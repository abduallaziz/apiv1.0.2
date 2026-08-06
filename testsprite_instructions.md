# Extra Testing Instructions — Sefay API

## Authentication & Tenancy
- All endpoints (except `/api/v1/auth/*` and `/api/v1/webhooks/*`) require a Bearer JWT (`Authorization: Bearer <token>`).
- Every request is scoped to a tenant embedded in the JWT — never pass a `tenant_id` manually; the API resolves it from the token.
- Test tenant isolation explicitly: create a resource under tenant A's token, then attempt to fetch/modify it using tenant B's token — must return 404, not 403 (resources from other tenants should appear to not exist, not merely be forbidden).

## Permissions
- Every write endpoint is gated by a specific permission key (e.g. `purchasing.manage`, `purchasing.agreement.approve`). Test with a low-privilege role (e.g. `cashier`) to confirm 403 on endpoints it shouldn't access.
- Approve/Reject actions on Agreements/Amendments/Releases require dedicated permissions (`purchasing.agreement.approve/.reject`, `purchasing.amendment.approve/.reject`, `purchasing.release.approve/.reject`) — distinct from the general `purchasing.manage` used for create/update/submit/cancel.

## Purchasing — Agreements → Amendments → Releases (newest module, test thoroughly)

### Agreements (`/purchasing/agreements`)
- Lifecycle: `draft → submitted → approved → closed`, plus `submitted → rejected` and `(draft|submitted|approved) → cancelled`.
- Only `draft` agreements can be edited (`PATCH`) or deleted (`DELETE`).
- `close` only valid from `approved`.

### Amendments (`/purchasing/amendments`)
- Lifecycle: `draft → submitted → approved`, plus `submitted → rejected` and `(draft|submitted) → cancelled`.
- **`approved` is terminal — cancel must fail with 400 on an approved amendment.**
- Each line item requires an explicit `action`: `modify`, `add`, or `discontinue` — test all three.
  - `add`: requires `item_id` (not `agreement_item_id`); the new `agreement_items` row is only created at `approve()` time, not at `create()`. Verify no row exists before approval.
  - `modify`: requires `agreement_item_id` + at least one delta field. Test that a delta against an item with `committed_quantity = null` (open-ended) is rejected with a clear error, not silently coalesced to 0.
  - `discontinue`: requires `agreement_item_id` only, no delta fields.
- **Eligibility rule**: creating a commercial amendment (`quantity_change`, `value_change`, `price_change`, `extension`, `general`) on a non-`approved` agreement must be rejected. `administrative_correction` must succeed regardless of agreement status — test both.
- Approving an amendment must never let it mutate an `agreement_item` that belongs to a *different* agreement than the amendment itself — test this cross-agreement case explicitly (should fail atomically, with the amendment's status unchanged).

### Releases (`/purchasing/releases`)
- Lifecycle: `draft → submitted → approved`, plus `submitted → rejected` and `(draft|submitted) → cancelled`. `approved` is terminal, same as Amendments.
- **Never send price fields** in the create payload — pricing is computed server-side from `agreement_pricing`. Confirm the response's `snapshot_unit_price`/`released_amount` reflect server-computed values, and that later changes to the source `agreement_pricing` do NOT retroactively change an already-created release's snapshot.
- **Overage check**: creating a release whose `released_quantity` exceeds the agreement item's remaining committed quantity must fail with a clear message (only enforced when `overage_policy = 'block'`; items with `committed_quantity = null` — Open Blanket — must NOT be checked at all).
- Test cumulative consumption: release 15 of a 20-unit commitment and approve it, then attempt to release 10 more — must fail (only 5 remain).
- Test atomicity: attempt to create a release with one valid line item and one line item referencing an `agreement_item_id` from a different agreement — the whole request must fail and leave **zero** orphan `agreement_releases` header row behind.

## Purchase Orders (`/purchasing/purchase-orders`)
- Source traceability lives at the **line-item level only** (`source_agreement_item_id`, `source_release_item_id`) — there is deliberately no header-level agreement/release reference. A single PO may legitimately contain lines sourced from different agreements/releases for the same supplier; this should succeed, not error.

## General correctness checks to apply across all modules
- Every `POST`/`PATCH` should reject unknown/extra fields (global `ValidationPipe` uses `forbidNonWhitelisted: true`) — send an extra bogus field and confirm 400.
- State-transition endpoints (`submit`, `approve`, `reject`, `cancel`, `close`) must return 400 (not 500) when called on a resource in an invalid current state.
- Soft-delete only: after `DELETE`, the resource should disappear from `GET` list/detail, but should not be recoverable via any endpoint (no hard-delete/undelete path exists).
- Rate limiting / tenant throttling may apply — expect occasional 429s under rapid repeated calls; retry with backoff rather than treating as a hard failure.
