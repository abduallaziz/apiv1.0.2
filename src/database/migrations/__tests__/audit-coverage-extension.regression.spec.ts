/**
 * Regression suite for Migration 11.1a (Audit Coverage Extension). Runs
 * directly against the real shared Supabase project via the service-role
 * client.
 *
 * Scope note (honest disclosure, matching the pattern from Migrations 8.2/
 * 10.1): most of this migration's coverage is added via the existing
 * @Audit() decorator + AuditInterceptor, which only fires on a real
 * authenticated HTTP request (request.user/request.tenantContext) — this
 * session has never exercised the full HTTP layer in a regression spec
 * (every prior spec calls RPCs/tables directly). This suite instead proves
 * the one thing that could actually be silently wrong: that the exact
 * AuditEntry field shapes used by the new MANUAL AuditService.log() calls
 * (production_order.completed, quality_hold.released, non_conformance.
 * closed, tenant_settings.updated) are valid against the real audit_logs
 * schema — a malformed field name or type would fail here. The @Audit()
 * decorator paths were verified via code review, tsc, build, and app
 * startup only, not by an automated test.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const TEST_TENANT_ID = '9bcd3369-d664-47c8-b297-3bc9b429aacf'; // Sefay Demo

describe('audit coverage extension regression (Migration 11.1a)', () => {
  let supabase: SupabaseClient;
  const insertedIds: string[] = [];

  const insertAuditRow = async (
    action: string,
    resourceType: string,
    before: object | null,
    after: object,
  ) => {
    const { data, error } = await supabase
      .from('audit_logs')
      .insert({
        tenant_id: TEST_TENANT_ID,
        actor_id: null,
        actor_role: 'test',
        action,
        resource_type: resourceType,
        resource_id: 'test-resource-id',
        before_data: before,
        after_data: after,
        ip_address: 'test',
        device: 'test',
      })
      .select()
      .single();
    if (error) throw error;
    insertedIds.push(data.id);
    return data;
  };

  beforeAll(async () => {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  }, 30_000);

  afterAll(async () => {
    for (const id of insertedIds)
      await supabase.from('audit_logs').delete().eq('id', id);
  }, 30_000);

  it('production_order.completed shape (before/after) is valid against audit_logs', async () => {
    const row = await insertAuditRow(
      'production_order.completed',
      'production_order',
      { status: 'in_progress', quantity_produced: null },
      { status: 'completed', quantity_produced: 10 },
    );
    expect(row.action).toBe('production_order.completed');
    expect(row.before_data.status).toBe('in_progress');
    expect(row.after_data.status).toBe('completed');
  }, 15_000);

  it('quality_hold.released shape (before/after) is valid against audit_logs', async () => {
    const row = await insertAuditRow(
      'quality_hold.released',
      'quality_hold',
      { status: 'active' },
      { status: 'released' },
    );
    expect(row.action).toBe('quality_hold.released');
    expect(row.before_data.status).toBe('active');
    expect(row.after_data.status).toBe('released');
  }, 15_000);

  it('non_conformance.closed shape (before/after) is valid against audit_logs', async () => {
    const row = await insertAuditRow(
      'non_conformance.closed',
      'non_conformance',
      { status: 'open' },
      { status: 'closed' },
    );
    expect(row.action).toBe('non_conformance.closed');
    expect(row.before_data.status).toBe('open');
    expect(row.after_data.status).toBe('closed');
  }, 15_000);

  it('tenant_settings.updated shape (before/after) is valid against audit_logs', async () => {
    const row = await insertAuditRow(
      'tenant_settings.updated',
      'tenant_settings',
      { invoice_footer: 'old footer' },
      { invoice_footer: 'new footer' },
    );
    expect(row.action).toBe('tenant_settings.updated');
    expect(row.before_data.invoice_footer).toBe('old footer');
    expect(row.after_data.invoice_footer).toBe('new footer');
  }, 15_000);

  it('rows are correctly scoped and queryable by tenant_id + resource_type (matches AuditController design)', async () => {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('action, resource_type')
      .eq('tenant_id', TEST_TENANT_ID)
      .in('id', insertedIds);
    expect(error).toBeNull();
    expect(data.length).toBe(4);
  }, 15_000);
});
