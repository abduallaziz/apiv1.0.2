// Phase 3 Accounting Bootstrap backfill — Option B scope, approved 2026-08-11.
// Explicit tenant allowlist ONLY — never queries "all tenants". Each tenant
// is one RPC call to fn_backfill_accounting_bootstrap (migration 186),
// which is itself one Postgres transaction with its own idempotency gate.
// This script adds no transaction logic of its own; it is a thin,
// auditable driver over that function, one call per tenant, sequential
// (not parallel) so a failure on tenant N never touches tenant N+1 while
// still being visible in order in the output.
//
// NOT executed as part of this review — run manually only after sign-off:
//   node scripts/backfill-accounting-bootstrap.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Exact 13 tenants from the Phase 3 audit (16 total minus the 3 explicitly
// excluded test fixtures: 494bc1da Test Delete Tenant, 6a6f7f6f FK Test
// Tenant, b917d629 SKU Test Tenant). Order = tenants.created_at ascending.
const TENANT_ALLOWLIST = [
  { id: '9bcd3369-d664-47c8-b297-3bc9b429aacf', name: 'Sefay Demo Updated' },
  { id: 'd4d2a8d3-eab7-42fe-a871-331ba2c2772c', name: 'Sefay Platform' },
  { id: 'd450488b-63b9-4cc1-a31d-5b2284a9dcf9', name: 'يوتيوب' },
  { id: '621544e0-1ccd-47d8-8dcc-e48134f83e39', name: 'ورشة العميد' },
  { id: 'b1f12952-57f2-440b-a607-6e5eac5bbee1', name: 'اي شي' },
  { id: 'e8583493-8855-4d8a-8080-bc6c16c01c4f', name: 'تجربه' },
  { id: '68b7a54d-7a9c-4c86-ba2b-46a45b7eec5e', name: 'Rest' },
  { id: 'a65054c5-c297-4060-bb22-612568365bff', name: 'Claude Test Business' },
  { id: 'c5434a6c-e5b9-4b3b-a288-48965d00c0dc', name: 'مطعم البيك' },
  { id: '2b74943b-4c8b-407e-9dd9-6af5a31280a2', name: 'اختبار' },
  { id: 'ad4c81d7-c16b-4f67-a210-5e307f3bc259', name: 'Tenant B Business' },
  { id: '24e57125-78d4-48bf-872d-c3f47f3b2b0a', name: 'To100' },
  { id: '48ed9760-06bb-4918-a987-f3e3d3905a80', name: 'sss' },
];

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const results = [];

  for (const tenant of TENANT_ALLOWLIST) {
    const { data, error } = await sb.rpc('fn_backfill_accounting_bootstrap', {
      p_tenant_id: tenant.id,
    });

    if (error) {
      results.push({ tenant: tenant.id, name: tenant.name, status: 'FAILED', detail: error.message });
      console.error(`[FAILED] ${tenant.name} (${tenant.id}): ${error.message}`);
      continue;
    }

    results.push({ tenant: tenant.id, name: tenant.name, status: data });
    console.log(`[${data}] ${tenant.name} (${tenant.id})`);
  }

  console.log('\n--- Summary ---');
  const ok = results.filter((r) => r.status === 'OK').length;
  const skipped = results.filter((r) => r.status === 'SKIPPED_ALREADY_CONFIGURED').length;
  const failed = results.filter((r) => r.status === 'FAILED').length;
  console.log(`Bootstrapped: ${ok} | Skipped (already configured): ${skipped} | Failed: ${failed} | Total: ${results.length}`);

  if (failed > 0) process.exitCode = 1;
})();
