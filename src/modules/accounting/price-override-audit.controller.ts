import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { AccountingService } from './accounting.service';
import { PriceOverrideAuditQueryDto } from './dto/price-override-audit-query.dto';

// Accounting Backend Phase 1 — D01's own read surface. Distinct
// permission namespace (price_override.*, not accounting.*), matching
// D01's existing invoice.price_override key, per the approved design.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('accounting')
export class PriceOverrideAuditController {
  constructor(private readonly accountingService: AccountingService) {}

  @Get('price-override-audit')
  @RequirePermission('price_override.audit.view')
  async list(
    @GetTenant() tenant: TenantContext,
    @Query() query: PriceOverrideAuditQueryDto,
  ) {
    return this.accountingService.listPriceOverrideAudits(tenant, query);
  }

  @Get('price-override-audit/:id')
  @RequirePermission('price_override.audit.view')
  async detail(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.accountingService.getPriceOverrideAudit(tenant, id);
  }
}
