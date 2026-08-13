import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SnapshotsService } from './snapshots.service';
import { GenerateSnapshotDto } from './dto/generate-snapshot.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/snapshots')
export class SnapshotsController {
  constructor(private readonly snapshotsService: SnapshotsService) {}

  @Get()
  @RequirePermission('inventory.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.snapshotsService.findAll(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.snapshotsService.findById(id, tenant.tenantId);
  }

  @Post('generate')
  @RequirePermission('inventory.manage')
  @HttpCode(HttpStatus.OK)
  @Audit('inventory_snapshot.generated')
  generate(
    @Body() dto: GenerateSnapshotDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.snapshotsService.generate(tenant.tenantId, user.sub, dto);
  }
}
