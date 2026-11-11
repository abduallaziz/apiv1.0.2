import {
  Controller,
  Get,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { ActivityProfilesService } from './activity-profiles.service';

/**
 * Read-only for every authenticated user of the tenant: the profile only
 * decides what the UI shows/enables. Authorisation stays in server-side RBAC.
 */
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('activity-profile')
export class ActivityProfilesController {
  constructor(private readonly service: ActivityProfilesService) {}

  @Get()
  get(
    @GetTenant() tenant: TenantContext,
    @Query('branch_id', new ParseUUIDPipe({ optional: true }))
    branchId?: string,
  ) {
    return this.service.resolve(tenant.tenantId, branchId ?? tenant.branchId);
  }
}
