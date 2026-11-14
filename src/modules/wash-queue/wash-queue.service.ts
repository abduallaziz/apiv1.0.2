import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { TenantContext } from '../../core/tenant/tenant.context';
import { AuditService } from '../../core/audit/audit.service';
import { BranchReferenceValidator } from '../invoices/branch-reference.validator';
import { WashJob, WashQueueRepository } from './wash-queue.repository';
import { CreateWashJobDto } from './dto/create-wash-job.dto';
import { ChangeWashStatusDto } from './dto/change-status.dto';
import {
  toEnglishDigits,
  normalizePlate,
} from '../customers/customer-normalize';
import { CAR_READY_NOTIFIER, CarReadyNotifier } from './car-ready-notifier';
import {
  canRewash,
  canTransition,
  isRewash,
  WASH_STATUSES,
} from './wash-queue.state-machine';

// RAISE EXCEPTION in the wash functions (code P0001, message "WASH_XXX: ...")
// are business-rule rejections -> 400 (404 for not-found, 403 for re-wash).
function mapDbError(err: unknown): never {
  const e = err as { code?: string; message?: string };
  if (e?.code === 'P0001' && e.message) {
    if (e.message.startsWith('WASH_JOB_NOT_FOUND')) {
      throw new NotFoundException('Wash job not found');
    }
    if (e.message.startsWith('WASH_REWASH_NOT_ALLOWED')) {
      throw new ForbiddenException(e.message);
    }
    throw new BadRequestException(e.message);
  }
  throw err;
}

export interface Actor {
  id: string;
  role: string;
  ip?: string;
  device?: string;
}

@Injectable()
export class WashQueueService {
  private readonly logger = new Logger(WashQueueService.name);

  constructor(
    private readonly repo: WashQueueRepository,
    private readonly audit: AuditService,
    @Inject(CAR_READY_NOTIFIER) private readonly notifier: CarReadyNotifier,
    @Optional() private readonly branchRefs?: BranchReferenceValidator,
  ) {}

  /** The context branch when the tenant runs with branch isolation, else null (no filter). */
  private isolatedBranch(tenant: TenantContext): string | null {
    return tenant.isolated && tenant.branchId ? tenant.branchId : null;
  }

  async create(tenant: TenantContext, dto: CreateWashJobDto, actor: Actor) {
    // English digits only, collapsed whitespace (B-22).
    const plate = toEnglishDigits(dto.plate).replace(/\s+/g, ' ').trim();
    if (!plate) throw new BadRequestException('plate must not be empty');
    // One live ticket per plate per branch (B-22).
    const key = normalizePlate(plate);
    if (tenant.isolated && tenant.branchId && dto.branch_id !== tenant.branchId) {
      throw new BadRequestException('A wash job can only be created in the working branch');
    }
    // customer / worker must belong to the job's branch (no-op flag-off)
    await this.branchRefs?.assertSameBranch(tenant, dto.branch_id, {
      customerId: dto.customer_id,
      workerIds: [dto.assigned_worker_id],
    });
    const active = await this.repo.listActiveByBranch(
      tenant.tenantId,
      dto.branch_id,
    );
    if (active.some((j) => normalizePlate(j.plate) === key)) {
      throw new ConflictException('This vehicle is already in the wash queue');
    }
    try {
      const job = await this.repo.create({
        tenantId: tenant.tenantId,
        branchId: dto.branch_id,
        actorId: actor.id,
        plate,
        vehicleSize: dto.vehicle_size ?? null,
        orderId: dto.order_id ?? null,
        customerId: dto.customer_id ?? null,
        workerId: dto.assigned_worker_id ?? null,
        notes: dto.notes ?? null,
      });
      await this.auditLog(tenant, actor, 'wash_job.create', job, null);
      return job;
    } catch (err) {
      return mapDbError(err);
    }
  }

  async board(tenant: TenantContext, branchId: string, date?: string) {
    // branch isolation: the board is ALWAYS the working branch's
    branchId = this.isolatedBranch(tenant) ?? branchId;
    const day = date ?? new Date().toISOString().slice(0, 10);
    const jobs = await this.repo.listBoard(tenant.tenantId, branchId, day);
    const columns: Record<string, WashJob[]> = {};
    for (const s of WASH_STATUSES) columns[s] = [];
    for (const j of jobs) columns[j.status].push(j);
    return { branch_id: branchId, date: day, columns };
  }

