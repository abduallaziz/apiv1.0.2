import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SubcontractOrdersRepository } from './repositories/subcontract-orders.repository';
import { SuppliersService } from '../purchasing/suppliers.service';
import { WarehousesService } from '../inventory/warehouses.service';
import { ItemsService } from '../items/items.service';
import { CreateSubcontractOrderDto } from './dto/create-subcontract-order.dto';
import { CreateSubcontractCostDto } from './dto/create-subcontract-cost.dto';
import { throwFromRpcError } from '../inventory/rpc-error.util';

@Injectable()
export class SubcontractOrdersService {
  constructor(
    private readonly subcontractOrdersRepo: SubcontractOrdersRepository,
    private readonly suppliersService: SuppliersService,
    private readonly warehousesService: WarehousesService,
    private readonly itemsService: ItemsService,
  ) {}

  findAll(tenantId: string, status?: string) {
    return this.subcontractOrdersRepo.findAll(tenantId, status);
  }

  async findById(id: string, tenantId: string) {
    const order = await this.subcontractOrdersRepo.findById(id, tenantId);
    if (!order) throw new NotFoundException('Subcontract order not found');
    return order;
  }

  async create(tenantId: string, createdBy: string | null, dto: CreateSubcontractOrderDto) {
    await this.warehousesService.findById(dto.warehouse_id, tenantId); // 404 if missing/wrong tenant

    const supplier: any = await this.suppliersService.findById(dto.supplier_id, tenantId); // 404 if missing
    if (!supplier.is_subcontractor) {
      throw new BadRequestException('The selected supplier is not marked as a subcontractor');
    }

    if (!dto.lines?.length) {
      throw new BadRequestException('At least one line is required');
    }
    for (const line of dto.lines) {
      await this.itemsService.findById(line.material_item_id, tenantId); // 404 if missing
      await this.itemsService.findById(line.output_item_id, tenantId); // 404 if missing
    }

    return this.subcontractOrdersRepo.create(
      tenantId,
      createdBy,
      {
        production_order_id: dto.production_order_id ?? null,
        supplier_id: dto.supplier_id,
        warehouse_id: dto.warehouse_id,
        order_number: dto.order_number,
        notes: dto.notes ?? null,
      },
      dto.lines.map((line) => ({
        material_item_id: line.material_item_id,
        material_variant_id: line.material_variant_id ?? null,
        quantity_sent: line.quantity_sent,
        output_item_id: line.output_item_id,
        output_variant_id: line.output_variant_id ?? null,
        output_quantity: line.output_quantity,
      })),
    );
  }

  async send(id: string, tenantId: string, actorId: string | null) {
    await this.findById(id, tenantId); // 404 before hitting the RPC
    try {
      return await this.subcontractOrdersRepo.send(tenantId, id, actorId);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async receive(id: string, tenantId: string, actorId: string | null) {
    await this.findById(id, tenantId);
    try {
      return await this.subcontractOrdersRepo.receive(tenantId, id, actorId);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }

  async findCosts(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.subcontractOrdersRepo.findCosts(id, tenantId);
  }

  // Costs must be added before receive() runs the allocation
  // (fn_receive_subcontract_output sums subcontract_costs at that moment,
  // exactly once) — enforced here at the application layer, matching the
  // identical "draft-only" rule LandedCostsService already applies for
  // Goods Receipts (Migration 13.15-fix).
  async addCost(id: string, tenantId: string, createdBy: string | null, dto: CreateSubcontractCostDto) {
    const order: any = await this.findById(id, tenantId);
    if (order.status === 'received' || order.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot add a cost to subcontract order with status "${order.status}" — costs must be added before the order is received`,
      );
    }
    return this.subcontractOrdersRepo.addCost(id, tenantId, createdBy, {
      cost_type: dto.cost_type,
      amount: dto.amount,
      notes: dto.notes ?? null,
    });
  }
}
