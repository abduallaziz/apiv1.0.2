import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResolverService } from './resolver.service';
import { normalizeScanValue } from '../utils/normalize-scan-value.util';
import { JwtAuthGuard } from '../../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../../core/permissions/permission.guard';
import { RequirePermission } from '../../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../../core/tenant/tenant.context';

// Standalone identification endpoint — lets a caller resolve a value
// without going through event ingestion (e.g. a manual "what is this
// code" lookup in the future Frontend Control Center). Read-only, same
// engine the Event Engine calls internally during ingest.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('scanner/resolve')
export class ResolverController {
  constructor(private readonly resolverService: ResolverService) {}

  @Get()
  @RequirePermission('devices.view')
  resolve(
    @Query('value') value: string,
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId?: string,
  ) {
    if (!value)
      throw new BadRequestException('Query parameter "value" is required');
    return this.resolverService.resolve(normalizeScanValue(value), {
      tenantId: tenant.tenantId,
      warehouseId,
    });
  }
}
