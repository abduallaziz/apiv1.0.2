import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { ZatcaService } from './zatca.service';
import { AttachCertificateDto, CreateZatcaDeviceDto, OnboardDto } from './dto/zatca.dto';

// Preparation screens' API: register the device, produce its CSR, import the certificate and look at
// the document queue. Nothing here contacts ZATCA.
@Controller('zatca')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class ZatcaController {
  constructor(private readonly service: ZatcaService) {}

  @Get('devices')
  @RequirePermission('settings.view')
  devices(@GetTenant() tenant: TenantContext) {
    return this.service.listDevices(tenant);
  }

  @Post('devices')
  @RequirePermission('settings.manage')
  createDevice(@GetTenant() tenant: TenantContext, @Body() dto: CreateZatcaDeviceDto) {
    return this.service.createDevice(tenant, dto);
  }

  @Post('devices/:id/csr')
  @RequirePermission('settings.manage')
  csr(@GetTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.generateCsr(tenant, id);
  }

  @Post('devices/:id/certificate')
  @RequirePermission('settings.manage')
  certificate(
    @GetTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachCertificateDto,
  ) {
    return this.service.attachCertificate(tenant, id, dto);
  }

  @Post('devices/:id/onboard')
  @RequirePermission('settings.manage')
  onboard(@GetTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OnboardDto) {
    return this.service.onboardCompliance(tenant, id, dto.otp);
  }

  @Post('devices/:id/compliance-checks')
  @RequirePermission('settings.manage')
  complianceChecks(@GetTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.runComplianceChecks(tenant, id);
  }

  @Post('devices/:id/activate')
  @RequirePermission('settings.manage')
  activate(@GetTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.activateProduction(tenant, id);
  }

  @Delete('devices/:id')
  @RequirePermission('settings.manage')
  deleteDevice(@GetTenant() tenant: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteDevice(tenant, id);
  }

  @Get('invoices')
  @RequirePermission('settings.view')
  invoices(@GetTenant() tenant: TenantContext, @Query('status') status?: string) {
    return this.service.listInvoices(tenant, status);
  }

  @Post('flush')
  @RequirePermission('settings.manage')
  flush(@GetTenant() tenant: TenantContext) {
    return this.service.flushPending(tenant);
  }
}
