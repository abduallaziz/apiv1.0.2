import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant.context';
import { Request } from 'express';

@Controller('shifts')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class ShiftsController {
  constructor(private readonly service: ShiftsService) {}

  @Post('open')
  @RequirePermission('shift.open')
  openShift(
    @Body() dto: OpenShiftDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    const ip = req.headers['x-forwarded-for'] as string ?? req.socket.remoteAddress ?? '';
    const device = req.headers['user-agent'] ?? '';
    return this.service.openShift(dto, tenant, user.sub, user.role, ip, device);
  }

  @Post(':id/close')
  @RequirePermission('shift.close')
  closeShift(
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    const ip = req.headers['x-forwarded-for'] as string ?? req.socket.remoteAddress ?? '';
    const device = req.headers['user-agent'] ?? '';
    return this.service.closeShift(id, dto, tenant, user.sub, user.role, ip, device);
  }

  @Get()
  @RequirePermission('shift.view.branch')
  findAll(
    @GetTenant() tenant: TenantContext,
    @Query('branch_id') branchId?: string,
  ) {
    return this.service.findAll(tenant, branchId);
  }

  @Get('current')
  @RequirePermission('shift.view.own')
  getCurrentShift(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @Query('branch_id') branchId?: string,
  ) {
    const user = (req as any).user;
    return this.service.getCurrentShift(tenant, user.sub, branchId);
  }

  @Get(':id/summary')
  @RequirePermission('shift.view.own')
  getShiftSummary(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.service.getShiftSummary(id, tenant);
  }
}