import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductionOrdersRepository } from './repositories/production-orders.repository';
import { BomRepository } from './repositories/bom.repository';
import { WarehousesService } from '../inventory/warehouses.service';
import { LocationsService } from '../inventory/locations.service';
import { StockService } from '../inventory/stock.service';
import { ItemsService } from '../items/items.service';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { UpdateProductionOrderDto } from './dto/update-production-order.dto';
import { CompleteProductionOrderDto } from './dto/complete-production-order.dto';
import { QueryProductionOrdersDto } from './dto/query-production-orders.dto';
import { throwFromRpcError } from '../inventory/rpc-error.util';
import { OwnershipRepository } from '../ownership/repositories/ownership.repository';
import { AuditService } from '../../core/audit/audit.service';
import { OperationsService } from './operations.service';
import { ScrapService } from './scrap.service';
import { OutputsService } from './outputs.service';
import { QualityConfigService } from '../quality/quality-config.service';
import { InspectionsService } from '../quality/inspections.service';

@Injectable()
export class ProductionOrdersService {
  constructor(
    private readonly productionOrdersRepo: ProductionOrdersRepository,
    private readonly bomRepo: BomRepository,
    private readonly warehousesService: WarehousesService,
    private readonly locationsService: LocationsService,
    private readonly stockService: StockService,
    private readonly itemsService: ItemsService,
    private readonly ownershipRepo: OwnershipRepository,
    private readonly auditService: AuditService,
    private readonly operationsService: OperationsService,
    private readonly scrapService: ScrapService,
    private readonly outputsService: OutputsService,
    private readonly qualityConfigService: QualityConfigService,
    private readonly inspectionsService: InspectionsService,
  ) {}

  async findAll(tenantId: string, query: QueryProductionOrdersDto) {
    const pagination = new PaginationDto(query.page, query.perPage);
    const { data, total } = await this.productionOrdersRepo.findAll(
      tenantId,
      {
        status: query.status,
        warehouse_id: query.warehouse_id,
        date_from: query.date_from,
        date_to: query.date_to,
        search: query.search,
        sort: query.sort,
        dir: query.dir,
      },
      pagination,
    );
    return {
      data: (data as any[]).map((order) => ({
        ...order,
        warehouse_name: order.warehouse?.name ?? null,
        output_item_name: order.bom?.item?.name ?? null,
        output_item_sku: order.bom?.item?.sku ?? null,
      })),
      total,
      page: pagination.page,
      perPage: pagination.perPage,
    };
  }

  async findById(id: string, tenantId: string) {
    const order = await this.productionOrdersRepo.findById(id, tenantId);
    if (!order) throw new NotFoundException('Production order not found');
    return order;
  }

  // Full read-model for the detail endpoint — composes the production order
  // row with its BOM snapshot + components + (for completed orders) actual
  // consumption from the immutable stock_movements ledger. Reuses
  // BomRepository (no duplicated BOM business logic) and ItemsService (no
  // duplicated item lookup logic) — no new tables, no direct stock reads
  // beyond the existing stock_movements ledger.
  async getDetails(id: string, tenantId: string) {
    const order: any = await this.findById(id, tenantId);

    const bom: any = await this.bomRepo.findById(order.bom_id, tenantId);
    const bomLines: any[] = bom ? await this.bomRepo.findLines(bom.id, tenantId) : [];
    const bomItem = bom ? await this.itemsService.findById(bom.item_id, tenantId).catch(() => null) : null;

    const consumption =
      order.status === 'completed'
        ? await this.productionOrdersRepo.findConsumptionMovements(tenantId, id)
        : [];
    const consumedByItem = new Map<string, number>();
    for (const m of consumption) {
      const key = `${m.item_id}:${m.variant_id ?? ''}`;
      consumedByItem.set(key, (consumedByItem.get(key) ?? 0) + Number(m.quantity));
    }

    const components = await Promise.all(
      bomLines.map(async (line) => {
        const componentItem = await this.itemsService.findById(line.component_item_id, tenantId).catch(() => null);
        const key = `${line.component_item_id}:${line.component_variant_id ?? ''}`;
        return {
          id: line.id,
          component_item_id: line.component_item_id,
          component_variant_id: line.component_variant_id,
          product_name: componentItem?.name ?? null,
          product_sku: componentItem?.sku ?? null,
          quantity_per_unit: Number(line.quantity_per_unit),
          scrap_percentage: Number(line.scrap_percentage),
          consumed_quantity: consumedByItem.get(key) ?? null, // only populated for completed orders
          unit: null, // GAP — no unit-of-measure FK exists on items today (see Migration 6.7 report)
        };
      }),
    );

    return {
      ...order,
      warehouse_name: order.warehouse?.name ?? null,
      warehouse_code: order.warehouse?.code ?? null,
      work_center_name: order.work_center?.name ?? null,
      work_center_is_active: order.work_center?.is_active ?? null,
      created_by_name: order.created_by_user?.name ?? null,
      created_by_email: order.created_by_user?.email ?? null,
      bom: bom
        ? {
            id: bom.id,
            version: bom.version,
            is_active: bom.is_active,
            notes: bom.notes,
            output_item_id: bom.item_id,
            output_item_name: bomItem?.name ?? null,
            output_item_sku: bomItem?.sku ?? null,
          }
        : null,
      components,
    };
  }

