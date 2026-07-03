import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly service: SchedulesService) {}

  @Get('me')
  @RequirePermission('attendance.checkin')
  findMine(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const user = req.user as { sub: string };
    return this.service.findAll(tenant, { userId: user.sub, from, to });
  }

  @Get()
  @RequirePermission('hr.manage')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('user_id') userId?: string,
    @Query('branch_id') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findAll(tenant, { userId, branchId, from, to });
  }

  @Post()
  @RequirePermission('hr.manage')
  create(@GetTenant() tenant: TenantContext, @Body() dto: CreateScheduleDto) {
    return this.service.create(tenant, dto);
  }

  @Patch(':id')
  @RequirePermission('hr.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.service.update(id, tenant, dto);
  }

  @Delete(':id')
  @RequirePermission('hr.manage')
  remove(@Param('id', ParseUUIDPipe) id: string, @GetTenant() tenant: TenantContext) {
    return this.service.remove(id, tenant);
  }
}
