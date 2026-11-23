/**
 * WP-C - the migration runner against a REAL Postgres (loopback scratch database only).
 *
 * The Supabase Management API is replaced by a fetch stand-in that executes the posted SQL on a
 * scratch database of the local test server. This proves the SQL the runner generates (checksum
 * columns, record/UPDATE statements, BEGIN..COMMIT wrapper, ROLLBACK) is valid Postgres and behaves
 * as designed. It does NOT prove how the hosted Management API treats multi-statement requests.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client as PgClient } from 'pg';
import {
  EXIT,
  FetchLike,
  checksumOf,
  createApi,
  loadConfig,
  runMigrations,
} from '../migration-runner';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const ROOT = path.resolve(__dirname, '..', '..', '..');
const silent = () => undefined;

function makeDir(files: Record<string, string>): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migpg-')), 'migrations');
  fs.mkdirSync(dir);
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c);
  return dir;
}

describe('migration runner on a real Postgres (scratch DB)', () => {
  jest.setTimeout(300_000); // catalog introspection / DDL can be slow on a loaded machine
  const adminUrl = process.env.DATABASE_URL as string;
  let admin: PgClient;
  let dbs: string[] = [];

  async function freshDb(bootstrap = false): Promise<PgClient> {
    const name = `sefay_runner_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await admin.query(`CREATE DATABASE ${name}`);
    dbs.push(name);
    const u = new URL(adminUrl);
    u.pathname = `/${name}`;
    const c = new PgClient({ connectionString: u.toString() });
    await c.connect();
    if (bootstrap) await c.query(fs.readFileSync(path.join(ROOT, 'test/local-db/bootstrap.sql'), 'utf8'));
    return c;
  }

  /** Stand-in for the Management API: runs the posted SQL; returns the rows of the last SELECT. */
  function pgFetch(c: PgClient): FetchLike {
    return async (_url, init) => {
      const sql = (JSON.parse(init.body) as { query: string }).query;
      try {
        const res = await c.query(sql);
        const last = Array.isArray(res) ? res[res.length - 1] : res;
        return { ok: true, status: 200, json: async () => last?.rows ?? [] };
      } catch (e) {
        return { ok: false, status: 400, json: async () => ({ message: (e as Error).message }) };
      }
    };
  }

  beforeAll(async () => {
    expect(LOOPBACK).toContain(new URL(adminUrl).hostname);
    admin = new PgClient({ connectionString: adminUrl });
    await admin.connect();
  });

  afterAll(async () => {
    for (const d of dbs) await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }, 60_000);

  const run = (c: PgClient, dir: string, env: Record<string, string> = {}, argv: string[] = []) => {
    const cfg = loadConfig(env, argv);
    return runMigrations(cfg, { api: createApi(cfg, 'test-token', pgFetch(c)), dir, log: silent });
  };

  it('applies, records checksum/applied_by/applied_from, and a re-run applies nothing', async () => {
    const c = await freshDb();
    const dir = makeDir({
      '001_a.sql': 'CREATE TABLE IF NOT EXISTS t1 (id int);',
      '002_b.sql': 'ALTER TABLE t1 ADD COLUMN IF NOT EXISTS v text;',
    });
    const env = { MIGRATION_CHECKSUM_MODE: 'record', MIGRATION_APPLIED_BY: 'tester', MIGRATION_APPLIED_FROM: 'jest' };
    expect((await run(c, dir, env)).applied).toEqual(['001_a.sql', '002_b.sql']);
    const rows = (await c.query('SELECT filename, checksum, applied_by, applied_from FROM schema_migrations ORDER BY id')).rows;
    expect(rows[0]).toEqual({
      filename: '001_a.sql',
      checksum: checksumOf('CREATE TABLE IF NOT EXISTS t1 (id int);'),
      applied_by: 'tester',
      applied_from: 'jest',
    });
    expect((await run(c, dir, env)).applied).toEqual([]);
    await c.end();
  });

  it('upgrades a legacy schema_migrations table (no checksum columns) without touching its rows', async () => {
    const c = await freshDb();
    await c.query(
      'CREATE TABLE schema_migrations (id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
    );
    await c.query("INSERT INTO schema_migrations (filename) VALUES ('001_a.sql')");
    const before = (await c.query('SELECT id, applied_at FROM schema_migrations')).rows[0];
    const dir = makeDir({ '001_a.sql': 'CREATE TABLE should_not_run (i int);', '002_b.sql': 'SELECT 1;' });
    for (const mode of ['record', 'enforce']) {
      const r = await run(c, dir, { MIGRATION_CHECKSUM_MODE: mode });
      expect(r.checksumMismatches).toEqual([]);
    }
    const t = await c.query("SELECT to_regclass('should_not_run') AS r");
    expect(t.rows[0].r).toBeNull(); // an already-recorded file is never re-run
    const row = (await c.query("SELECT id, applied_at, checksum FROM schema_migrations WHERE filename='001_a.sql'")).rows[0];
    expect(row.id).toBe(before.id);
    expect(row.applied_at).toEqual(before.applied_at);
    expect(row.checksum).toBe(checksumOf('CREATE TABLE should_not_run (i int);'));
    await c.end();
  });

  it('enforce mode blocks when an applied file changes; nothing new is applied', async () => {
    const c = await freshDb();
    const dir = makeDir({ '001_a.sql': 'CREATE TABLE IF NOT EXISTS t1 (id int);' });
    await run(c, dir, { MIGRATION_CHECKSUM_MODE: 'record' });
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE IF NOT EXISTS t1 (id int, extra int);');
    fs.writeFileSync(path.join(dir, '002_b.sql'), 'CREATE TABLE IF NOT EXISTS t2 (id int);');
    await expect(run(c, dir, { MIGRATION_CHECKSUM_MODE: 'enforce' })).rejects.toMatchObject({ exitCode: EXIT.CHECKSUM });
    expect((await c.query("SELECT to_regclass('t2') AS r")).rows[0].r).toBeNull();
    await c.end();
  });

  it('dry-run leaves the database byte-for-byte unchanged (no table, no columns, no rows)', async () => {
    const c = await freshDb();
    const dir = makeDir({ '001_a.sql': 'CREATE TABLE t_dry (i int);' });
    const r = await run(c, dir, {}, ['--dry-run']);
    expect(r.wouldApply).toEqual(['001_a.sql']);
    expect((await c.query("SELECT to_regclass('schema_migrations') AS r")).rows[0].r).toBeNull();
    expect((await c.query("SELECT to_regclass('t_dry') AS r")).rows[0].r).toBeNull();
    await c.end();
  });

  it('transaction auto: a failing file leaves no partial state and is not recorded', async () => {
    const c = await freshDb();
    const dir = makeDir({
      '001_ok.sql': 'CREATE TABLE IF NOT EXISTS ok1 (i int);',
      '002_bad.sql': 'CREATE TABLE half_done (i int);\nINSERT INTO does_not_exist VALUES (1);',
    });
    await expect(run(c, dir, { MIGRATION_TRANSACTION_MODE: 'auto' })).rejects.toMatchObject({ exitCode: EXIT.SQL });
    expect((await c.query("SELECT to_regclass('half_done') AS r")).rows[0].r).toBeNull();
    expect((await c.query("SELECT to_regclass('ok1') AS r")).rows[0].r).not.toBeNull();
    const names = (await c.query('SELECT filename FROM schema_migrations')).rows.map((x) => x.filename);
    expect(names).toEqual(['001_ok.sql']);
    // the session is usable afterwards (no aborted transaction left open)
    await c.query('SELECT 1');
    await c.end();
  });

  it('transaction auto does not wrap a file with CONCURRENTLY (it would fail inside a transaction)', async () => {
    const c = await freshDb();
    const dir = makeDir({
      '001_a.sql': 'CREATE TABLE IF NOT EXISTS tc (i int);',
      '002_idx.sql': 'CREATE INDEX CONCURRENTLY IF NOT EXISTS tc_i ON tc (i);',
    });
    const r = await run(c, dir, { MIGRATION_TRANSACTION_MODE: 'auto' });
    expect(r.applied).toEqual(['001_a.sql', '002_idx.sql']);
    await c.end();
  });

  it('applies the entire real migrations folder through the runner; a re-run applies nothing and verifies every checksum', async () => {
    const c = await freshDb(true);
    const real = path.join(ROOT, 'src/database/migrations');
    const expected = fs.readdirSync(real).filter((f) => f.endsWith('.sql')).length;
    const env = { MIGRATION_CHECKSUM_MODE: 'enforce' };
    const first = await run(c, real, env);
    expect(first.applied).toHaveLength(expected);
    const second = await run(c, real, env);
    expect(second.applied).toEqual([]);
    expect(second.checksumMismatches).toEqual([]);
    const nulls = await c.query('SELECT count(*)::int AS n FROM schema_migrations WHERE checksum IS NULL');
    expect(nulls.rows[0].n).toBe(0);
    await c.end();
  }, 900_000);
});
