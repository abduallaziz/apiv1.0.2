// Regression coverage for the PENDING migrations 258, 259, 260, 264, 265
// (src/database/migrations_pending). DB-backed: runs only through
// `npm run test:integration[:local]` against the disposable local test database.
import 'dotenv/config';
import { randomUUID } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { requireTestTenantId } from '../../../../test/support/test-tenant';

jest.setTimeout(30000);

describe('pending migrations 258-265', () => {
  let db: SupabaseClient;
  let tenantId: string;
  const created: { table: string; id: string }[] = [];
  const track = (table: string, id: string) => created.push({ table, id });

  beforeAll(() => {
    db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    tenantId = requireTestTenantId();
  });

  afterAll(async () => {
    for (const { table, id } of [...created].reverse()) {
      await db.from(table).delete().eq('id', id);
    }
  });

  describe('258 payment idempotency', () => {
    let invoiceId: string;
    beforeAll(async () => {
      const { data: plan } = await db.from('plans').insert({ name: `P-${randomUUID()}` }).select('id').single();
      track('plans', plan.id);
      const { data: sub } = await db.from('subscriptions').insert({ tenant_id: tenantId, plan_id: plan.id, status: 'cancelled' }).select('id').single();
      track('subscriptions', sub.id);
      const { data: inv } = await db.from('invoices').insert({ tenant_id: tenantId, invoice_number: `T-${randomUUID()}`, subscription_id: sub.id }).select('id').single();
      invoiceId = inv.id;
      track('invoices', inv.id);
    });

    const pay = (extra: Record<string, unknown>) =>
      db.from('payments').insert({ tenant_id: tenantId, invoice_id: invoiceId, provider: 'mock', amount: 10, ...extra }).select('id').single();

    it('allows one succeeded payment per invoice and rejects a second', async () => {
      const first = await pay({ status: 'succeeded' });
      expect(first.error).toBeNull();
      track('payments', first.data.id);
      const second = await pay({ status: 'succeeded' });
      expect(second.error?.code).toBe('23505');
    });

    it('still allows failed attempts alongside a succeeded one', async () => {
      const failed = await pay({ status: 'failed' });
      expect(failed.error).toBeNull();
      track('payments', failed.data.id);
    });

    it('rejects a repeated provider payment id', async () => {
      const pid = `pi_${randomUUID()}`;
      const a = await pay({ status: 'pending', provider_payment_id: pid });
      expect(a.error).toBeNull();
      track('payments', a.data.id);
      const b = await pay({ status: 'pending', provider_payment_id: pid });
      expect(b.error?.code).toBe('23505');
    });

    it('rejects a repeated idempotency key per tenant', async () => {
      const key = `k-${randomUUID()}`;
      const a = await pay({ status: 'pending', idempotency_key: key });
      expect(a.error).toBeNull();
      track('payments', a.data.id);
      const b = await pay({ status: 'pending', idempotency_key: key });
      expect(b.error?.code).toBe('23505');
    });

    it('dedupes webhook events by (provider, event_id)', async () => {
      const ev = { provider: 'stripe', event_id: `evt_${randomUUID()}`, event_type: 'payment_intent.succeeded' };
      const a = await db.from('billing_webhook_events').insert(ev).select('id').single();
      expect(a.error).toBeNull();
      track('billing_webhook_events', a.data.id);
      const b = await db.from('billing_webhook_events').insert(ev);
      expect(b.error?.code).toBe('23505');
    });
  });

  describe('259 fn_checkout_dine_in_table_v2', () => {
    let branchId: string;
    const mk = async (status: string) => {
      const { data: table } = await db.from('tables').insert({ tenant_id: tenantId, branch_id: branchId, name: `T-${randomUUID().slice(0, 6)}`, status: 'occupied' }).select('id').single();
      track('tables', table.id);
      const { data: order, error } = await db.from('orders').insert({ tenant_id: tenantId, branch_id: branchId, sale_attempt_id: randomUUID(), status, total: 50, table_id: table.id }).select('id').single();
      expect(error).toBeNull();
      track('orders', order.id);
      return { tableId: table.id as string, orderId: order.id as string };
    };
    const call = (orderId: string, tableId: string, method: string, customer: string | null, cash: number | null, card: number | null) =>
      db.rpc('fn_checkout_dine_in_table_v2', {
        p_tenant_id: tenantId, p_order_id: orderId, p_table_id: tableId, p_payment_method: method,
        p_customer_id: customer, p_shift_id: null, p_cash_amount: cash, p_card_amount: card,
      });

    beforeAll(async () => {
      const { data } = await db.from('branches').select('id').eq('tenant_id', tenantId).limit(1).single();
      branchId = data.id;
    });

    it('completes a pending order and only then frees the table', async () => {
      const { tableId, orderId } = await mk('pending');
      const { data, error } = await call(orderId, tableId, 'cash', null, null, null);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data[0].status).toBe('completed');
      const { data: t } = await db.from('tables').select('status').eq('id', tableId).single();
      expect(t.status).toBe('available');
    });

    it('does NOT free the table when the order is not pending (v1 bug)', async () => {
      const { tableId, orderId } = await mk('completed');
      const { data, error } = await call(orderId, tableId, 'cash', null, null, null);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
      const { data: t } = await db.from('tables').select('status').eq('id', tableId).single();
      expect(t.status).toBe('occupied');
    });

    it('persists the split cash/card breakdown', async () => {
      const { tableId, orderId } = await mk('pending');
      const { data, error } = await call(orderId, tableId, 'split', null, 20, 30);
      expect(error).toBeNull();
      expect(Number(data[0].cash_amount)).toBe(20);
      expect(Number(data[0].card_amount)).toBe(30);
    });

    it('rejects a customer of another tenant', async () => {
      const { data: other } = await db.from('customers').insert({ tenant_id: '9bcd3369-1111-4000-8000-000000000000', full_name: 'Other' }).select('id').single();
      track('customers', other.id);
      const { tableId, orderId } = await mk('pending');
      const { error } = await call(orderId, tableId, 'cash', other.id, null, null);
      expect(error?.message).toMatch(/Customer not found/);
      const { data: o } = await db.from('orders').select('status').eq('id', orderId).single();
      expect(o.status).toBe('pending');
    });
  });

  describe('260 loyalty redeem / refund', () => {
    let customerId: string;
    beforeEach(async () => {
      const { data } = await db.from('customers').insert({ tenant_id: tenantId, full_name: 'Loyal', loyalty_points: 100, lifetime_points_earned: 500 }).select('id').single();
      customerId = data.id;
      track('customers', data.id);
    });
    const redeem = (attempt: string, pts: number) =>
      db.rpc('fn_redeem_loyalty_points', { p_customer_id: customerId, p_points: pts, p_sale_attempt_id: attempt });
    const refund = (attempt: string) =>
      db.rpc('fn_refund_loyalty_points', { p_customer_id: customerId, p_sale_attempt_id: attempt });
    const balance = async () => {
      const { data } = await db.from('customers').select('loyalty_points, lifetime_points_earned').eq('id', customerId).single();
      return { pts: Number(data.loyalty_points), life: Number(data.lifetime_points_earned) };
    };

    it('redeem deducts and is idempotent per attempt (replay changes nothing)', async () => {
      const a = randomUUID();
      const first = await redeem(a, 30);
      expect(first.error).toBeNull();
      expect((await balance()).pts).toBe(70);
      const replay = await redeem(a, 30);
      expect(replay.error?.code).toBe('23505');
      expect((await balance()).pts).toBe(70);
    });

    it('refund restores the points once and never touches lifetime_points_earned', async () => {
      const a = randomUUID();
      await redeem(a, 30);
      const r1 = await refund(a);
      expect(r1.error).toBeNull();
      expect(await balance()).toEqual({ pts: 100, life: 500 });
      const r2 = await refund(a);
      expect(r2.data).toEqual([]);
      expect(await balance()).toEqual({ pts: 100, life: 500 });
    });

    it('refund of an attempt that never redeemed is a no-op', async () => {
      const r = await refund(randomUUID());
      expect(r.error).toBeNull();
      expect(r.data).toEqual([]);
      expect(await balance()).toEqual({ pts: 100, life: 500 });
    });

    it('cannot redeem more than the balance', async () => {
      const r = await redeem(randomUUID(), 1000);
      expect(r.data).toEqual([]);
      expect((await balance()).pts).toBe(100);
    });

    it('records redeem and refund rows in the ledger with the attempt id', async () => {
      const a = randomUUID();
      await redeem(a, 10);
      await refund(a);
      const { data } = await db.from('loyalty_ledger').select('type, delta').eq('sale_attempt_id', a).order('created_at');
      expect(data.map((r) => r.type).sort()).toEqual(['redeem', 'refund']);
    });
  });

  describe('264/265 activities', () => {
    it('seeds the 38 activities including the new tireOil', async () => {
      const { data } = await db.from('activity_definitions').select('code');
      expect(data).toHaveLength(38);
      expect(data.map((r) => r.code)).toContain('tireOil');
    });

    it('enforces one active row per (tenant, activity) and one primary per tenant', async () => {
      const mk = (code: string, primary: boolean) =>
        db.from('tenant_activities').insert({ tenant_id: tenantId, activity_code: code, is_primary: primary }).select('id').single();
      const a = await mk('carWash', true);
      expect(a.error).toBeNull();
      track('tenant_activities', a.data.id);
      expect((await mk('carWash', false)).error?.code).toBe('23505'); // same activity twice
      expect((await mk('cafe', true)).error?.code).toBe('23505'); // second primary
      const b = await mk('cafe', false);
      expect(b.error).toBeNull();
      track('tenant_activities', b.data.id);
      // soft delete frees the slot
      await db.from('tenant_activities').update({ deleted_at: new Date().toISOString() }).eq('id', b.data.id);
      const again = await mk('cafe', false);
      expect(again.error).toBeNull();
      track('tenant_activities', again.data.id);
    });

    it('rejects an unknown activity code and enforces one default per branch', async () => {
      const { data: br } = await db.from('branches').select('id').eq('tenant_id', tenantId).limit(1).single();
      const bad = await db.from('branch_activities').insert({ tenant_id: tenantId, branch_id: br.id, activity_code: 'nope' });
      expect(bad.error).not.toBeNull();
      const mk = (code: string, def: boolean) =>
        db.from('branch_activities').insert({ tenant_id: tenantId, branch_id: br.id, activity_code: code, is_default: def }).select('id').single();
      const a = await mk('carWash', true);
      expect(a.error).toBeNull();
      track('branch_activities', a.data.id);
      expect((await mk('tireOil', true)).error?.code).toBe('23505');
      const b = await mk('tireOil', false);
      expect(b.error).toBeNull();
      track('branch_activities', b.data.id);
    });
  });
});
