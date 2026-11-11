import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

/**
 * Identity-based safety check for database-backed (integration/regression)
 * tests. Decides, from the *Supabase project identity* (not NODE_ENV), whether
 * writing tests may run. Fails closed: every condition must hold.
 *
 * Secrets are never returned or logged; only the project ref (a public
 * identifier) and human-readable reasons.
 */

export interface SafetyInput {
  testUrl?: string;
  testServiceKey?: string;
  allowFlag?: string; // must equal the project ref
  testTenantId?: string;
  allowedRefs: string[]; // test/support/allowed-test-projects.json
  protectedRefs: string[]; // refs of the app's own (prod/staging) databases
}

export interface SafetyResult {
  ok: boolean;
  ref: string | null;
  reasons: string[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function projectRefFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    // A loopback address can never be the hosted production project: it is the
    // local docker test stack (test/local-db). Identity 'local'.
    if (['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) return 'local';
    const m = host.match(/^([a-z0-9]{10,})\.supabase\.(co|in|net)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Supabase pooler user is `postgres.<ref>`; direct host is `db.<ref>.supabase.co`. */
export function projectRefFromDbUrl(url?: string): string | null {
  if (!url) return null;
  const pooler = url.match(/^postgres(?:ql)?:\/\/postgres\.([a-z0-9]{10,})[:@]/i);
  if (pooler) return pooler[1].toLowerCase();
  const direct = url.match(/@db\.([a-z0-9]{10,})\.supabase\.(co|in|net)/i);
  return direct ? direct[1].toLowerCase() : null;
}

export function evaluateTestDbSafety(input: SafetyInput): SafetyResult {
  const reasons: string[] = [];
  const ref = projectRefFromUrl(input.testUrl);

  if (!input.testUrl) reasons.push('TEST_SUPABASE_URL is not set');
  else if (!ref)
    reasons.push('TEST_SUPABASE_URL is not a recognizable Supabase project URL');

  if (!input.testServiceKey)
    reasons.push('TEST_SUPABASE_SERVICE_ROLE_KEY is not set');

  if (!input.testTenantId || !UUID_RE.test(input.testTenantId))
    reasons.push('TEST_TENANT_ID is missing or not a UUID');

  if (ref) {
    if (
      ref !== 'local' &&
      !input.allowedRefs.map((r) => r.toLowerCase()).includes(ref)
    )
      reasons.push(
        'project is not in test/support/allowed-test-projects.json (allowlist)',
      );
    if (input.protectedRefs.map((r) => r.toLowerCase()).includes(ref))
      reasons.push(
        'project matches this app\'s own configured database (production/staging) — refused',
      );
    if (input.allowFlag !== ref)
      reasons.push(
        'ALLOW_DB_WRITE_TESTS must be set to the exact test project ref',
      );
  }

  return { ok: reasons.length === 0, ref, reasons };
}

/** Refs of every database the application itself is configured to use. */
export function collectProtectedRefs(
  env: NodeJS.ProcessEnv,
  apiRoot: string,
): string[] {
  const refs = new Set<string>();
  const add = (r: string | null) => r && refs.add(r.toLowerCase());

  // In a test worker the setup file has already re-pointed SUPABASE_URL /
  // DATABASE_URL at the TEST_* values; those must not count as "the app's own".
  const remapped = env.SUPABASE_URL !== undefined && env.SUPABASE_URL === env.TEST_SUPABASE_URL;
  const sources: Array<Record<string, string | undefined>> = remapped ? [] : [env];
  for (const f of ['.env', '.env.production', '.env.staging', '.env.local']) {
    const p = path.join(apiRoot, f);
    try {
      if (fs.existsSync(p)) sources.push(dotenv.parse(fs.readFileSync(p)));
    } catch {
      /* unreadable env file: ignore */
    }
  }
  for (const s of sources) {
    add(projectRefFromUrl(s.SUPABASE_URL));
    add(projectRefFromDbUrl(s.DATABASE_URL));
  }
  for (const r of (env.PROTECTED_SUPABASE_REFS ?? '').split(','))
    if (r.trim()) refs.add(r.trim().toLowerCase());
  return [...refs];
}

export function loadAllowedRefs(): string[] {
  const file = path.join(__dirname, 'allowed-test-projects.json');
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    allowedProjectRefs?: string[];
  };
  return json.allowedProjectRefs ?? [];
}

export function evaluateFromEnv(
  env: NodeJS.ProcessEnv,
  apiRoot: string,
): SafetyResult {
  return evaluateTestDbSafety({
    testUrl: env.TEST_SUPABASE_URL,
    testServiceKey: env.TEST_SUPABASE_SERVICE_ROLE_KEY,
    allowFlag: env.ALLOW_DB_WRITE_TESTS,
    testTenantId: env.TEST_TENANT_ID,
    allowedRefs: loadAllowedRefs(),
    protectedRefs: collectProtectedRefs(env, apiRoot),
  });
}

export function assertSafeOrThrow(r: SafetyResult): void {
  if (r.ok) return;
  throw new Error(
    'DB integration tests refused (no connection was made):\n - ' +
      r.reasons.join('\n - '),
  );
}
