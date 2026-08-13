import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
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
@Controller('scanner/devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Get()
  @RequirePermission('devices.view')
  findAll(@GetTenant() tenant: TenantContext) {
    return this.devicesService.findAll(tenant.tenantId);
  }

  @Get(':id')
  @RequirePermission('devices.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.devicesService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('devices.manage')
  @Audit('scanner_device.created')
  create(
    @Body() dto: CreateDeviceDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.devicesService.create(tenant.tenantId, dto, user.sub);
  }

  @Patch(':id')
  @RequirePermission('devices.manage')
  @Audit('scanner_device.updated')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDeviceDto,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.devicesService.update(id, tenant.tenantId, dto);
  }

  @Delete(':id')
  @RequirePermission('devices.manage')
  @Audit('scanner_device.removed')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.devicesService.remove(id, tenant.tenantId);
  }
}
