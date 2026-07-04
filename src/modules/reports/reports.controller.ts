import { Controller, Get, Query, Res, UseGuards, BadRequestException } from '@nestjs/common';
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
  @Get('employees')
  @RequirePermission('reports.view.branch')
  async getEmployees(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getEmployeesReport(tenant, query);

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('employees', data as Record<string, unknown>);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="employees-report.xlsx"',
      });
      res.send(buffer);
      return;
    }

    return data;
  }

  @Get('customers')
  @RequirePermission('reports.view.branch')
  async getCustomers(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getCustomersReport(tenant, query);

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('customers', data as Record<string, unknown>);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="customers-report.xlsx"',
      });
      res.send(buffer);
      return;
    }

    return data;
  }

  @Get('tax')
  @RequirePermission('reports.view.branch')
  async getTax(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getTaxReport(tenant, query);

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('tax', data as Record<string, unknown>);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="tax-report.xlsx"',
      });
      res.send(buffer);
      return;
    }

    return data;
  }

  @Get('inventory')
  @RequirePermission('reports.view.branch')
  async getInventory(
    @GetTenant() tenant: TenantContext,
    @Query('warehouse_id') warehouseId: string,
    @Query('format') format: ExportFormat,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getInventoryReport(tenant, warehouseId);

    if (format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('inventory', data as Record<string, unknown>);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="inventory-report.xlsx"',
      });
      res.send(buffer);
      return;
    }

    return data;
  }

  @Get('cogs')
  @RequirePermission('reports.view.branch')
  async getCogs(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getCogsReport(tenant, query);

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('cogs', data as Record<string, unknown>);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="cogs-report.xlsx"',
      });
      res.send(buffer);
      return;
    }

    return data;
  }

  @Get('daily-reconciliation')
  @RequirePermission('reports.view.branch')
  async getDailyReconciliation(
    @GetTenant() tenant: TenantContext,
    @Query('date') date: string,
    @Query('branch_id') branchId?: string,
  ) {
    if (!date) {
      date = new Date().toISOString().slice(0, 10);
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format');
    }
    return this.reportsService.getDailyReconciliation(tenant, date, branchId);
  }

  @Get('comparison')
  @RequirePermission('reports.view.branch')
  async getComparison(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getPeriodComparison(tenant, query);
  }

  @Get('by-branch')
  @RequirePermission('reports.view.all')
  async getByBranch(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getBranchComparison(tenant, query);
  }

  @Get('customer-churn')
  @RequirePermission('reports.view.branch')
  async getCustomerChurn(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getCustomerChurn(tenant, query);
  }

  @Get('top-items')
  @RequirePermission('reports.view.branch')
  async getTopItems(
    @GetTenant() tenant: TenantContext,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getTopItems(tenant, query);
  }

  @Get('recent-activity')
  @RequirePermission('reports.view.branch')
  async getRecentActivity(@GetTenant() tenant: TenantContext) {
    return this.reportsService.getRecentActivity(tenant);
  }

  @Get('sparklines')
  @RequirePermission('reports.view.branch')
  async getSparklines(@GetTenant() tenant: TenantContext) {
    return this.reportsService.getSparklines(tenant);
  }

  @Get('payroll')
  @RequirePermission('hr.manage')
  async getPayroll(
    @GetTenant() tenant: TenantContext,
    @Query('month') month?: string,
  ) {
    if (!month) month = new Date().toISOString().substring(0, 7);
    else if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month must be in YYYY-MM format');
    }
    return this.reportsService.getPayrollReport(tenant, month);
  }
}