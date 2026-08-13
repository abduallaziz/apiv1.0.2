import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { TenantGuard } from '../../core/tenant/tenant.guard';
import { PermissionGuard } from '../../core/permissions/permission.guard';
import { RequirePermission } from '../../core/permissions/require-permission.decorator';
import { GetTenant } from '../../core/tenant/get-tenant.decorator';
import { TenantContext } from '../../core/tenant/tenant-context';
import { AccountingService } from './accounting.service';
import { JournalEntriesQueryDto } from './dto/journal-entries-query.dto';

// Accounting Backend Phase 1 — Command Center, Journal Entries, Sales
// Posting, COGS Reconciliation, Fiscal Periods, Chart of Accounts.
// Price Override Audit and Owner/Branch Assignment live in their own
// controllers (price-override-audit.controller.ts,
// accounting-config.controller.ts) per the approved design's separation
// of concerns — same @Controller('accounting') route prefix, distinct
// files.
@UseGuards(JwtAuthGuard, TenantGuard, PermissionGuard)
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accountingService: AccountingService) {}

  @Get('command-center')
  @RequirePermission('accounting.view')
  async commandCenter(@GetTenant() tenant: TenantContext) {
    return this.accountingService.getCommandCenter(tenant);
  }

  @Get('journal-entries')
  @RequirePermission('accounting.journal.view')
  async journalEntries(
    @GetTenant() tenant: TenantContext,
    @Query() query: JournalEntriesQueryDto,
  ) {
    return this.accountingService.listJournalEntries(tenant, query);
  }

  @Get('journal-entries/:id')
  @RequirePermission('accounting.journal.view')
  async journalEntryDetail(
    @Param('id') id: string,
    @GetTenant() tenant: TenantContext,
  ) {
    return this.accountingService.getJournalEntry(tenant, id);
  }

  @Get('sales-posting')
  @RequirePermission('accounting.journal.view')
  async salesPosting(
    @GetTenant() tenant: TenantContext,
    @Query() query: JournalEntriesQueryDto,
  ) {
    return this.accountingService.listSalesPosting(tenant, query);
  }

  @Get('cogs-reconciliation')
  @RequirePermission('accounting.reconciliation.view')
  async cogsReconciliation(
    @GetTenant() tenant: TenantContext,
    @Query() query: JournalEntriesQueryDto,
  ) {
    return this.accountingService.listCogsReconciliation(tenant, query);
  }

  @Get('fiscal-periods')
  @RequirePermission('accounting.period.manage')
  async fiscalPeriods(@GetTenant() tenant: TenantContext) {
    return this.accountingService.listFiscalPeriods(tenant);
  }

  @Get('chart-of-accounts')
  @RequirePermission('accounting.ledger.view')
  async chartOfAccounts(@GetTenant() tenant: TenantContext) {
    return this.accountingService.getChartOfAccounts(tenant);
  }
}
