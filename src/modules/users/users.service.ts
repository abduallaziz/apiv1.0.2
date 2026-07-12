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
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeRoleDto } from './dto/change-role.dto';
import { TenantContext } from '../../core/tenant/tenant.context';
import { AuditService } from '../../core/audit/audit.service';
import { UserRole } from '../../shared/types/enums';
import { BillingService } from '../../core/billing/billing.service';
import { AuthService } from '../auth/auth.service';
import { PermissionsService } from '../../core/permissions/permissions.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly auditService: AuditService,
    private readonly billingService: BillingService,
    private readonly authService: AuthService,
    private readonly permissionsService: PermissionsService,
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

  async findAllEmployees(tenant: TenantContext) {
    const { data, error } = await this.usersRepository.findAllEmployees(tenant);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  async findEmployeeHistory(id: string, tenant: TenantContext) {
    await this.findOne(id, tenant); // 404s if not found / wrong tenant
    return this.usersRepository.findHistory(id, tenant.tenantId);
  }

  async findLinkableSystemUsers(tenant: TenantContext) {
    const { data, error } = await this.usersRepository.findLinkableSystemUsers(tenant);
    if (error) throw new BadRequestException(error.message);
    return data;
  }

  // Real-time wizard validation (Step 1) and a defense-in-depth check at create
  // time — email/phone/employee_number must each be unique per tenant across
  // every row (System User or Employee Profile), since they still share one table.
  async checkDuplicates(tenant: TenantContext, fields: { email?: string; phone?: string; employee_number?: string }, excludeId?: string) {
    const result: { email?: boolean; phone?: boolean; employee_number?: boolean } = {}

    if (fields.email) {
      const { data } = await this.usersRepository.findByEmail(fields.email, tenant.tenantId);
      result.email = !!data && data.id !== excludeId;
    }
    if (fields.phone) {
      const { data } = await this.usersRepository.findByPhone(fields.phone, tenant.tenantId);
      result.phone = !!data && data.id !== excludeId;
    }
    if (fields.employee_number) {
      const { data } = await this.usersRepository.findByEmployeeNumber(fields.employee_number, tenant.tenantId);
      result.employee_number = !!data && data.id !== excludeId;
    }
    return result;
  }

  private async assertNoDuplicates(
    dto: { email?: string; phone?: string; employee_number?: string },
    tenantId: string,
    excludeId?: string,
  ) {
    if (dto.email) {
      const { data } = await this.usersRepository.findByEmail(dto.email, tenantId);
      if (data && data.id !== excludeId) throw new ConflictException('Email already exists in this tenant');
    }
    if (dto.phone) {
      const { data } = await this.usersRepository.findByPhone(dto.phone, tenantId);
      if (data && data.id !== excludeId) throw new ConflictException('Phone number already exists in this tenant');
    }
    if (dto.employee_number) {
      const { data } = await this.usersRepository.findByEmployeeNumber(dto.employee_number, tenantId);
      if (data && data.id !== excludeId) throw new ConflictException('Employee number already exists in this tenant');
    }
  }

  async linkAsEmployee(id: string, tenant: TenantContext, actorId: string) {
    const existing = await this.findOne(id, tenant);
    if ((existing as any).is_employee_profile) {
      throw new ConflictException('This user already has an Employee Profile');
    }

    const { data, error } = await this.usersRepository.linkAsEmployee(id, tenant.tenantId);
    if (error) throw new BadRequestException(error.message);

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      action: 'employee.linked',
      resource_type: 'employee',
      resource_id: id,
      after_data: { name: existing.name },
    });

    return data;
  }

  async updateEmployee(id: string, dto: UpdateEmployeeDto, tenant: TenantContext, actorId: string) {
    const existing = await this.findOne(id, tenant);
    if (!(existing as any).is_employee_profile) {
      throw new NotFoundException('Employee profile not found');
    }

    await this.assertNoDuplicates(dto, tenant.tenantId, id);

    const updates: Record<string, unknown> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.avatar_url !== undefined) updates.avatar_url = dto.avatar_url;
    if (dto.employee_number !== undefined) updates.employee_number = dto.employee_number;
    if (dto.phone !== undefined) updates.phone = dto.phone;
    if (dto.email !== undefined) updates.email = dto.email;
    if (dto.identity_number !== undefined) updates.identity_number = dto.identity_number;
    if (dto.department !== undefined) updates.department = dto.department;
    if (dto.job_title !== undefined) updates.job_title = dto.job_title;
    if (dto.manager_name !== undefined) updates.manager_name = dto.manager_name;
    if (dto.employment_type !== undefined) updates.employment_type = dto.employment_type;
    if (dto.join_date !== undefined) updates.join_date = dto.join_date;
    if (dto.city !== undefined) updates.city = dto.city;
    if (dto.address !== undefined) updates.address = dto.address;
    if (dto.gps_radius_meters !== undefined) updates.gps_radius_meters = dto.gps_radius_meters;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.attendance_enabled !== undefined) updates.attendance_enabled = dto.attendance_enabled;
    if (dto.base_salary !== undefined) updates.base_salary = dto.base_salary;
    if (dto.grace_period_minutes !== undefined) updates.grace_period_minutes = dto.grace_period_minutes;
    if (dto.late_deduction_mode !== undefined) updates.late_deduction_mode = dto.late_deduction_mode;
    if (dto.late_deduction_value !== undefined) updates.late_deduction_value = dto.late_deduction_value;

    const { data, error } = await this.usersRepository.update(id, tenant.tenantId, updates);
    if (error) throw new BadRequestException(error.message);

    if (dto.is_active === false && existing.is_active !== false) {
      await this.revokeAccess(id, tenant.tenantId);
    }
    if (dto.attendance_enabled === false && (existing as any).attendance_enabled !== false) {
      await this.usersRepository.revokeAttendanceAccess(id, tenant.tenantId);
    }

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      action: 'employee.updated',
      resource_type: 'employee',
      resource_id: id,
      before_data: { name: existing.name, is_active: existing.is_active },
      after_data: updates,
    });

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

  // Employee Core creation — no email/password/role required. Creates a row
  // with role 'none' (zero dashboard permissions, resolves via role_permissions
  // to an empty set) and no password_hash, i.e. no System User account exists
  // for this person unless one is separately created later via create() above.
  async createEmployee(dto: CreateEmployeeDto, tenant: TenantContext, actorId: string) {
    await this.billingService.checkUserLimit(tenant.tenantId);

    await this.assertNoDuplicates(dto, tenant.tenantId);

    const { data, error } = await this.usersRepository.create({
      tenant_id: tenant.tenantId,
      email: dto.email ?? null,
      password_hash: null,
      name: dto.name,
      role: UserRole.NONE,
      is_active: true,
      is_employee_profile: true,
      employee_number: dto.employee_number ?? null,
      phone: dto.phone ?? null,
      identity_number: dto.identity_number ?? null,
      department: dto.department ?? null,
      job_title: dto.job_title ?? null,
      manager_name: dto.manager_name ?? null,
      employment_type: dto.employment_type ?? null,
      join_date: dto.join_date ?? null,
      city: dto.city ?? null,
      address: dto.address ?? null,
      gps_radius_meters: dto.gps_radius_meters ?? null,
    });

    if (error) throw new BadRequestException(error.message);

    // "Enable Attendance" was toggled in the wizard's Attendance step — generate
    // the token now that the employee actually exists (attendance can only ever
    // be tied to a real employeeId + tenantId, never created ahead of the record).
    let attendance_token: string | null = null;
    if (dto.enable_attendance) {
      const linkResult = await this.usersRepository.generateAttendanceToken(data.id, tenant.tenantId);
      attendance_token = linkResult.attendance_token;
    }

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      action: 'employee.create',
      resource_type: 'employee',
      resource_id: data.id,
      after_data: { name: data.name, employee_number: data.employee_number, attendance_enabled: !!dto.enable_attendance },
    });

    return { ...data, attendance_token, attendance_enabled: !!dto.enable_attendance };
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

    const roleId = await this.usersRepository.findSystemRoleId(dto.role);
    if (!roleId) {
      throw new BadRequestException(`Unknown system role: ${dto.role}`);
    }

    // users.role/role_id are kept in sync purely as a legacy mirror —
    // user_roles (synced below) is what guards and
    // PermissionsService.hasPermissionForUser actually read.
    const { data, error } = await this.usersRepository.update(id, tenant.tenantId, {
      role: dto.role,
      role_id: roleId,
    });
    if (error) throw new BadRequestException(error.message);

    await this.usersRepository.syncPrimaryRole(id, roleId);
    // The user's cached multi-role permission set (if any) is now stale —
    // only hasPermissionForUser's cache uses this key; hasPermission()'s
    // per-role cache is untouched since that role-wide entry is still valid
    // for every other user still holding it.
    await this.permissionsService.invalidateUserPermissions(id, tenant.tenantId);

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

  // Phase 3 — full role listing for the user-detail "Roles" panel.
  // findOne() throws NotFoundException if `id` isn't in this tenant, which
  // is what scopes this to the caller's tenant (user_roles itself has no
  // tenant_id column to filter on).
  async getUserRoles(id: string, tenant: TenantContext) {
    await this.findOne(id, tenant);
    return this.usersRepository.findUserRoles(id);
  }

  // Grants an ADDITIONAL role alongside whatever the user already holds —
  // distinct from changeRole(), which replaces the single primary role.
  // Never touches is_primary of an existing row; the new role is only ever
  // primary if the user somehow had zero roles beforehand (shouldn't happen
  // given register()/086 backfill, but this keeps that edge case sane
  // rather than leaving the user with zero primary role at all).
  async addRole(id: string, roleId: string, tenant: TenantContext, actorId: string) {
    await this.findOne(id, tenant);

    const role = await this.usersRepository.findAccessibleRole(roleId, tenant.tenantId);
    if (!role) throw new NotFoundException('Role not found');

    const currentCount = await this.usersRepository.countUserRoles(id);

    try {
      await this.usersRepository.insertUserRole(id, roleId, currentCount === 0);
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ConflictException(`User already has the "${role.name}" role`);
      }
      throw err;
    }

    await this.permissionsService.invalidateUserPermissions(id, tenant.tenantId);

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      action: 'user.role_added',
      resource_type: 'user',
      resource_id: id,
      after_data: { role_id: roleId, role_name: role.name },
    });

    return { user_id: id, role_id: roleId, role_name: role.name };
  }

  // Rejects removing the currently-primary role (changeRole() is the
  // intended path for swapping it — this endpoint only manages secondary
  // roles) and rejects removing a user's only remaining role, so a user can
  // never end up with zero roles through this endpoint.
  async removeRole(id: string, roleId: string, tenant: TenantContext, actorId: string) {
    await this.findOne(id, tenant);

    const roles = await this.usersRepository.findUserRoles(id);
    const target = roles.find((r: any) => r.role_id === roleId);
    if (!target) throw new NotFoundException('User does not have this role');

    if (roles.length === 1) {
      throw new ForbiddenException('Cannot remove a user\'s only remaining role');
    }
    if (target.is_primary) {
      throw new ForbiddenException('Cannot remove the primary role directly — change it via PATCH /users/:id/role instead');
    }

    await this.usersRepository.deleteUserRole(id, roleId);
    await this.permissionsService.invalidateUserPermissions(id, tenant.tenantId);

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      action: 'user.role_removed',
      resource_type: 'user',
      resource_id: id,
      before_data: { role_id: roleId, role_name: (target as any).role?.name },
    });

    return { user_id: id, role_id: roleId, removed: true };
  }

  // Phase B of the Hybrid RBAC+ABAC model — per-user GRANT/DENY on top of
  // whatever their role(s) already resolve to. findOne() scopes this to the
  // caller's tenant the same way every other user-scoped write in this
  // service does; the actual GRANT/DENY merge logic lives in
  // PermissionsService.getGrantedSetForUser(), not here.
  async setPermissionOverride(
    id: string,
    permissionKey: string,
    action: 'GRANT' | 'DENY',
    tenant: TenantContext,
    actorId: string,
  ) {
    await this.findOne(id, tenant);

    try {
      await this.permissionsService.setOverride(id, permissionKey, action, tenant.tenantId);
    } catch (err: any) {
      // user_permissions_override.permission_key REFERENCES permissions(name)
      if (err?.code === '23503') {
        throw new NotFoundException(`Unknown permission: ${permissionKey}`);
      }
      throw err;
    }

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      action: 'user.permission_override_set',
      resource_type: 'user',
      resource_id: id,
      after_data: { permission_key: permissionKey, action },
    });

    return { user_id: id, permission_key: permissionKey, action };
  }

  async removePermissionOverride(
    id: string,
    permissionKey: string,
    tenant: TenantContext,
    actorId: string,
  ) {
    await this.findOne(id, tenant);

    await this.permissionsService.removeOverride(id, permissionKey, tenant.tenantId);

    await this.auditService.log({
      tenant_id: tenant.tenantId,
      actor_id: actorId,
      action: 'user.permission_override_removed',
      resource_type: 'user',
      resource_id: id,
      before_data: { permission_key: permissionKey },
    });

    return { user_id: id, permission_key: permissionKey, removed: true };
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