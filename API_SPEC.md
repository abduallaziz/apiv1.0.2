# API Specification — Sefay Backend (`C:\Fp\api`)

**Source:** Actual code survey + `api/STATUS.md` (the module's official progress log).
**Date:** 2026-07-28

---

## 1. Overview

Sefay's backend is a multi-tenant NestJS + TypeScript API on top of Supabase PostgreSQL, serving the `web` dashboard, the employee attendance portal, and the superadmin console. It handles POS, inventory/purchasing, HR/attendance, permissions, billing/subscriptions, and notifications for all tenants from a single deployment, with strict per-tenant data isolation.

---

## 2. Tech Stack

- **Framework:** NestJS + TypeScript
- **Database:** Supabase PostgreSQL, accessed directly (not via Supabase Auth) — 138 hand-managed SQL migrations under `src/database/migrations/`
- **Auth:** Custom JWT — 15-minute access token + 7-day rotating refresh token, with device-level sessions
- **Cache/Queue:** Redis, BullMQ for background jobs
- **Payments:** Stripe (production) + a Mock provider, selected via `PAYMENT_PROVIDER` env var
- **Infra:** Railway (API hosting), Vercel (frontend), Supabase Postgres, Redis (Docker local / Railway prod)
- **Logging/Metrics:** Winston (structured logs), prom-client (metrics)
- **Secrets:** Joi-validated env schema

---

## 3. Core Architectural Rules

1. **Tenant isolation:** every query goes through `ScopedRepository`, which automatically applies `tenant_id` — controllers never touch the database directly, and business logic never lives in controllers.
2. **Permissions:** `resource.action.scope` format, enforced via `PermissionGuard`. Role permissions are cached in Redis for 10 minutes and survive server restarts — must be flushed manually after any local `seed:permissions` run.
3. **New tenant tables** must include a `service_role` `GRANT` and a `deleted_at` column from creation, or they will 500 later.
4. **Postgres function changes:** adding a parameter via `CREATE OR REPLACE` creates a second overload and breaks PostgREST RPC calls — the old signature must be `DROP`ped first.
5. **Schema-touching work follows a mandatory approval gate** (see `api/CLAUDE.md`): Architectural Audit → Database Design → Business Rules → State Machine → Migration Matrix → user review → only after the literal message **"Approved – Proceed with Implementation"** does implementation (migrations, DDL, controllers/services/DTOs/tests) begin. No DB/code changes are permitted before that exact approval.

---

## 4. Module Map (`src/`)

### 4.1 `core/` — cross-cutting platform services
auth, tenant (`TenantGuard`), permissions (`PermissionGuard`), feature-flags, audit, billing (Stripe + Mock, dunning), queue (BullMQ+Redis), notification (email/in-app), i18n, logger, metrics, backup, cache, loyalty, outbox, security, secrets, ai-usage, perf.

### 4.2 `engines/` — business-rule engines
approval-engine, discount-engine, expense-engine, payment-engine, pos-engine, shift-engine.

### 4.3 `modules/` — domain APIs
access-control, auth, branches, coupons, customers, expenses, gift-cards, hr, inventory, invoices, items, note-presets, notifications, payments, plans, purchasing, reports, shifts, subscriptions, superadmin, tables, tenants, users.

### 4.4 `database/migrations/`
138 numbered SQL files (e.g. `091_order_note_presets.sql`), hand-managed — not via `supabase/migrations` (that folder is unused).

---

## 5. Domain Capabilities

| Domain | Status / Notes |
|---|---|
| POS engine | Implemented |
| Inventory (items, stock, counts, movements, adjustments, transfers, warehouses, locations) | Phase 2 — production-readiness in progress |
| Purchasing (purchase orders, goods receipts, amendments) | Amendments backend complete (§106, Jul 26 2026) |
| Access Control | Real permission customization for existing system roles shipped; custom roles, multi-role users, and branch-scoped permissions are pending |
| Branches | API scaffolding exists; multi-branch management is "spec pending" — treat as WIP |
| HR (employees, attendance, leaves, payroll, schedules, shifts) | Built out further than documented; missing org chart/reporting hierarchy and GOSI/WPS compliance |
| Billing/Subscriptions | Stripe + Mock provider; superadmin-level tenant/subscription management present |
| Notifications | Email + in-app channels via `core/notification` |

---

## 6. Known Gaps

| Gap | Status |
|---|---|
| Custom permission roles | Pending |
| Multiple roles per user | Pending |
| Branch-scoped permissions | Pending |
| Multi-Branch Management | Spec pending |
| Employee org chart / reporting hierarchy | Not present |
| GOSI / WPS compliance | Not present |
| Mobile app backend consumers (React Native/Expo) | Planned, not built |

---

## 7. Latest Documented Update

- Purchasing #9.5.6.2 — Amendments backend complete (§106) — July 26, 2026 (`api/STATUS.md`).

---

*This document reflects only what actually exists in the `api` codebase and `api/STATUS.md` as of 2026-07-28.*
