import * as jwt from 'jsonwebtoken';
import { ExecutionContext } from '@nestjs/common';
import { decodeTenantId } from './decode-tenant.util';
import { isQaTenant } from './qa-tenant';
import { isLoadTestMode } from './load-test-mode';
import { TenantThrottlerGuard } from './tenant-throttler.guard';
import { resolveUserPermission } from '../permissions/permission-resolution.util';

const QA = '9bcd3369-d664-47c8-b297-3bc9b429aacf';
const SECRET = 'unit-test-secret-unit-test-secret-1234';
const FORGER = 'attacker-secret-attacker-secret-00';
const OLD = { ...process.env };
const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

beforeEach(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.NODE_ENV = 'development';
  delete process.env.LOAD_TEST_MODE;
});
afterAll(() => {
  process.env = OLD;
});

describe('decodeTenantId only trusts verified tokens (T4-A)', () => {
  it('returns tenant for a validly signed token', () => {
    expect(decodeTenantId(bearer(jwt.sign({ tenant_id: 'abc' }, SECRET)))).toBe(
      'abc',
    );
  });
  it('ignores a token forged with another secret', () => {
    expect(
      decodeTenantId(bearer(jwt.sign({ tenant_id: QA }, FORGER))),
    ).toBeUndefined();
  });
  it('ignores an unsigned (alg none) token', () => {
    const h = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url');
    const p = Buffer.from(JSON.stringify({ tenant_id: QA })).toString(
      'base64url',
    );
    expect(decodeTenantId(bearer(`${h}.${p}.`))).toBeUndefined();
  });
  it('ignores garbage and missing headers', () => {
    expect(decodeTenantId(bearer('garbage'))).toBeUndefined();
    expect(decodeTenantId({ headers: {} })).toBeUndefined();
  });
  it('fails closed when JWT_SECRET is unset', () => {
    const t = jwt.sign({ tenant_id: 'a' }, SECRET);
    delete process.env.JWT_SECRET;
    expect(decodeTenantId(bearer(t))).toBeUndefined();
  });
});

describe('QA exemption is non-production only (T4)', () => {
  it('applies in development, not in production', () => {
    expect(isQaTenant(QA)).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(isQaTenant(QA)).toBe(false);
  });
  it('never applies to other tenants', () => {
    expect(isQaTenant('someone-else')).toBe(false);
    expect(isQaTenant(null)).toBe(false);
  });
  it('LOAD_TEST_MODE is ignored in production', () => {
    process.env.LOAD_TEST_MODE = 'true';
    expect(isLoadTestMode()).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(isLoadTestMode()).toBe(false);
  });
});

describe('TenantThrottlerGuard.shouldSkip', () => {
  const guard = Object.create(TenantThrottlerGuard.prototype) as {
    shouldSkip(c: ExecutionContext): Promise<boolean>;
  };
  const ctx = (req: object) =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as ExecutionContext;

  it('does NOT skip for a forged QA token', async () => {
    const t = jwt.sign({ tenant_id: QA }, FORGER);
    expect(await guard.shouldSkip(ctx(bearer(t)))).toBe(false);
  });
  it('does NOT skip for an invalid token or no token', async () => {
    expect(await guard.shouldSkip(ctx(bearer('x.y.z')))).toBe(false);
    expect(await guard.shouldSkip(ctx({ headers: {} }))).toBe(false);
  });
  it('does NOT skip a normal tenant', async () => {
    const t = jwt.sign({ tenant_id: 'normal' }, SECRET);
    expect(await guard.shouldSkip(ctx(bearer(t)))).toBe(false);
  });
  it('skips a genuine QA token outside production only', async () => {
    const t = jwt.sign({ tenant_id: QA }, SECRET);
    expect(await guard.shouldSkip(ctx(bearer(t)))).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(await guard.shouldSkip(ctx(bearer(t)))).toBe(false);
  });
});

describe('RBAC bypass for QA tenant (T4-B)', () => {
  const perms = { hasPermission: jest.fn(), hasPermissionForUser: jest.fn() };
  const logger = { warn: jest.fn(), error: jest.fn() } as never;
  const user = (tenant: string) =>
    ({
      sub: 'u',
      role: 'cashier',
      roles: ['cashier'],
      tenant_id: tenant,
    }) as never;
  beforeEach(() => {
    perms.hasPermission.mockResolvedValue(false);
    perms.hasPermissionForUser.mockResolvedValue(false);
  });
  const run = (tenant: string) =>
    resolveUserPermission(perms as never, logger, user(tenant), 'x');

  it('QA tenant bypasses in development', async () => {
    expect(await run(QA)).toBe(true);
  });
  it('QA tenant is subject to normal RBAC in production', async () => {
    process.env.NODE_ENV = 'production';
    expect(await run(QA)).toBe(false);
  });
  it('a normal tenant never gets the bypass', async () => {
    expect(await run('n')).toBe(false);
  });
});
