# Inventory & Purchasing

Enterprise inventory management for the multi-tenant POS/ERP platform.

## Architecture

- **NestJS** owns orchestration: controllers, DTOs/validation, RBAC
  (`@RequirePermission`), business policies (approval thresholds, status
  workflows), error mapping, and API contracts.
- **PostgreSQL RPC functions** (PL/pgSQL, migration `019_inventory_rpc_functions.sql`)
  are the sole atomicity boundary for every operation that mutates quantity
  or cost: stock movements, FIFO/average cost layer consumption,
  reservations, goods receipts, two-phase warehouse transfers, stock count
  finalization, and inventory adjustments. Each RPC call is one Postgres
  transaction; concurrent mutations are serialized with `SELECT ... FOR
  UPDATE` (or `FOR UPDATE SKIP LOCKED` for multi-worker claiming).
- **`stock_movements`** is an immutable, append-only ledger — DB triggers
  block `UPDATE`/`DELETE` outright. `stock_levels` is the current-quantity
  projection derived from it; `cost_layers` carries FIFO layers (or a single
  rolling average layer for `costing_method = 'average'` items).
- **Outbox pattern**: every mutating RPC inserts into `domain_events_outbox`
  via `_emit_domain_event()` inside the same transaction. A Cron scheduler
  (`OutboxRelayScheduler`, `src/core/outbox/`) claims pending/failed rows
  with `fn_claim_outbox_events` (`FOR UPDATE SKIP LOCKED`, safe under
  horizontal worker scaling) and enqueues them onto a dedicated BullMQ
  queue (`domain-events`); `OutboxProcessor` relays each event and marks it
  processed/failed with retry tracking.

## Legacy stock_quantity

`item_variants.stock_quantity` (and `items.cost_price`) predate this module
and are now frozen historical snapshots:

- Migration `023_legacy_stock_migration.sql` backfilled any existing
  positive `stock_quantity` into `stock_levels`/`stock_movements`/
  `cost_layers` (via the same `fn_apply_stock_movement`/`fn_add_cost_layer`
  RPCs a real goods receipt uses), seeding a per-tenant "Main Warehouse"
  where none existed.
- DB triggers on `item_variants` reject any future `INSERT`/`UPDATE` that
  changes `stock_quantity`'s value — the column can never be written again,
  by any code path.
- `CreateVariantDto` no longer accepts `stock_quantity`; the field is gone
  from the API surface entirely.

All stock now flows exclusively through Inventory/Purchasing RPCs.

## Modules

- `src/modules/inventory/` — warehouses, locations, reorder points, stock
  levels/movements (read), reservations, adjustments, transfers, stock
  counts.
- `src/modules/purchasing/` — suppliers, purchase orders, goods receipts
  (posting a receipt calls `fn_post_goods_receipt`, which applies stock
  movements and cost layers atomically).
- `src/core/outbox/` — the relay worker described above.

## RBAC

Permissions are namespaced `inventory.*` / `purchasing.*` and seeded in
`src/database/seeds/permissions.seed.ts`. Roles: `superadmin`, `owner`,
`manager` get full access; `inventory_clerk` gets operational access
(view/adjust/transfer/count/reserve, plus purchasing manage/receive but
**not** approve); `cashier`/`worker` get `inventory.view` only (plus
`inventory.reserve` for `cashier`).

## Frontend

`sefayv1.0.2/src/features/{suppliers,warehouses,purchase-orders,
goods-receipts,stock,adjustments}` consume only the endpoints above —
no remaining calls into legacy item-stock fields. Sidebar nav and
approve-action gating mirror the backend permission matrix above.
