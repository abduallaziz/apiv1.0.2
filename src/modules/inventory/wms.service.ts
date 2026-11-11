import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { WmsRepository } from './repositories/wms.repository';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { CreatePickListDto } from './dto/create-pick-list.dto';
import { CreateZoneSplitPickListsDto } from './dto/create-zone-split-pick-lists.dto';
import { CreateWaveDto } from './dto/create-wave.dto';
import {
  ShipmentsQueryDto,
  PickListsQueryDto,
  WavesQueryDto,
  ExceptionsQueryDto,
} from './dto/wms-list-query.dto';
import { LocationsService } from './locations.service';
import { StockService } from './stock.service';
import { WarehousesService } from './warehouses.service';
import { throwFromRpcError } from './rpc-error.util';
import { AuditService } from '../../core/audit/audit.service';

@Injectable()
export class WmsService {
  constructor(
    private readonly wmsRepo: WmsRepository,
    private readonly locationsService: LocationsService,
    private readonly stockService: StockService,
    private readonly warehousesService: WarehousesService,
    private readonly auditService: AuditService,
  ) {}

  // Same pattern as WarehouseTasksService.resolveBranchForWarehouse —
  // audit_logs.branch_id is best-effort, never blocks the actual action.
  private async resolveBranchForWarehouse(
    warehouseId: string | null | undefined,
    tenantId: string,
  ): Promise<string | null> {
    if (!warehouseId) return null;
    try {
      const warehouse = await this.warehousesService.findById(
        warehouseId,
        tenantId,
      );
      return (warehouse as { branch_id?: string | null })?.branch_id ?? null;
    } catch {
      return null;
    }
  }

  // Shipments

  async findShipments(tenantId: string, status?: string): Promise<unknown>;
  async findShipments(
    tenantId: string,
    query: ShipmentsQueryDto,
  ): Promise<unknown>;
  async findShipments(tenantId: string, arg?: string | ShipmentsQueryDto) {
    const result = await this.wmsRepo.findShipments(tenantId, arg as any);
    return Array.isArray(result) ? result : (result ?? []);
  }

  async findShipmentById(id: string, tenantId: string) {
    const shipment = await this.wmsRepo.findShipmentById(id, tenantId);
    if (!shipment) throw new NotFoundException('Shipment not found');
    return shipment;
  }

  async createShipment(tenantId: string, dto: CreateShipmentDto) {
    const { items, ...header } = dto;

    for (const line of items) {
      if (line.location_id) {
        await this.locationsService.findById(
          line.location_id,
          header.warehouse_id,
          tenantId,
        );
      }
    }

    return this.wmsRepo.createShipment(
      tenantId,
      {
        warehouse_id: header.warehouse_id,
        reference_type: header.reference_type,
        reference_id: header.reference_id,
      },
      items.map((line) => ({
        item_id: line.item_id,
        variant_id: line.variant_id ?? null,
        location_id: line.location_id ?? null,
        quantity_requested: line.quantity_requested,
      })),
    );
  }

