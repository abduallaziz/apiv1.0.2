import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Migration runner core (WP-C). Pure/injectable so it can be unit tested with a fake HTTP layer.
 *
 * Backward compatibility: with NO new environment variable set, behaviour is the same as the
 * original runner (hard-coded target, apply every un-recorded file in `migrations/`, one request
 * per file plus one for the record, never fail because of checksums). Stricter behaviour is opt-in:
 *   MIGRATION_TARGET_REF / MIGRATION_ALLOWED_REFS   target allow-list
 *   MIGRATION_CHECKSUM_MODE = off (default: no checksum columns/bookkeeping) | record (add columns, record, warn) | enforce (also refuse on change)
 *   MIGRATION_TRANSACTION_MODE = off (default) | auto
 *   MIGRATIONS_ON_BOOT = true (default) | false
 */

export const DEFAULT_PROJECT_REF = 'uugxagglmkxcjmncxgja';

export const EXIT = {
  OK: 0,
  FAILURE: 1,
  /** Refusal caused by configuration: target not allowed, missing token, wrong directory. */
  CONFIG: 2,
  /** An already-applied migration file differs from what was applied (enforce mode). */
  CHECKSUM: 3,
  /** A migration's SQL failed. */
  SQL: 4,
} as const;

export class RunnerError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = EXIT.FAILURE,
  ) {
    super(message);
    this.name = 'RunnerError';
  }
}

export type ChecksumMode = 'off' | 'record' | 'enforce';
export type TransactionMode = 'off' | 'auto';

export interface RunnerConfig {
  targetRef: string;
  allowedRefs: string[];
  dryRun: boolean;
  /** Explicit release-job invocation (`--release` or MIGRATION_RELEASE_JOB=true). */
  release: boolean;
  migrationsOnBoot: boolean;
  checksumMode: ChecksumMode;
  transactionMode: TransactionMode;
  appliedBy: string;
  appliedFrom: string;
}

const REF_RE = /^[a-z0-9]{20}$/;

function truthy(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v.trim() === '') return dflt;
  return !['false', '0', 'no', 'off'].includes(v.trim().toLowerCase());
}

export function loadConfig(
  env: Record<string, string | undefined>,
  argv: string[],
): RunnerConfig {
  const targetRef = (env.MIGRATION_TARGET_REF || '').trim() || DEFAULT_PROJECT_REF;
  const allowedRaw = (env.MIGRATION_ALLOWED_REFS || '').trim();
  const allowedRefs = allowedRaw
    ? allowedRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [DEFAULT_PROJECT_REF];

  if (!REF_RE.test(targetRef)) {
    throw new RunnerError(
      'Invalid MIGRATION_TARGET_REF (expected a 20-character project reference).',
      EXIT.CONFIG,
    );
  }
  if (!allowedRefs.includes(targetRef)) {
    throw new RunnerError(
      `Refusing: target project "${targetRef}" is not in MIGRATION_ALLOWED_REFS.`,
      EXIT.CONFIG,
    );
  }

  const checksumRaw = (env.MIGRATION_CHECKSUM_MODE || 'off').trim().toLowerCase();
  if (checksumRaw !== 'off' && checksumRaw !== 'record' && checksumRaw !== 'enforce') {
    throw new RunnerError(
      'MIGRATION_CHECKSUM_MODE must be "off", "record" or "enforce".',
      EXIT.CONFIG,
    );
  }
  const txRaw = (env.MIGRATION_TRANSACTION_MODE || 'off').trim().toLowerCase();
  if (txRaw !== 'off' && txRaw !== 'auto') {
    throw new RunnerError(
      'MIGRATION_TRANSACTION_MODE must be "off" or "auto".',
      EXIT.CONFIG,
    );
  }

  const appliedFrom =
    env.MIGRATION_APPLIED_FROM ||
    (env.GITHUB_RUN_ID
      ? `github-actions:${env.GITHUB_RUN_ID}`
      : env.RAILWAY_DEPLOYMENT_ID
        ? `railway:${env.RAILWAY_DEPLOYMENT_ID}`
        : 'local');

  return {
    targetRef,
    allowedRefs,
    dryRun: argv.includes('--dry-run'),
    release: argv.includes('--release') || truthy(env.MIGRATION_RELEASE_JOB, false),
    migrationsOnBoot: truthy(env.MIGRATIONS_ON_BOOT, true),
    checksumMode: checksumRaw,
    transactionMode: txRaw,
    appliedBy: env.MIGRATION_APPLIED_BY || env.GITHUB_ACTOR || 'runner',
    appliedFrom,
  };
}

/** True when this invocation must do nothing (boot-time run while the owner turned boot migrations off). */
export function shouldSkipOnBoot(cfg: RunnerConfig): boolean {
  return !cfg.migrationsOnBoot && !cfg.release && !cfg.dryRun;
}

