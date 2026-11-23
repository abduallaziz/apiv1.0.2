import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_PROJECT_REF,
  EXIT,
  FetchLike,
  RunnerError,
  checksumOf,
  createApi,
  loadConfig,
  planTransaction,
  runMigrations,
  shouldSkipOnBoot,
} from './migration-runner';

/** Fake Management API: records every request and emulates schema_migrations just enough. */
function makeFake(
  opts: {
    applied?: Record<string, string | null>;
    failOn?: RegExp;
    noChecksumColumns?: boolean;
    tableMissing?: boolean;
  } = {},
) {
  const rows = new Map<string, string | null>(Object.entries(opts.applied ?? {}));
  const requests: { url: string; auth: string; sql: string }[] = [];
  let tableExists = !opts.tableMissing;
  const fetchImpl: FetchLike = async (url, init) => {
    const sql = (JSON.parse(init.body) as { query: string }).query;
    requests.push({ url, auth: init.headers.Authorization, sql });
    const fail = (message: string) => ({
      ok: false,
      status: 400,
      json: async () => ({ message }),
    });
    const ok = (body: unknown = []) => ({
      ok: true,
      status: 200,
      json: async () => body,
    });
    if (opts.failOn && opts.failOn.test(sql)) return fail('boom');
    if (/^\s*SELECT/i.test(sql) && /schema_migrations/.test(sql)) {
      if (!tableExists) return fail('relation "schema_migrations" does not exist');
      return ok([...rows].map(([filename, checksum]) => ({ filename, checksum })));
    }
    if (/CREATE TABLE IF NOT EXISTS schema_migrations/.test(sql)) {
      tableExists = true;
      return ok();
    }
    if (/ALTER TABLE schema_migrations/.test(sql)) {
      return opts.noChecksumColumns ? fail('permission denied') : ok();
    }
    const upd =
      /UPDATE schema_migrations SET checksum = '([0-9a-f]+)' WHERE filename = '([^']+)'/.exec(sql);
    if (upd) {
      if (!rows.get(upd[2])) rows.set(upd[2], upd[1]);
      return ok();
    }
    const ins =
      /INSERT INTO schema_migrations \(filename[^)]*\) VALUES \('([^']+)'(?:, '([0-9a-f]+)')?/.exec(
        sql,
      );
    if (ins) {
      if (!rows.has(ins[1])) rows.set(ins[1], ins[2] ?? null);
      return ok();
    }
    return ok();
  };
  return { rows, requests, fetchImpl };
}

function makeDir(files: Record<string, string>, name = 'migrations'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c);
  return dir;
}

const silent = () => undefined;
const baseCfg = () => loadConfig({}, []);

