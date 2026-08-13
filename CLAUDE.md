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

## Application Layer Deferral (permanent, no exceptions) — decided 2026-08-08

Do NOT implement any user-facing application (mobile, desktop, or otherwise) before the Sefay Core Platform is complete. This applies without exception to every application, including but not limited to:

- Mobile Inventory App
- Mobile POS / Cashier App
- Scanner Mobile App
- Attend App
- Employee App
- Customer App
- Any future frontend/mobile/desktop application

**Reason:** an application layer must only be built on top of a stable platform — business domains, database schema, APIs, permissions, authentication, workflows, notifications, integrations, and security rules all need to be settled first. Building an app against a still-moving core forces rework.

**Immediate consequence for the Sefay Universal Device Platform (#21):** Phases 1–7 (Architectural Audit, Database Foundation, Device Management, Scanner Event Engine, Resolver Engine, Adapter Framework, Action Framework, Authorization Completion Patch) are complete and remain **backend infrastructure only**. **Phase 8 (Mobile Scanner Application) and every later phase are on hold — do not start any mobile application work** until the Core Platform is declared complete.

**New execution priority, effective immediately:**
1. Audit current Sefay Core domains.
2. Identify missing business modules.
3. Create an execution roadmap for Core completion.
4. Complete backend/core architecture.
5. Validate: database, APIs, permissions, tests, runtime, documentation.
6. Only after Core completion does Application Layer work begin.

**Application implementation order, once Core completion is declared** (not before):
1. Android — mobile, tablet, touch POS, device integrations
2. iOS — iPhone, iPad
3. Windows — desktop/POS when required

No exceptions for "small" applications — every application, regardless of size or scope, follows this same rule.

This rule persists across every session, same as the Execution Gate above. Do not assume it has been superseded just because a later message discusses an application feature — remain in Core-only mode until an explicit Core Platform completion declaration is given.
