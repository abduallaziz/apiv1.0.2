# Design — POS Registers (nقاط البيع / الصناديق) + plan dimension

Status: **Architecture Review Only.** No code/migration until the exact message
**"Approved – Proceed with Implementation"**.

Owner decisions captured in chat (2026-11-15):
- A "point of sale / register" (صندوق) is a named entity the owner creates. It can be SHARED (several
  cashiers take turns) or DEDICATED (one per cashier) — the owner decides purely by how many registers
  they create and name. The system does not need a separate mode flag.
- Rule that fixes the cash-shortage problem: **one open shift per register at any instant.** Taking turns is
  fine (close → next opens); opening a second shift on a busy register is blocked.
- Every person who logs in (any role, including cashier) counts toward the **users** limit. Separate login
  per cashier is required for accountability (a shift is owned by the login that opened it, not by the
  register). HR-only employees (role `none`) remain unlimited.
- **POS registers are their own plan dimension** (`max_pos`), bought beyond the plan as an add-on
  (`extra_pos`), exactly like branches/users. The allowance is a **tenant-wide pool** the owner distributes
  across branches (branches are unequal: a supermarket needs 8, a kiosk 1).
- Isolation is untouched: each register belongs to its branch; cashiers see only their branch's registers;
  only the owner (admin layer) distributes the pool.

---

## 1. Architectural Audit (current state)

- `shifts(cashier_id, branch_id, status open|closed, opening_cash, closing_cash, expected_cash,
  discrepancy, opened_at, closed_at, closed_by, report_snapshot, …)`.
- Only rule today: unique index `uq_shifts_one_open_per_cashier_branch` = one open shift per
  (tenant, cashier, branch). **Nothing limits how many shifts are open on the same physical drawer** — so 5
  cashiers can each open a shift and all sell against one drawer → the shortage cannot be attributed.
- **No register/terminal entity exists.** POS is just the screen a logged-in cashier opens.
- `plans(max_users, max_branches)` — no `max_pos`. `addons.type ∈ (extra_user, extra_branch, feature)` — no
  `extra_pos`. `EntitlementsService.activeAddons` sums extra users/branches only.
- `discrepancy` already exists on shifts; the shift report snapshot already attributes sales/returns to a
  shift. So "عجز" (cash + non-cash: unbilled customer, stock variance, unjustified discount) is already a
  per-shift concept — we only need the shift to also carry **which register** it was opened on.

Gap to close: (a) a `pos_registers` entity per branch, (b) shifts reference a register + one-open-per-register
rule, (c) `max_pos` plan dimension + `extra_pos` add-on wired into entitlements, (d) a backfill so existing
branches keep working.

## 2. Database Design

### 2.1 New table `pos_registers`
```
id            UUID PK
tenant_id     UUID NOT NULL → tenants(id)
branch_id     UUID NOT NULL → branches(id)        -- every register belongs to one branch (isolation)
name          TEXT NOT NULL                        -- owner-chosen: "أحمد", "صندوق 1", "الصندوق الرئيسي"
is_active     BOOLEAN NOT NULL DEFAULT true
sort_order    INTEGER NOT NULL DEFAULT 0
created_at / updated_at / deleted_at
```
- Unique active name per branch: `UNIQUE (tenant_id, branch_id, lower(name)) WHERE deleted_at IS NULL`.
- `service_role` grant + RLS enabled + revoke from anon/authenticated (new-table checklist).
- Index `(tenant_id, branch_id) WHERE deleted_at IS NULL`.

### 2.2 `shifts` gets a register link
```
ALTER TABLE shifts ADD COLUMN register_id UUID REFERENCES pos_registers(id);
```
- New partial unique index — the core fix:
  `uq_shifts_one_open_per_register ON shifts (register_id) WHERE status='open' AND deleted_at IS NULL`.
