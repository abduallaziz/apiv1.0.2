# Migration release runbook (WP-C)

Audience: the owner, at a production migration window. Nothing here is activated by merging code:
every new behaviour is opt-in through an environment variable and defaults to today's behaviour.

Evidence labels: **VERIFIED** (proven locally or read in the repo), **INFERRED** (follows from verified facts),
**UNKNOWN** (not provable without touching production/hosted settings).

## 1. Facts this runbook is built on

| Fact | Label |
|---|---|
| `npm run start:prod` = `node dist/database/migrate.js && node dist/database/seeds/permissions.seed.js && node dist/main`; the runner applies every file of `src/database/migrations/` that `schema_migrations` does not list, in filename order, at every container start (`package.json`) | VERIFIED |
| Railway tracks `main`; a merge deploys immediately; "Wait for CI" is off; `railway.json` has no healthcheck; `API CI` ran only on push/PR to `main` with empty DB env | per the readiness report (owner-read settings) |
| A failing migration exits the process, Railway retries up to 3 times (`restartPolicyMaxRetries: 3`); with no healthcheck the previous deployment may already be stopped, so a bad file in `migrations/` is downtime | VERIFIED (code) / INFERRED (Railway behaviour) |
| New migrations live in `src/database/migrations_pending/`, which the runner never scans (it also refuses to scan any directory not named `migrations`) | VERIFIED (unit test) |
| How the hosted Supabase Management API treats a multi-statement request (atomic or not) | **UNKNOWN**. On plain Postgres a multi-statement simple query is atomic (VERIFIED locally); that is not proof for the hosted API. That is why `MIGRATION_TRANSACTION_MODE` defaults to `off`. |

## 2. New switches (all optional)

| Variable | Default (= today) | Effect |
|---|---|---|
| `MIGRATIONS_ON_BOOT` | `true` | `false`: the boot-time run (`start:prod`, plain `npm run migrate`) does nothing and exits 0. Only `--release` / `MIGRATION_RELEASE_JOB=true` (the release job) or `--dry-run` run. The permission seed in `start:prod` is a separate command and is unchanged. |
| `MIGRATION_TARGET_REF` | built-in project ref | Target project. Must be 20 chars and listed in the allow-list. |
| `MIGRATION_ALLOWED_REFS` | built-in ref only | Comma list of refs the runner may touch. Any other target: refusal, exit 2, nothing sent. |
| `MIGRATION_CHECKSUM_MODE` | `off` | `off`: no checksum columns, no bookkeeping (today). `record`: adds `checksum/applied_by/applied_from` to `schema_migrations` (`ADD COLUMN IF NOT EXISTS`), records the checksum of rows that predate checksums on first sight (never fails for them), warns if an applied file changed. `enforce`: same, and refuses (exit 3) if an applied file changed. Hash = SHA-256 of the file with CRLF normalised to LF. |
| `MIGRATION_TRANSACTION_MODE` | `off` | `auto`: each file (plus its `schema_migrations` row) is sent as one `BEGIN; ...; COMMIT;` request unless it has its own transaction control, `CONCURRENTLY`, `VACUUM`, `CREATE/DROP DATABASE`, `ALTER SYSTEM` or `ALTER TYPE .. ADD VALUE`; on failure the runner sends `ROLLBACK`. Validate on a scratch project before using it on production. |

CLI flags: `--dry-run` (reads `schema_migrations`, lists what would apply with short checksums, writes nothing, seeds nothing),
`--release` (marks a release-job run), `--no-seed` (skip the permission seed).
Exit codes: `0` ok, `1` other failure, `2` configuration/refusal, `3` checksum mismatch, `4` a migration's SQL failed.
npm scripts: `migrate`, `migrate:dry-run`, `migrate:release`, `migrations:lint`, `schema:drift`.

## 3. What merging the WP-C code does to production with NO variable set