  // Inventory #7 / 7-7 (Owner-approved) — reconciled to the same reason/
  // actor/audit contract every other cancel action in this module uses.
  async cancelShipment(
    id: string,
    tenantId: string,
    reason: string,
    actorId: string,
  ) {
    const existing = await this.findShipmentById(id, tenantId);
    try {
      const result = await this.wmsRepo.cancelShipment(
        id,
        tenantId,
        reason,
        actorId,
      );

      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'shipment.cancelled',
          resource_type: 'shipment',
          resource_id: id,
          after_data: { reason },
          branch_id: await this.resolveBranchForWarehouse(
            (existing as { warehouse_id?: string | null })?.warehouse_id,
            tenantId,
          ),
        })
        .catch(() => {});

      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async shipShipment(
    id: string,
    tenantId: string,
    actorId: string,
    trackingNumber?: string,
  ) {
    await this.findShipmentById(id, tenantId);
    try {
      const result = await this.wmsRepo.shipShipment(
        id,
        actorId,
        trackingNumber,
      );
      await this.stockService.invalidateStockCache(tenantId);
      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async confirmPack(
    shipmentLineId: string,
    tenantId: string,
    quantity: number,
    actorId: string,
  ) {
    // fn_confirm_pack takes no tenant argument: ownership must be proven here.
    if (
      !(await this.wmsRepo.shipmentLineBelongsToTenant(shipmentLineId, tenantId))
    ) {
      throw new NotFoundException('Shipment line not found');
    }
    try {
      return await this.wmsRepo.confirmPack(shipmentLineId, quantity, actorId);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  // Inventory #7 / 7-7 (Owner-approved) — Exception Handling Primitives.
  // Each RPC (fn_record_short_pick/fn_record_damage/fn_record_lost_item)
  // already writes the warehouse_exceptions row, the reservation
  // reduction, and any warehouse_work_status_history transitions inside
  // its own transaction — the service layer only adds the audit_logs
  // entry, following the exact same pattern as every other action here.
  async recordShortPick(
    shipmentLineId: string,
    tenantId: string,
    reason: string,
    actorId: string,
  ) {
    try {
      const result = await this.wmsRepo.recordShortPick(
        shipmentLineId,
        tenantId,
        reason,
        actorId,
      );

      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'shipment_line.short_pick',
          resource_type: 'shipment_line',
          resource_id: shipmentLineId,
          after_data: {
            reason,
            affected_quantity: (result as { affected_quantity?: number })
              ?.affected_quantity,
          },
        })
        .catch(() => {});

      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async recordDamage(
    shipmentLineId: string,
    tenantId: string,
    quantity: number,
    reason: string,
    actorId: string,
  ) {
    try {
      const result = await this.wmsRepo.recordDamage(
        shipmentLineId,
        tenantId,
        quantity,
        reason,
        actorId,
      );

      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'shipment_line.damaged',
          resource_type: 'shipment_line',
          resource_id: shipmentLineId,
          after_data: { reason, affected_quantity: quantity },
        })
        .catch(() => {});

      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async recordLostItem(
    shipmentLineId: string,
    tenantId: string,
    quantity: number,
    reason: string,
    actorId: string,
  ) {
    try {
      const result = await this.wmsRepo.recordLostItem(
        shipmentLineId,
        tenantId,
        quantity,
        reason,
        actorId,
      );

      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'shipment_line.lost',
          resource_type: 'shipment_line',
          resource_id: shipmentLineId,
          after_data: { reason, affected_quantity: quantity },
        })
        .catch(() => {});

      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async recoverLostItem(
    exceptionId: string,
    tenantId: string,
    quantity: number,
    reason: string,
    actorId: string,
    unitCost?: number,
  ) {
    try {
      const result = await this.wmsRepo.recoverLostItem(
        exceptionId,
        tenantId,
        quantity,
        reason,
        actorId,
        unitCost,
      );

      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'warehouse_exception.lost_item_recovered',
          resource_type: 'warehouse_exception',
          resource_id: exceptionId,
          after_data: { reason, quantity },
        })
        .catch(() => {});

      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  findExceptions(
    tenantId: string,
    entityType?: string,
    entityId?: string,
  ): unknown;
  findExceptions(tenantId: string, query: ExceptionsQueryDto): unknown;
  findExceptions(
    tenantId: string,
    arg2?: string | ExceptionsQueryDto,
    arg3?: string,
  ) {
    if (typeof arg2 === 'object') {
      return this.wmsRepo.findExceptions(tenantId, arg2);
    }
    return this.wmsRepo.findExceptions(tenantId, arg2, arg3);
  }

  // Pick lists

  async findPickLists(tenantId: string, status?: string): Promise<unknown>;
  async findPickLists(
    tenantId: string,
    query: PickListsQueryDto,
  ): Promise<unknown>;
  async findPickLists(tenantId: string, arg?: string | PickListsQueryDto) {
    const result = await this.wmsRepo.findPickLists(tenantId, arg as any);
    return Array.isArray(result) ? result : (result ?? []);
  }

  async findPickListById(id: string, tenantId: string) {
    const pickList = await this.wmsRepo.findPickListById(id, tenantId);
    if (!pickList) throw new NotFoundException('Pick list not found');
    return pickList;
  }

  async createPickList(
    tenantId: string,
    dto: CreatePickListDto,
    actorId: string,
  ) {
    try {
      const result = await this.wmsRepo.createPickList(
        tenantId,
        dto.warehouse_id,
        dto.shipment_ids,
        dto.strategy,
        dto.zone_location_id ?? null,
        actorId,
        dto.priority,
      );

      // Inventory #7 / 7-2 (Owner-approved) — real gap found within this
      // item's exact scope: pick-list creation had no audit_logs entry at
      // all (unlike warehouse_tasks.create, which already had one before
      // 7-1). Fixed here, not deferred.
      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'pick_list.created',
          resource_type: 'pick_list',
          resource_id: (result as { id?: string })?.id,
          branch_id: await this.resolveBranchForWarehouse(
            dto.warehouse_id,
            tenantId,
          ),
        })
        .catch(() => {});

      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  // Inventory #7 / 7-4/7-5 (Owner-approved) — Wave create + evaluate.

  async createWave(tenantId: string, dto: CreateWaveDto, actorId: string) {
    const result = await this.wmsRepo.createWave(
      tenantId,
      dto.warehouse_id,
      dto.criteria,
      actorId,
    );

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'wave.created',
        resource_type: 'wave',
        resource_id: (result as { id?: string })?.id,
        after_data: { criteria: dto.criteria ?? {} },
        branch_id: await this.resolveBranchForWarehouse(
          dto.warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return result;
  }

  findWaves(tenantId: string, status?: string): unknown;
  findWaves(tenantId: string, query: WavesQueryDto): unknown;
  findWaves(tenantId: string, arg?: string | WavesQueryDto) {
    return this.wmsRepo.findWaves(tenantId, arg as any);
  }

  async findWaveById(id: string, tenantId: string) {
    const wave = await this.wmsRepo.findWaveById(id, tenantId);
    if (!wave) throw new NotFoundException('Wave not found');
    return wave;
  }

  async evaluateWaveEligibility(id: string, tenantId: string, actorId: string) {
    const existing = await this.findWaveById(id, tenantId);
    try {
      const result = await this.wmsRepo.evaluateWaveEligibility(
        id,
        tenantId,
        actorId,
      );

      const included = (result ?? []).filter(
        (r: { included_reason: unknown }) => r.included_reason !== null,
      ).length;
      const excluded = (result ?? []).length - included;

      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'wave.evaluated',
          resource_type: 'wave',
          resource_id: id,
          after_data: { included, excluded },
          branch_id: await this.resolveBranchForWarehouse(
            (existing as { warehouse_id?: string | null })?.warehouse_id,
            tenantId,
          ),
        })
        .catch(() => {});

      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  // Inventory #7 / 7-6 (Owner-approved) — Wave Claim + Release. Claim is
  // an atomic sub-step inside fn_release_wave's own transaction (see
  // migration 237), so there is deliberately no separate claimWave()
  // here — the approved status enum has no durable "claimed" state.
  async releaseWave(
    id: string,
    tenantId: string,
    actorId: string,
    priority?: string,
  ) {
    const existing = await this.findWaveById(id, tenantId);
    let result: Awaited<ReturnType<WmsRepository['releaseWave']>>;
    try {
      result = await this.wmsRepo.releaseWave(id, tenantId, actorId, priority);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }

    // fn_release_wave (migration 238) never raises for "nothing
    // claimable" — it commits the exclusion-reason bookkeeping and
    // returns zero rows, leaving the wave untouched in 'reviewing' so
    // the audit trail is never discarded by a rollback. The API layer
    // is where "fail loudly to the caller" belongs instead: an empty
    // result here means this call genuinely released nothing, which is
    // always worth surfacing as an error rather than a silent 200 with
    // an empty array. Kept outside the try/catch above so it is never
    // re-wrapped by throwFromRpcError, which exists for Postgres/RPC
    // errors, not this application-level decision.
    if (!result || result.length === 0) {
      throw new BadRequestException(
        'WAVE_NO_ELIGIBLE_SHIPMENTS: no shipments could be claimed for this wave (none were eligible, or every eligible shipment is no longer available)',
      );
    }

    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'wave.released',
        resource_type: 'wave',
        resource_id: id,
        after_data: {
          pick_list_ids: result.map((pl: { id?: string }) => pl.id),
        },
        branch_id: await this.resolveBranchForWarehouse(
          (existing as { warehouse_id?: string | null })?.warehouse_id,
          tenantId,
        ),
      })
      .catch(() => {});

    return result;
  }

  async cancelWave(
    id: string,
    tenantId: string,
    reason: string,
    actorId: string,
  ) {
    const existing = await this.findWaveById(id, tenantId);
    try {
      const result = await this.wmsRepo.cancelWave(
        id,
        tenantId,
        reason,
        actorId,
      );

      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'wave.cancelled',
          resource_type: 'wave',
          resource_id: id,
          after_data: { reason },
          branch_id: await this.resolveBranchForWarehouse(
            (existing as { warehouse_id?: string | null })?.warehouse_id,
            tenantId,
          ),
        })
        .catch(() => {});

      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  // Inventory #7 / 7-3 (Owner-approved) — automatic multi-zone splitting
  // (§5.1: never reject, never silently lose lines). Creates one 'zone'
  // pick list per zone actually represented among the given shipments'
  // lines, each independently audited.
  async createZoneSplitPickLists(
    tenantId: string,
    dto: CreateZoneSplitPickListsDto,
    actorId: string,
  ) {
    try {
      const results = await this.wmsRepo.createZoneSplitPickLists(
        tenantId,
        dto.warehouse_id,
        dto.shipment_ids,
        actorId,
        dto.priority,
      );

      const branchId = await this.resolveBranchForWarehouse(
        dto.warehouse_id,
        tenantId,
      );
      for (const pickList of (results ?? []) as { id: string }[]) {
        await this.auditService
          .log({
            tenant_id: tenantId,
            actor_id: actorId,
            action: 'pick_list.created',
            resource_type: 'pick_list',
            resource_id: pickList.id,
            after_data: { via: 'zone_split', shipment_ids: dto.shipment_ids },
            branch_id: branchId,
          })
          .catch(() => {});
      }

      return results;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  // Inventory #7 / 7-2 (Owner-approved) — real assignment/reassignment;
  // pick_lists.assigned_to was never set anywhere before this item.
  async assignPickList(
    id: string,
    tenantId: string,
    assignedTo: string,
    actorId: string,
  ) {
    const existing = await this.findPickListById(id, tenantId);
    try {
      const result = await this.wmsRepo.assignPickList(
        id,
        tenantId,
        assignedTo,
        actorId,
      );

      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'pick_list.assigned',
          resource_type: 'pick_list',
          resource_id: id,
          branch_id: await this.resolveBranchForWarehouse(
            (existing as { warehouse_id?: string | null })?.warehouse_id,
            tenantId,
          ),
        })
        .catch(() => {});

      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  // Inventory #7 / 7-2 (Owner-approved) — no pick-list-level cancel
  // existed before this item.
  async cancelPickList(
    id: string,
    tenantId: string,
    reason: string,
    actorId: string,
  ) {
    const existing = await this.findPickListById(id, tenantId);
    try {
      const result = await this.wmsRepo.cancelPickList(
        id,
        tenantId,
        reason,
        actorId,
      );
      await this.stockService.invalidateStockCache(tenantId);

      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'pick_list.cancelled',
          resource_type: 'pick_list',
          resource_id: id,
          after_data: { reason },
          branch_id: await this.resolveBranchForWarehouse(
            (existing as { warehouse_id?: string | null })?.warehouse_id,
            tenantId,
          ),
        })
        .catch(() => {});

      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  pickListHistory(id: string, tenantId: string) {
    return this.wmsRepo.findPickListHistory(id, tenantId);
  }

  waveHistory(id: string, tenantId: string) {
    return this.wmsRepo.findWaveHistory(id, tenantId);
  }

  // Migration 13.20 — batchId is optional (non-batch-tracked items pass
  // undefined). fn_validate_pick_requirements (migration 171) raises if the
  // item requires a batch/serial and none was given, or if FEFO would be
  // violated — called BEFORE fn_confirm_pick, never inside it, so the
  // existing tested picking engine is untouched.
  async confirmPick(
    pickListLineId: string,
    tenantId: string,
    quantity: number,
    actorId: string,
    batchId?: string,
  ) {
    try {
      const line: any = await this.wmsRepo.findPickListLineWithContext(
        pickListLineId,
        tenantId,
      );
      if (!line) throw new NotFoundException('Pick list line not found');
      const warehouseId = line.pick_lists?.warehouse_id;

      await this.wmsRepo.validatePickRequirements(
        tenantId,
        warehouseId,
        line.item_id,
        line.variant_id ?? null,
        quantity,
        batchId ?? line.batch_id ?? null,
      );
      if (batchId) {
        await this.wmsRepo.setPickListLineBatch(
          pickListLineId,
          tenantId,
          batchId,
        );
      }

      const result = await this.wmsRepo.confirmPick(
        pickListLineId,
        quantity,
        actorId,
      );
      await this.stockService.invalidateStockCache(tenantId);

      // Inventory #7 / 7-2 completeness fix (Owner-approved) — confirmPick
      // was the one pick-list lifecycle transition with no audit_logs
      // entry at all (create/assign/reassign/cancel all had one).
      // warehouse_work_status_history already correctly records the
      // pick_list-level completion transition (migration 225); this adds
      // the missing per-confirm actor/narrative entry, same granularity
      // WarehouseTasksService.confirm() already uses.
      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'pick_list.pick_confirmed',
          resource_type: 'pick_list',
          resource_id: line.pick_list_id,
          after_data: { pick_list_line_id: pickListLineId, quantity },
          branch_id: await this.resolveBranchForWarehouse(
            warehouseId,
            tenantId,
          ),
        })
        .catch(() => {});

      return result;
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }
}
