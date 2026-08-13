import { Injectable, NotFoundException } from '@nestjs/common';
import { SnapshotsRepository } from './repositories/snapshots.repository';
import { GenerateSnapshotDto } from './dto/generate-snapshot.dto';
import { throwFromRpcError } from './rpc-error.util';
import { AuditService } from '../../core/audit/audit.service';

@Injectable()
export class SnapshotsService {
  constructor(
    private readonly snapshotsRepo: SnapshotsRepository,
    private readonly auditService: AuditService,
  ) {}

  findAll(tenantId: string) {
    return this.snapshotsRepo.findAll(tenantId);
  }

  async findById(id: string, tenantId: string) {
    const run = await this.snapshotsRepo.findById(id, tenantId);
    if (!run) throw new NotFoundException('Snapshot not found');
    return run;
  }

  async generate(
    tenantId: string,
    actorId: string | null,
    dto: GenerateSnapshotDto,
  ) {
    const snapshotDate =
      dto.snapshot_date ?? new Date().toISOString().slice(0, 10);
    // Fetched only to detect + audit a supersede — never mutated directly;
    // fn_generate_inventory_snapshot (148) is the only writer.
    const previousActive = dto.supersede
      ? await this.snapshotsRepo.findActiveForDate(tenantId, snapshotDate)
      : null;

    let result;
    try {
      result = await this.snapshotsRepo.generate(
        tenantId,
        actorId,
        dto.snapshot_date,
        dto.supersede,
      );
    } catch (error) {
      throwFromRpcError(error as { message: string; code?: string });
    }

    if (previousActive && actorId) {
      // Distinct from the controller's @Audit('inventory_snapshot.generated')
      // (which covers the new run via after_data) — this captures the
      // separate fact that an older run was superseded, referencing its id.
      await this.auditService
        .log({
          tenant_id: tenantId,
          actor_id: actorId,
          action: 'inventory_snapshot.superseded',
          resource_type: 'inventory_snapshot',
          resource_id: previousActive.id,
          before_data: { ...previousActive, status: 'active' },
          after_data: { ...previousActive, status: 'superseded' },
        })
        .catch(() => {});
    }

    return result;
  }
}