  private async validateLocations(
    tenantId: string,
    warehouseId: string,
    dto: { source_location_id?: string; staging_location_id?: string; output_location_id?: string },
  ) {
    for (const locationId of [dto.source_location_id, dto.staging_location_id, dto.output_location_id]) {
      if (locationId) {
        await this.locationsService.findById(locationId, warehouseId, tenantId); // throws if missing/mismatched warehouse
      }
    }
  }

  async create(tenantId: string, dto: CreateProductionOrderDto) {
    await this.warehousesService.findById(dto.warehouse_id, tenantId); // throws NotFoundException if missing
    const bom = await this.bomRepo.findById(dto.bom_id, tenantId);
    if (!bom) throw new NotFoundException('BOM not found');
    if (!(bom as any).is_active) {
      throw new BadRequestException('Cannot create a production order against an inactive BOM');
    }
    await this.validateLocations(tenantId, dto.warehouse_id, dto);

    const order = await this.productionOrdersRepo.create(tenantId, {
      warehouse_id: dto.warehouse_id,
      bom_id: dto.bom_id,
      work_center_id: dto.work_center_id ?? null,
      order_number: dto.order_number,
      quantity_planned: dto.quantity_planned,
      scheduled_date: dto.scheduled_date ?? null,
      source_location_id: dto.source_location_id ?? null,
      staging_location_id: dto.staging_location_id ?? null,
      output_location_id: dto.output_location_id ?? null,
      notes: dto.notes ?? null,
    });
    return order;
  }

  async update(id: string, tenantId: string, dto: UpdateProductionOrderDto) {
    const existing: any = await this.findById(id, tenantId);
    if (existing.status !== 'draft') {
      throw new BadRequestException(`Production order ${id} is not in draft status (status=${existing.status})`);
    }
    if (dto.source_location_id || dto.staging_location_id || dto.output_location_id) {
      await this.validateLocations(tenantId, existing.warehouse_id, dto);
    }

    const updated = await this.productionOrdersRepo.update(id, tenantId, { ...dto });
    if (!updated) {
      throw new BadRequestException(`Production order ${id} is not in draft status`);
    }
    return updated;
  }

  async start(id: string, tenantId: string) {
    const existing = await this.findById(id, tenantId);
    if ((existing as any).status !== 'draft') {
      throw new BadRequestException(`Production order ${id} is not in draft status (status=${(existing as any).status})`);
    }
    const started = await this.productionOrdersRepo.start(id, tenantId);
    if (!started) {
      throw new BadRequestException(`Production order ${id} is not in draft status`);
    }
    return started;
  }

  // Migration 10.1 (#20) — blocks completion if any BOM component currently
  // has an active non-company ownership layer (customer/consignment-owned
  // raw material). This is an application-layer guard only — it never
  // touches fn_post_production_order or any Manufacturing RPC. Proper
  // ownership-aware component consumption is deferred to a later phase;
  // for now this guard exists specifically to prevent fn_post_production_
  // order from silently consuming owned components and orphaning their
  // ownership layers (no consumption path for production exists yet).
  private async assertNoOwnedComponents(tenantId: string, warehouseId: string, bomId: string) {
    const lines: any[] = await this.bomRepo.findLines(bomId, tenantId);
    for (const line of lines) {
      const activeLayers = await this.ownershipRepo.findActiveForItem(
        tenantId,
        warehouseId,
        line.component_item_id,
        line.component_variant_id ?? null,
      );
      if (activeLayers.length > 0) {
        throw new BadRequestException(
          `Cannot complete production order: component ${line.component_item_id} has active non-company ownership — ownership-aware production consumption is not yet supported`,
        );
      }
    }
  }