- Boot: same sequence, same SQL (`CREATE TABLE IF NOT EXISTS schema_migrations`, `SELECT filename`, file, `INSERT .. ON CONFLICT DO NOTHING`), same logs (`✅ Applied: <file>`). No new column, no checksum write (VERIFIED by unit test "default mode = today").
- The seed module is now imported lazily (after migrations) instead of at start. Effect: with missing `SUPABASE_URL` the process fails after the migrations instead of before. INFERRED harmless.
- `api.yml` gains PR-only jobs; `migrations-release.yml` is `workflow_dispatch` only. Neither runs on push.

## 4. Per-window gate order (every time a migration is released)

Never skip or reorder. "Hold" means stop and wait for the owner.

| # | Gate | Who | Pass criterion |
|---|---|---|---|
| G0 | Freeze: no other merge to `main` during the window | owner | none queued |
| G1 | **Backup**: `powershell -ExecutionPolicy Bypass -File C:\web-analysis\findings\SEFAY_PHASE_1_WPA\RELEASE_B_SQL_PACKAGE\take-backup.ps1` (password typed hidden, never pasted). Record file name, size, time. Check it is readable: `docker run --rm -v C:\sefay-backups:/in:ro postgres:17 pg_restore -l /in/<file>` | owner | non-empty, lists tables |
| G2 | The migration PR: lint job green, `integration-tests` green, local rehearsal on the loopback DB applied **twice** (second run no-op) and its rollback exercised, owner review, label `migration-approved` | owner + reviewer | all green |
| G3 | Drift check against a fresh schema-only snapshot (section 6) | owner/engineer | no unexplained difference |
| G4 | **Dry run**: Actions -> "Migrations Release (manual, production)" -> Run workflow, `dry_run` = true (default). The `production` environment waits for the required reviewer. Read the list: it must be exactly the files you expect, in order, with no checksum mismatch | owner | list matches the PR |
| G5 | **Apply**: same workflow, `dry_run` = false. `MIGRATION_CHECKSUM_MODE=enforce` is hard-wired in the workflow. Leave `transaction_mode` = off until section 8 is done | owner | job green, log shows `✅ Applied:` per file |
| G6 | **Verify** (read-only): the release's verify SQL (e.g. RELEASE_B `30_verify_readonly.sql`), `schema_migrations` has the new rows with non-null `checksum`, app health OK | owner | as the release plan says |
| G7 | **Hold**: observation period; nothing else is released until the owner closes the window | owner | |

For a migration file that must run from the runner, moving it from `migrations_pending/` to `migrations/` is itself part of the approved PR (label `migration-approved`); no one moves files outside a window.

## 5. Final gate: settings the owner flips, in this order

The risk to avoid: a deploy that applies unreviewed SQL. Until step 5 below, every deploy still runs the runner on `migrations/`; the controls in that period are "new SQL only in `migrations_pending/`", the `migrations-approval` check and branch protection. After step 5 a deploy cannot apply SQL at all.

| Step | Setting | Where | Why in this position |
|---|---|---|---|
| 1 | Open the WP-C PR so every CI job runs once (check names only become selectable after a run) | GitHub | prerequisite for step 2 |
| 2 | **Branch protection on `main`**: require a PR, require status checks `TypeScript Build Check`, `Unit Tests (no database)`, `Migration lint (changed files)`, `No migration change without owner approval`, `Integration tests (local DB)`; no direct push; no force push; auto-merge off | GitHub -> Settings -> Branches | first, so nothing reaches `main` unchecked while the other steps are in progress |
| 3 | Merge the WP-C PR (deploys with defaults: behaviour unchanged, section 3) | GitHub / Railway | the new variables are ignored by older code, so the code must be live before step 5 |
| 4 | Create GitHub **Environment `production`** with required reviewer(s); add `SUPABASE_ACCESS_TOKEN` as an **environment** secret (never a repository secret). Optional environment variables: `MIGRATION_TARGET_REF`, `MIGRATION_ALLOWED_REFS` (leave unset to use the built-in ref). Then run the release workflow as a **dry run** and confirm it reports nothing to apply (or only the expected files) and no checksum mismatch | GitHub -> Settings -> Environments | proves the release path works before the boot path is closed; otherwise nothing could apply a later migration |
| 5 | **`MIGRATIONS_ON_BOOT=false`** in Railway variables, redeploy; the boot log must show `MIGRATIONS_ON_BOOT=false: skipping migrations at boot` | Railway -> Variables | only now is the boot path closed, and the release job is proven |
| 6 | Optional hardening: remove `SUPABASE_ACCESS_TOKEN` from Railway variables (the seed uses the service-role key, not this token; the running service then cannot apply SQL even by accident). Do this only after step 5 is verified | Railway -> Variables | removes the last place the token lives besides the protected environment |
| 7 | **Wait for CI = ON** (so a push to `main` deploys only after `API CI` passes) | Railway -> Service -> Settings -> Deploy | after steps 2-5; independent of migrations, protects against broken code |
| 8 | **Healthcheck path**: set the path of the liveness route. `GET /api/v1/health` (AppController, no DB) exists in code with global prefix `api/v1` (INFERRED; confirm with one `curl` against the deployed URL first). Do not use `/api/v1/health/db` (depends on the database) | Railway -> Service -> Settings -> Deploy | with a healthcheck the old deployment is kept if the new one does not come up |

