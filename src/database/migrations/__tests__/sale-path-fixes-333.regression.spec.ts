/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any */
/**
 * FIX 333 (WP-D D-4) — stock deduction / restock idempotent per order.
 * BEFORE (rollback applied): replay duplicates stock movements, layer consumption and restock.
 * AFTER (333 applied): replay and concurrent replay are no-ops. Leaves 333 applied. LOCAL DISPOSABLE DATABASE ONLY.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Harness } from './support/sale-path-fixtures';

jest.setTimeout(180000);
const PENDING = path.resolve(__dirname, '..', '..', 'migrations_pending');
const read = (...p: string[]) => fs.readFileSync(path.join(PENDING, ...p), 'utf8').replace(/\r/g, '');

describe('FIX 333: idempotent stock deduction and restock (before / after / rollback)', () => {
  const h = new Harness();
  const hashes = async () =>
    (
      await h.q(
        "SELECT proname, md5(replace(prosrc, chr(13), '')) h FROM pg_proc WHERE proname IN ('fn_process_sale_stock_deduction','fn_reverse_sale_stock_deduction') AND pronamespace='public'::regnamespace ORDER BY 1",
      )
    ).map((r) => r.h as string);

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (local) required');
    await h.open();
  });
  afterAll(async () => {
    await h.pg.query(read('333_sale_stock_idempotency.sql'));
    await h.close();
  });

  const deduct = (f: any, orderId: string, a: string, qty: number) =>
    h.repo.deductStockForSale(f.tenantId, f.warehouseId, orderId, null as never, [{ item_id: a, variant_id: null, quantity: qty }]);

  async function committedSale(label: string, qty = 2, stock = 10) {
    const f = await h.tenant(label);
    const a = await h.item(f, 'A');
    await h.receive(f, a, stock, 7);
    const s = await h.runSale(f, [{ itemId: a, qty, price: 20 }], { mode: 'pooled_stock_on' });
    if (!s.ok) throw new Error('setup');
    return { f, a, orderId: s.id };
  }

  it('rollback restores the previous bodies; re-apply is idempotent', async () => {
    const fixed = await hashes();
    await h.pg.query(read('rollback', '333_sale_stock_idempotency_ROLLBACK.sql'));
    const rolled = await hashes();
    expect(rolled).not.toEqual(fixed);
    await h.pg.query(read('333_sale_stock_idempotency.sql'));
    expect(await hashes()).toEqual(fixed);
    await h.pg.query(read('333_sale_stock_idempotency.sql'));
    expect(await hashes()).toEqual(fixed);
  });

  it('BEFORE (rollback applied): a second deduction for the same order doubles movements, layer consumption and stock; a second restock doubles the return', async () => {
    await h.pg.query(read('rollback', '333_sale_stock_idempotency_ROLLBACK.sql'));
    const { f, a, orderId } = await committedSale('f333before');
    await deduct(f, orderId, a, 2);
    expect(await h.movements(f, orderId)).toHaveLength(2); // KNOWN-DEFECT characterised
    expect(await h.onHand(f, a)).toBe(6); // 10 - 2 - 2
    expect((await h.layers(f, a))[0].rem).toBe(6);
    await h.repo.reverseSaleStockDeduction(f.tenantId, orderId, null as never);
    await h.repo.reverseSaleStockDeduction(f.tenantId, orderId, null as never);
    expect(await h.movements(f, orderId, 'sale_return')).toHaveLength(4); // 2 sale rows restocked twice
    expect(await h.onHand(f, a)).toBe(14); // 6 + 4 + 4: 4 phantom units
  });

  it('AFTER (333 applied): replayed deduction is a no-op (sequential)', async () => {
    await h.pg.query(read('333_sale_stock_idempotency.sql'));
    const { f, a, orderId } = await committedSale('f333seq');
    await deduct(f, orderId, a, 2);
    await deduct(f, orderId, a, 2);
    expect(await h.movements(f, orderId)).toHaveLength(1);
    expect(await h.onHand(f, a)).toBe(8);
    expect((await h.layers(f, a))[0].rem).toBe(8);
  });

  it('AFTER: concurrent replay from 4 connections is a no-op (advisory lock serialises)', async () => {
    const f = await h.tenant('f333con');
    const a = await h.item(f, 'A');
    await h.receive(f, a, 10, 7);
    // order WITHOUT in-tx deduction so the 4 callers race on the first deduction
    const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_off', skipPostCommitDeduction: true });
    if (!s.ok) throw new Error('setup');
    await Promise.all([0, 1, 2, 3].map(() => deduct(f, s.id, a, 2)));
    expect(await h.movements(f, s.id)).toHaveLength(1);
    expect(await h.onHand(f, a)).toBe(8);
    expect((await h.layers(f, a))[0].rem).toBe(8);
  });

  it('AFTER: replay of a fully BACKORDERED order does not add a second backorder row', async () => {
    const f = await h.tenant('f333bo');
    const a = await h.item(f, 'A');
    const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on' });
    if (!s.ok) throw new Error('setup');
    await deduct(f, s.id, a, 2);
    expect((await h.q('SELECT count(*)::int n FROM backorders WHERE order_id=$1', [s.id]))[0].n).toBe(1);
    expect(await h.backorder(f, a)).toBe(2);
  });

  it('AFTER: replayed / concurrent restock restores exactly once; cancel -> second cancel attempt cannot restock again', async () => {
    const { f, a, orderId } = await committedSale('f333rev');
    await Promise.all([0, 1, 2].map(() => h.repo.reverseSaleStockDeduction(f.tenantId, orderId, null as never)));
    expect(await h.movements(f, orderId, 'sale_return')).toHaveLength(1);
    expect(await h.onHand(f, a)).toBe(10);
    expect((await h.layers(f, a)).reduce((t, l) => t + l.rem, 0)).toBe(10);
  });

  it('AFTER: the legitimate flows still work: post-commit retry after a savepoint failure deducts once; cancel restocks once', async () => {
    const f = await h.tenant('f333flow');
    const a = await h.item(f, 'A', { costing: 'standard', standardCost: null });
    await h.receive(f, a, 10, 7);
    const s = await h.runSale(f, [{ itemId: a, qty: 2, price: 20 }], { mode: 'pooled_stock_on', skipPostCommitDeduction: true });
    if (!s.ok) throw new Error('setup');
    expect(s.stockDeducted).toBe(false);
    await h.q('UPDATE items SET standard_cost=7 WHERE id=$1', [a]);
    await deduct(f, s.id, a, 2);
    expect(await h.onHand(f, a)).toBe(8);
    expect((await h.runCancel(f, s.id)).ok).toBe(true);
    expect(await h.onHand(f, a)).toBe(10);
  });
});
