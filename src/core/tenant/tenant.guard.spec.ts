import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuard } from './tenant.guard';
import { TenantContext } from './tenant.context';
import { BranchValidatorService } from '../security/branch-validator.service';
import {
  TenantIsolation,
  TenantIsolationService,
} from '../security/tenant-isolation.service';

const T = 't1';
const OWN = 'b-own';
const OTHER = 'b-other';
const MAIN = 'b-main';

function make(
  iso: TenantIsolation,
  activeBranches: string[] = [OWN, OTHER, MAIN],
) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
  const validator = {
    validate: jest.fn((id: string) =>
      activeBranches.includes(id)
        ? Promise.resolve()
        : Promise.reject(new ForbiddenException('Branch not found')),
    ),
  };
  const isolation = {
    get: jest.fn().mockResolvedValue(iso),
    isActiveBranch: jest.fn((_t: string, id: string) =>
      Promise.resolve(activeBranches.includes(id)),
    ),
  };
  const guard = new TenantGuard(
    reflector as unknown as Reflector,
    validator as unknown as BranchValidatorService,
    isolation as unknown as TenantIsolationService,
  );
  const run = async (
    user: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) => {
    const request: {
      user: unknown;
      headers: unknown;
      tenantContext?: TenantContext;
    } = {
      user,
      headers,
    };
    const ctx = {
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    await guard.canActivate(ctx);
    return request.tenantContext;
  };
  return { run, validator };
}

describe('TenantGuard branch resolution', () => {
  const off: TenantIsolation = { enabled: false, mainBranchId: MAIN };
  const on: TenantIsolation = { enabled: true, mainBranchId: MAIN };

  it('restricted user gets their own branch', async () => {
    const { run } = make(off);
    const ctx = await run({ tenant_id: T, role: 'cashier', branch_id: OWN });
    expect(ctx.branchId).toBe(OWN);
    expect(ctx.isolated).toBe(false);
  });

  it('restricted user naming another branch is rejected (flag off too)', async () => {
    const { run } = make(off);
    await expect(
      run(
        { tenant_id: T, role: 'cashier', branch_id: OWN },
        { 'x-branch-id': OTHER },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('restricted user sending their own branch header is fine', async () => {
    const { run } = make(on);
    const ctx = await run(
      { tenant_id: T, role: 'cashier', branch_id: OWN },
      { 'x-branch-id': OWN },
    );
    expect(ctx).toMatchObject({ branchId: OWN, isolated: true });
  });

  it('central user without header is tenant-wide when isolation is off', async () => {
    const { run } = make(off);
    const ctx = await run({ tenant_id: T, role: 'owner', branch_id: null });
    expect(ctx).toMatchObject({ branchId: null, isolated: false });
  });

  it('central user without header lands on the main branch under isolation', async () => {
    const { run } = make(on);
    const ctx = await run({ tenant_id: T, role: 'owner', branch_id: null });
    expect(ctx).toMatchObject({ branchId: MAIN, isolated: true });
  });

  it('central user header selects that branch, unknown branch is refused', async () => {
    const { run } = make(on);
    expect(
      (await run({ tenant_id: T, role: 'owner' }, { 'x-branch-id': OTHER }))
        .branchId,
    ).toBe(OTHER);
    await expect(
      run({ tenant_id: T, role: 'owner' }, { 'x-branch-id': 'nope' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('superadmin keeps using the headers', async () => {
    const { run } = make(off);
    const ctx = await run(
      { role: 'superadmin' },
      { 'x-tenant-id': 'tx', 'x-branch-id': OTHER },
    );
    expect(ctx).toMatchObject({ tenantId: 'tx', branchId: OTHER });
  });

  it('missing tenant is forbidden', async () => {
    const { run } = make(off);
    await expect(run({ role: 'owner' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
