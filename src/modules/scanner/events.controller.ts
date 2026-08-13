import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { EventsService } from './events.service';
import { CreateScanEventDto } from './dto/create-scan-event.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Audit } from '../../core/audit/audit.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('scanner/events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Get()
  @RequirePermission('devices.view')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('device_id') deviceId?: string,
    @Query('session_id') sessionId?: string,
  ) {
    return this.eventsService.findAll(tenant.tenantId, deviceId, sessionId);
  }

  @Get(':id')
  @RequirePermission('devices.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.eventsService.findById(id, tenant.tenantId);
  }

  @Get(':id/history')
  @RequirePermission('devices.view')
  history(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.eventsService.history(id, tenant.tenantId);
  }

  // Ingestion is an operational scan action, not device administration —
  // gated by devices.view (any user who can see the scanner subsystem can
  // submit scans through it), not devices.manage (device registration).
  @Post()
  @RequirePermission('devices.view')
  @HttpCode(HttpStatus.OK)
  @Audit('scanner_event.ingested')
  ingest(@Body() dto: CreateScanEventDto, @GetTenant() tenant: TenantContext) {
    return this.eventsService.ingest(tenant.tenantId, dto);
  }
}