- Keep the existing per-cashier index too (a cashier still can't hold two open shifts).
- `register_id` is nullable only for historical rows; new shifts always set it (see backfill).

### 2.3 Plan dimension + add-on
```
ALTER TABLE plans ADD COLUMN max_pos INTEGER NOT NULL DEFAULT 1;   -- registers included
-- addons.type gains 'extra_pos'
ALTER TABLE addons DROP CONSTRAINT addons_type_check;
ALTER TABLE addons ADD  CONSTRAINT addons_type_check
  CHECK (type IN ('extra_user','extra_branch','extra_pos','feature'));
INSERT INTO addons (key,type,name_ar,name_en,sort_order) VALUES
  ('extra_pos','extra_pos','نقطة بيع إضافية','Extra POS register',3) ON CONFLICT DO NOTHING;
```
- Seed sensible `max_pos` per existing plan (editable later from the super-admin screen):
  Basic 1, Standard 2, Pro 3, Enterprise a generous number (e.g. 50). Demo tenant stays generous.

### 2.4 Backfill (nothing breaks)
- For every existing active branch with no register: create one default register
  `name = 'نقطة البيع'` (or the branch name), `is_active=true`.
- Set `shifts.register_id` of every **open** shift to its branch's default register. Closed/historical
  shifts may stay null (reporting tolerates null = "legacy, no register").
- Because a branch starts with exactly one default register, the one-open-per-register rule immediately
  enforces "one open shift per branch" for anyone who hasn't defined extra registers — which already
  matches how single-drawer shops expect it to behave.

## 3. Business Rules

- **Create/rename/deactivate registers:** owner (and branch manager within their branch) only. Creating a
  register checks the POS pool (see §5). A register with history is deactivated, never hard-deleted.
- **Open a shift:** the cashier picks a register of their branch.
  - If that register already has an open shift → **block (hard)**: "هذه النقطة مشغولة بوردية مفتوحة، أغلقها
    أولاً." (409). This is the anti-chaos rule; no override.
  - Else open; the shift records `register_id` + `cashier_id` (the login that opened it).
- **Shared register, separate identities:** Ahmed/Faisal/Khalid each log in with their OWN account and open
  on the same register in turn. The shift — and therefore its shortage (cash or non-cash) — is attributed to
  whoever opened it, even on a shared register. Shared login accounts are not supported (defeats tracking).
- **Dedicated registers:** owner creates one register per cashier → each always opens on their own →
  shortage is always attributable with no questions. Same mechanics, owner's choice of how many registers.
- **Users limit:** every login (any role incl. cashier) counts (already true after `countLoginUsers`). HR
  `role='none'` employees unlimited.
- **POS pool:** tenant-wide allowance = plan `max_pos` + active `extra_pos` add-ons. Enforced on register
  **creation** across all branches (sum of active registers < pool). Distribution across branches is the
  owner's, in the admin layer; isolation is untouched.

## 4. State Machine

Register:  `active  ⇄ inactive` (owner toggles)  →  `deleted` (soft, only if no open shift).
Shift (unchanged states) now gated by register:
```
          open-shift(register R by cashier C)
 idle ───────────────────────────────────────▶ open            (allowed only if R has no open shift)
  ▲                                              │
  │ close-shift (drawer counted, discrepancy)    │
  └──────────────────────────────────────────────┘
 open-shift on a busy R ─▶ REJECTED (409 "register busy")
```
Pool guard: `create-register` allowed only while `active registers < entitlement.max_pos` (else 402/403
"POS limit reached — buy an extra register or free one").

## 5. Entitlements wiring

- `EntitlementsService`: `limits` gains `max_pos` = plan.max_pos + Σ(active `extra_pos`.quantity), `-1`
  unlimited. `activeAddons` also sums `extra_pos`.
- `BillingService.checkPosLimit(tenantId)` mirrors `checkBranchLimit`: counts active, non-deleted
  `pos_registers` tenant-wide; throws `ForbiddenException` at the pool.
- Register-create path calls `checkPosLimit` first.
- The web plan card / usage meter gains a "نقاط البيع" row (used/limit), read from entitlements.

## 6. Migration Matrix (strict order, each tested before the next)

| # | File | Change | Breaks anything? |
|---|------|--------|------------------|
| 318 | `318_pos_registers.sql` | create `pos_registers` (+grants/RLS/indexes); `shifts.register_id`; `uq_shifts_one_open_per_register`; backfill default register per active branch + link open shifts | No — every branch ends with 1 register; open shifts keep working; rule becomes "1 open per branch" by default |
| 319 | `319_plan_pos_dimension.sql` | `plans.max_pos` (+seed per plan); `addons` type check + `extra_pos` seed | No — default max_pos covers existing tenants; Enterprise/demo generous |
| — | backend | `pos_registers` module (CRUD, branch-scoped), `checkPosLimit`, open-shift guard on register, entitlements `max_pos` | Additive; one-open-per-register enforced by index + friendly 409 |
| — | web | registers management (owner/manager, per branch), register picker in open-shift, pool usage row | Additive |

Rollback per file documented at its head (`DROP …`).

## 7. Open confirmations before implementation
1. Register-create limit is on **active registers tenant-wide vs the pool** (not concurrent-open). Agreed.
2. Hard block (no manager override) on opening a busy register. Agreed.
3. Default register name for backfill: `"نقطة البيع"` (or branch name) — confirm wording.
4. Seeded `max_pos` per plan: Basic 1 / Standard 2 / Pro 3 / Enterprise 50 — confirm numbers.
