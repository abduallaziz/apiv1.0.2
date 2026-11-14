# Design — Full branch isolation (owner-approved 2026-11-14: "Approved – Proceed with Implementation")

Audit input: `web/.audit-full/BRANCH-ISOLATION-AUDIT.md` (code-only audit: 199 tables; enforcement is app-level, RLS is tenant-only).

## 1. Requirement (owner's words, summarized)
Every branch behaves like an independent business. Items (prices, stock, barcodes, categories), customers and loyalty,
employees (each in ONE branch), attendance, schedules, payroll, leaves, expenses, sales, shifts, tables/kitchen/wash,
coupons, accounting/ledger, reports, documents/settings are all per branch. Only the main branch's dashboard shows a
small summary per branch. The tenant owner (system buyer) sees the summary AND can enter any branch to manage it (with that
branch's data only); a branch manager sees only their own branch. Things can be copied/pushed explicitly from a branch to
another branch or to all branches (catalog/categories, work patterns, coupons/loyalty/rewards, templates/settings/roles, and
future additions) without becoming shared. Existing data stays in its own branch; records without a branch go to the main branch.

## 2. Decisions (D1..D10)
- D1 **Rollout flag**: `tenants.branch_isolation_enabled boolean NOT NULL DEFAULT false`. All schema changes are ADDITIVE
  (new columns/indexes/tables, backfills; no drops, no renames). Behaviour changes only when the flag is on for the tenant.
  The flag is first enabled on the demo tenant for production verification; defaulting to true for new tenants and enabling
  for existing ones happens only on the owner's explicit say-so.
- D2 **Main branch**: `branches.is_main boolean NOT NULL DEFAULT false`, at most one per tenant (partial unique index on live
  rows). Backfill: the earliest created live active branch of each tenant, preferring a name starting with 'Main'. The main
  branch cannot be deleted/deactivated; only the owner can move the flag.
- D3 **Active branch resolution (authoritative, in TenantGuard)**, for every request:
  - restricted user (`users.branch_id` set): effective branch = own branch; an `x-branch-id` header for another branch -> 403
    (this closes an existing hole; enforced regardless of the flag);
  - central user (`users.branch_id` NULL = owner/admin): `x-branch-id` (validated) if present; otherwise tenant-wide when the
    flag is off, the MAIN branch when the flag is on;
  - `TenantContext.branchId` therefore is non-null on every tenant request when the flag is on; `TenantContext.isolated`
    tells repositories to filter. Summary endpoints (`/reports/by-branch`, dashboard summary) are the only tenant-wide readers
    and are explicitly marked.
- D4 **Ownership model = one row per branch** (not a shared row with overlays): items, variants, barcodes, categories, brands,
  units, attributes, packaging, customers (+ vehicles via customer), coupons, rewards/loyalty definitions and tiers,
  note presets, expense lookups, departments, shift patterns, geofences, document templates/assignments, suppliers,
  settings overrides each get `branch_id`. Existing rows: items/categories/etc. (no branch today) -> main branch;
  customers -> `created_branch_id` else main; rows that already have a branch keep it.
  History is untouched: `order_items.item_id` keeps pointing at the original item row.
- D5 **Uniqueness becomes per branch** (SKU, barcode, customer phone, plate, coupon code, category/brand/unit/attribute names,
  expense lookup names, department names, account codes later): new unique indexes include `branch_id`; old tenant-wide
  indexes are dropped in the same phase only after the backfill proves no conflicts.
- D6 **Invoice numbering per branch**: counter `(tenant_id, branch_id, series)`; the main branch keeps the existing tenant
  counter value (numbers are never re-issued), other branches start their own series with a branch prefix. ZATCA chains are
  already per device = per branch.
- D7 **Employees**: `users.branch_id` is mandatory for employees/cashiers/managers; owner/admin stay central (NULL). Attendance
  and schedules force the branch of the employee; payroll and HR lists filter by the effective branch.
- D8 **Push/copy ("publish to branches")**: ONE generic service `BranchPublishService` with a registry of publishable entity
  types (`items`, `categories`, `shift_patterns`, `coupons`, `reward_definitions`, `loyalty_tiers`, `document_templates`,
  `note_presets`, `roles/settings`, ...). Each registered type provides `clone(sourceId, targetBranchId)`; a provenance table
  `branch_publications(tenant_id, entity_type, source_id, source_branch_id, target_branch_id, target_id, created_by)` makes the
  action idempotent (re-push updates or skips) and traceable. New entity types plug into the registry (future-proof).
  Owner-only permission `branches.publish`.
- D9 **Accounting**: books/owners are already per branch. Phase 5 makes journal/ledger visibility follow the branch (book ->
  owner -> branch) and lets each branch own its chart of accounts (lazily copied on first use) and fiscal periods; posting
  functions keep resolving account roles per accounting owner. Accounting business logic stays owned by the product owner.
- D10 **Inter-branch flows** (decision made by default, reversible): no cross-branch stock transfer and no buying with another
  branch's items; a customer record is per branch (a person can exist as a customer in several branches); loyalty and coupons
  never cross branches.

## 3. Enforcement layers
1. TenantGuard resolves the effective branch (D3). 2. Repositories filter by `tenant.branchId` when `tenant.isolated`
   (helper `scopeBranch(query, tenant)`), 3. writes stamp `branch_id` from the context and reject foreign-branch references
   (item/customer/coupon/worker of another branch inside a sale -> 400/403), 4. unique indexes per branch (D5),
5. cache keys (items, stock, dashboard, invoices) include the branch, 6. Realtime/websocket rooms per branch,
7. RLS: unchanged in this program (service-role repositories bypass it); a branch-aware RLS layer is a possible later phase.

## 4. Phases (each = additive migration + backend + web + tests + push + production verification)
P0 foundation: D1, D2, D3 (+ web sends x-branch-id on every request), restricted-user header fix, owner branch switcher.
P1 catalog: items/categories/brands/units/attributes/barcodes/coupons/note-presets/rewards definitions (D4, D5) + push registry (D8).
P2 customers/vehicles/loyalty. P3 sales: orders/invoice numbering (D6), shifts, tables/kitchen/wash validation of references.
P4 HR (D7): users/employees/attendance/schedules/leaves/payroll/shift patterns/geofences/departments.
P5 expenses lookups + accounting (D9). P6 reports + main-branch dashboard summary + owner branch switching UX.
P7 settings/templates per branch, remaining pushables, flip defaults (owner decision).

## 5. Migration matrix and hazards
See audit section 4/5. Highlights: no eager fan-out over the demo tenant's ~130 branches (lazy creation); old unique indexes are
dropped only after the new per-branch ones exist and a conflict check passes; `CREATE INDEX CONCURRENTLY` is not used
(migrations run inside the runner); every migration idempotent (IF NOT EXISTS) with a ROLLBACK note; migration numbers start at 279.

## 6. Verification
Unit tests for guard resolution (restricted/central, flag on/off), repository scoping helper, publish service. Production
verification on the demo tenant with the flag on: create a second branch, prove that items/customers/employees/sales/expenses of
branch A are invisible from branch B in UI and API, owner switcher works, summary shows both branches.

## 7. Publish to branches — how to register a new publishable entity type
Code: `src/modules/branches/publish/` (service, registry, provenance repo) and `publishers/` (built-in types).
API: `GET /branches/publish/types`, `POST /branches/publish {entity_type, source_ids[], target_branch_ids[]|'all', mode}`
(permission `branches.publish`, owner/superadmin only; users bound to a branch get 403; requires isolation ON; sources must belong to
the working branch; targets must be other active branches). Provenance: table `branch_publications` (migration 315), unique on
`(tenant_id, entity_type, source_id, target_branch_id)`.
Modes: `copy_new` creates what is missing and never touches existing rows (skipped); `update_existing` also updates them.
A unique-key collision in the target (name/sku/code) is resolved by matching the existing row (`findExisting`), never by failing.

To add a type:
1. The table must be branch-owned (`branch_id`, registered in `branch_isolation_tables`, per-branch unique index).
2. For a flat table: add a `simplePublisher({type, group, labelAr, labelEn, table, columns, naturalKey, softDelete?, hasUpdatedAt?, overrides?})`
   entry in `publishers/index.ts` (`registerBuiltInPublishers`). Counters/usage columns are simply left out of `columns`.
3. For a record with children or foreign keys: implement `EntityPublisher` (see `items.publisher.ts`): `loadSources`, `listSourceIds`,
   `findExisting`, `exists`, `create`, `update` (+ optional `afterPublish` for cache invalidation). Map references to the target
   branch's equivalent by name (`mapLookupByName`), creating it if missing.
4. Use `group: 'setup'` only for types that must be copied when a new branch is created with `copy_setup_from_main`.
5. Types that cannot be cloned register with `supported: false` + `unsupportedReason` (shown by `/types`, rejected by `/publish`), e.g. `document_templates` (tenant-wide, assigned per branch).
6. Add the web label in `PublishToBranchesDialog` callers; add a case to `branch-publish.service.spec.ts` if the type has special rules.
Deferred: per-branch settings/roles overlay (branch_settings) and item attributes/packaging levels.
