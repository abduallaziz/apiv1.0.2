import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { BranchValidatorService } from '../../core/security/branch-validator.service';

jest.mock('bcryptjs', () => ({
  compare: jest.fn().mockResolvedValue(false),
}));

// Branch Domain Batch 2, B5 (Owner-approved) — login() has a large surface
// (device_sessions insert, tenant business_type, role names, JWT signing)
// that only matters once past the branch-lifecycle check this phase adds.
// These tests deliberately stay focused on ordering/rejection at that
// check: bcrypt.compare is mocked to always return false, so a request
// that gets past the branch check fails at the password step instead
// (UnauthorizedException) rather than needing the full session/JWT
// machinery mocked out just to prove the branch check ran (or didn't).

const TENANT_A = 'tenant-a';
const BRANCH_A = 'branch-a';

function fakeUsersQuery(row: Record<string, unknown> | null) {
  const chain = {
    from: jest.fn(() => chain),
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    is: jest.fn(() => chain),
    single: jest.fn(() =>
      Promise.resolve({
        data: row,
        error: row ? null : new Error('not found'),
      }),
    ),
  };
  return chain;
}

function buildService(
  userRow: Record<string, unknown> | null,
  validateImpl: (branchId: string, tenantId: string) => Promise<void>,
) {
  const supabase = fakeUsersQuery(userRow);
  const branchValidator = {
    validate: jest.fn(validateImpl),
  } as unknown as BranchValidatorService;
  const accountingBootstrapService = {} as any;
  const jwtService = { sign: jest.fn(() => 'token') } as any;
  const config = { getOrThrow: jest.fn(() => 'https://fake') } as any;
  const auditService = { log: jest.fn().mockResolvedValue(undefined) } as any;

  const service = new AuthService(
    supabase,
    accountingBootstrapService,
    jwtService,
    config,
    auditService,
    branchValidator,
  );
  return { service, branchValidator };
}

const alwaysValid = () => Promise.resolve();
const alwaysInvalid = () =>
  Promise.reject(
    new ForbiddenException('Branch not found or does not belong to tenant'),
  );

describe('AuthService.login — branch lifecycle (B5)', () => {
  it('restricted user + inactive/deleted branch → rejected before password check, no session created', async () => {
    const { service, branchValidator } = buildService(
      {
        id: 'user-1',
        email: 'u@test.com',
        password_hash: '$2a$10$fakehashvalue',
        role: 'cashier',
        tenant_id: TENANT_A,
        is_active: true,
        name: 'User',
        branch_id: BRANCH_A,
      },
      alwaysInvalid,
    );

    await expect(
      service.login(
        {
          email: 'u@test.com',
          password: 'whatever',
          device_name: 'test',
        } as any,
        '127.0.0.1',
        'jest',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(branchValidator.validate).toHaveBeenCalledWith(BRANCH_A, TENANT_A);
  });

  it('restricted user + active branch → branch check passes, request proceeds to (and fails at) the password step', async () => {
    const { service, branchValidator } = buildService(
      {
        id: 'user-1',
        email: 'u@test.com',
        password_hash: '$2a$10$fakehashvalue',
        role: 'cashier',
        tenant_id: TENANT_A,
        is_active: true,
        name: 'User',
        branch_id: BRANCH_A,
      },
      alwaysValid,
    );

    await expect(
      service.login(
        { email: 'u@test.com', password: 'wrong', device_name: 'test' } as any,
        '127.0.0.1',
        'jest',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(branchValidator.validate).toHaveBeenCalledWith(BRANCH_A, TENANT_A);
  });

  it('central user (branch_id null) → branch check never invoked at all', async () => {
    const { service, branchValidator } = buildService(
      {
        id: 'user-1',
        email: 'u@test.com',
        password_hash: '$2a$10$fakehashvalue',
        role: 'owner',
        tenant_id: TENANT_A,
        is_active: true,
        name: 'Owner',
        branch_id: null,
      },
      alwaysValid,
    );

    await expect(
      service.login(
        { email: 'u@test.com', password: 'wrong', device_name: 'test' } as any,
        '127.0.0.1',
        'jest',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(branchValidator.validate).not.toHaveBeenCalled();
  });

  it('inactive account is still rejected before the branch check even runs (existing behavior unchanged)', async () => {
    const { service, branchValidator } = buildService(
      {
        id: 'user-1',
        email: 'u@test.com',
        password_hash: '$2a$10$fakehashvalue',
        role: 'cashier',
        tenant_id: TENANT_A,
        is_active: false,
        name: 'User',
        branch_id: BRANCH_A,
      },
      alwaysValid,
    );

    await expect(
      service.login(
        {
          email: 'u@test.com',
          password: 'whatever',
          device_name: 'test',
        } as any,
        '127.0.0.1',
        'jest',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(branchValidator.validate).not.toHaveBeenCalled();
  });
});
