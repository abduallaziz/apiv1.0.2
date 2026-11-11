# Migration design — P0/P1 hardening + P2 Activity Profiles

**Status: ARCHITECTURE REVIEW ONLY (api/CLAUDE.md gate).** No migration file, DDL or backend
code derived from this document exists. Implementation starts only after the exact message
"Approved – Proceed with Implementation". Next free migration number: **258** (latest is 257).

Verified facts (read from the repo, 2026-11-11):
- `payments` (001_initial_schema.sql:354): no uniqueness except PK; `provider` CHECK mock/stripe/moyasar/tap; `status` pending/succeeded/failed/refunded.
- `subscriptions.status` CHECK = trial, active, past_due, grace_period, suspended, cancelled, expired (001:199).
- No webhook-event table exists.
- `fn_checkout_dine_in_table` (072) is the only version: updates `tables` to available BEFORE confirming the order update, never sets shift/cash/card amounts or customer checks.
- `loyalty_ledger.type` CHECK = earn/redeem/adjustment; `fn_adjust_loyalty_points` adds `GREATEST(delta,0)` to `lifetime_points_earned` for ANY positive delta (210).
- `fn_create_sales_return` (253) reverses stock + revenue journal only.
- 15 RPCs take no tenant argument (list in §3.4).
- `tenants.activity` VARCHAR(40) single nullable column (015); branches exist; web lists 37 activities in 8 sections (`ACTIVITY_PROFILES.md`).

Conventions applied to every migration (from project memory): additive only; new tenant tables get
`GRANT ALL ... TO service_role`, `deleted_at`, RLS policy like `loyalty_ledger`; never
`CREATE OR REPLACE` with a changed parameter list (creates an overload and breaks PostgREST RPC) —
use **expand/contract**: new `_v2` function → app switches → old dropped in a later migration.
Each migration is tested on an **isolated** Supabase project first, never the shared one.

---

## 1) Migration Matrix

| # | Name | Purpose | Type | Depends on | Backward compat |
|---|---|---|---|---|---|
| 258 | `billing_payment_idempotency` | one succeeded payment per invoice, webhook dedupe, no duplicate periods | additive | none | old code keeps working |
| 259 | `fn_checkout_dine_in_table_v2` | atomic dine-in checkout with shift, amounts, correct ordering | new function | 072 | v1 kept until cutover |
| 260 | `loyalty_refund_path` | refund redeemed points without inflating lifetime; idempotent redeem | additive + new fn | 208-210 | `adjustment` unchanged |
| 261 | `sales_return_reversals` | return also reverses commission and earned points (per policy) | new columns + replace fn (same signature) | 253, 255, 260 | dry-run output extended only |
| 262 | `rpc_tenant_guard_v2` | `_v2` functions taking `p_tenant_id` and verifying it | new functions | 258+ | old kept until cutover |
| 263 | `rpc_tenant_guard_cutover` | drop the 15 old RPC signatures | contract | 262 + API released | **breaking for old API builds** |
| 264 | `activity_definitions` | global catalog of 38 activities + capabilities | new table + seed | none | none |
| 265 | `tenant_branch_activities` | N activities per tenant, per-branch activity | new tables + backfill | 264 | `tenants.activity` stays, dual-read |

P3 (pricing dimensions, work orders, appointments, deposits, packages, recipes, warranty,
delivery) get their own design + approval after 265; not designed here beyond §5.

---

## 2) P0 migrations

### 258 `billing_payment_idempotency`
```
payments:
  + idempotency_key TEXT NULL
  UNIQUE INDEX uq_payments_one_succeeded_per_invoice (invoice_id) WHERE status = 'succeeded'
  UNIQUE INDEX uq_payments_provider_payment (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL
  UNIQUE INDEX uq_payments_idempotency (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
billing_webhook_events (global, not tenant-scoped):
  id uuid PK, provider text, event_id text, event_type text, status text CHECK IN
  ('received','processed','failed','ignored'), received_at, processed_at, error text, payload_hash text
  UNIQUE (provider, event_id);  GRANT ALL TO service_role; RLS off (platform table)
(dropped in implementation: a unique (subscription_id, period_start) index is ineffective because period_start = now() differs on every call; duplicate charges are stopped by the per-invoice succeeded-payment index + idempotency_key + the app-level same-plan check)
```
- **Pre-flight (read-only, on the isolated copy and, with approval, production):** duplicate
  checks for each unique index; the migration aborts with a clear message if any exist
  (never deletes data).
- `deleted_at`: not added to `billing_webhook_events` (immutable platform log; documented exception).
- **App changes (after migration):** `processPayment` writes `idempotency_key = hash(invoiceId+attempt)`,
  catches unique-violation as "already paid"; webhook controller inserts the event first, skips on conflict.
- **Rollback:** `DROP INDEX` ×4, `DROP TABLE billing_webhook_events`, `DROP COLUMN idempotency_key`.

