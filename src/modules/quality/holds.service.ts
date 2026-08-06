import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { HoldsRepository } from './repositories/holds.repository';
import { WarehousesService } from '../inventory/warehouses.service';
import { ItemsService } from '../items/items.service';
import { ApprovalEngine } from '../../engines/approval-engine/approval.engine';
import { ApprovalHistoryRepository } from '../../engines/approval-engine/approval-history.repository';
import { CreateHoldDto } from './dto/create-hold.dto';
import { ReleaseHoldDto } from './dto/release-hold.dto';
import { AuditService } from '../../core/audit/audit.service';

@Injectable()
export class HoldsService {
  constructor(
    private readonly holdsRepo: HoldsRepository,
    private readonly warehousesService: WarehousesService,
    private readonly itemsService: ItemsService,
    private readonly approvalEngine: ApprovalEngine,
    private readonly approvalHistory: ApprovalHistoryRepository,
    private readonly auditService: AuditService,
  ) {}

  findAll(tenantId: string) {
    return this.holdsRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const hold = await this.holdsRepo.findById(id, tenantId);
    if (!hold) throw new NotFoundException('Quality hold not found');
    return hold;
  }

  async create(tenantId: string, dto: CreateHoldDto, createdBy: string) {
    await this.warehousesService.findById(dto.warehouse_id, tenantId); // throws NotFoundException if missing
    await this.itemsService.findById(dto.item_id, tenantId); // throws NotFoundException if missing

    return this.holdsRepo.create(tenantId, {
      warehouse_id: dto.warehouse_id,
      item_id: dto.item_id,
      variant_id: dto.variant_id ?? null,
      quantity_held: dto.quantity_held ?? null,
      reason: dto.reason ?? null,
      quality_inspection_id: dto.quality_inspection_id ?? null,
      created_by: createdBy,
    });
  }

  // active -> ApprovalEngine (approve/reject) -> approval_history -> released
  // (or stays active if the release request is rejected — quality_holds has
  // only 'active'/'released' states, per the approved schema; a rejected
  // release request is an audited decision, not a third status).
  async release(id: string, tenantId: string, releaserId: string, dto: ReleaseHoldDto) {
    const hold: any = await this.findById(id, tenantId);

    if (dto.approved) {
      if (!this.approvalEngine.canApprove(hold.status, 'active')) {
        throw new BadRequestException(`Hold ${id} is not active (status=${hold.status})`);
      }
      const result = this.approvalEngine.approve(releaserId);
      const released = await this.holdsRepo.release(id, tenantId, result.resolvedBy, result.resolvedAt, 'released');
      if (!released) {
        throw new BadRequestException(`Hold ${id} is not active`);
      }
      await this.approvalHistory.record({
        tenantId,
        referenceType: 'quality_hold',
        referenceId: id,
        action: 'release',
        actorId: releaserId,
        previousStatus: 'active',
        newStatus: 'released',
        reason: dto.reason,
      });
      // General action audit trail (audit_logs), distinct from
      // approval_history's decision ledger above — captures before_data
      // (the active hold) which the @Audit() interceptor alone never does.
      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: releaserId,
          action: 'quality_hold.released',
          resource_type: 'quality_hold',
          resource_id: id,
          before_data: hold,
          after_data: released as unknown as Record<string, unknown>,
        })
        .catch(() => {});
      return released;
    }

    if (!this.approvalEngine.canApprove(hold.status, 'active')) {
      throw new BadRequestException(`Hold ${id} is not active (status=${hold.status})`);
    }
    const result = this.approvalEngine.reject(releaserId, dto.reason ?? ''); // throws if reason empty
    await this.approvalHistory.record({
      tenantId,
      referenceType: 'quality_hold',
      referenceId: id,
      action: 'reject_release',
      actorId: releaserId,
      previousStatus: 'active',
      newStatus: 'active', // release request denied — hold remains active
      reason: result.reason,
    });
    return hold;
  }
}
