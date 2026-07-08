import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { LoyaltyTiersRepository } from './loyalty-tiers.repository';
import { GetTenant } from '../tenant/get-tenant.decorator';
import { TenantContext } from '../tenant/tenant-context';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../tenant/tenant.guard';
import { PermissionGuard } from '../permissions/permission.guard';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { CreateLoyaltyTierDto } from './dto/create-loyalty-tier.dto';
import { UpdateLoyaltyTierDto } from './dto/update-loyalty-tier.dto';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('loyalty-tiers')
export class LoyaltyTiersController {
  constructor(private readonly repo: LoyaltyTiersRepository) {}

  @Get()
  @RequirePermission('settings.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.repo.findAll(tenant);
  }

  @Post()
  @RequirePermission('settings.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateLoyaltyTierDto) {
    return this.repo.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermission('settings.manage')
  async update(
    @GetTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body() dto: UpdateLoyaltyTierDto,
  ) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Loyalty tier not found');
    return this.repo.update(tenant, id, dto);
  }

  @Delete(':id')
  @RequirePermission('settings.manage')
  async remove(@GetTenant() tenant: TenantContext, @Param('id') id: string) {
    const existing = await this.repo.findById(tenant, id);
    if (!existing) throw new NotFoundException('Loyalty tier not found');
    await this.repo.softDelete(tenant, id);
    return { message: 'Loyalty tier deleted' };
  }
}