describe('loadConfig', () => {
  it('defaults to today behaviour when no env is set', () => {
    const c = baseCfg();
    expect(c.targetRef).toBe(DEFAULT_PROJECT_REF);
    expect(c.migrationsOnBoot).toBe(true);
    expect(c.checksumMode).toBe('record');
    expect(c.transactionMode).toBe('off');
    expect(c.dryRun).toBe(false);
    expect(shouldSkipOnBoot(c)).toBe(false);
  });

  it('refuses a target that is not allow-listed (exit 2)', () => {
    const ref = 'a'.repeat(20);
    expect(() => loadConfig({ MIGRATION_TARGET_REF: ref }, [])).toThrow(
      /not in MIGRATION_ALLOWED_REFS/,
    );
    try {
      loadConfig({ MIGRATION_TARGET_REF: ref, MIGRATION_ALLOWED_REFS: 'b'.repeat(20) }, []);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RunnerError);
      expect((e as RunnerError).exitCode).toBe(EXIT.CONFIG);
    }
  });

  it('accepts an allow-listed override and rejects malformed refs', () => {
    const ref = 'a'.repeat(20);
    expect(
      loadConfig({ MIGRATION_TARGET_REF: ref, MIGRATION_ALLOWED_REFS: `x,${ref}` }, []).targetRef,
    ).toBe(ref);
    expect(() =>
      loadConfig({ MIGRATION_TARGET_REF: 'short', MIGRATION_ALLOWED_REFS: 'short' }, []),
    ).toThrow(/Invalid/);
  });

  it('parses flags and modes', () => {
    expect(loadConfig({}, ['--dry-run']).dryRun).toBe(true);
    expect(loadConfig({ MIGRATIONS_ON_BOOT: 'false' }, []).migrationsOnBoot).toBe(false);
    expect(() => loadConfig({ MIGRATION_CHECKSUM_MODE: 'x' }, [])).toThrow();
    expect(() => loadConfig({ MIGRATION_TRANSACTION_MODE: 'x' }, [])).toThrow();
  });

  it('MIGRATIONS_ON_BOOT=false skips boot runs but not release or dry-run', () => {
    const env = { MIGRATIONS_ON_BOOT: 'false' };
    expect(shouldSkipOnBoot(loadConfig(env, []))).toBe(true);
    expect(shouldSkipOnBoot(loadConfig(env, ['--release']))).toBe(false);
    expect(shouldSkipOnBoot(loadConfig({ ...env, MIGRATION_RELEASE_JOB: 'true' }, []))).toBe(false);
    expect(shouldSkipOnBoot(loadConfig(env, ['--dry-run']))).toBe(false);
  });
});

describe('checksumOf', () => {
  it('is stable across CRLF/LF and BOM', () => {
    expect(checksumOf('a\r\nb\r\n')).toBe(checksumOf('a\nb\n'));
    expect(checksumOf('﻿a')).toBe(checksumOf('a'));
    expect(checksumOf('a')).not.toBe(checksumOf('b'));
  });
});

describe('planTransaction', () => {
  it('wraps plain DDL', () => {
    expect(planTransaction('CREATE TABLE IF NOT EXISTS t(a int);').wrap).toBe(true);
  });
  it.each([
    ['CREATE INDEX CONCURRENTLY i ON t(a);', 'CONCURRENTLY'],
    ['BEGIN;\nCREATE TABLE x();\nCOMMIT;', 'own transaction control'],
    ['select 1;\ncommit;', 'own transaction control'],
    ['VACUUM t;', 'statement not allowed'],
    ["ALTER TYPE e ADD VALUE 'x';", 'ADD VALUE'],
  ])('does not wrap %s', (sql, reason) => {
    const p = planTransaction(sql);
    expect(p.wrap).toBe(false);
    expect(p.reason).toContain(reason);
  });
  it('ignores keywords in comments', () => {
    expect(planTransaction('-- BEGIN; COMMIT; CONCURRENTLY\nSELECT 1;').wrap).toBe(true);
  });
});