/** SHA-256 of the file content with line endings normalised (CRLF checkouts must hash like LF ones). */
export function checksumOf(sql: string): string {
  return crypto
    .createHash('sha256')
    .update(sql.replace(/^﻿/, '').replace(/\r\n/g, '\n'), 'utf8')
    .digest('hex');
}

/** Defence in depth: only ever scan a directory literally named `migrations`. */
export function assertMigrationsDir(dir: string): void {
  const resolved = path.resolve(dir);
  const base = path.basename(resolved).toLowerCase();
  if (base !== 'migrations' || /pending/i.test(resolved.split(path.sep).slice(-2).join('/'))) {
    throw new RunnerError(
      `Refusing to scan "${base}": the runner only reads a directory named "migrations" (never migrations_pending).`,
      EXIT.CONFIG,
    );
  }
}

export function listMigrationFiles(dir: string): string[] {
  assertMigrationsDir(dir);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

/**
 * Decide whether a file may be wrapped in BEGIN/COMMIT. Not safe when the file controls its own
 * transaction, or uses statements Postgres refuses inside a transaction block.
 */
export function planTransaction(sql: string): { wrap: boolean; reason?: string } {
  const s = stripSqlComments(sql);
  if (/\bconcurrently\b/i.test(s)) return { wrap: false, reason: 'CONCURRENTLY' };
  if (/(^|;)\s*(begin|commit|end|rollback|start\s+transaction|savepoint|release\s+savepoint)\b\s*(;|transaction\b|work\b|$)/im.test(s))
    return { wrap: false, reason: 'own transaction control' };
  if (/(^|;)\s*(vacuum|create\s+database|drop\s+database|alter\s+system|reindex\s+(database|system))\b/im.test(s))
    return { wrap: false, reason: 'statement not allowed in a transaction block' };
  if (/\balter\s+type\b[^;]*\badd\s+value\b/i.test(s))
    return { wrap: false, reason: 'ALTER TYPE ... ADD VALUE' };
  return { wrap: true };
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface Api {
  run(sql: string): Promise<void>;
  query<T>(sql: string): Promise<T[]>;
}

export function createApi(
  cfg: Pick<RunnerConfig, 'targetRef'>,
  token: string | undefined,
  fetchImpl: FetchLike,
): Api {
  async function post(sql: string): Promise<unknown> {
    if (!token) throw new RunnerError('Missing SUPABASE_ACCESS_TOKEN in .env', EXIT.CONFIG);
    const response = await fetchImpl(
      `https://api.supabase.com/v1/projects/${cfg.targetRef}/database/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: sql }),
      },
    );
    const data = (await response.json()) as { error?: string; message?: string };
    if (!response.ok) {
      throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
    }
    return data;
  }
  return {
    async run(sql) {
      await post(sql);
    },
    async query<T>(sql: string) {
      return (await post(sql)) as T[];
    },
  };
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export interface RunResult {
  applied: string[];
  wouldApply: string[];
  checksumRecorded: string[];
  checksumMismatches: string[];
  dryRun: boolean;
}

export interface RunDeps {
  api: Api;
  dir: string;
  log?: (msg: string) => void;
}

interface AppliedRow {
  filename: string;
  checksum?: string | null;
}

export async function runMigrations(cfg: RunnerConfig, deps: RunDeps): Promise<RunResult> {
  const { api, dir } = deps;
  const log = deps.log ?? ((m: string) => console.log(m));
  const result: RunResult = {
    applied: [],
    wouldApply: [],
    checksumRecorded: [],
    checksumMismatches: [],
    dryRun: cfg.dryRun,
  };

  const files = listMigrationFiles(dir); // also asserts the directory name
  log(`\nSefay Migration Runner - target ${cfg.targetRef}${cfg.dryRun ? ' (DRY RUN: nothing will be applied)' : ''}\n`);

  let checksumReady = false;
  let appliedRows: AppliedRow[] = [];

  if (cfg.dryRun) {
    // Read-only: no CREATE/ALTER. A missing table simply means everything is pending.
    try {
      appliedRows = await api.query<AppliedRow>('SELECT * FROM schema_migrations ORDER BY id ASC');
    } catch (e) {
      if (!/does not exist/i.test((e as Error).message)) throw e;
    }
  } else {
    await api.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
    try {
      if (cfg.checksumMode !== 'off') {
        await api.run(
          'ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT, ' +
            'ADD COLUMN IF NOT EXISTS applied_by TEXT, ADD COLUMN IF NOT EXISTS applied_from TEXT',
        );
        checksumReady = true;
      }
    } catch (e) {
      if (cfg.checksumMode === 'enforce') {
        throw new RunnerError(
          `Cannot add checksum columns to schema_migrations (checksum mode is enforce): ${(e as Error).message}`,
          EXIT.CONFIG,
        );
      }
      log(`  ! checksum columns unavailable, continuing without checksums: ${(e as Error).message}`);
    }
    appliedRows = await api.query<AppliedRow>(
      checksumReady
        ? 'SELECT filename, checksum FROM schema_migrations ORDER BY id ASC'
        : 'SELECT filename FROM schema_migrations ORDER BY id ASC',
    );
  }

  const appliedMap = new Map(appliedRows.map((r) => [r.filename, r.checksum ?? null]));
  const contents = new Map<string, { sql: string; sum: string }>();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf-8');
    contents.set(f, { sql, sum: checksumOf(sql) });
  }

  // Verify / record checksums of files that are already applied.
  const toRecord: string[] = [];
  const verify = cfg.checksumMode !== 'off' || cfg.dryRun; // 'off' + real run = today's behaviour, no bookkeeping
  for (const [f, { sum }] of contents) {
    if (!verify || !appliedMap.has(f)) continue;
    const stored = appliedMap.get(f);
    if (!stored) toRecord.push(f);
    else if (stored !== sum) result.checksumMismatches.push(f);
  }

  if (result.checksumMismatches.length > 0) {
    const list = result.checksumMismatches.map((f) => `    - ${f}`).join('\n');
    if (cfg.checksumMode === 'enforce') {
      throw new RunnerError(
        `Checksum mismatch: already-applied migration file(s) changed after being applied:\n${list}\n` +
          'Applied migrations are immutable. Add a new migration instead, or have the owner review the change.',
        EXIT.CHECKSUM,
      );
    }
    log(`  ! WARNING: already-applied file(s) differ from what was recorded (mode=${cfg.checksumMode}, not blocking):\n${list}`);
  }

  if (!cfg.dryRun && checksumReady && toRecord.length > 0) {
    try {
      for (const f of toRecord) {
        await api.run(
          `UPDATE schema_migrations SET checksum = ${q(contents.get(f)!.sum)} WHERE filename = ${q(f)} AND checksum IS NULL`,
        );
        result.checksumRecorded.push(f);
      }
    } catch (e) {
      if (cfg.checksumMode === 'enforce') throw e;
      log(`  ! could not record checksums for existing rows (non-fatal): ${(e as Error).message}`);
    }
  }

  const pending = files.filter((f) => !appliedMap.has(f));

  if (cfg.dryRun) {
    result.wouldApply = pending;
    log(
      pending.length === 0
        ? 'Dry run: database is up to date, nothing to apply.\n'
        : `Dry run: ${pending.length} migration(s) WOULD be applied, in this order:\n${pending
            .map((f) => {
              const t = planTransaction(contents.get(f)!.sql);
              return `    ${f}  [sha256 ${contents.get(f)!.sum.slice(0, 12)}] ${t.wrap ? 'transactional-capable' : `no wrap (${t.reason})`}`;
            })
            .join('\n')}\n`,
    );
    if (result.checksumMismatches.length === 0) log('Dry run: no checksum mismatches on applied files.');
    return result;
  }

  if (pending.length === 0) {
    log('Database is up to date. No migrations to apply.\n');
    return result;
  }

  log(`${pending.length} migration(s) to apply:\n`);
  for (const filename of pending) {
    const { sql, sum } = contents.get(filename)!;
    log(`  -> Applying: ${filename}`);
    const record =
      `INSERT INTO schema_migrations (filename${checksumReady ? ', checksum, applied_by, applied_from' : ''}) ` +
      `VALUES (${q(filename)}${checksumReady ? `, ${q(sum)}, ${q(cfg.appliedBy)}, ${q(cfg.appliedFrom)}` : ''}) ` +
      // ON CONFLICT: two deployments can run this runner at the same time; the loser must not fail
      // the deploy because the winner already recorded the same (idempotent) file.
      'ON CONFLICT (filename) DO NOTHING';
    const plan = cfg.transactionMode === 'auto' ? planTransaction(sql) : { wrap: false };
    try {
      if (plan.wrap) {
        // One request = one implicit session: file + record commit or roll back together.
        await api.run(`BEGIN;\n${sql}\n;\n${record};\nCOMMIT;`);
      } else {
        await api.run(sql);
        await api.run(record);
      }
    } catch (e) {
      if (plan.wrap) {
        // Never leave an aborted transaction open on a pooled session (best effort).
        await api.run('ROLLBACK').catch(() => undefined);
      }
      throw new RunnerError(`Migration ${filename} failed: ${(e as Error).message}`, EXIT.SQL);
    }
    result.applied.push(filename);
    log(`  ✅ Applied: ${filename}${plan.wrap ? ' (transactional)' : ''}`);
  }
  log(`\nDone. ${pending.length} migration(s) applied successfully.\n`);
  return result;
}
