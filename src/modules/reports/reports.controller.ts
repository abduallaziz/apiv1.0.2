import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { ReportQueryDto, ExportFormat } from './dto/report-query.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { Audit } from '../../core/audit/audit.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtPayload } from '../../shared/types/jwt-payload.type';

@Controller('reports')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('revenue')
  @RequirePermission('reports.view.branch')
  async getRevenue(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getRevenueReport(
      tenant,
      user,
      query,
    );

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('revenue', data);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getShiftsReport(tenant, user, query);

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('shifts', data);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getExpensesReport(
      tenant,
      user,
      query,
    );

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('expenses', data);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getPaymentsReport(
      tenant,
      user,
      query,
    );

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('payments', data);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
      const buffer = await this.reportsService.exportToExcel('employees', data);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
      const buffer = await this.reportsService.exportToExcel('customers', data);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="customers-report.xlsx"',
      });
      res.send(buffer);
      return;
    }

    return data;
  }

  // Branch Domain Batch 1, B3 (Owner-approved) — reuses the same
  // resolveReportBranchScope pattern already proven on revenue/shifts/
  // expenses/customer-churn/top-items/recent-activity/sparklines, rather
  // than the B2 interceptor, to keep Reports internally consistent.
  @Get('tax')
  @RequirePermission('reports.view.branch')
  async getTax(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getTaxReport(tenant, user, query);

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('tax', data);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="tax-report.xlsx"',
      });
      res.send(buffer);
      return;
    }

    return data;
  }

  // Branch Domain Batch 2 (Owner-approved) — warehouse_id is the only
  // client-supplied handle here (no fake branch_id param introduced);
  // getInventoryReport() resolves warehouse_id -> warehouses.branch_id ->
  // the same resolveReportBranchScope every other migrated Reports
  // endpoint already uses, before the RPC ever runs.
  @Get('inventory')
  @RequirePermission('reports.view.branch')
  async getInventory(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query('warehouse_id') warehouseId: string,
    @Query('format') format: ExportFormat,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getInventoryReport(
      tenant,
      user,
      warehouseId,
    );

    if (format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('inventory', data);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reportsService.getCogsReport(tenant, user, query);

    if (query.format === ExportFormat.EXCEL) {
      const buffer = await this.reportsService.exportToExcel('cogs', data);
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
    @CurrentUser() user: JwtPayload,
    @Query('date') date: string,
    @Query('branch_id') branchId?: string,
  ) {
    // Phase 1: an omitted date means "today" in the TENANT timezone; the
    // service resolves it (the controller only knows the UTC date).
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format');
    }
    return this.reportsService.getDailyReconciliation(
      tenant,
      user,
      date,
      branchId,
    );
  }

  @Get('comparison')
  @RequirePermission('reports.view.branch')
  async getComparison(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getPeriodComparison(tenant, user, query);
  }

  // Branch Domain Batch 1, B3 (Owner-approved) — deliberately UNCHANGED.
  // getBranchComparison() never reads query.branch_id at all (it always
  // returns every branch's own metrics, tagged with each branch's own
  // branch_id) — this is a genuinely, intentionally tenant-wide
  // cross-branch comparison report, already correctly gated by the real,
  // enforced `reports.view.all` permission tier. Forcing branch narrowing
  // onto it would contradict its actual purpose, per the explicit
  // instruction not to do that.
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
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getCustomerChurn(tenant, user, query);
  }

  @Get('top-items')
  @RequirePermission('reports.view.branch')
  async getTopItems(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getTopItems(tenant, user, query);
  }

  @Get('recent-activity')
  @RequirePermission('reports.view.branch')
  async getRecentActivity(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getRecentActivity(tenant, user, query);
  }

  @Get('sparklines')
  @RequirePermission('reports.view.branch')
  async getSparklines(
    @GetTenant() tenant: TenantContext,
    @CurrentUser() user: JwtPayload,
    @Query() query: ReportQueryDto,
  ) {
    return this.reportsService.getSparklines(tenant, user, query);
  }

  @Get('hr-summary')
  @RequirePermission('attendance.view.all')
  async getHrSummary(@GetTenant() tenant: TenantContext) {
    return this.reportsService.getHrSummary(tenant);
  }

  @Get('audit-summary')
  @RequirePermission('attendance.view.all')
  async getAuditSummary(@GetTenant() tenant: TenantContext) {
    return this.reportsService.getAuditSummary(tenant);
  }

  @Get('payroll')
  @Audit('payroll.calculated')
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
