# Fiscal-year continuity (WP-B)

Status: **pending, not deployed.** Migrations `325_fiscal_year_continuity.sql` and `326_fiscal_period_safety_net.sql` live in
`src/database/migrations_pending/` (not scanned by `migrate.ts`). Moving them to `migrations/` and running the first
backfill are owner-approved production steps.

## Why
A tenant gets exactly one fiscal year at registration/backfill. `fn_post_journal_entry` raises
`No fiscal period covers posting date` for any date after the last period, which rolls back the whole sale
(`accounting_posting_failed`). For tenants created in 2026 that starts on 2027-01-01.

## Rules the implementation keeps
- Fiscal years/periods are append-only (migration 179): never deleted, never updated except `status`.
- Only **contiguous** years, horizon capped at 5 years, **dry-run by default**.
- A closed/locked period is never touched or reopened; new years are created `open`.
- Serialised per tenant (advisory transaction lock); repeated or parallel calls create each year exactly once.

## Pieces
| Piece | What |
|---|---|
| `fn_plan_fiscal_years(tenant, through)` | read-only plan: `create` / `covered` / `refuse` + reason |
| `fn_ensure_fiscal_years(tenant, through, dry_run default true)` | applies the plan (only with `dry_run = false`) |
| `fn_try_extend_fiscal_year(tenant, date)` | used by the posting engine (326): extends by at most one adjacent year, never far-future, never past; on any failure returns false and the engine raises its original error |
| `v_fiscal_coverage`, `fn_fiscal_coverage_alerts(days)` | coverage monitor (critical ≤ 30 days, high ≤ 90, warning below threshold, expired < 0) |
| `fn_tenant_posting_date(tenant, ts)` | tenant-time-zone date helper — **not wired into any sale path** (see below) |
| `FiscalCalendarService` / `FiscalCalendarScheduler` | daily pass, **off by default**; reports only unless `FISCAL_SCHEDULER_APPLY=true` too |
| `scripts/fiscal-years.js` | dry-run report; controlled apply needs `--apply --confirm approval.json` listing the approved tenants |

Env flags (all optional): `FISCAL_SCHEDULER_ENABLED=false`, `FISCAL_SCHEDULER_APPLY=false`, `FISCAL_HORIZON_YEARS=2` (0–5), `FISCAL_ALERT_DAYS=180`.
Metrics (aggregate, no tenant labels): `sefay_fiscal_coverage_days_min`, `sefay_fiscal_coverage_tenants_below_threshold`.

## Accounting date rules today (documented exceptions, no change made — decision P1-D6)
| Event | Date used | Where |
|---|---|---|
| Sale | `orders.created_at::date` in the **database session time zone** (UTC on the local harness) | `fn_post_sales_order` (266) |
| Cancel (reversal) | `new Date().toISOString().slice(0,10)` — UTC date of the **app process** | `invoices.repository.ts` cancel path |
| Sales return | tenant-time-zone date of `now()` | `fn_create_sales_return` (253) |
A Riyadh sale at 00:30 on 1 Jan is posted on 31 Dec (UTC) today; `fn_tenant_posting_date` returns 1 Jan. Aligning the rules changes report numbers and is a separate decision.

## Running the tool (local)
```
FISCAL_DATABASE_URL=postgres://…@127.0.0.1:…/…  node scripts/fiscal-years.js --years 2 --report report.json
FISCAL_DATABASE_URL=…  node scripts/fiscal-years.js --apply --confirm approval.json
```
Non-loopback hosts are refused (dry-run needs `--allow-remote-read`; apply needs `FISCAL_ALLOW_REMOTE_APPLY=<exact host>`).
