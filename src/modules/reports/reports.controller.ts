import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportQueryDto, ExportFormat } from './dto/report-query.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';

@Controller('reports')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('revenue')
  @RequirePermission('reports.view.branch')
  async getRevenue(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getRevenueReport(tenant, query);

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('revenue', data as Record<string, unknown>);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="revenue-report.xlsx"',
      });
      res.send(buffer);
      return;
    }

    return data;
  }

  @Get('shifts')
  @RequirePermission('reports.view.branch')
  async getShifts(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getShiftsReport(tenant, query);

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('shifts', data as Record<string, unknown>);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="shifts-report.xlsx"',
      });
      res.send(buffer);
      return;
    }

    return data;
  }

  @Get('expenses')
  @RequirePermission('reports.view.branch')
  async getExpenses(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getExpensesReport(tenant, query);

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('expenses', data as Record<string, unknown>);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="expenses-report.xlsx"',
      });
      res.send(buffer);
      return;
    }

    return data;
  }

  @Get('payments')
  @RequirePermission('reports.view.branch')
  async getPayments(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getPaymentsReport(tenant, query);

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('payments', data as Record<string, unknown>);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="payments-report.xlsx"',
      });
      res.send(buffer);
      return;
    }

    return data;
  }
}