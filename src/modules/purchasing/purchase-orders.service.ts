import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PurchaseOrdersRepository } from './repositories/purchase-orders.repository';
import { PaginationDto } from '../../shared/dto/pagination.dto';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { RejectPurchaseOrderDto } from './dto/reject-purchase-order.dto';
import { ApprovalEngine } from '../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../engines/approval-engine/approval-history.repository';

const PO_REFERENCE_TYPE = 'purchase_order';
const PO_PENDING_STATUS = 'submitted' as const;

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly purchaseOrdersRepo: PurchaseOrdersRepository,
    private readonly approvalEngine: ApprovalEngine,
    private readonly approvalHistory: ApprovalHistoryRepository,
  ) {}

  async findAll(
    tenantId: string,
    status?: string,
    page?: string,
    perPage?: string,
  ) {
    return (
      (await this.purchaseOrdersRepo.findAll(
        tenantId,
        status,
        new PaginationDto(page, perPage),
      )) ?? []
    );
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
    const po = await this.findById(id, tenantId);
    if (!this.approvalEngine.canApprove(po.status, PO_PENDING_STATUS)) {
      throw new BadRequestException(
        `Cannot approve purchase order with status: ${po.status}`,
      );
    }
    const result = this.approvalEngine.approve(approvedBy);
    const updated = await this.purchaseOrdersRepo.approve(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
    );
    await this.approvalHistory.record({
      tenantId,
      referenceType: PO_REFERENCE_TYPE,
      referenceId: id,
      action: 'approved',
      actorId: approvedBy,
      previousStatus: po.status,
      newStatus: 'approved',
    });
    return updated;
  }

  async reject(
    id: string,
    tenantId: string,
    rejectedBy: string,
    dto: RejectPurchaseOrderDto,
  ) {
    const po = await this.findById(id, tenantId);
    if (!this.approvalEngine.canReject(po.status, PO_PENDING_STATUS)) {
      throw new BadRequestException(
        `Cannot reject purchase order with status: ${po.status}`,
      );
    }
    const result = this.approvalEngine.reject(rejectedBy, dto.reason);
    const note = po.notes
      ? `${po.notes} | Rejected: ${result.reason}`
      : `Rejected: ${result.reason}`;
    const updated = await this.purchaseOrdersRepo.reject(
      id,
      tenantId,
      result.resolvedBy,
      result.resolvedAt,
      note,
    );
    await this.approvalHistory.record({
      tenantId,
      referenceType: PO_REFERENCE_TYPE,
      referenceId: id,
      action: 'rejected',
      actorId: rejectedBy,
      previousStatus: po.status,
      newStatus: 'rejected',
      reason: result.reason,
    });
    return updated;
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

  async history(id: string, tenantId: string) {
    await this.findById(id, tenantId);
    return this.approvalHistory.findForReference(
      tenantId,
      PO_REFERENCE_TYPE,
      id,
    );
  }
}
