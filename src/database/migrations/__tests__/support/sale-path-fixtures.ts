/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any */
/**
 * WP-D (T2) shared fixtures for the sale / inventory / accounting proof specs.
 *
 * LOCAL DISPOSABLE DATABASE ONLY: every entry point refuses a non-loopback DATABASE_URL.
 * The sale path is exercised through the REAL `InvoicesRepository` (createWithItemsPooled, cancelPooled,
 * deductStockForSale, reverseSaleStockDeduction) bound to a real pg Pool, so the SQL the app runs is the SQL tested.
 * Only the service-level orchestration (flag selection, post-commit deduction, fire-and-forget restock on cancel)
 * is mirrored here (`runSale`, `runCancel`) from `InvoicesService.create/cancel` — labelled INFERRED in the report.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Pool, Client as PgClient } from 'pg';
import { randomUUID } from 'crypto';
import { InvoicesRepository } from '../../../../modules/invoices/repositories/invoices.repository';
import { TenantSessionService } from '../../../../core/tenant/tenant-session.service';

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
export const RUN = `t2-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export function assertLoopback(): string {
  const url = process.env.DATABASE_URL ?? '';
  const host = new URL(url || 'postgres://invalid').hostname;
  if (!LOOPBACK.includes(host)) {
    throw new Error('WP-D specs refuse to run against a non-loopback DB');
  }
  return url;
}

export type Fx = {
  tenantId: string;
  branchId: string;
  warehouseId: string;
  warehouse2Id: string;
};

export class Harness {
  pool!: Pool;
  pg!: PgClient;
  repo!: InvoicesRepository;
  session!: TenantSessionService;

  async open() {
    const url = assertLoopback();
    this.pool = new Pool({ connectionString: url, max: 10 });
    this.pg = new PgClient({ connectionString: url });
    await this.pg.connect();
    this.session = new TenantSessionService(this.pool);
    this.repo = new InvoicesRepository(this.rpcShim() as never, this.session);
  }

  /**
   * Idempotently (re)applies pending migration files to the LOCAL database. Other specs (e.g. the 328 wiring spec) roll
   * function bodies back to production state when they finish, so every spec that depends on a pending fix re-asserts it.
   * 332 needs the 325-328 wiring; they are applied first only when that wiring is missing.
   */
  async ensurePending(...files: string[]) {
    const dir = path.resolve(__dirname, '..', '..', '..', 'migrations_pending');
    const apply = async (f: string) => {
      await this.pg.query(fs.readFileSync(path.join(dir, f), 'utf8'));
    };
    if (files.some((f) => f.startsWith('332'))) {
      const [{ ok }] = await this.q("SELECT (to_regprocedure('fn_posting_date_for_event(uuid,text,timestamp with time zone,date)') IS NOT NULL AND (SELECT prosrc ~ 'fn_posting_date_for_event' FROM pg_proc WHERE proname='fn_create_sales_return' AND pronamespace='public'::regnamespace)) AS ok");
      if (!ok) {
        for (const f of ['325_fiscal_year_continuity.sql', '326_fiscal_period_safety_net.sql', '327_posting_date_policy.sql', '328_posting_date_policy_wiring.sql']) await apply(f);
      }
    }
    for (const f of files) await apply(f);
  }

  async close() {
    await this.pg?.end();
    await this.pool?.end();
  }

  /** Minimal supabase-js stand-in: only `.rpc(fn, namedArgs)` (what deductStockForSale/reverseSaleStockDeduction use). */
  private rpcShim() {
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        const keys = Object.keys(args);
        const sql = `SELECT ${fn}(${keys
          .map((k, i) => `${k} => $${i + 1}${k === 'p_items' ? '::jsonb' : ''}`)
          .join(', ')})`;
        try {
          await this.pool.query(
            sql,
            keys.map((k) => (k === 'p_items' ? JSON.stringify(args[k]) : args[k])),
          );
          return { error: null };
        } catch (e: any) {
          return { error: { message: e.message, code: e.code } };
        }
      },
    };
  }

  async q<T = any>(sql: string, p: unknown[] = []): Promise<T[]> {
    return (await this.pg.query(sql, p)).rows as T[];
  }

  async withClient<T>(fn: (c: PgClient) => Promise<T>): Promise<T> {
    const c = new PgClient({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  // ------------------------------------------------------------------ fixtures
  async tenant(label: string): Promise<Fx> {
    const tenantId = randomUUID();
    const branchId = randomUUID();
    const warehouseId = randomUUID();
    const warehouse2Id = randomUUID();
    const q = this.q.bind(this);
    await q(
      'INSERT INTO tenants (id, name, business_type, status, timezone) VALUES ($1,$2,$3,$4,$5)',
      [tenantId, `${RUN}-${label}`, 'retail', 'active', 'Asia/Riyadh'],
    );
    await q('INSERT INTO branches (id, tenant_id, name) VALUES ($1,$2,$3)', [
      branchId,
      tenantId,
      'Main',
    ]);
    await q(
      "INSERT INTO warehouses (id, tenant_id, branch_id, code, name) VALUES ($1,$2,$3,'W1','Main WH'),($4,$2,$3,'W2','Second WH')",
      [warehouseId, tenantId, branchId, warehouse2Id],
    );
    await q('UPDATE branches SET default_warehouse_id=$2 WHERE id=$1', [
      branchId,
      warehouseId,
    ]);
    const [owner] = await q(
      "INSERT INTO accounting_owners (tenant_id, branch_id, owner_type_code, name, status) VALUES ($1,$2,'branch','Main','active') RETURNING id",
      [tenantId, branchId],
    );
    await q(
      "INSERT INTO branch_accounting_assignments (tenant_id, branch_id, accounting_owner_id, effective_from, reason) VALUES ($1,$2,$3,'2020-01-01','wp-d test')",
      [tenantId, branchId, owner.id],
    );
    const [cal] = await q(
      'INSERT INTO fiscal_calendars (tenant_id, start_month, start_day, effective_from) VALUES ($1,1,1,make_date(2020,1,1)) RETURNING id',
      [tenantId],
    );
    const [{ y }] = await q('SELECT extract(year from now())::int y');
    for (const yr of [y]) {
      await q('SELECT fn_generate_fiscal_year($1,$2,$3,$4)', [
        tenantId,
        cal.id,
        yr,
        String(yr),
      ]);
    }
    await q(
      `INSERT INTO accounts (tenant_id, code, name, account_type, normal_balance, is_posting_account, is_system_account, is_active) VALUES
       ($1,'1000','Cash','asset','debit',true,true,true),($1,'1010','Bank','asset','debit',true,true,true),
       ($1,'1100','Accounts Receivable','asset','debit',true,true,true),($1,'1200','Inventory Asset','asset','debit',true,true,true),
       ($1,'2100','Accounts Payable','liability','credit',true,true,true),($1,'2200','Tax Payable','liability','credit',true,true,true),
       ($1,'4000','Sales Revenue','revenue','credit',true,true,true),($1,'5000','Cost of Goods Sold','expense','debit',true,true,true)`,
      [tenantId],
    );
    await q(
      `INSERT INTO account_role_assignments (tenant_id, role_code, account_id)
       SELECT $1, v.role_code, a.id FROM (VALUES ('default_cash','1000'),('default_bank','1010'),('accounts_receivable','1100'),
       ('inventory_asset','1200'),('accounts_payable','2100'),('tax_payable','2200'),('sales_revenue','4000'),('cogs','5000')) AS v(role_code, code)
       JOIN accounts a ON a.tenant_id = $1 AND a.code = v.code`,
      [tenantId],
    );
    return { tenantId, branchId, warehouseId, warehouse2Id };
  }

  async item(
    f: Fx,
    name: string,
    opts: {
      costing?: string;
      standardCost?: number | null;
      tracked?: boolean;
      price?: number;
    } = {},
  ): Promise<string> {
    const [r] = await this.q(
      `INSERT INTO items (tenant_id, name, type, operation_type, price, has_inventory, costing_method, standard_cost)
       VALUES ($1,$2,'product','sell',$3,$4,$5,$6) RETURNING id`,
      [
        f.tenantId,
        `${name}-${randomUUID().slice(0, 6)}`,
        opts.price ?? 10,
        opts.tracked ?? true,
        opts.costing ?? 'fifo',
        opts.standardCost ?? null,
      ],
    );
    return r.id;
  }

  /** A real, posted goods receipt (stock movement 'receipt' + cost layer). */
  async receive(
    f: Fx,
    itemId: string,
    qty: number,
    unitCost: number,
    warehouseId = f.warehouseId,
  ): Promise<string> {
    const [gr] = await this.q(
      "INSERT INTO goods_receipts (tenant_id, warehouse_id, receipt_number, status) VALUES ($1,$2,$3,'draft') RETURNING id",
      [f.tenantId, warehouseId, `GR-${randomUUID().slice(0, 8)}`],
    );
    await this.q(
      'INSERT INTO goods_receipt_items (tenant_id, goods_receipt_id, item_id, quantity_received, unit_cost) VALUES ($1,$2,$3,$4,$5)',
      [f.tenantId, gr.id, itemId, qty, unitCost],
    );
    await this.q('SELECT fn_post_goods_receipt($1, NULL)', [gr.id]);
    return gr.id;
  }

  // ------------------------------------------------------------------ the sale path
  /**
   * Mirrors InvoicesService.create() for the three flag combinations, using the REAL repository methods.
   *  - 'pooled_off'        : repo.create + repo.insertItems (PostgREST in prod; here pg-direct) + post-commit deduction, NO journal entry.
   *  - 'pooled_stock_off'  : createWithItemsPooled without stockInTx (order + entry in tx; stock deducted AFTER commit).
   *  - 'pooled_stock_on'   : createWithItemsPooled with stockInTx (stock + entry in the same transaction).
   */
  async runSale(
    f: Fx,
    lines: { itemId: string; qty: number; price: number }[],
    o: {
      mode: 'pooled_off' | 'pooled_stock_off' | 'pooled_stock_on';
      attemptId?: string;
      discount?: number;
      taxRate?: number; // e.g. 0.15
      /** explicit order amounts (e.g. produced by the real PosEngine.buildInvoice, incl. tax-inclusive mode) */
      amounts?: { subtotal: number; discount: number; tax: number; total: number };
      payment?: 'cash' | 'card' | 'tab' | 'split';
      skipPostCommitDeduction?: boolean;
      /** WP-E: SALE_EXCEPTION_RECORDING_ENABLED (default off) */
      recordExceptions?: boolean;
      afterPost?: (c: any, orderId: string) => Promise<void>;
    },
  ) {
    const subtotal = o.amounts?.subtotal ?? round2(lines.reduce((s, l) => s + l.qty * l.price, 0));
    const discount = o.amounts?.discount ?? o.discount ?? 0;
    const tax = o.amounts?.tax ?? round2((subtotal - discount) * (o.taxRate ?? 0));
    const total = o.amounts?.total ?? round2(subtotal - discount + tax);
    const payment = o.payment ?? 'card';
    const payload: Record<string, unknown> = {
      branch_id: f.branchId,
      cashier_id: null,
      status: 'completed',
      subtotal,
      discount,
      tax,
      total,
      payment_method: payment,
      sale_attempt_id: o.attemptId ?? randomUUID(),
      cash_amount: payment === 'split' ? round2(total / 2) : null,
      card_amount: payment === 'split' ? round2(total - round2(total / 2)) : null,
    };
    const tenantCtx = { tenantId: f.tenantId } as never;
    const items = lines.map((l, i) => ({
      item_id: l.itemId,
      item_name: `line-${String(i).padStart(3, '0')}`,
      quantity: l.qty,
      unit_price: l.price,
      official_price_snapshot: l.price,
    }));
    const stockItems = lines.map((l) => ({
      item_id: l.itemId,
      variant_id: null,
      quantity: l.qty,
    }));
    try {
      if (o.mode === 'pooled_off') {
        const ins = await this.pool.query(
          `INSERT INTO orders (tenant_id, branch_id, status, subtotal, discount, tax, total, payment_method, sale_attempt_id, held)
           VALUES ($1,$2,'completed',$3,$4,$5,$6,$7,$8,false) RETURNING id`,
          [f.tenantId, f.branchId, subtotal, discount, tax, total, payment, payload.sale_attempt_id],
        );
        const id = ins.rows[0].id as string;
        for (const [i, l] of lines.entries()) {
          await this.pool.query(
            'INSERT INTO order_items (order_id, item_id, item_name, qty, price, total_price) VALUES ($1,$2,$3,$4,$5,$6)',
            [id, l.itemId, `line-${String(i).padStart(3, '0')}`, l.qty, l.price, l.qty * l.price],
          );
        }
        let stockError: string | undefined;
        if (!o.skipPostCommitDeduction) {
          try {
            await this.repo.deductStockForSale(f.tenantId, f.warehouseId, id, null as never, stockItems);
          } catch (e: any) {
            stockError = e.message;
          }
        }
        return { ok: true as const, id, stockDeducted: !stockError && !o.skipPostCommitDeduction, stockError };
      }
      const inv = await this.repo.createWithItemsPooled(
        tenantCtx,
        payload,
        items as never,
        o.mode === 'pooled_stock_on'
          ? { warehouseId: f.warehouseId, ...(o.recordExceptions ? { recordExceptions: true } : {}) }
          : undefined,
        undefined,
        o.afterPost,
      );
      let stockError = inv.stockError;
      let stockDeducted = inv.stockDeducted;
      if (!inv.stockDeducted && !inv.stockExceptions && !o.skipPostCommitDeduction) {
        // identical to InvoicesService.create: post-commit retry of the deduction
        try {
          await this.repo.deductStockForSale(f.tenantId, f.warehouseId, inv.id, null as never, stockItems);
          stockDeducted = true;
          stockError = undefined;
        } catch (e: any) {
          stockError = e.message;
        }
      }
      return { ok: true as const, id: inv.id, stockDeducted, stockError, stockExceptions: inv.stockExceptions };
    } catch (e: any) {
      return { ok: false as const, error: e.message as string, code: e.code as string | undefined };
    }
  }

  /** Mirrors InvoicesService.cancel(): pooled status+entry reversal, then (separately, after commit) the stock restore. */
  async runCancel(f: Fx, orderId: string, o: { failRestock?: boolean; recordExceptions?: boolean } = {}) {
    try {
      const upd = await this.repo.cancelPooled(
        { tenantId: f.tenantId } as never,
        orderId,
        null as never,
        'test',
        ...(o.recordExceptions ? [{ recordExceptions: true }] : []),
      );
      let restockError: string | undefined;
      if (!o.failRestock && !upd.restockHandled) {
        try {
          await this.repo.reverseSaleStockDeduction(f.tenantId, orderId, null as never);
        } catch (e: any) {
          restockError = e.message;
        }
      }
      return { ok: true as const, upd, restockError };
    } catch (e: any) {
      return { ok: false as const, error: e.message as string };
    }
  }

  async doReturn(f: Fx, orderId: string, items: [string, number][], shiftId: string | null = null) {
    return this.withClient(async (c) => {
      try {
        await c.query('BEGIN');
        const r = await c.query(
          "SELECT fn_create_sales_return($1,$2,NULL,$3,'customer return',$4::jsonb) AS r",
          [
            f.tenantId,
            orderId,
            shiftId,
            JSON.stringify(items.map(([order_item_id, quantity]) => ({ order_item_id, quantity }))),
          ],
        );
        await c.query('COMMIT');
        return { ok: true as const, res: r.rows[0].r as any };
      } catch (e: any) {
        await c.query('ROLLBACK').catch(() => undefined);
        return { ok: false as const, error: e.message as string, res: null };
      }
    });
  }

  /** A shift row for cash refunds. */
  async openShift(f: Fx): Promise<string> {
    const [u] = await this.q(
      "INSERT INTO users (tenant_id, name, email, is_active) VALUES ($1,'cashier',$2,true) RETURNING id",
      [f.tenantId, `${randomUUID()}@t2.local`],
    );
    const [s] = await this.q(
      "INSERT INTO shifts (tenant_id, branch_id, cashier_id, status, opening_cash) VALUES ($1,$2,$3,'open',0) RETURNING id",
      [f.tenantId, f.branchId, u.id],
    );
    return s.id;
  }

  // ------------------------------------------------------------------ read model
  async orderItemIds(orderId: string): Promise<string[]> {
    return (
      await this.q('SELECT id FROM order_items WHERE order_id=$1 ORDER BY item_name, id', [orderId])
    ).map((r) => r.id);
  }
  async count(table: string, f: Fx): Promise<number> {
    return (await this.q(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1`, [f.tenantId]))[0].n;
  }
  async movements(f: Fx, orderId: string, type = 'sale') {
    return this.q(
      "SELECT * FROM stock_movements WHERE tenant_id=$1 AND reference_type='order' AND reference_id=$2 AND movement_type=$3 ORDER BY created_at, id",
      [f.tenantId, orderId, type],
    );
  }
  async entries(f: Fx, orderId: string) {
    return this.q(
      "SELECT * FROM journal_entries WHERE tenant_id=$1 AND source_module='sales' AND source_entity_type='order' AND source_entity_id=$2 ORDER BY created_at, id",
      [f.tenantId, orderId],
    );
  }
  async lines(entryId: string) {
    return this.q(
      `SELECT a.code, jl.debit_amount::numeric d, jl.credit_amount::numeric c
         FROM journal_lines jl JOIN accounts a ON a.id=jl.account_id WHERE jl.journal_entry_id=$1 ORDER BY jl.line_number`,
      [entryId],
    );
  }
  /** net (debit - credit) per account code over posted/reversed entries (the trial balance basis). */
  async balances(f: Fx): Promise<Record<string, number>> {
    const rows = await this.q(
      `SELECT a.code, (tb.debit_total - tb.credit_total)::float8 net
         FROM fn_trial_balance($1) tb JOIN accounts a ON a.id = tb.account_id`,
      [f.tenantId],
    );
    return Object.fromEntries(rows.map((r) => [r.code, round2(r.net)]));
  }
  async onHand(f: Fx, itemId: string, warehouseId = f.warehouseId): Promise<number> {
    const r = await this.q(
      'SELECT coalesce(sum(quantity_on_hand),0)::float8 q FROM stock_levels WHERE tenant_id=$1 AND warehouse_id=$2 AND item_id=$3',
      [f.tenantId, warehouseId, itemId],
    );
    return r[0].q;
  }
  async backorder(f: Fx, itemId: string): Promise<number> {
    const r = await this.q(
      'SELECT coalesce(sum(quantity_backorder),0)::float8 q FROM stock_levels WHERE tenant_id=$1 AND item_id=$2',
      [f.tenantId, itemId],
    );
    return r[0].q;
  }
  async layers(f: Fx, itemId: string, warehouseId = f.warehouseId) {
    return this.q(
      'SELECT unit_cost::float8 uc, quantity_remaining::float8 rem, quantity_received::float8 rcv FROM cost_layers WHERE tenant_id=$1 AND warehouse_id=$2 AND item_id=$3 ORDER BY received_at, created_at, id',
      [f.tenantId, warehouseId, itemId],
    );
  }
  async layerValue(f: Fx): Promise<number> {
    return (
      await this.q(
        'SELECT coalesce(sum(quantity_remaining*unit_cost),0)::float8 v FROM cost_layers WHERE tenant_id=$1',
        [f.tenantId],
      )
    )[0].v;
  }
  async entryBalanced(entryId: string) {
    const [r] = await this.q(
      'SELECT coalesce(sum(debit_amount),0)::numeric d, coalesce(sum(credit_amount),0)::numeric c, count(*)::int n FROM journal_lines WHERE journal_entry_id=$1',
      [entryId],
    );
    return Number(r.d) === Number(r.c) && r.n > 0;
  }
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
