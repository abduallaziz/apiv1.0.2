import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SupplierQualityRepository } from './repositories/supplier-quality.repository';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('quality/supplier-quality')
export class SupplierQualityController {
  constructor(
    private readonly supplierQualityRepo: SupplierQualityRepository,
  ) {}

  @Get()
  @RequirePermission('quality.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.supplierQualityRepo.findAll(tenant.tenantId);
  }

  @Get(':supplierId')
  @RequirePermission('quality.view')
  findOne(
    @Param('supplierId') supplierId: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.supplierQualityRepo.findBySupplier(tenant.tenantId, supplierId);
  }
}
