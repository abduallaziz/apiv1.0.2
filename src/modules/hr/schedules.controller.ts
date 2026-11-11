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
import { BulkCreateScheduleDto } from './dto/bulk-create-schedule.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { BranchScoped } from '../../core/security/branch-scoped.decorator';
import { EffectiveBranchId } from '../../core/security/effective-branch-id.decorator';

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

  // Branch Domain Batch 1, B2 (Owner-approved) — a restricted actor was
  // previously able to see every branch's schedules by omitting/
  // overriding branch_id; now forced to their own branch.
  @Get()
  @RequirePermission('hr.manage')
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

  // Branch Domain Batch 2, B6 (Owner-approved) — branch_id is legitimately
  // optional here (a schedule can be tenant-wide), so unlike the
  // shift/expense/table/waitlist writes above, a null effectiveBranchId is
  // valid and passed through as-is (Central omitting it, or a restricted
  // actor with no branch override) rather than rejected — only an explicit
  // cross-branch mismatch is rejected.
  @Post()
  @RequirePermission('hr.manage')
  @BranchScoped({ source: 'body', mode: 'write' })
  create(
    @GetTenant() tenant: TenantContext,
    @Body() dto: CreateScheduleDto,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
  ) {
    return this.service.create(tenant, {
      ...dto,
      branch_id: effectiveBranchId ?? undefined,
    });
  }

  @Post('bulk')
  @RequirePermission('hr.manage')
  @BranchScoped({ source: 'body', mode: 'write' })
  bulkCreate(
    @GetTenant() tenant: TenantContext,
    @Body() dto: BulkCreateScheduleDto,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
  ) {
    return this.service.bulkCreate(tenant, {
      ...dto,
      branch_id: effectiveBranchId ?? undefined,
    });
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
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.remove(id, tenant);
  }
}