  async complete(id: string, tenantId: string, actorId: string | null, dto: CompleteProductionOrderDto) {
    const existing: any = await this.findById(id, tenantId); // 404 if missing, before hitting the RPC
    await this.assertNoOwnedComponents(tenantId, existing.warehouse_id, existing.bom_id);
    // Migration 13.16A — routing gate: a no-op for the overwhelming majority
    // of production orders (zero operations rows). Only blocks completion
    // when the order actually has routing operations and at least one is
    // still not 'completed'. fn_post_production_order itself is untouched.
    await this.operationsService.assertAllOperationsComplete(id, tenantId);
    try {
      const result = await this.productionOrdersRepo.complete(id, actorId, dto.quantity_produced);
      await this.stockService.invalidateStockCache(tenantId);
      // Migration 13.16A — optional scrap posting, orchestrated at the
      // application layer immediately after the existing, unmodified
      // fn_post_production_order call succeeds. Absent entirely (dto.scrap
      // undefined) for every caller that doesn't use this — no behavior
      // change to the completion flow itself.
      if (dto.scrap?.length) {
        for (const scrapEntry of dto.scrap) {
          await this.scrapService.record(id, tenantId, actorId, scrapEntry);
        }
      }
      // Migration 13.16B — By-products (#16). Two independent, additive
      // steps, both after the existing fn_post_production_order call:
      // (1) mirror the main product's own receipt (already posted by that
      // unmodified call) into production_order_outputs for visibility —
      // does not post anything new; (2) receive every by_product output
      // row planned ahead via POST .../outputs (a no-op when none exist,
      // i.e. every production order that doesn't use by-products).
      const bom: any = await this.bomRepo.findById(existing.bom_id, tenantId);
      if (bom) {
        const mainMovement = await this.productionOrdersRepo.findMainReceiptMovement(
          tenantId, id, bom.item_id, bom.variant_id ?? null,
        );
        if (mainMovement) {
          await this.outputsService.recordMainProductOutput(
            id, tenantId, bom.item_id, bom.variant_id ?? null,
            Number(mainMovement.quantity), Number(mainMovement.unit_cost), mainMovement.id,
          );
        }
      }
      await this.outputsService.receiveAllUnposted(id, tenantId, existing.warehouse_id, actorId);
      // Migration 13.19 — Manufacturing Quality Gate. Additive step AFTER
      // the existing, unmodified fn_post_production_order call succeeds
      // (output already received into stock via that unmodified RPC) — does
      // NOT touch production costing, the stock ledger, or completion
      // logic. Best-effort: a quality-config lookup failure must never
      // block a production completion that already succeeded.
      if (bom) {
        try {
          const rule = await this.qualityConfigService.resolvePlan(
            tenantId, 'production_output', bom.item_id, null, null, existing.warehouse_id,
          );
          if (rule?.action === 'require_inspection') {
            await this.inspectionsService.create(tenantId, {
              reference_type: 'production_order',
              reference_id: id,
              item_id: bom.item_id,
              variant_id: bom.variant_id ?? undefined,
              template_id: rule.template_id ?? undefined,
              warehouse_id: existing.warehouse_id,
              quantity_inspected: Number(result.quantity_produced ?? dto.quantity_produced ?? 0),
            } as any, actorId ?? undefined as any);
          }
        } catch {
          // best-effort — never block the already-completed production order
        }
      }
      // Manual audit call (no @Audit() decorator on this route) — captures
      // before_data (pre-completion status/quantities), which the
      // interceptor alone never does. actorId is already available here,
      // unlike update()/start()/cancel(), which use the decorator instead.
      if (actorId) {
        await this.auditService
          .log({
            tenant_id: tenantId,
            actor_id: actorId,
            action: 'production_order.completed',
            resource_type: 'production_order',
            resource_id: id,
            before_data: existing,
            after_data: result as unknown as Record<string, unknown>,
          })
          .catch(() => {}); // audit failure must never affect the production posting
      }
      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  // Migration 6.8 — cancellable from draft or in_progress; no stock reversal
  // needed since fn_post_production_order hasn't run in either status.
  async cancel(id: string, tenantId: string) {
    const existing = await this.findById(id, tenantId);
    if (!['draft', 'in_progress'].includes((existing as any).status)) {
      throw new BadRequestException(
        `Production order ${id} cannot be cancelled from status=${(existing as any).status}`,
      );
    }
    const cancelled = await this.productionOrdersRepo.cancel(id, tenantId);
    if (!cancelled) {
      throw new BadRequestException(`Production order ${id} cannot be cancelled from its current status`);
    }
    return cancelled;
  }
}