### Subscription / payment state machine (rules the app + DB enforce)
```
subscription: (none) -> suspended[pending payment placeholder] -> active        (payment succeeded)
                         suspended[placeholder] -> cancelled                    (payment failed/abandoned)
              trial -> active (paid) | expired (trial_ends_at passed, unpaid)
              active -> past_due (renewal failed) -> grace_period -> suspended -> cancelled|expired
              any non-cancelled -> cancelled (owner action)
payment:      pending -> succeeded | failed ;  succeeded -> refunded
              (succeeded is terminal except refunded; only ONE succeeded per invoice)
webhook:      received -> processed | failed | ignored   (event_id unique)
```
Invalid transitions (e.g. cancelled -> active without a new paid invoice) are rejected in the service;
an optional DB trigger is a decision (§6-D3).

---

## 3) P1 migrations

### 259 `fn_checkout_dine_in_table_v2` (new function, v1 untouched)
Parameters: tenant, order, table, payment_method, customer, **shift_id, cash_amount, card_amount, cashier_id**.
Behaviour: (1) `UPDATE orders ... WHERE status='pending' RETURNING` first; (2) only if a row was updated,
free the table (fixes v1 freeing the table even when the order was not pending); (3) set `shift_id`,
`cash_amount`, `card_amount`, `payment_method`; (4) customer must belong to tenant (defence in depth);
(5) returns the row or empty. Application then runs the same best-effort post steps as `/invoices`
(stock, loyalty earn, coupon) — no schema needed for those.
- Prerequisite check: `orders.shift_id/cash_amount/card_amount` exist (they do for `/invoices`; verify in the isolated DB).
- Cutover: API calls `_v2`; v1 dropped in 263.
- Rollback: drop `_v2`, API reverts to v1 call.

### 260 `loyalty_refund_path`
```
loyalty_ledger.type CHECK  += 'refund'
loyalty_ledger + sale_attempt_id uuid NULL
UNIQUE INDEX uq_loyalty_redeem_attempt (tenant_id, sale_attempt_id) WHERE type='redeem' AND sale_attempt_id IS NOT NULL
UNIQUE INDEX uq_loyalty_refund_attempt (tenant_id, sale_attempt_id) WHERE type='refund' AND sale_attempt_id IS NOT NULL
fn_refund_loyalty_points(p_tenant, p_customer, p_points, p_sale_attempt, p_branch, p_actor)
   -> adds p_points to customers.loyalty_points, NOT lifetime_points_earned, ledger row type 'refund',
      requires an existing redeem row for that attempt and refunds at most once.
```
CHECK-constraint replacement uses `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` in one transaction.
App: `redeemPoints*` passes `sale_attempt_id`; the `/invoices` catch block calls the refund when the
order insert fails (including the lost-race duplicate case). Reward-instance redemption gets the same
treatment via a reversal function in the same migration (`fn_unredeem_reward_instances`), decision D5.
- Rollback: drop the two functions/indexes; CHECK back to 3 values (only safe if no 'refund' rows — migration
  pre-check blocks rollback otherwise).

### 261 `sales_return_reversals`
```
sales_return_items + commission_reversed NUMERIC(12,2) NOT NULL DEFAULT 0
sales_returns      + loyalty_points_reversed NUMERIC NOT NULL DEFAULT 0
fn_create_sales_return  (SAME signature -> plain CREATE OR REPLACE, no overload)
   + per returned line: commission_reversed = commission_amount * returned_qty / sold_qty
   + earned points on the order reversed proportionally to returned value (ledger type 'adjustment',
     negative delta, order_id set) — never below 0
   + redeemed points: refunded proportionally ONLY if policy D6 says so (via 260)
   + coupon use_count: NOT reversed (policy D7 default)
```
Reports that sum commission must subtract `commission_reversed` (app/report change, listed in the same phase).
- Rollback: restore function body from 253; new columns can stay (unused, default 0).

### 262/263 `rpc_tenant_guard_v2` + cutover
Fifteen functions take no tenant id. Each gets a `_v2` twin with `p_tenant_id uuid` as first
parameter that raises when the target row's `tenant_id` differs, then performs the same work:

| group | functions |
|---|---|
| warehouse | fn_confirm_pick, fn_confirm_pack, fn_ship_shipment |
| inventory | fn_approve_stock_count, fn_finalize_stock_count, fn_release_reservation |
| transfers | fn_transfer_approve, fn_transfer_dispatch, fn_transfer_receive, fn_transfer_complete |
| serials | fn_sell_serial, fn_return_serial |
| commerce | fn_redeem_coupon, fn_adjust_loyalty_points |
| system | fn_claim_outbox_events (platform job — excluded, documented) |

Two real gaps are already fixed in the API (confirmPack, serial sale); the `_v2` layer makes isolation
hold even if a future service forgets the check. Cutover (263) is the only breaking step: it runs only after
the API release using `_v2` is live everywhere (production + staging share one DB — see D1).
- Rollback of 262: drop `_v2`. 263 is not reversible without re-creating old bodies (kept in the
  migration file as a commented rollback script).