describe('runMigrations', () => {
  it('applies pending files in filename order, records checksum; default mode = separate requests', async () => {
    const dir = makeDir({ '002_b.sql': 'SELECT 2;', '001_a.sql': 'SELECT 1;', 'notes.txt': 'x' });
    const fake = makeFake();
    const api = createApi(baseCfg(), 'tok', fake.fetchImpl);
    const r = await runMigrations(baseCfg(), { api, dir, log: silent });
    expect(r.applied).toEqual(['001_a.sql', '002_b.sql']);
    expect(fake.rows.get('001_a.sql')).toBe(checksumOf('SELECT 1;'));
    expect(fake.requests.some((x) => /^BEGIN/.test(x.sql))).toBe(false);
    expect(fake.requests[0].url).toContain(`/projects/${DEFAULT_PROJECT_REF}/`);
    expect(fake.requests[0].auth).toBe('Bearer tok');
  });

  it('skips already applied files', async () => {
    const dir = makeDir({ '001_a.sql': 'SELECT 1;', '002_b.sql': 'SELECT 2;' });
    const fake = makeFake({ applied: { '001_a.sql': checksumOf('SELECT 1;') } });
    const r = await runMigrations(baseCfg(), {
      api: createApi(baseCfg(), 't', fake.fetchImpl),
      dir,
      log: silent,
    });
    expect(r.applied).toEqual(['002_b.sql']);
    expect(fake.requests.some((x) => x.sql === 'SELECT 1;')).toBe(false);
  });

  it('dry-run applies and writes nothing', async () => {
    const dir = makeDir({ '001_a.sql': 'SELECT 1;', '002_b.sql': 'SELECT 2;' });
    const fake = makeFake({ applied: { '001_a.sql': null } });
    const cfg = loadConfig({}, ['--dry-run']);
    const r = await runMigrations(cfg, {
      api: createApi(cfg, 't', fake.fetchImpl),
      dir,
      log: silent,
    });
    expect(r.wouldApply).toEqual(['002_b.sql']);
    expect(r.applied).toEqual([]);
    expect(fake.requests.every((x) => /^\s*SELECT/i.test(x.sql))).toBe(true);
    expect(fake.rows.get('001_a.sql')).toBeNull();
  });

  it('dry-run with a missing schema_migrations table lists everything and creates nothing', async () => {
    const dir = makeDir({ '001_a.sql': 'SELECT 1;' });
    const fake = makeFake({ tableMissing: true });
    const cfg = loadConfig({}, ['--dry-run']);
    const r = await runMigrations(cfg, {
      api: createApi(cfg, 't', fake.fetchImpl),
      dir,
      log: silent,
    });
    expect(r.wouldApply).toEqual(['001_a.sql']);
    expect(fake.requests).toHaveLength(1);
  });

  it('records checksum on first sight for rows that predate checksums, never fails', async () => {
    const dir = makeDir({ '001_a.sql': 'SELECT 1;' });
    const fake = makeFake({ applied: { '001_a.sql': null } });
    for (const mode of ['record', 'enforce']) {
      const cfg = loadConfig({ MIGRATION_CHECKSUM_MODE: mode }, []);
      const r = await runMigrations(cfg, {
        api: createApi(cfg, 't', fake.fetchImpl),
        dir,
        log: silent,
      });
      expect(r.checksumMismatches).toEqual([]);
    }
    expect(fake.rows.get('001_a.sql')).toBe(checksumOf('SELECT 1;'));
  });

  it('enforce mode refuses (exit 3) when an applied file changed, before applying anything', async () => {
    const dir = makeDir({ '001_a.sql': 'SELECT 1; -- edited', '002_b.sql': 'SELECT 2;' });
    const fake = makeFake({ applied: { '001_a.sql': checksumOf('SELECT 1;') } });
    const cfg = loadConfig({ MIGRATION_CHECKSUM_MODE: 'enforce' }, []);
    await expect(
      runMigrations(cfg, { api: createApi(cfg, 't', fake.fetchImpl), dir, log: silent }),
    ).rejects.toMatchObject({ exitCode: EXIT.CHECKSUM });
    expect(fake.rows.has('002_b.sql')).toBe(false);
  });

  it('default (record) mode only warns on a changed applied file and keeps going', async () => {
    const dir = makeDir({ '001_a.sql': 'SELECT 1; -- edited', '002_b.sql': 'SELECT 2;' });
    const fake = makeFake({ applied: { '001_a.sql': checksumOf('SELECT 1;') } });
    const logs: string[] = [];
    const r = await runMigrations(baseCfg(), {
      api: createApi(baseCfg(), 't', fake.fetchImpl),
      dir,
      log: (m) => logs.push(m),
    });
    expect(r.checksumMismatches).toEqual(['001_a.sql']);
    expect(r.applied).toEqual(['002_b.sql']);
    expect(logs.join('\n')).toMatch(/WARNING/);
  });

  it('continues without checksums when the columns cannot be added (default mode)', async () => {
    const dir = makeDir({ '001_a.sql': 'SELECT 1;' });
    const fake = makeFake({ noChecksumColumns: true });
    const r = await runMigrations(baseCfg(), {
      api: createApi(baseCfg(), 't', fake.fetchImpl),
      dir,
      log: silent,
    });
    expect(r.applied).toEqual(['001_a.sql']);
    expect(
      fake.requests.some((x) => /INSERT INTO schema_migrations \(filename\) VALUES/.test(x.sql)),
    ).toBe(true);
  });

  it('enforce mode treats failure to add the checksum columns as a config refusal', async () => {
    const dir = makeDir({ '001_a.sql': 'SELECT 1;' });
    const fake = makeFake({ noChecksumColumns: true });
    const cfg = loadConfig({ MIGRATION_CHECKSUM_MODE: 'enforce' }, []);
    await expect(
      runMigrations(cfg, { api: createApi(cfg, 't', fake.fetchImpl), dir, log: silent }),
    ).rejects.toMatchObject({ exitCode: EXIT.CONFIG });
  });

  it('auto transaction mode wraps file + record in one request, but not CONCURRENTLY files', async () => {
    const dir = makeDir({
      '001_a.sql': 'CREATE TABLE IF NOT EXISTS a(i int);',
      '002_b.sql': 'CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON a(i);',
    });
    const fake = makeFake();
    const cfg = loadConfig({ MIGRATION_TRANSACTION_MODE: 'auto' }, []);
    await runMigrations(cfg, { api: createApi(cfg, 't', fake.fetchImpl), dir, log: silent });
    const wrapped = fake.requests.filter((x) => /^BEGIN;/.test(x.sql));
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].sql).toMatch(
      /CREATE TABLE IF NOT EXISTS a[\s\S]*INSERT INTO schema_migrations[\s\S]*COMMIT;$/,
    );
    expect(fake.rows.has('002_b.sql')).toBe(true);
  });

  it('a failing file stops the run with exit 4, is not recorded, and a wrapped one sends ROLLBACK', async () => {
    const dir = makeDir({ '001_a.sql': 'SELECT 1; -- bad', '002_b.sql': 'SELECT 2;' });
    const fake = makeFake({ failOn: /-- bad/ });
    const cfg = loadConfig({ MIGRATION_TRANSACTION_MODE: 'auto' }, []);
    await expect(
      runMigrations(cfg, { api: createApi(cfg, 't', fake.fetchImpl), dir, log: silent }),
    ).rejects.toMatchObject({ exitCode: EXIT.SQL });
    expect(fake.rows.size).toBe(0);
    expect(fake.requests.some((x) => x.sql === 'ROLLBACK')).toBe(true);
  });

  it('refuses to scan migrations_pending (or any directory not named migrations)', async () => {
    const dir = makeDir({ '324_x.sql': 'SELECT 1;' }, 'migrations_pending');
    const fake = makeFake();
    await expect(
      runMigrations(baseCfg(), {
        api: createApi(baseCfg(), 't', fake.fetchImpl),
        dir,
        log: silent,
      }),
    ).rejects.toMatchObject({ exitCode: EXIT.CONFIG });
    expect(fake.requests).toHaveLength(0);
  });

  it('missing token is a config error (exit 2)', async () => {
    const dir = makeDir({ '001_a.sql': 'SELECT 1;' });
    const fake = makeFake();
    await expect(
      runMigrations(baseCfg(), {
        api: createApi(baseCfg(), undefined, fake.fetchImpl),
        dir,
        log: silent,
      }),
    ).rejects.toMatchObject({ exitCode: EXIT.CONFIG });
  });

  it('no pending-only file is present in the live migrations folder', () => {
    const live = new Set(fs.readdirSync(path.join(__dirname, 'migrations')));
    const pending = fs
      .readdirSync(path.join(__dirname, 'migrations_pending'))
      .filter((f) => f.endsWith('.sql'));
    for (const p of pending) expect(live.has(p)).toBe(false);
  });
});
