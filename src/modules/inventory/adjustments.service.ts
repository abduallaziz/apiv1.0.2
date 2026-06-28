import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdjustmentsRepository } from './repositories/adjustments.repository';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { throwFromRpcError } from './rpc-error.util';

@Injectable()
export class AdjustmentsService {
  private readonly approvalThreshold: number;

  constructor(
    private readonly adjustmentsRepo: AdjustmentsRepository,
    private readonly config: ConfigService,
  ) {
    this.approvalThreshold = Number(this.config.get<string>('INVENTORY_ADJUSTMENT_APPROVAL_THRESHOLD') ?? '0');
  }

  findAll(tenantId: string, status?: string) {
    return this.adjustmentsRepo.findAll(tenantId, status);
  }

  async findById(id: string, tenantId: string) {
    const adjustment = await this.adjustmentsRepo.findById(id, tenantId);
    if (!adjustment) throw new NotFoundException('Adjustment not found');
    return adjustment;
  }

  create(tenantId: string, dto: CreateAdjustmentDto, actorId: string) {
    const movementValue = dto.unit_cost
      ? Math.abs(dto.quantity_delta) * dto.unit_cost
      : Math.abs(dto.quantity_delta);
    const requiresApproval = this.approvalThreshold > 0 && movementValue >= this.approvalThreshold;

    return this.adjustmentsRepo.create(tenantId, {
      warehouse_id: dto.warehouse_id,
      item_id: dto.item_id,
      variant_id: dto.variant_id ?? null,
      batch_id: dto.batch_id ?? null,
      quantity_delta: dto.quantity_delta,
      unit_cost: dto.unit_cost ?? null,
      reason: dto.reason,
      requested_by: actorId,
      requires_approval: requiresApproval,
      status: requiresApproval ? 'pending_approval' : 'approved',
    });
  }

  async approve(id: string, tenantId: string, actorId: string) {
    await this.findById(id, tenantId);
    return this.adjustmentsRepo.approve(id, tenantId, actorId);
  }

  async reject(id: string, tenantId: string, actorId: string) {
    await this.findById(id, tenantId);
    return this.adjustmentsRepo.reject(id, tenantId, actorId);
  }

  async post(id: string, tenantId: string, actorId: string) {
    const adjustment = await this.findById(id, tenantId);
    if (adjustment.status !== 'approved') {
      throw new ForbiddenException('Adjustment must be approved before it can be posted');
    }
    try {
      return await this.adjustmentsRepo.post(id, actorId);
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }
  }
}
