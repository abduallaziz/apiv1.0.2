import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MrpRepository } from './repositories/mrp.repository';
import { ProductionOrdersService } from './production-orders.service';
import { PurchaseRequestsService } from '../purchasing/purchase-requests.service';
import { PermissionsService } from '../../core/permissions/permissions.service';

// Two-permission conversion model (approved design, migration 13.17 Phase B):
// every MRP endpoint requires 'manufacturing.plan' (enforced by the
// controller's @RequirePermission decorator, same as every other route).
// Conversion ADDITIONALLY requires a second, order-type-specific permission
// checked here in the service, since a single decorator can't branch on
// request data: purchase-type -> 'purchasing.manage', production-type ->
// 'manufacturing.manage'.
@Injectable()
export class MrpService {
  constructor(
    private readonly mrpRepo: MrpRepository,
    private readonly productionOrdersService: ProductionOrdersService,
    private readonly purchaseRequestsService: PurchaseRequestsService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async run(tenantId: string, warehouseId: string) {
    const mrpRunId = await this.mrpRepo.runMrp(tenantId, warehouseId);
    return this.mrpRepo.findPlannedOrders(tenantId).then((rows) =>
      rows.filter((r: any) => r.mrp_run_id === mrpRunId),
    );
  }

  findAll(tenantId: string, status?: string, orderType?: string) {
    return this.mrpRepo.findPlannedOrders(tenantId, status, orderType);
  }

  async findById(id: string, tenantId: string) {
    const order = await this.mrpRepo.findPlannedOrderById(id, tenantId);
    if (!order) throw new NotFoundException('Planned order not found');
    return order;
  }

  async approve(id: string, tenantId: string) {
    const order = await this.findById(id, tenantId);
    if (order.status !== 'proposed') {
      throw new BadRequestException(`Cannot approve a planned order with status: ${order.status}`);
    }
    return this.mrpRepo.updateStatus(id, tenantId, 'approved');
  }

  async cancel(id: string, tenantId: string) {
    const order = await this.findById(id, tenantId);
    if (order.status === 'converted') {
      throw new BadRequestException('Cannot cancel a planned order that has already been converted');
    }
    return this.mrpRepo.updateStatus(id, tenantId, 'cancelled');
  }

  async convert(
    id: string,
    tenantId: string,
    userRole: string,
    requestedBy: string,
  ) {
    const order = await this.findById(id, tenantId);
    if (order.status !== 'approved') {
      throw new BadRequestException(
        `Cannot convert a planned order with status: ${order.status} — it must be approved first`,
      );
    }

    if (order.order_type === 'purchase') {
      const allowed = await this.permissionsService.hasPermission(userRole, 'purchasing.manage', tenantId);
      if (!allowed) throw new ForbiddenException('Permission denied: purchasing.manage');

      const pr = await this.purchaseRequestsService.createFromSuggestions(
        tenantId,
        {
          warehouse_id: order.warehouse_id,
          notes: 'Generated from MRP planned order',
          items: [{ item_id: order.item_id, variant_id: order.variant_id ?? undefined, quantity_requested: Number(order.quantity) }],
        },
        requestedBy,
      );
      return this.mrpRepo.updateStatus(id, tenantId, 'converted', {
        referenceType: 'purchase_request',
        referenceId: pr.id,
      });
    }

    // production
    const allowed = await this.permissionsService.hasPermission(userRole, 'manufacturing.manage', tenantId);
    if (!allowed) throw new ForbiddenException('Permission denied: manufacturing.manage');

    const po = await this.productionOrdersService.create(tenantId, {
      warehouse_id: order.warehouse_id,
      bom_id: order.bom_id,
      order_number: `PO-MRP-${Date.now()}`,
      quantity_planned: Number(order.quantity),
      notes: 'Generated from MRP planned order',
    });
    return this.mrpRepo.updateStatus(id, tenantId, 'converted', {
      referenceType: 'production_order',
      referenceId: po.id,
    });
  }
}
