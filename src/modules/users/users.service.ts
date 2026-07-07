import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersRepository } from './users.repository';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { TenantContext } from '../../core/tenant/tenant.context';
import { AuditService } from '../../core/audit/audit.service';
import { UserRole } from '../../shared/types/enums';
import { BillingService } from '../../core/billing/billing.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly auditService: AuditService,
    private readonly billingService: BillingService,
    private readonly authService: AuthService,
  ) {}

  // Disabling or deleting an employee must immediately cut them off, not just at
  // their next login: revoke the personal attendance link/device binding and kill
  // any live sessions so an already-issued token stops working on its next refresh.
  private async revokeAccess(id: string, tenantId: string) {
    await Promise.all([
      this.usersRepository.revokeAttendanceAccess(id, tenantId),
      this.authService.revokeAllSessionsForUser(id, tenantId),
    ]);
  }

  async findAll(tenant: TenantContext) {
    const { data, error } = await this.usersRepository.findAll(tenant);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findOne(id: string, tenant: TenantContext) {
    const { data, error } = await this.usersRepository.findById(id, tenant);
    if (error || !data) throw new NotFoundException('User not found');
    return data;
  }

  async create(dto: CreateUserDto, tenant: TenantContext, actorId: string) {
    await this.billingService.checkUserLimit(tenant.tenantId);

    const { data: existing } = await this.usersRepository.findByEmail(dto.email, tenant.tenantId);
    if (existing) throw new ConflictException('Email already exists in this tenant');

    if (dto.role === UserRole.SUPERADMIN) {
      throw new ForbiddenException('Cannot create superadmin via this endpoint');
    }

    const password_hash = await bcrypt.hash(dto.password, 12);

    const { data, error } = await this.usersRepository.create({
      tenant_id: tenant.tenantId,
      email: dto.email,
      password_hash,
      name: dto.name,
      role: dto.role,
      is_active: true,
    });

    if (error) throw new BadRequestException(error.message);

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      action: 'user.create',
      resource_type: 'user',
      resource_id: data.id,
      after_data: { email: data.email, role: data.role },
    });

    return data;
  }

  async update(id: string, dto: UpdateUserDto, tenant: TenantContext, actorId: string) {
    const existing = await this.findOne(id, tenant);

    const updates: Record<string, unknown> = {};
    if (dto.name) updates.name = dto.name;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.password) updates.password_hash = await bcrypt.hash(dto.password, 12);
    if (dto.commission_rate !== undefined) updates.commission_rate = dto.commission_rate;
    if (dto.base_salary !== undefined) updates.base_salary = dto.base_salary;
    if (dto.grace_period_minutes !== undefined) updates.grace_period_minutes = dto.grace_period_minutes;
    if (dto.late_deduction_mode !== undefined) updates.late_deduction_mode = dto.late_deduction_mode;
    if (dto.late_deduction_value !== undefined) updates.late_deduction_value = dto.late_deduction_value;
    if (dto.department !== undefined) updates.department = dto.department;
    if (dto.job_title !== undefined) updates.job_title = dto.job_title;
    if (dto.avatar_url !== undefined) updates.avatar_url = dto.avatar_url;
    if (dto.employee_number !== undefined) updates.employee_number = dto.employee_number;
    if (dto.phone !== undefined) updates.phone = dto.phone;
    if (dto.identity_number !== undefined) updates.identity_number = dto.identity_number;
    if (dto.manager_name !== undefined) updates.manager_name = dto.manager_name;
    if (dto.employment_type !== undefined) updates.employment_type = dto.employment_type;
    if (dto.join_date !== undefined) updates.join_date = dto.join_date;
    if (dto.city !== undefined) updates.city = dto.city;
    if (dto.address !== undefined) updates.address = dto.address;
    if (dto.gps_radius_meters !== undefined) updates.gps_radius_meters = dto.gps_radius_meters;
    if (dto.attendance_enabled !== undefined) updates.attendance_enabled = dto.attendance_enabled;

    if (dto.role) throw new BadRequestException('Use PATCH /users/:id/role to change role');

    const { data, error } = await this.usersRepository.update(id, tenant.tenantId, updates);
    if (error) throw new BadRequestException(error.message);

    // Being disabled (active → inactive) must immediately revoke attendance access
    // and kill live sessions — re-enabling does NOT restore the old link/device on
    // its own; the admin generates a fresh attendance link if needed (matches the
    // existing "generate/regenerate" flow, no auto-restore of stale credentials).
    if (dto.is_active === false && existing.is_active !== false) {
      await this.revokeAccess(id, tenant.tenantId);
    }

    // Turning attendance off (independent of the employee's active/disabled status)
    // must revoke the link/device the same way — attendance is its own on/off
    // switch, not a side effect of the employee lifecycle.
    if (dto.attendance_enabled === false && (existing as any).attendance_enabled !== false) {
      await this.usersRepository.revokeAttendanceAccess(id, tenant.tenantId);
    }

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      action: 'user.update',
      resource_type: 'user',
      resource_id: id,
      before_data: { name: existing.name, is_active: existing.is_active },
      after_data: updates,
    });

    return data;
  }

  async changeRole(id: string, dto: ChangeRoleDto, tenant: TenantContext, actorId: string) {
    const existing = await this.findOne(id, tenant);

    if (existing.role === UserRole.SUPERADMIN) {
      throw new ForbiddenException('Cannot change superadmin role');
    }
    if (dto.role === UserRole.SUPERADMIN) {
      throw new ForbiddenException('Cannot assign superadmin role');
    }

    const { data, error } = await this.usersRepository.update(id, tenant.tenantId, { role: dto.role });
    if (error) throw new BadRequestException(error.message);

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      action: 'user.role_change',
      resource_type: 'user',
      resource_id: id,
      before_data: { role: existing.role },
      after_data: { role: dto.role },
    });

    return data;
  }

  async remove(id: string, tenant: TenantContext, actorId: string) {
    const existing = await this.findOne(id, tenant);

    if (id === actorId) throw new ForbiddenException('Cannot delete yourself');

    const { error } = await this.usersRepository.softDelete(id, tenant.tenantId);
    if (error) throw new BadRequestException(error.message);

    await this.revokeAccess(id, tenant.tenantId);

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      action: 'user.delete',
      resource_type: 'user',
      resource_id: id,
      before_data: { email: existing.email, role: existing.role },
    });

    return { message: 'User deleted successfully' };
  }

  async generateAttendanceLink(id: string, tenant: TenantContext) {
    await this.findOne(id, tenant);
    return this.usersRepository.generateAttendanceToken(id, tenant.tenantId);
  }

  async unbindAttendanceDevice(id: string, tenant: TenantContext) {
    await this.findOne(id, tenant);
    await this.usersRepository.unbindAttendanceDevice(id, tenant.tenantId);
    return { message: 'Device unbound — the link can now be used from a new device.' };
  }
}