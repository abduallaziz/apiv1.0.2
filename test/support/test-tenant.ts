import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Dedicated test tenant. Database-backed specs must NEVER pick "the first
 * active tenant/warehouse" — that selects an arbitrary (possibly real) tenant.
 */
export function requireTestTenantId(): string {
  const id = process.env.TEST_TENANT_ID;
  if (!id) {
    throw new Error(
      'TEST_TENANT_ID is not set — DB-backed specs run only through ' +
        '`npm run test:integration` against an isolated test project',
    );
  }
  return id;
}

/** First active warehouse of the dedicated TEST tenant only. */
export async function pickTestWarehouse(
  supabase: SupabaseClient,
): Promise<{ id: string; tenant_id: string }> {
  const tenantId = requireTestTenantId();
  const { data, error } = await supabase
    .from('warehouses')
    .select('id, tenant_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();
  if (error || !data) {
    throw new Error(
      'The test tenant has no active warehouse — seed the test project first',
    );
  }
  return data;
}
