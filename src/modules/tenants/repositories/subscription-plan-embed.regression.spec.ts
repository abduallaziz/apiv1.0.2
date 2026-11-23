/**
 * Regression: GET /tenant/subscription returned 500 in production.
 * Cause (VERIFIED): `subscriptions` has TWO foreign keys to `plans` (plan_id and pending_plan_id, migration 316), so
 * the PostgREST embed `plans(...)` is ambiguous (PGRST201). The embeds must name the relationship:
 * `plans!subscriptions_plan_id_fkey(...)`.
 * Runs against the LOCAL disposable database through the integration setup (read-only queries).
 */
import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { TenantsRepository } from './tenants.repository';
import { TenantManagementRepository } from '../../shared/tenant-management/tenant-management.repository';

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf';

describe('subscriptions -> plans embed is unambiguous', () => {
  let supabase: SupabaseClient;

  beforeAll(() => {
    supabase = createClient(
      process.env.SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    );
  });

  it('documents the cause: the unqualified embed is rejected as ambiguous', async () => {
    const { error } = await supabase
      .from('subscriptions')
      .select('id, plans(name)')
      .limit(1);
    expect(error?.code).toBe('PGRST201');
  });

  it('the qualified embed works', async () => {
    const { error } = await supabase
      .from('subscriptions')
      .select('id, plans!subscriptions_plan_id_fkey(name)')
      .limit(1);
    expect(error).toBeNull();
    const inner = await supabase
      .from('subscriptions')
      .select('id, plans!subscriptions_plan_id_fkey!inner(price_monthly)')
      .limit(1);
    expect(inner.error).toBeNull();
  });

  it('TenantsRepository.getSubscription (the /tenant/subscription endpoint) no longer throws', async () => {
    const repo = new TenantsRepository(supabase);
    await expect(repo.getSubscription(TEST_TENANT_ID)).resolves.not.toThrow();
  });

  it('TenantManagementRepository.getSubscription no longer throws', async () => {
    const repo = new TenantManagementRepository(supabase);
    await expect(repo.getSubscription(TEST_TENANT_ID)).resolves.not.toThrow();
  });

  it('no source file embeds plans from subscriptions without naming the relationship', () => {
    const root = path.resolve(__dirname, '..', '..', '..'); // src
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'database') continue;
          walk(p);
        } else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
          const src = fs.readFileSync(p, 'utf8');
          if (/\bplans(!inner)?\(/.test(src)) offenders.push(path.relative(root, p));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
