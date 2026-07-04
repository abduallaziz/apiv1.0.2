import { Injectable, BadRequestException } from '@nestjs/common';
import { EmployeeGeofencesRepository } from './repositories/employee-geofences.repository';
import { CreateEmployeeGeofenceDto } from './dto/create-employee-geofence.dto';
import { TenantContext } from '../../core/tenant/tenant-context';

@Injectable()
export class EmployeeGeofencesService {
  constructor(private readonly repo: EmployeeGeofencesRepository) {}

  findAllForUser(tenant: TenantContext, userId: string) {
    return this.repo.findAllForUser(tenant.tenantId, userId);
  }

  async create(tenant: TenantContext, dto: CreateEmployeeGeofenceDto) {
    const ok = await this.repo.userBelongsToTenant(dto.user_id, tenant.tenantId);
    if (!ok) throw new BadRequestException('User not found');
    return this.repo.create(tenant.tenantId, { ...dto });
  }

  remove(id: string, tenant: TenantContext) {
    return this.repo.remove(id, tenant.tenantId);
  }
}
