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

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly auditService: AuditService,
    private readonly billingService: BillingService,
  ) {}

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

    if (dto.role) throw new BadRequestException('Use PATCH /users/:id/role to change role');

    const { data, error } = await this.usersRepository.update(id, tenant.tenantId, updates);
    if (error) throw new BadRequestException(error.message);

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
}