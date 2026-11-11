# Pending migrations — NOT applied

These files are deliberately kept OUT of `../migrations/` because `npm run migrate` (and the
`start:prod` boot) applies every `.sql` in that folder automatically, and the only database
configured is the shared (very likely production) Supabase project.

Move a file into `../migrations/` only after:
1. it has been applied to an isolated Supabase test project (apply twice to prove idempotency);
2. its integration specs pass via `npm run test:integration` (guard-protected);
3. the owner confirms the deploy plan (see `docs/MIGRATION_DESIGN_P0_P1_P2.md`).

Status (2026-11-11) — written, UNVERIFIED on any database:
| file | state |
|---|---|
| 258_billing_payment_idempotency | written |
| 259_fn_checkout_dine_in_table_v2 | written |
| 260_loyalty_refund_path | written |
| 261_sales_return_reversals | not written (needs the full body of fn_create_sales_return, 253) |
| 262/263 rpc_tenant_guard_v2 + cutover | not written (needs the bodies of the 15 functions) |
| 264_activity_definitions | written (provisional defaults per section, decision D8) |
| 265_tenant_branch_activities | written |

The API code that uses these objects (idempotency_key writes, webhook event table, v2 checkout,
loyalty refund, activity endpoints) is NOT changed yet: it would fail against a database without them.
