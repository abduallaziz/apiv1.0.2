## Architectural approval protocol (permanent, no exceptions)

For any feature/migration that touches the database schema, the mandatory sequence is:

1. Architectural Audit
2. Database Design
3. Business Rules
4. State Machine
5. Migration Matrix
6. User review and approval
7. Implementation (migration files, `npm run migrate`, backend code)

### Execution Gate (Mandatory)

Current Phase for any design under review: **Architecture Review Only**, until the exact approval message is received:

> **"Approved – Proceed with Implementation"**

Until that exact message arrives, remain in review mode. The following are strictly prohibited before explicit approval:

- Creating or modifying migration files.
- Writing DDL.
- Creating or modifying backend code.
- Creating Controllers, Services, Repositories, DTOs, APIs, or Tests.
- Modifying any project file (beyond documenting the design itself, e.g. STATUS.md/CLAUDE.md).
- Generating implementation patches.
- Assuming approval because all comments appear resolved.

Your responsibility during review mode is limited to:

- Architectural Audit
- Database Design
- Business Rules
- State Machine
- Migration Matrix
- Answering review comments
- Updating the proposed design

Approval is never implicit. Only the exact message **"Approved – Proceed with Implementation"** authorizes implementation.

If there is any uncertainty, remain in review mode and ask for clarification rather than proceeding.

This rule persists across every session — do not assume an exception applies just because the conversation is long or the design looks mature.

See `STATUS.md` (top policy section) for the full engineering log and how it must be maintained.

## Sequential Execution Order (Mandatory, no exceptions)

Any multi-item roadmap/plan (e.g. the 24-point Inventory scope) MUST be executed strictly in item order: 1, then 2, then 3, ... with each item taken to **100% completion** before starting the next one.

- Never skip ahead to a later item while an earlier one is still partial ("جزئي").
- Never work on multiple items in parallel or interleave them.
- If an earlier item is discovered to be incomplete while working on a later one, the later item must still be finished to 100% first (per explicit user decision on 2026-07-26), then execution returns to strict 1→2→3→... order from the first incomplete item — it does not jump to wherever the plan "logically" continues.
- Status reporting for a multi-item plan must use exactly three buckets — **مكتمل 100%**, **جزئي**, **لم يُبنَ** — never vaguer wording, and must be presented as one single sequential list (by the plan's own item numbers) unless the user explicitly asks for a different grouping.

This rule persists across every session, same as the Execution Gate above.

## Application / Mobile Execution Rule (supersedes the former "Application Layer Deferral") — updated 2026-08-20

Frontend, Mobile, and Application-layer work is **not globally deferred**. An Application-layer capability may be implemented once its required contracts and dependencies are ready — execution order is determined by actual dependency graphs, not by a global "Core Platform complete" gate.

**Before implementing any Frontend/Mobile capability, verify:**
1. Required backend API exists, or is explicitly part of the same approved implementation phase.
2. Required DTO/API contracts are defined.
3. Authorization and tenant/branch/warehouse rules are defined.
4. Required business logic is approved and stable enough for the feature.
5. Required database/schema dependencies exist, or are included in the same approved phase.
6. The feature has an explicit Source-of-Truth specification.
7. Runtime validation can be performed.
8. No known architectural blocker exists.

If all eight are satisfied, Application/Mobile implementation is allowed for that capability.

**Architectural safety is unchanged by this rule.** Removing the global gate does NOT mean:
- frontend may invent business logic or API contracts
- frontend may bypass authorization or tenant/branch/warehouse scope
- frontend may create fake data or a second Source of Truth
- frontend may implement business logic independently of backend
- mobile clients may bypass Device Platform contracts

Sefay's backend remains the sole Source of Truth; Frontend/Mobile only consumes approved backend contracts.

**Mobile applications** are treated as a normal Application Layer capability, gated per-feature on the 8-point check above — e.g. Mobile Warehouse is allowed once warehouse APIs, barcode/device contracts, authorization, and sync/idempotency behavior exist. A mobile app must never be blocked solely because an unrelated Core Platform capability elsewhere remains unfinished.

**Device Platform backend and Mobile Device integration** may evolve together once their contracts are defined: `Device Backend → Device Contract → Mobile Consumer`, not `Core Platform Complete → Mobile allowed`.

**Dependency-first execution** for every Application/Mobile feature: `Dependency Audit → Contract Validation → Authorization Validation → Implementation → Runtime Validation`.

**Scope control is unchanged.** All Application/Mobile work still follows: `Architectural Audit → Migration Matrix → Execution Protocol → Validation Gates`. No architecture or business-logic change without approval, per the Architectural Approval Protocol above.

> Application and Mobile layers are not globally deferred. They may be implemented when their required contracts, authorization, dependencies, and validation paths are ready. Application work must consume Sefay's approved backend contracts and may not invent or duplicate business logic.

This rule persists across every session, same as the Execution Gate above.