  async getOne(tenant: TenantContext, jobId: string) {
    const job = await this.repo.findOne(
      tenant.tenantId,
      jobId,
      this.isolatedBranch(tenant),
    );
    if (!job) throw new NotFoundException('Wash job not found');
    const events = await this.repo.listEvents(tenant.tenantId, jobId);
    return { ...job, events };
  }

  async changeStatus(
    tenant: TenantContext,
    jobId: string,
    dto: ChangeWashStatusDto,
    actor: Actor,
  ) {
    const before = await this.repo.findOne(
      tenant.tenantId,
      jobId,
      this.isolatedBranch(tenant),
    );
    if (!before) throw new NotFoundException('Wash job not found');

    const allowRewash = canRewash(actor.role);
    if (isRewash(before.status, dto.status) && !allowRewash) {
      throw new ForbiddenException(
        'Only an authorised role may send a ready car back to washing',
      );
    }
    if (!canTransition(before.status, dto.status, allowRewash)) {
      throw new BadRequestException(
        `Cannot change a ${before.status} job to ${dto.status}`,
      );
    }

    let job: WashJob;
    try {
      job = await this.repo.transition(
        tenant.tenantId,
        jobId,
        dto.status,
        actor.id,
        allowRewash,
      );
    } catch (err) {
      return mapDbError(err);
    }

    await this.auditLog(tenant, actor, 'wash_job.status', job, before.status);

    if (job.status === 'ready') {
      job = await this.notifyReady(tenant, job);
    }
    return job;
  }

  /** Links the invoice that billed this job (B-21). Only once, only a live sale. */
  async linkOrder(
    tenant: TenantContext,
    jobId: string,
    orderId: string,
    actor: Actor,
  ) {
    const job = await this.repo.findOne(
      tenant.tenantId,
      jobId,
      this.isolatedBranch(tenant),
    );
    if (!job) throw new NotFoundException('Wash job not found');
    if (job.status === 'cancelled') {
      throw new BadRequestException('Cannot bill a cancelled job');
    }
    if (job.order_id) {
      throw new ConflictException('This job is already billed');
    }
    if (!(await this.repo.orderIsBillable(
        tenant.tenantId,
        orderId,
        this.isolatedBranch(tenant),
      ))) {
      throw new BadRequestException('Order not found');
    }
    const updated = await this.repo.setOrder(tenant.tenantId, jobId, orderId);
    await this.auditLog(tenant, actor, 'wash_job.bill', updated, null);
    return updated;
  }

  async assign(
    tenant: TenantContext,
    jobId: string,
    workerId: string | null,
    actor: Actor,
  ) {
    if (this.isolatedBranch(tenant)) {
      const current = await this.repo.findOne(
        tenant.tenantId,
        jobId,
        this.isolatedBranch(tenant),
      );
      if (!current) throw new NotFoundException('Wash job not found');
      await this.branchRefs?.assertSameBranch(tenant, current.branch_id, {
        workerIds: [workerId],
      });
    }
    try {
      const job = await this.repo.assign(
        tenant.tenantId,
        jobId,
        workerId,
        actor.id,
      );
      await this.auditLog(tenant, actor, 'wash_job.assign', job, null);
      return job;
    } catch (err) {
      return mapDbError(err);
    }
  }

  // G9: a failing/false channel never blocks the status change.
  private async notifyReady(
    tenant: TenantContext,
    job: WashJob,
  ): Promise<WashJob> {
    try {
      const delivered = await this.notifier.notify({
        tenantId: tenant.tenantId,
        jobId: job.id,
        branchId: job.branch_id,
        plate: job.plate,
        queueNumber: job.queue_number,
        customerId: job.customer_id,
        orderId: job.order_id,
      });
      if (delivered) {
        await this.repo.markNotified(tenant.tenantId, job.id);
        return { ...job, ready_notified_at: new Date().toISOString() };
      }
    } catch (err) {
      this.logger.warn(
        `Car-ready notifier failed for job ${job.id}: ${(err as Error).message}`,
      );
    }
    return job;
  }

  private async auditLog(
    tenant: TenantContext,
    actor: Actor,
    action: string,
    job: WashJob,
    fromStatus: string | null,
  ) {
    await this.audit.log({
      tenant_id: tenant.tenantId,
      actor_id: actor.id,
      actor_role: actor.role,
      action,
      resource_type: 'wash_job',
      resource_id: job.id,
      before_data: fromStatus ? { status: fromStatus } : undefined,
      after_data: {
        status: job.status,
        plate: job.plate,
        queue_number: job.queue_number,
        assigned_worker_id: job.assigned_worker_id,
      },
      ip_address: actor.ip,
      device: actor.device,
      branch_id: job.branch_id,
    });
  }
}
