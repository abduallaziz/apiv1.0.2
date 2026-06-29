import { Controller, Get, Post, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('inventory/reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Get()
  @RequirePermission('inventory.view')
  findAll(@Query('status') status: string, @GetTenant() tenant: TenantContext) {
    return this.reservationsService.findAll(tenant.tenantId, status);
  }

  @Get(':id')
  @RequirePermission('inventory.view')
  findOne(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.reservationsService.findById(id, tenant.tenantId);
  }

  @Post()
  @RequirePermission('inventory.reserve')
  create(
    @Body() dto: CreateReservationDto,
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.reservationsService.create(tenant.tenantId, dto, user.sub);
  }

  @Post(':id/release')
  @RequirePermission('inventory.reserve')
  @HttpCode(HttpStatus.OK)
  release(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.reservationsService.release(id, tenant.tenantId);
  }
}
