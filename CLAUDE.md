## Architectural approval protocol (permanent, no exceptions)

For any feature/migration that touches the database schema, the mandatory sequence is:

1. Architectural Audit
2. Database Design
3. Business Rules
4. State Machine
5. Migration Matrix
6. User review and approval
7. Implementation (migration files, `npm run migrate`, backend code)

**Never move from step 6 to step 7 automatically** — not even when every architectural note the user raised appears to have been addressed. Answering a design concern is not implicit approval. Implementation — writing any migration file, running `npm run migrate`, or writing backend code for the feature — only begins after the user sends an explicit approval message containing the literal phrase:

> **"Approved – Proceed with Implementation"**

This rule persists across every session. Do not assume an exception applies just because the conversation is long or the design looks mature.

See `STATUS.md` (top policy section) for the full engineering log and how it must be maintained.
