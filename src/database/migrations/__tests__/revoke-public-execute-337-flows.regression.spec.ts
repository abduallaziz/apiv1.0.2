/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * R-FN flows: after migration 337 the LEGITIMATE server path (service_role) must still work for sales returns and shift
 * closing, the public roles (anon, authenticated) must be refused, and the tenant argument must still isolate tenants.
 *
 * LOCAL DISPOSABLE DATABASE ONLY. Each call runs in its own transaction under `SET LOCAL ROLE <role>` so the real
 * function privileges are exercised (the backend reaches these functions as service_role through PostgREST).
 */
import * as fs from 'fs';
import * as path from 'path';
import { Harness } from './support/sale-path-fixtures';

jest.setTimeout(180000);

describe('337 flows: returns and shift close keep working for service_role, refused for public roles', () => {
  const h = new Harness();
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (local) required');
    await h.open();
    await h.ensurePending(
      '332_sales_return_tax_inclusive_share.sql',
      '337_revoke_public_execute_security_definer.sql',
    );
  }, 120000);
  afterAll(async () => h.close());

  /** runs `sql` in a transaction as `role`; resolves {ok,row} or {ok:false,code,message}; always rolls back when `rollback` */
  async function as(role: string, sql: string, params: unknown[], rollback = false) {
    return h.withClient(async (c) => {
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL ROLE ${role}`);
        const r = await c.query(sql, params);
        await c.query(rollback ? 'ROLLBACK' : 'COMMIT');
        return { ok: true as const, row: r.rows[0] };
      } catch (e: any) {
        await c.query('ROLLBACK').catch(() => undefined);
        return { ok: false as const, code: e.code as string, message: e.message as string };
      }
    });
  }

  // a cash refund is paid from an OPEN register, so every return needs an open shift (as in the real flow)
  const RETURN_SQL =
    "SELECT fn_create_sales_return($1,$2,NULL,$4,'customer return',$3::jsonb) AS r";
  const returnArgs = (
    tenantId: string,
    orderId: string,
    items: { order_item_id: string; quantity: number }[],
    shiftId: string | null = null,
  ) => [tenantId, orderId, JSON.stringify(items), shiftId];

  async function sold(label: string) {
    const f = await h.tenant(label);
    const a = await h.item(f, 'A');
    await h.receive(f, a, 10, 7);
    const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], {
      mode: 'pooled_stock_on',
      taxRate: 0.15,
      payment: 'cash',
    });
    if (!s.ok) throw new Error('fixture sale failed');
    const [oi] = await h.orderItemIds(s.id);
    const shiftId = await h.openShift(f);
    return { f, itemId: a, orderId: s.id, shiftId, items: [{ order_item_id: oi, quantity: 1 }] };
  }

  const CLOSE_SQL =
    "SELECT fn_close_shift($1,$2,$3,0,0,0,NULL,now(),'{}'::jsonb,'[]'::jsonb,0,0,0,0) AS r";
  async function openShiftFor(f: any) {
    const shiftId = await h.openShift(f);
    const [{ cashier_id }] = await h.q('SELECT cashier_id FROM shifts WHERE id = $1', [shiftId]);
    return { shiftId, cashierId: cashier_id as string };
  }

  it('privileges: only service_role may EXECUTE both functions (every overload)', async () => {
    const rows = await h.q(
      `SELECT p.oid::regprocedure::text AS sig,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x,
              has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x
         FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('fn_create_sales_return','fn_close_shift')`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect([r.sig, r.anon_x, r.auth_x, r.svc_x]).toEqual([r.sig, false, false, true]);
    }
  });

  it('sales return: service_role succeeds end to end (stock restocked, return recorded)', async () => {
    const { f, itemId, orderId, items, shiftId } = await sold('r337a');
    const before = await h.onHand(f, itemId);
    const r = await as('service_role', RETURN_SQL, returnArgs(f.tenantId, orderId, items, shiftId));
    expect(r.ok).toBe(true);
    expect((await h.onHand(f, itemId)) - before).toBe(1);
    expect(
      (
        await h.q(
          'SELECT count(*)::int n FROM sales_returns WHERE tenant_id=$1 AND order_id=$2',
          [f.tenantId, orderId],
        )
      )[0].n,
    ).toBe(1);
  });

  it('sales return: anon and authenticated are refused (permission denied) and nothing is written', async () => {
    const { f, orderId, items, shiftId } = await sold('r337b');
    for (const role of ['anon', 'authenticated']) {
      const r = await as(role, RETURN_SQL, returnArgs(f.tenantId, orderId, items, shiftId));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe('42501');
        expect(r.message).toMatch(/permission denied/i);
      }
    }
    expect(
      (await h.q('SELECT count(*)::int n FROM sales_returns WHERE tenant_id=$1', [f.tenantId]))[0].n,
    ).toBe(0);
  });

  it('tenant isolation still holds on the trusted path: tenant B cannot return tenant A order', async () => {
    const a = await sold('r337c1');
    const b = await h.tenant('r337c2');
    const r = await as('service_role', RETURN_SQL, returnArgs(b.tenantId, a.orderId, a.items, a.shiftId));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/not found/i);
    expect(
      (await h.q('SELECT count(*)::int n FROM sales_returns WHERE order_id=$1', [a.orderId]))[0].n,
    ).toBe(0);
  });

  it('shift close: service_role closes an open shift (status closed, closed_at recorded)', async () => {
    const f = await h.tenant('r337d');
    const { shiftId, cashierId } = await openShiftFor(f);
    const r = await as('service_role', CLOSE_SQL, [f.tenantId, shiftId, cashierId]);
    expect(r.ok).toBe(true);
    const [s] = await h.q('SELECT status, closed_at FROM shifts WHERE id=$1', [shiftId]);
    expect(s.status).toBe('closed');
    expect(s.closed_at).not.toBeNull();
  });

  it('shift close: anon and authenticated are refused and the shift stays open', async () => {
    const f = await h.tenant('r337e');
    const { shiftId, cashierId } = await openShiftFor(f);
    for (const role of ['anon', 'authenticated']) {
      const r = await as(role, CLOSE_SQL, [f.tenantId, shiftId, cashierId]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('42501');
    }
    expect((await h.q('SELECT status FROM shifts WHERE id=$1', [shiftId]))[0].status).toBe('open');
  });

  it('shift close: tenant B cannot close tenant A shift', async () => {
    const a = await h.tenant('r337f1');
    const b = await h.tenant('r337f2');
    const { shiftId, cashierId } = await openShiftFor(a);
    const r = await as('service_role', CLOSE_SQL, [b.tenantId, shiftId, cashierId]);
    expect(r.ok).toBe(false);
    expect((await h.q('SELECT status FROM shifts WHERE id=$1', [shiftId]))[0].status).toBe('open');
  });

  it('rollback restores the previous exposure (flows still work); re-applying 337 closes it again', async () => {
    const { f, orderId, items, shiftId } = await sold('r337g');
    await h.pg.query(
      fs.readFileSync(
        path.resolve(
          __dirname,
          '..',
          '..',
          'migrations_pending',
          'rollback',
          '337_revoke_public_execute_security_definer_ROLLBACK.sql',
        ),
        'utf8',
      ),
    );
    const exposed = await as('anon', RETURN_SQL, returnArgs(f.tenantId, orderId, items, shiftId), true); // the hole
    expect(exposed.ok).toBe(true);
    const trusted = await as('service_role', RETURN_SQL, returnArgs(f.tenantId, orderId, items, shiftId), true);
    expect(trusted.ok).toBe(true);
    await h.ensurePending('337_revoke_public_execute_security_definer.sql');
    const closed = await as('anon', RETURN_SQL, returnArgs(f.tenantId, orderId, items, shiftId), true);
    expect(closed.ok).toBe(false);
  });
});
