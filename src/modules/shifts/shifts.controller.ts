import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Res,
  Query,
  StreamableFile,
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
import { BranchScoped } from '../../core/security/branch-scoped.decorator';
import { EffectiveBranchId } from '../../core/security/effective-branch-id.decorator';
import { Request, Response } from 'express';

@Controller('shifts')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class ShiftsController {
  constructor(private readonly service: ShiftsService) {}

  // Branch Domain Batch 2, B6 (Owner-approved) — dto.branch_id was
  // previously trusted outright for the shift's branch of record; a
  // restricted cashier's request now has it overridden with the
  // server-derived effectiveBranchId (rejected outright on an explicit
  // mismatch), same as POST /invoices.
  @Post('open')
  @RequirePermission('shift.open')
  @BranchScoped({ source: 'body', mode: 'write' })
  openShift(
    @Body() dto: OpenShiftDto,
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
    @Req() req: Request,
  ) {
    if (!effectiveBranchId) {
      throw new BadRequestException('branch_id is required to open a shift');
    }
    const user = (req as any).user;
    const ip =
      (req.headers['x-forwarded-for'] as string) ??
      req.socket.remoteAddress ??
      '';
    const device = req.headers['user-agent'] ?? '';
    return this.service.openShift(
      { ...dto, branch_id: effectiveBranchId },
      tenant,
      user.sub,
      user.role,
      ip,
      device,
    );
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
    const ip =
      (req.headers['x-forwarded-for'] as string) ??
      req.socket.remoteAddress ??
      '';
    const device = req.headers['user-agent'] ?? '';
    return this.service.closeShift(
      id,
      dto,
      tenant,
      user.sub,
      user.role,
      ip,
      device,
    );
  }

  @Post('drawer-open')
  @RequirePermission('shift.open')
  drawerOpen(@GetTenant() tenant: TenantContext, @Req() req: Request) {
    const user = (req as any).user;
    const ip =
      (req.headers['x-forwarded-for'] as string) ??
      req.socket.remoteAddress ??
      '';
    const device = req.headers['user-agent'] ?? '';
    return this.service.logDrawerOpen(tenant, user.sub, user.role, ip, device);
  }

  // Branch Domain Batch 1, B2 (Owner-approved) — Restricted actors were
  // previously able to see every branch's shifts by simply omitting/
  // overriding branch_id; now forced to their own branch, same as
  // Invoices.
  @Get()
  @RequirePermission('shift.view.branch')
  @BranchScoped()
  findAll(
    @GetTenant() tenant: TenantContext,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
  ) {
    return this.service.findAll(tenant, effectiveBranchId ?? undefined);
  }

  @Get('current')
  @RequirePermission('shift.view.own')
  @BranchScoped()
  async getCurrentShift(
    @GetTenant() tenant: TenantContext,
    @Req() req: Request,
    @EffectiveBranchId() effectiveBranchId: string | null | undefined,
  ) {
    const user = (req as any).user;
    const shift = await this.service.getCurrentShift(
      tenant,
      user.sub,
      effectiveBranchId ?? undefined,
    );
    return shift ?? null;
  }

  @Get(':id/report.pdf')
  @RequirePermission('shift.view.own')
  async getShiftReportPdf(
    @Param('id') id: string,
    @Query('lang') lang: string,
    @GetTenant() tenant: TenantContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { buffer, fileName } = await this.service.getShiftReportPdf(
      id,
      tenant,
      lang === 'en' ? 'en' : 'ar',
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(buffer);
  }

  @Get(':id/report')
  @RequirePermission('shift.view.own')
  getShiftReport(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.service.getShiftReport(id, tenant);
  }

  @Get(':id/summary')
  @RequirePermission('shift.view.own')
  getShiftSummary(@Param('id') id: string, @GetTenant() tenant: TenantContext) {
    return this.service.getShiftSummary(id, tenant);
  }
}
