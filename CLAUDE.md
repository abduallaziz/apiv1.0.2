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

After every Architectural Audit, Database Design, Business Rules, State Machine, and Migration Matrix:

- Never assume approval.
- Never create migrations.
- Never create backend code.
- Never generate DDL.
- Never modify project files.

Wait until the user explicitly responds with:

> **"Approved – Proceed with Implementation"**

Only after this exact approval may implementation begin.

If the approval is not explicit, remain in design/review mode regardless of whether all comments appear resolved. Answering a design concern is not implicit approval — do not move from step 6 to step 7 on your own judgment, no matter how mature the design looks or how long the review has gone on.

This rule persists across every session.

See `STATUS.md` (top policy section) for the full engineering log and how it must be maintained.
