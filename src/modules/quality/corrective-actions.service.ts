import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CorrectiveActionsRepository } from './repositories/corrective-actions.repository';
import { NonConformancesService } from './non-conformances.service';
import { CreateCorrectiveActionDto } from './dto/create-corrective-action.dto';
import { CompleteCorrectiveActionDto } from './dto/complete-corrective-action.dto';
import { VerifyCorrectiveActionDto } from './dto/verify-corrective-action.dto';
import { CloseCorrectiveActionDto } from './dto/close-corrective-action.dto';

// assigned -> in_progress -> completed -> verified -> closed
@Injectable()
export class CorrectiveActionsService {
  constructor(
    private readonly capaRepo: CorrectiveActionsRepository,
    private readonly nonConformancesService: NonConformancesService,
  ) {}

  findAll(tenantId: string, ownerId?: string, status?: string) {
    return this.capaRepo.findAll(tenantId, ownerId, status);
  }

  async findById(id: string, tenantId: string) {
    const action = await this.capaRepo.findById(id, tenantId);
    if (!action) throw new NotFoundException('Corrective action not found');
    return action;
  }

  history(id: string, tenantId: string) {
    return this.capaRepo.findHistory(tenantId, id);
  }

  async create(tenantId: string, dto: CreateCorrectiveActionDto, createdBy: string) {
    await this.nonConformancesService.findById(dto.non_conformance_id, tenantId);
    const action = await this.capaRepo.create(tenantId, {
      non_conformance_id: dto.non_conformance_id,
      title: dto.title,
      description: dto.description ?? null,
      owner_id: dto.owner_id,
      priority: dto.priority ?? 'medium',
      due_date: dto.due_date ?? null,
      created_by: createdBy,
    });
    await this.capaRepo.recordHistory(tenantId, action.id, null, 'assigned', createdBy);
    return action;
  }

  async start(id: string, tenantId: string, actorId: string) {
    const existing: any = await this.findById(id, tenantId);
    if (existing.status !== 'assigned') {
      throw new BadRequestException(`Corrective action ${id} is not assigned (status=${existing.status})`);
    }
    const updated = await this.capaRepo.updateStatus(id, tenantId, 'assigned', { status: 'in_progress' });
    if (!updated) throw new BadRequestException(`Corrective action ${id} status changed concurrently`);
    await this.capaRepo.recordHistory(tenantId, id, 'assigned', 'in_progress', actorId);
    return updated;
  }

  async complete(id: string, tenantId: string, dto: CompleteCorrectiveActionDto, actorId: string) {
    const existing: any = await this.findById(id, tenantId);
    if (existing.status !== 'in_progress') {
      throw new BadRequestException(`Corrective action ${id} is not in_progress (status=${existing.status})`);
    }
    const updated = await this.capaRepo.updateStatus(id, tenantId, 'in_progress', {
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: actorId,
      disposition: dto.disposition ?? null,
    });
    if (!updated) throw new BadRequestException(`Corrective action ${id} status changed concurrently`);
    await this.capaRepo.recordHistory(tenantId, id, 'in_progress', 'completed', actorId, dto.notes);
    return updated;
  }

  // Verification requires a distinct actor recording an effectiveness
  // check — gated on quality.approve at the controller, separate from the
  // quality.execute permission that performed the action itself.
  async verify(id: string, tenantId: string, dto: VerifyCorrectiveActionDto, actorId: string) {
    const existing: any = await this.findById(id, tenantId);
    if (existing.status !== 'completed') {
      throw new BadRequestException(`Corrective action ${id} is not completed (status=${existing.status})`);
    }
    const updated = await this.capaRepo.updateStatus(id, tenantId, 'completed', {
      status: 'verified',
      verified_at: new Date().toISOString(),
      verified_by: actorId,
      effectiveness_check: dto.effectiveness_check,
    });
    if (!updated) throw new BadRequestException(`Corrective action ${id} status changed concurrently`);
    await this.capaRepo.recordHistory(tenantId, id, 'completed', 'verified', actorId, dto.effectiveness_check);
    return updated;
  }

  async close(id: string, tenantId: string, dto: CloseCorrectiveActionDto, actorId: string) {
    const existing: any = await this.findById(id, tenantId);
    if (existing.status !== 'verified') {
      throw new BadRequestException(`Corrective action ${id} is not verified (status=${existing.status})`);
    }
    const updated = await this.capaRepo.updateStatus(id, tenantId, 'verified', {
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: actorId,
      closure_notes: dto.closure_notes ?? null,
    });
    if (!updated) throw new BadRequestException(`Corrective action ${id} status changed concurrently`);
    await this.capaRepo.recordHistory(tenantId, id, 'verified', 'closed', actorId, dto.closure_notes);
    return updated;
  }
}
