# SEFAY master plan — progress log (resume from here)

Updated: 2026-11-11. Source of truth is the code; this file tracks status only.

Gates that apply to everything below (api/CLAUDE.md): any schema change needs the exact message
"Approved – Proceed with Implementation"; no tests against the shared (likely production)
Supabase project; no commit/push/deploy without permission.

## P0 — security & stability
| Item | Status |
|---|---|
| T1 `/plans` admin routes superadmin-only; GET hides inactive for non-superadmin | DONE, unit-tested |
| T2 `/subscriptions/upgrade|cancel` owner(+superadmin) only; inactive/unknown plan rejected | DONE, unit-tested |
| T4-A throttler trusts only signature-verified JWT; LOAD_TEST_MODE ignored in production | DONE, unit-tested |
| T4-B QA tenant RBAC/throttle exemption disabled in production | DONE, unit-tested |
| Test DB isolation (unit vs integration split, identity guard, guarded client) | DONE (guard unit-tested; positive path needs an isolated test project) |
| T3 pay-before-activate (`activateSubscription`), failed payment leaves sub unchanged (402), placeholder SUSPENDED→ACTIVE/CANCELLED | DONE, unit-tested |
| T3 production refuses `PAYMENT_PROVIDER=mock` (opt-out `ALLOW_MOCK_PAYMENT_IN_PRODUCTION=true`) | DONE, unit-tested — **deploy impact: prod must set PAYMENT_PROVIDER=stripe or boot fails** |
| T3 idempotent upgrade (same plan/cycle already paid & running → no new charge) | DONE (app-level; concurrent double-click race remains) |
| T3 DB-level payment idempotency (unique payment per invoice) + Stripe webhook event dedupe table | BLOCKED — needs migration (schema approval + isolated test DB) |
| Tenant isolation via RPC (fn_* take only ids; rely on service pre-check) | NOT STARTED — hardening = migrations (approval); sweep of callers is no-schema work, pending |
| Superadmin manual payment still charges provider and activates even if it fails (legacy) | OPEN — product decision |
| Investigate earlier Jest writes to the remote DB | PLAN READY (`docs/TEST_DB_SAFETY.md`), live read-only queries need owner approval |

## P1 — financial/operational integrity
| Item | Status |
|---|---|
| Dine-in addItems re-priced server-side from item/variant master (client unit_price ignored; unknown item -> 404) | DONE, unit-tested |
| Discount bounds: percentage clamped 0..100, fixed clamped 0..subtotal (engine level) | DONE, unit-tested |
| Discount permission / cap per role (who may give 100%) | OPEN — policy decision |
| Dine-in checkout: customer_id must belong to the tenant | DONE, unit-tested |
| Dine-in checkout parity: orders get no shift_id, no loyalty/coupon, cash/card split not persisted (fn_checkout_dine_in_table, migration 072) | BLOCKED — DB function change (migration) |
| RPC sweep: 15 RPCs take no tenant arg. Verified owned-check in services for transfers, counts, reservations, coupons, loyalty, pick, ship. FIXED two real gaps: wms.confirmPack (tenantId was unused) and invoice serial_id -> fn_sell_serial (client-supplied id unchecked) | DONE, unit-tested (confirmPack); serial check typechecked only (no unit test: InvoicesService too large to stub) |
| RPC hardening at DB level (p_tenant_id inside the 15 functions) | BLOCKED — migrations |
| Loyalty points compensation when invoice insert fails after redemption | BLOCKED — fn_adjust_loyalty_points adds positive deltas to lifetime_points_earned, so compensating with an adjustment would corrupt tier stats; needs a dedicated refund path (migration) |
| Reward-instance redemption rollback on failed sale | BLOCKED — needs reversal function (migration) |
| Returns (migration 253) reverse stock + revenue journal only; loyalty points, commissions, coupon use are NOT reversed | BLOCKED — DB function change (migration) |
| COGS posting, payment settlement/tab | NOT STARTED |

## P2–P6
NOT STARTED. Need new tables (Activity Profiles, pricing dimensions, work orders,
appointments, packages, recipes, 38 activities) -> schema approval + isolated test DB.

## Migrations (approved 2026-11-11)
Written but UNAPPLIED and UNVERIFIED in `src/database/migrations_pending/` (kept out of `migrations/` because `migrate`/`start:prod` auto-apply that folder to the only configured DB). Written: 258, 259, 260, 264, 265. Not written: 261, 262, 263. API code using them is not changed yet. See that folder's README.
