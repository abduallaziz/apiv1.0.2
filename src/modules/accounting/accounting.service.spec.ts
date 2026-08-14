import { ConflictException, NotFoundException } from '@nestjs/common';
import { AccountingService } from './accounting.service';
import { TenantContext } from '../../core/tenant/tenant-context';

const TENANT = new TenantContext('t1', 'b1');

function buildService(repoOverrides: Partial<Record<string, jest.Mock>> = {}) {
  const repo = {
    getCommandCenterSummary: jest.fn().mockResolvedValue({ revenue: 0 }),
    findJournalEntries: jest
      .fn()
      .mockResolvedValue({ data: [], total: 0, page: 1, perPage: 50 }),
    findJournalEntryDetail: jest.fn().mockResolvedValue(null),
    findPriceOverrideAudits: jest
      .fn()
      .mockResolvedValue({ data: [], total: 0, page: 1, perPage: 50 }),
    findPriceOverrideAuditDetail: jest.fn().mockResolvedValue(null),
    findFiscalPeriods: jest.fn().mockResolvedValue([]),
    findAccountingOwners: jest.fn().mockResolvedValue([]),
    findBranchAssignments: jest.fn().mockResolvedValue([]),
    assignBranchAccountingOwner: jest.fn().mockResolvedValue({ id: 'a1' }),
    findChartOfAccounts: jest.fn().mockResolvedValue([]),
    ...repoOverrides,
  };
  const service = new AccountingService(repo as any);
  return { service, repo };
}

describe('AccountingService', () => {
  it('getCommandCenter delegates to repo.getCommandCenterSummary, no local computation of financial values', async () => {
    const { service, repo } = buildService();
    await service.getCommandCenter(TENANT);
    expect(repo.getCommandCenterSummary).toHaveBeenCalledWith(TENANT);
  });

  it('listJournalEntries passes the query through unchanged', async () => {
    const { service, repo } = buildService();
    const query = { page: 2, per_page: 10 } as any;
    await service.listJournalEntries(TENANT, query);
    expect(repo.findJournalEntries).toHaveBeenCalledWith(TENANT, query);
  });

  it('getJournalEntry throws NotFoundException when the repo returns null', async () => {
    const { service } = buildService({
      findJournalEntryDetail: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.getJournalEntry(TENANT, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getJournalEntry returns the entry when found', async () => {
    const entry = { id: 'e1', lines: [] };
    const { service } = buildService({
      findJournalEntryDetail: jest.fn().mockResolvedValue(entry),
    });
    await expect(service.getJournalEntry(TENANT, 'e1')).resolves.toEqual(entry);
  });

  it('listSalesPosting forces source_module=sales regardless of caller input', async () => {
    const { service, repo } = buildService();
    await service.listSalesPosting(TENANT, {
      page: 1,
      per_page: 50,
      source_module: 'ignored',
    });
    expect(repo.findJournalEntries).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ source_module: 'sales' }),
    );
  });

  it('listCogsReconciliation forces source_module=sales AND requires_cogs_reconciliation=true', async () => {
    const { service, repo } = buildService();
    await service.listCogsReconciliation(TENANT, {
      page: 1,
      per_page: 50,
    });
    expect(repo.findJournalEntries).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({
        source_module: 'sales',
        requires_cogs_reconciliation: true,
      }),
    );
  });

  it('getPriceOverrideAudit throws NotFoundException when missing', async () => {
    const { service } = buildService({
      findPriceOverrideAuditDetail: jest.fn().mockResolvedValue(null),
    });
    await expect(
      service.getPriceOverrideAudit(TENANT, 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assignBranchAccountingOwner delegates with the actor id', async () => {
    const { service, repo } = buildService();
    const dto = {
      branch_id: 'b1',
      accounting_owner_id: 'o1',
      effective_from: '2026-08-13',
    } as any;
    await service.assignBranchAccountingOwner(TENANT, dto, 'user-1');
    expect(repo.assignBranchAccountingOwner).toHaveBeenCalledWith(
      TENANT,
      dto,
      'user-1',
    );
  });

  it('assignBranchAccountingOwner maps excl_branch_accounting_assignments_no_overlap to a 409', async () => {
    // Shape matches the real @supabase-js/PostgREST error object confirmed
    // live: {code, details, hint, message} — no `.constraint` field.
    const dbError = Object.assign(
      new Error(
        'conflicting key value violates exclusion constraint "excl_branch_accounting_assignments_no_overlap"',
      ),
      { code: '23P01' },
    );
    const { service } = buildService({
      assignBranchAccountingOwner: jest.fn().mockRejectedValue(dbError),
    });
    const dto = {
      branch_id: 'b1',
      accounting_owner_id: 'o1',
      effective_from: '2026-08-13',
    } as any;
    await expect(
      service.assignBranchAccountingOwner(TENANT, dto, 'user-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('assignBranchAccountingOwner rethrows unrelated errors unchanged (stays a 500)', async () => {
    const dbError = Object.assign(new Error('connection terminated'), {
      code: '57P01',
    });
    const { service } = buildService({
      assignBranchAccountingOwner: jest.fn().mockRejectedValue(dbError),
    });
    const dto = {
      branch_id: 'b1',
      accounting_owner_id: 'o1',
      effective_from: '2026-08-13',
    } as any;
    await expect(
      service.assignBranchAccountingOwner(TENANT, dto, 'user-1'),
    ).rejects.toBe(dbError);
  });

  it('assignBranchAccountingOwner rethrows a different exclusion-constraint violation unchanged', async () => {
    const dbError = Object.assign(
      new Error(
        'conflicting key value violates exclusion constraint "some_other_constraint"',
      ),
      { code: '23P01' },
    );
    const { service } = buildService({
      assignBranchAccountingOwner: jest.fn().mockRejectedValue(dbError),
    });
    const dto = {
      branch_id: 'b1',
      accounting_owner_id: 'o1',
      effective_from: '2026-08-13',
    } as any;
    await expect(
      service.assignBranchAccountingOwner(TENANT, dto, 'user-1'),
    ).rejects.toBe(dbError);
  });

  it('getChartOfAccounts delegates to the repo', async () => {
    const { service, repo } = buildService();
    await service.getChartOfAccounts(TENANT);
    expect(repo.findChartOfAccounts).toHaveBeenCalledWith(TENANT);
  });

  it('listFiscalPeriods / listAccountingOwners / listBranchAssignments all delegate cleanly', async () => {
    const { service, repo } = buildService();
    await service.listFiscalPeriods(TENANT);
    await service.listAccountingOwners(TENANT);
    await service.listBranchAssignments(TENANT);
    expect(repo.findFiscalPeriods).toHaveBeenCalledWith(TENANT);
    expect(repo.findAccountingOwners).toHaveBeenCalledWith(TENANT);
    expect(repo.findBranchAssignments).toHaveBeenCalledWith(TENANT);
  });
});
