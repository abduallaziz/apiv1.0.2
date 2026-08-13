import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HoldsRepository } from './repositories/holds.repository';
import { WarehousesService } from '../inventory/warehouses.service';
import { ItemsService } from '../items/items.service';
import { CreateHoldDto } from './dto/create-hold.dto';
import { ReleaseHoldDto } from './dto/release-hold.dto';
import { AuditService } from '../../core/audit/audit.service';

@Injectable()
export class HoldsService {
  constructor(
    private readonly holdsRepo: HoldsRepository,
    private readonly warehousesService: WarehousesService,
    private readonly itemsService: ItemsService,
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

  history(id: string, tenantId: string) {
    return this.holdsRepo.findHistory(tenantId, id);
  }

  // Creates the hold and applies the hard block in one RPC call
  // (fn_create_quality_hold — migration 166). Held quantity is immediately
  // excluded from quantity_available; nothing here touches cost_layers or
  // quantity_on_hand.
  async create(tenantId: string, dto: CreateHoldDto, createdBy: string) {
    await this.warehousesService.findById(dto.warehouse_id, tenantId);
    await this.itemsService.findById(dto.item_id, tenantId);

    return this.holdsRepo.create(tenantId, {
      warehouse_id: dto.warehouse_id,
      item_id: dto.item_id,
      variant_id: dto.variant_id ?? null,
      location_id: dto.location_id ?? null,
      batch_id: dto.batch_id ?? null,
      serial_id: dto.serial_id ?? null,
      quantity_held: dto.quantity_held ?? null,
      reason: dto.reason ?? null,
      source_document_type: dto.source_document_type ?? 'manual',
      source_document_id: dto.source_document_id ?? null,
      quality_inspection_id: dto.quality_inspection_id ?? null,
      created_by: createdBy,
    });
  }

  // active -> released (restores availability) OR active -> rejected
  // (disposition stands, quantity stays excluded permanently until a
  // separate write-off). Both are real, audited outcomes — not a "release
  // request" ApprovalEngine flow with only one real end state, per the
  // approved hard-block design.
  async release(
    id: string,
    tenantId: string,
    actorId: string,
    dto: ReleaseHoldDto,
  ) {
    const hold: any = await this.findById(id, tenantId);
    if (hold.status !== 'active') {
      throw new BadRequestException(
        `Hold ${id} is not active (status=${hold.status})`,
      );
    }

    if (dto.approved) {
      const released = await this.holdsRepo.release(
        id,
        tenantId,
        actorId,
        dto.reason,
      );
      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'quality_hold.released',
          resource_type: 'quality_hold',
          resource_id: id,
          before_data: hold,
          after_data: released,
        })
        .catch(() => {});
      return released;
    }

    if (!dto.disposition) {
      throw new BadRequestException(
        'disposition is required when rejecting a quality hold',
      );
    }
    const rejected = await this.holdsRepo.reject(
      id,
      tenantId,
      actorId,
      dto.disposition,
      dto.reason,
    );
    await this.auditService
      .log({
        tenant_id: tenantId,
        actor_id: actorId,
        action: 'quality_hold.rejected',
        resource_type: 'quality_hold',
        resource_id: id,
        before_data: hold,
        after_data: rejected,
      })
      .catch(() => {});
    return rejected;
  }
}
