import { Controller, Get, Post, Body, Query, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceExceptionDto } from './dto/create-attendance-exception.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Post('check-in')
  @RequirePermission('attendance.checkin')
  checkIn(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Body('branch_id') branchId?: string,
  ) {
    const user = req.user as { sub: string };
    return this.service.checkIn(tenant, user.sub, branchId ?? null);
  }

  @Post('check-out')
  @RequirePermission('attendance.checkin')
  checkOut(@GetTenant() tenant: TenantContext, @Req() req: Request) {
    const user = req.user as { sub: string };
    return this.service.checkOut(tenant, user.sub);
  }

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
  @RequirePermission('attendance.view.all')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('user_id') userId?: string,
    @Query('branch_id') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findAll(tenant, { userId, branchId, from, to });
  }

  @Post('exceptions')
  @RequirePermission('hr.manage')
  createException(
    @GetTenant() tenant: TenantContext,
    @Body() dto: CreateAttendanceExceptionDto,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.createException(tenant, dto.user_id, dto.date_from, dto.date_to, dto.reason, user.sub);
  }

  @Get('exceptions')
  @RequirePermission('attendance.view.all')
  findExceptions(
    @GetTenant() tenant: TenantContext,
    @Query('user_id') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findExceptions(tenant, { userId, from, to });
  }
}
