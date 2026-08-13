import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../core/tenant/tenant-context';
import { AccountingRepository } from './repositories/accounting.repository';
import { JournalEntriesQueryDto } from './dto/journal-entries-query.dto';
import { PriceOverrideAuditQueryDto } from './dto/price-override-audit-query.dto';
import { AssignBranchAccountingOwnerDto } from './dto/assign-branch-accounting-owner.dto';

// Accounting Backend Phase 1 — orchestrates AccountingRepository only.
// Deliberately contains no financial computation of its own: every value
// returned is either a direct read or a SUM/COUNT over already-posted
// journal_lines. Never calls fn_post_sales_order/fn_reverse_sales_order/
// fn_post_journal_entry/fn_reverse_journal_entry — those remain exclusively
// InvoicesRepository's concern, invoked only from the sale/cancel write path.
@Injectable()
export class AccountingService {
  constructor(private readonly repo: AccountingRepository) {}

  async getCommandCenter(tenant: TenantContext) {
    return this.repo.getCommandCenterSummary(tenant);
  }

  async listJournalEntries(
    tenant: TenantContext,
    query: JournalEntriesQueryDto,
  ) {
    return this.repo.findJournalEntries(tenant, query);
  }

  async getJournalEntry(tenant: TenantContext, id: string) {
    const entry = await this.repo.findJournalEntryDetail(tenant, id);
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  async listSalesPosting(tenant: TenantContext, query: JournalEntriesQueryDto) {
    return this.repo.findJournalEntries(tenant, {
      ...query,
      source_module: 'sales',
    });
  }

  async listCogsReconciliation(
    tenant: TenantContext,
    query: JournalEntriesQueryDto,
  ) {
    return this.repo.findJournalEntries(tenant, {
      ...query,
      source_module: 'sales',
      requires_cogs_reconciliation: true,
    });
  }

  async listPriceOverrideAudits(
    tenant: TenantContext,
    query: PriceOverrideAuditQueryDto,
  ) {
    return this.repo.findPriceOverrideAudits(tenant, query);
  }

  async getPriceOverrideAudit(tenant: TenantContext, id: string) {
    const audit = await this.repo.findPriceOverrideAuditDetail(tenant, id);
    if (!audit)
      throw new NotFoundException('Price override audit record not found');
    return audit;
  }

  async listFiscalPeriods(tenant: TenantContext) {
    return this.repo.findFiscalPeriods(tenant);
  }

  async listAccountingOwners(tenant: TenantContext) {
    return this.repo.findAccountingOwners(tenant);
  }

  async listBranchAssignments(tenant: TenantContext) {
    return this.repo.findBranchAssignments(tenant);
  }

  async assignBranchAccountingOwner(
    tenant: TenantContext,
    dto: AssignBranchAccountingOwnerDto,
    createdBy: string,
  ) {
    return this.repo.assignBranchAccountingOwner(tenant, dto, createdBy);
  }

  async getChartOfAccounts(tenant: TenantContext) {
    return this.repo.findChartOfAccounts(tenant);
  }
}
