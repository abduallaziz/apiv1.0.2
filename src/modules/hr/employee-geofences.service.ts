import { Injectable, BadRequestException } from '@nestjs/common';
import { EmployeeGeofencesRepository } from './repositories/employee-geofences.repository';
import { CreateEmployeeGeofenceDto } from './dto/create-employee-geofence.dto';
import { TenantContext } from '../../core/tenant/tenant-context';
import { HrBranchService } from './hr-branch.service';

@Injectable()
export class EmployeeGeofencesService {
  constructor(
    private readonly repo: EmployeeGeofencesRepository,
    private readonly hrBranch: HrBranchService,
  ) {}

  async findAllForUser(tenant: TenantContext, userId: string) {
    await this.hrBranch.assertEmployeesInScope(tenant, [userId]);
    return this.repo.findAllForUser(tenant.tenantId, userId);
  }

  async create(tenant: TenantContext, dto: CreateEmployeeGeofenceDto) {
    const branchId = await this.hrBranch.branchOfEmployee(tenant, dto.user_id);
    const ok = await this.repo.userBelongsToTenant(
      dto.user_id,
      tenant.tenantId,
    );
    if (!ok) throw new BadRequestException('User not found');
    return this.repo.create(tenant.tenantId, {
      ...dto,
      ...(tenant.isolated ? { branch_id: branchId } : {}),
    });
  }

  remove(id: string, tenant: TenantContext) {
    return this.repo.remove(
      id,
      tenant.tenantId,
      tenant.isolated ? tenant.branchId : null,
    );
  }
}
