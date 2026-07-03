import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { WaitlistService } from './waitlist.service';
import { CreateWaitlistEntryDto } from './dto/create-waitlist-entry.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly service: WaitlistService) {}

  @Get()
  @RequirePermission('tables.manage')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('branch_id') branchId?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(tenant, branchId, status);
  }

  @Post()
  @RequirePermission('tables.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateWaitlistEntryDto) {
    return this.service.create(tenant, dto);
  }

  @Patch(':id/seat')
  @RequirePermission('tables.manage')
  seat(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
    @Body('table_id') tableId: string,
  ) {
    return this.service.seat(tenant, id, tableId);
  }

  @Patch(':id/cancel')
  @RequirePermission('tables.manage')
  cancel(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.cancel(tenant, id);
  }
}
