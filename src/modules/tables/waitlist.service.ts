import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { WaitlistRepository } from './repositories/waitlist.repository';
import { DineInService } from './dine-in.service';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';
import { TenantContext } from '../../core/tenant/tenant-context';

@Injectable()
export class WaitlistService {
  constructor(
    private readonly repo: WaitlistRepository,
    private readonly dineInService: DineInService,
  ) {}

  findAll(tenant: TenantContext, branchId?: string, status?: string) {
    return this.repo.findAll(tenant.tenantId, branchId, status);
  }

  async create(tenant: TenantContext, dto: CreateWaitlistEntryDto) {
    const branchOk = await this.repo.branchBelongsToTenant(dto.branch_id, tenant.tenantId);
    if (!branchOk) throw new BadRequestException('Branch not found');
    return this.repo.create(tenant.tenantId, dto);
  }

  async seat(tenant: TenantContext, id: string, tableId: string, actorId: string) {
    const entry = await this.repo.findById(id, tenant.tenantId);
    if (!entry) throw new NotFoundException('Waitlist entry not found');
    if (entry.status !== 'waiting') {
      throw new BadRequestException(`Cannot seat an entry with status: ${entry.status}`);
    }

    // كان يضبط حالة الطاولة "مشغولة" مباشرة (بعد تحقق يدوي مكرَّر) بدون إنشاء أي طلب —
    // نفس خلل الحجوزات أعلاه بالضبط. openTable() يفعل التحقق + الإنشاء + ضبط الحالة
    // كعملية واحدة متسقة، فأزلنا التكرار هنا بدل نسخه.
    await this.dineInService.openTable(tenant, tableId, actorId);
    return this.repo.seat(id, tenant.tenantId, tableId);
  }

  async cancel(tenant: TenantContext, id: string) {
    const entry = await this.repo.findById(id, tenant.tenantId);
    if (!entry) throw new NotFoundException('Waitlist entry not found');
    return this.repo.cancel(id, tenant.tenantId);
  }
}
