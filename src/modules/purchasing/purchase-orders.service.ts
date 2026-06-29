import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PurchaseOrdersRepository } from './repositories/purchase-orders.repository';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';

@Injectable()
export class PurchaseOrdersService {
  constructor(private readonly purchaseOrdersRepo: PurchaseOrdersRepository) {}

  async findAll(tenantId: string, status?: string) {
    const orders = await this.purchaseOrdersRepo.findAll(tenantId, status);
    return (orders ?? []).map((po: any) => ({
      ...po,
      supplier_name: po.suppliers?.name ?? null,
      warehouse_name: po.warehouses?.name ?? null,
    }));
  }

  async findById(id: string, tenantId: string) {
    const po: any = await this.purchaseOrdersRepo.findById(id, tenantId);
    if (!po) throw new NotFoundException('Purchase order not found');
    return {
      ...po,
      supplier_name: po.suppliers?.name ?? null,
      warehouse_name: po.warehouses?.name ?? null,
      items: (po.items ?? []).map((item: any) => ({
        ...item,
        item_name: item.items?.name ?? null,
      })),
    };
  }

  create(tenantId: string, dto: CreatePurchaseOrderDto, createdBy: string) {
    const { items, ...header } = dto;
    return this.purchaseOrdersRepo.create(
      tenantId,
      {
        supplier_id: header.supplier_id,
        warehouse_id: header.warehouse_id,
        order_number: header.order_number,
        order_date: header.order_date ?? new Date().toISOString().slice(0, 10),
        expected_date: header.expected_date ?? null,
        notes: header.notes ?? null,
      },
      items.map((line) => ({
        item_id: line.item_id,
        variant_id: line.variant_id ?? null,
        quantity_ordered: line.quantity_ordered,
        unit_cost: line.unit_cost,
      })),
      createdBy,
    );
  }

  async update(id: string, tenantId: string, dto: UpdatePurchaseOrderDto) {
    const po = await this.findById(id, tenantId);
    if (po.status !== 'draft') {
      throw new ForbiddenException('Only draft purchase orders can be edited');
    }
    return this.purchaseOrdersRepo.update(id, tenantId, { ...dto });
  }

  async submit(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.purchaseOrdersRepo.submit(id, tenantId);
  }

  async approve(id: string, tenantId: string, approvedBy: string) {
    await this.findById(id, tenantId);
    return this.purchaseOrdersRepo.approve(id, tenantId, approvedBy);
  }

  async cancel(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.purchaseOrdersRepo.cancel(id, tenantId);
  }

  async remove(id: string, tenantId: string) {
    const po = await this.findById(id, tenantId);
    if (po.status !== 'draft') {
      throw new ForbiddenException('Only draft purchase orders can be deleted');
    }
    await this.purchaseOrdersRepo.softDelete(id, tenantId);
  }
}
