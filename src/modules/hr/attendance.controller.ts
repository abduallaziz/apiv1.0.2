import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AttendanceService } from './attendance.service';
import { CreateAttendanceExceptionDto } from './dto/create-attendance-exception.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { Audit } from '../../core/audit/audit.decorator';
import { BranchScoped } from '../../core/security/branch-scoped.decorator';
import { EffectiveBranchId } from '../../core/security/effective-branch-id.decorator';

@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  // Branch Domain Batch 1, B2 (Owner-approved) — a restricted user's
  // check-in branch is now validated against their own branch (or, for
  // Central, any explicit same-tenant branch) rather than trusted as-is.
  @Post('check-in')
  @Audit('attendance.checkin')
  @RequirePermission('attendance.checkin')
  @BranchScoped({ source: 'body', mode: 'write' })
  checkIn(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
  ) {
    const user = req.user as { sub: string };
    return this.service.checkIn(tenant, user.sub, effectiveBranchId ?? null);
  }

  @Post('check-out')
  @Audit('attendance.checkout')
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

  // Branch Domain Batch 1, B2 (Owner-approved) — defense in depth: a
  // restricted actor incorrectly granted attendance.view.all is now still
  // forced to their own branch scope, same as every other migrated
  // endpoint.
  @Get()
  @RequirePermission('attendance.view.all')
  @BranchScoped()
  findAll(
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
    @Query('user_id') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.findAll(tenant, {
      userId,
      branchId: effectiveBranchId ?? undefined,
      from,
      to,
    });
  }

  @Post('exceptions')
  @Audit('payroll.adjustment.made')
  @RequirePermission('hr.manage')
  createException(
    @GetTenant() tenant: TenantContext,
    @Body() dto: CreateAttendanceExceptionDto,
    @Req() req: Request,
  ) {
    const user = req.user as { sub: string };
    return this.service.createException(
      tenant,
      dto.user_id,
      dto.date_from,
      dto.date_to,
      dto.reason,
      user.sub,
    );
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
