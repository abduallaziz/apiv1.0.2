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
