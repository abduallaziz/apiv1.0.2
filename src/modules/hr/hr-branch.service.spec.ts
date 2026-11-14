import { NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../core/tenant/tenant.context';
import { HrBranchService } from './hr-branch.service';

function makeService(row: { branch_id: string | null } | null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data: row, error: null });
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'eq', 'is']) chain[m] = jest.fn(() => chain);
  chain.maybeSingle = maybeSingle;
  const supabase = { from: jest.fn(() => chain) };
  return {
    service: new HrBranchService(supabase as never),
    supabase,
  };
}

describe('HrBranchService', () => {
  it('is a no-op (no query) when isolation is off', async () => {
    const { service, supabase } = makeService(null);
    const tenant = new TenantContext('t1', null, false);
    await expect(service.branchOfEmployee(tenant, 'u1')).resolves.toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns the employee branch when it is the working branch', async () => {
    const { service } = makeService({ branch_id: 'bA' });
    const tenant = new TenantContext('t1', 'bA', true);
    await expect(service.branchOfEmployee(tenant, 'u1')).resolves.toBe('bA');
  });

  it('404s for an employee of another branch', async () => {
    const { service } = makeService({ branch_id: 'bB' });
    const tenant = new TenantContext('t1', 'bA', true);
    await expect(service.branchOfEmployee(tenant, 'u1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404s for an unknown or central (unbranched) user', async () => {
    const tenant = new TenantContext('t1', 'bA', true);
    await expect(
      makeService(null).service.assertEmployeesInScope(tenant, ['u1']),
    ).rejects.toThrow(NotFoundException);
    await expect(
      makeService({ branch_id: null }).service.assertEmployeesInScope(tenant, [
        'u1',
      ]),
    ).rejects.toThrow(NotFoundException);
  });
});