Rollback of the final gate: step 5 -> delete the variable (or set `true`) and redeploy = exactly today's behaviour. Steps 2, 7, 8 are independent toggles.

## 6. Schema drift check (needs a schema-only snapshot, no data)

1. Snapshot (owner): `take-backup.ps1` (it is a `pg_dump -Fc` of schema `public`; the dump itself holds data, keep it local).
2. Extract the schema only: `docker run --rm -v C:\sefay-backups:/in:ro postgres:17 pg_restore -s -f - /in/<file> > schema.sql`.
3. `docker compose -p sefay-t1 -f test/local-db/docker-compose.yml up -d db` (use your own project name/port), then
   `LOCAL_DB_PORT=<port> node scripts/schema-drift.js --snapshot-sql schema.sql [--with-pending] [--json out.json] [--report-only]`.
   It builds two throw-away databases on the loopback server (it refuses any other host), compares tables, columns (type/not-null/default), constraints, indexes, functions, triggers, policies, RLS flags, views, sequences, enums, prints every difference by object and drops both databases.
4. Differences either become part of an idempotent baseline migration (`migrations_pending/331_schema_drift_baseline.sql`, see the WP-C report) or are explained and recorded.

## 7. Rollback

| Situation | Action |
|---|---|
| Dry run shows something unexpected (G4) | Do not apply. Fix the PR; nothing changed in production. |
| Release job fails at file N (G5) | The file is not recorded (runner stops, exit 4). Files before N stay applied and recorded. With `transaction_mode=off` a failing file's own effect depends on the hosted API's behaviour (UNKNOWN). Restore decision: forward-fix with a new idempotent migration, or run the migration's reviewed rollback block against production **through the SQL Editor by the owner**. Production data is never restored over a live database without a separate decision. |
| A change must be undone after G6 | Use that migration's tested rollback script (`migrations_pending/rollback/`). Exceptions are stated in each script. `331`'s rollback is for scratch databases only: on production 331 is a no-op, there is nothing to undo. |
| Catastrophic data problem | Restore from the G1 backup into a **separate** database first (privacy: real data is not restored into any other environment without specific approval), compare, then decide. |
| The new boot switch itself misbehaves | Railway: delete `MIGRATIONS_ON_BOOT` (or `true`) and redeploy. Code rollback: redeploy the previous deployment; the schema additions of the runner (`checksum*` columns) are additive and harmless to older code. |

## 8. Before ever using `MIGRATION_TRANSACTION_MODE=auto` on production

Run the release workflow once against a scratch Supabase project (not production) with a file that fails in its second statement and check that its first statement did not persist. Until then keep `off`. (Locally on plain Postgres this is proven: see `migration-runner.regression.spec.ts`.)

## 9. Not covered / residual

- The permission seed still runs at boot via `start:prod` (a separate command). Moving it to the release job is a separate, owner-approved change to `package.json`.
- Applied-file checksums can only be verified after the first `record`/`enforce` run has stored them; rows that predate this are recorded on first sight, so edits made **before** that moment are not detectable.
- `API CI` jobs `migration-lint`, `migrations-approval` and `integration-tests` run on pull requests only, by design.
