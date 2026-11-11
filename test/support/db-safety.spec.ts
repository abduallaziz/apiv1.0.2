import {
  evaluateTestDbSafety,
  projectRefFromDbUrl,
  projectRefFromUrl,
  SafetyInput,
} from './db-safety';

const TEST_REF = 'abcdefghij1234567890';
const PROD_REF = 'prodprodprod1234567890';
const good = (): SafetyInput => ({
  testUrl: `https://${TEST_REF}.supabase.co`,
  testServiceKey: 'k',
  allowFlag: TEST_REF,
  testTenantId: '11111111-1111-4111-8111-111111111111',
  allowedRefs: [TEST_REF],
  protectedRefs: [PROD_REF],
});

describe('evaluateTestDbSafety (fail-closed)', () => {
  it('passes only when every condition holds', () => {
    const r = evaluateTestDbSafety(good());
    expect(r.ok).toBe(true);
    expect(r.ref).toBe(TEST_REF);
  });

  it('refuses when the allowlist is empty (default state)', () => {
    expect(evaluateTestDbSafety({ ...good(), allowedRefs: [] }).ok).toBe(false);
  });

  it('refuses a project that is the app database even if allow-listed', () => {
    const r = evaluateTestDbSafety({
      ...good(),
      allowedRefs: [TEST_REF],
      protectedRefs: [TEST_REF],
    });
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/production\/staging/);
  });

  it('refuses without the explicit ALLOW_DB_WRITE_TESTS=<ref> permission', () => {
    expect(evaluateTestDbSafety({ ...good(), allowFlag: undefined }).ok).toBe(false);
    expect(evaluateTestDbSafety({ ...good(), allowFlag: 'true' }).ok).toBe(false);
    expect(evaluateTestDbSafety({ ...good(), allowFlag: PROD_REF }).ok).toBe(false);
  });

  it('refuses without a dedicated test tenant or key', () => {
    expect(evaluateTestDbSafety({ ...good(), testTenantId: undefined }).ok).toBe(false);
    expect(evaluateTestDbSafety({ ...good(), testTenantId: 'nope' }).ok).toBe(false);
    expect(evaluateTestDbSafety({ ...good(), testServiceKey: '' }).ok).toBe(false);
  });

  it('refuses non-Supabase or missing URLs', () => {
    expect(evaluateTestDbSafety({ ...good(), testUrl: 'http://localhost:54321' }).ok).toBe(false);
    expect(evaluateTestDbSafety({ ...good(), testUrl: undefined }).ok).toBe(false);
  });

  it('does not rely on NODE_ENV', () => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    expect(evaluateTestDbSafety({ ...good(), allowedRefs: [] }).ok).toBe(false);
    process.env.NODE_ENV = old;
  });

  it('never includes secrets in reasons', () => {
    const r = evaluateTestDbSafety({ ...good(), testServiceKey: 'SECRET-KEY-123', allowedRefs: [] });
    expect(JSON.stringify(r)).not.toContain('SECRET-KEY-123');
  });
});

describe('local docker test stack', () => {
  const local = () => ({ ...good(), testUrl: 'http://127.0.0.1:54331', allowFlag: 'local', allowedRefs: [] });
  it('is accepted without an allowlist entry when explicitly permitted', () => {
    const r = evaluateTestDbSafety(local());
    expect(r.ok).toBe(true);
    expect(r.ref).toBe('local');
  });
  it('still needs the explicit permission flag', () => {
    expect(evaluateTestDbSafety({ ...local(), allowFlag: undefined }).ok).toBe(false);
  });
  it('a hosted URL is never treated as local', () => {
    expect(projectRefFromUrl('https://127.0.0.1.supabase.co')).not.toBe('local');
    expect(projectRefFromUrl('https://localhost.evil.com')).toBeNull();
  });
});

describe('project ref extraction', () => {
  it('reads the ref from a Supabase URL', () => {
    expect(projectRefFromUrl(`https://${TEST_REF}.supabase.co`)).toBe(TEST_REF);
    expect(projectRefFromUrl('https://example.com')).toBeNull();
  });
  it('reads the ref from pooler and direct DB URLs', () => {
    expect(projectRefFromDbUrl(`postgres://postgres.${PROD_REF}:pw@aws-1.pooler.supabase.com:6543/postgres`)).toBe(PROD_REF);
    expect(projectRefFromDbUrl(`postgresql://postgres:pw@db.${PROD_REF}.supabase.co:5432/postgres`)).toBe(PROD_REF);
    expect(projectRefFromDbUrl('postgres://u:p@localhost:5432/db')).toBeNull();
  });
});
