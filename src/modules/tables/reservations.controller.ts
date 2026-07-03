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
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}

  @Get()
  @RequirePermission('tables.manage')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('table_id') tableId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.service.findAll(tenant, { tableId, from, to, status });
  }

  @Get(':id')
  @RequirePermission('tables.manage')
  findOne(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.findOne(id, tenant);
  }

  @Post()
  @RequirePermission('tables.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateReservationDto) {
    return this.service.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermission('tables.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
    @Body() dto: UpdateReservationDto,
  ) {
    return this.service.update(id, tenant, dto);
  }
}
