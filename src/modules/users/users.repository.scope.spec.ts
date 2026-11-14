import { UsersRepository } from './users.repository';
import { TenantContext } from '../../core/tenant/tenant.context';

function build(isMain: boolean) {
  const q: any = { eq: jest.fn(() => q), or: jest.fn(() => q) };
  const branches: any = {
    select: () => branches,
    eq: () => branches,
    maybeSingle: () => Promise.resolve({ data: { is_main: isMain } }),
  };
  const supabase: any = { from: jest.fn(() => branches) };
  const repo = new UsersRepository(supabase) as any;
  return { repo, q };
}

describe('UsersRepository.scopeUsers', () => {
  it('main branch: includes central users', async () => {
    const { repo, q } = build(true);
    const t = new TenantContext('t1', 'b1', true);
    repo.scopeUsers(q, t, await repo.isMainBranch(t));
    expect(q.or).toHaveBeenCalledWith('branch_id.eq.b1,branch_id.is.null');
  });
  it('other branch: only its own users', async () => {
    const { repo, q } = build(false);
    const t = new TenantContext('t1', 'b2', true);
    repo.scopeUsers(q, t, await repo.isMainBranch(t));
    expect(q.eq).toHaveBeenCalledWith('branch_id', 'b2');
    expect(q.or).not.toHaveBeenCalled();
  });
  it('not isolated: untouched', async () => {
    const { repo, q } = build(false);
    const t = new TenantContext('t1', 'b2');
    repo.scopeUsers(q, t, await repo.isMainBranch(t));
    expect(q.eq).not.toHaveBeenCalled();
    expect(q.or).not.toHaveBeenCalled();
  });
});