---

## 4) P2 — Activity Profiles (264, 265)

### 264 `activity_definitions` (global catalog, seeded)
```
activity_definitions
  code text PK                  -- e.g. 'carWash','supermarket','salon','tireOil' (38th, proposed)
  section text, name_ar, name_en, icon text, sort int
  capabilities text[]           -- e.g. {'pos.grid','queue','work_order','appointments','recipes','batches','serials','packages'}
  pricing_dimensions jsonb      -- e.g. [{"key":"vehicle_size","values":["small","medium","large"]}]
  customer_fields jsonb         -- fields + roles (phone, plate_number, ...)
  workflow text CHECK IN ('instant','table_kitchen','queue','work_order','appointment')
  stock_mode text CHECK IN ('none','qty','batch_expiry','serial','recipe')
  payment_modes text[]          -- 'standard','deposit','tab','package'
  is_active bool, created_at
```
Seed: the 37 existing codes (kept identical to `business-type.config.ts`) + `tireOil`. Defaults per
activity come from `ACTIVITY_PROFILES.md` after the owner marks keep/edit/delete (open item D8).
GRANT service_role; read-only for tenants (no tenant_id).

### 265 `tenant_branch_activities`
```
tenant_activities  (id, tenant_id FK, activity_code FK, is_primary bool, config_overrides jsonb,
                    created_at, deleted_at)  UNIQUE (tenant_id, activity_code) WHERE deleted_at IS NULL
                    UNIQUE (tenant_id) WHERE is_primary AND deleted_at IS NULL
branch_activities  (id, tenant_id FK, branch_id FK, activity_code FK, is_default bool, config_overrides jsonb,
                    created_at, deleted_at)  UNIQUE (branch_id, activity_code) WHERE deleted_at IS NULL
RLS tenant_session_isolation + GRANT service_role on both.
```
Backfill (same migration, idempotent `INSERT … ON CONFLICT DO NOTHING`):
1. every tenant with `tenants.activity IS NOT NULL` → one `tenant_activities` row, `is_primary`;
2. no `branch_activities` rows are created: **resolution rule** = a branch with no rows inherits its tenant's activities.
`tenants.activity` is kept and still written (dual-write) so web/Android/JWT keep working;
it is removed only in a future contract migration after a full release cycle.
Effective profile = definition ⊕ tenant override ⊕ branch override, resolved by one server endpoint
(`GET /activity-profile`) which the JWT/clients consume; permissions stay server-side RBAC (the profile
only decides what is shown/enabled, never what is authorised).
- Rollback: drop the two tables; `tenants.activity` untouched so nothing is lost.

---

## 5) P3 outline (separate approval later)
Reuse first: BOM/production exists → **recipes = BOM**; `customer_vehicles` (255) → vehicles; wash queue (256) →
queue workflow; notifications module exists. New: `price_dimensions`+`item_prices`, `work_orders`(+lines,+status
history), `appointments`+`resources`, `deposits`, `packages`+`package_balances`, `warranties`, `deliveries`.
Each follows the same additive/expand-contract rules and gets its own state machine.

---

## 6) Decisions needed from the owner
- **D1** Is production the only database (staging shares it)? Cutover 263 and any `_v2` rollout must be one coordinated release. A separate staging DB is strongly advised.
- **D2** Isolated Supabase project for testing 258–265 (required before implementation).
- **D3** DB trigger enforcing subscription transitions, or service-level only?
- **D4** One invoice per (subscription, period) — OK? (blocks duplicate charges, also blocks re-billing the same period after a void.)
- **D5** Reward-instance redemption rollback in 260, or only points?
- **D6** On a return: refund redeemed points proportionally? reverse earned points proportionally?
- **D7** Coupon on return: leave consumed (default) or restore usage?
- **D8** Per-activity keep/edit/delete answers in `ACTIVITY_PROFILES.md`; confirm `tireOil` as the 38th.
- **D9** Dine-in: require an open shift at checkout like `/invoices` (behaviour change for restaurants that don't use shifts)?
- **D10** Superadmin manual payment: still activate when the gateway fails (current) or not.

## 7) Verification plan (on the isolated DB only)
For every migration: apply on a clean copy → apply again (idempotent) → duplicate pre-flight → unit/integration
specs through `npm run test:integration` (guard-protected) → rollback script dry run. Specific cases:
258 concurrent double payment (one wins), duplicate webhook event; 259 non-pending order does not free the table,
shift/cash/card persisted; 260 refund once, lifetime unchanged, parallel redeem same attempt; 261 partial/multi
returns never exceed sold qty, commission/points reversed proportionally; 262 foreign-tenant ids rejected by every
`_v2`; 264/265 backfill idempotent, branch inheritance, tenants with NULL activity unaffected.
