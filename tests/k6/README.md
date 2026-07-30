# Sefay load testing (k6)

Performance testing only. Nothing here changes business logic, database schema
or throttling configuration — the suite reads the system as it is and reports
what it finds.

## What was built from

Every endpoint, payload and constraint below was read out of the codebase, not
assumed. The load-bearing facts:

| Fact | Source |
|---|---|
| `ValidationPipe` runs with `forbidNonWhitelisted: true` — one extra body property is a 400 | `src/main.ts` |
| 600 requests/min per tenant | `src/core/security/throttler.config.ts` (`PER_TENANT_LIMIT`) |
| 30 login attempts/min per IP, **5 per email** | `throttler.config.ts`, `email-login-throttle.guard.ts` |
| A sale performs 12–18 sequential PostgREST round-trips | `src/modules/invoices/invoices.service.ts` |
| Sales deduct stock only when `branches.default_warehouse_id` is set **and** `items.has_inventory = true` | `043_pos_inventory_deduction.sql` |
| Stock writes serialise on `cost_layers ... FOR UPDATE` then `stock_levels` | `019_inventory_rpc_functions.sql` |
| Reports fetch whole result sets and aggregate in JS — no `GROUP BY` | `src/modules/reports/reports.service.ts` |
| The dashboard issues 11 parallel requests on mount | `sefayv1.0.2/src/features/dashboard/pages/DashboardOverview.tsx` |
| `/metrics` is `@Public()` and includes Node CPU/RSS/event-loop lag | `src/core/metrics/metrics.service.ts` |
| `/internal/perf-metrics` reports `avgDbQueries` per endpoint | `src/core/perf/perf-tracking.service.ts` |

## Data safety

All writes are test data and are tagged with the run ID through fields that
already exist on the DTOs:

- invoices → `notes` = `[LOADTEST:<RUN_ID>] ...`
- inventory adjustments → `reason` = `[LOADTEST:<RUN_ID>] ...`

To find everything a run created:

```sql
SELECT id, created_at, total FROM orders          WHERE notes  LIKE '[LOADTEST:%';
SELECT id, created_at        FROM stock_adjustments WHERE reason LIKE '[LOADTEST:%';
```

Note that `orders` — not `invoices` — is the table the invoices module writes to.

Reads are unrestricted; writes are limited to invoices and inventory
adjustments. Nothing is deleted or updated.

## Setup

```bash
# k6 (linux/amd64)
curl -sSL https://github.com/grafana/k6/releases/download/v0.54.0/k6-v0.54.0-linux-amd64.tar.gz \
  | tar xz && sudo mv k6-v0.54.0-linux-amd64/k6 /usr/local/bin/
```

Required environment:

```bash
export API_URL='https://<api-host>/api/v1'    # note the /api/v1 suffix

# One account:
export K6_EMAIL='loadtest@example.com'
export K6_PASSWORD='...'

# Or several — strongly preferred, see "Rate limits" below:
export ACCOUNTS='[{"email":"a@x.com","password":"..."},{"email":"b@y.com","password":"..."}]'
```

## LOAD_TEST_MODE (temporary)

Set on the API service for the duration of a test run:

```
LOAD_TEST_MODE=true
```

While enabled, every rate limit is bypassed:

| Limit | Normally | With the flag |
|---|---|---|
| per-tenant | 600 req/min | bypassed |
| per-IP | tenants × 600/min | bypassed |
| auth | 30 logins/min per IP | bypassed |
| session | 60 refresh/logout per min | bypassed |
| per-email login | 5 attempts/min | bypassed |

How it is implemented (`src/core/security/load-test-mode.ts`):

- **Nothing is removed or reconfigured.** Every guard, bucket and limit is
  untouched. Two early-exit checks were added in front of them —
  `TenantThrottlerGuard.shouldSkip()` and
  `EmailLoginThrottleGuard.canActivate()`. `ThrottlerGuard` evaluates
  `shouldSkip()` before iterating its named throttlers, so one exit covers
  `global`, `global-ip`, `auth` and `session`.
- **Off by default.** An environment that does not set the variable behaves
  exactly as it did before the flag existed.
- **Fails closed.** Only the literal string `true` enables it. `TRUE`, `1`,
  `yes` and empty all leave limits fully active, and the Joi schema rejects
  anything other than `true`/`false` at boot.
- **Announces itself.** A warning banner is logged at startup whenever the flag
  is on, with an extra line when `NODE_ENV=production`.
- **Leaves no residue.** The bypass returns before any Redis write, so no
  counter is consumed. Unsetting the flag resumes limiting from a clean window
  rather than a pre-exhausted one.

Authentication, authorization, tenant scoping and validation are unaffected: a
request that skips throttling still passes through `JwtAuthGuard`,
`TenantGuard`, `PermissionGuard` and the global `ValidationPipe`.

**While the flag is on there is no brute-force protection on `/auth/login`.**
Keep it on only for the duration of a run, and only in an environment with no
real customer data. To disable, remove the variable and redeploy — no code
change is needed.

## Rate limits matter more than VU count

**This section applies when `LOAD_TEST_MODE` is NOT set.** With the flag on,
limits are bypassed entirely and a single account is enough for any VU count;
`headroomReport()` will still print its warning, which can be ignored in that
case.

The consequence of running with limits active has to be planned for rather than
discovered mid-run:

**One tenant = 600 req/min = 10 req/s, total, across all VUs.**

A single load-phase iteration issues roughly 15 requests. At 50 VUs that is
well past the budget within seconds, and from that point the run measures the
throttler rather than the application.

The suite handles this the only way that does not involve changing config:
spreading load across accounts in **different tenants**. Two users of the same
tenant share one bucket, so what matters is distinct tenants, not distinct
logins.

| Phase | VUs | Distinct tenants for a clean read |
|---|---|---|
| 1 Smoke | 5 | 1 is fine |
| 2 Normal | 50 | 8–10 |
| 3 Stress | 100 / 250 | 20+ |
| 4 Inventory | 40 | 1 — contention is the point |

`headroomReport()` prints the computed budget at the start of every run and
warns explicitly when the configuration guarantees a throttled result. If
fewer tenants are available than recommended, the run is still useful — the
429 rate itself answers "how many users can one tenant carry?" — but it will
not find the application's own ceiling.

Logins happen once in `setup()`, spaced 2.5s apart to stay inside the 30/min
auth bucket, and the tokens are handed to the VUs. No VU ever logs in.

## Running the phases

Run each phase with the metrics collector alongside it, in a second terminal:

```bash
export K6_TOKEN='<an access token>'   # for /internal/perf-metrics
node tests/k6/tools/collect-metrics.js watch --out reports/phase1.json
```

Then, in the first terminal:

```bash
# Phase 1 — Smoke: 5 VUs, 2 min, read-only
k6 run tests/k6/smoke.js

# Phase 2 — Normal load: ramp to 50 VUs, 10 min, full journey with writes
k6 run tests/k6/load.js

# Phase 3 — Stress: 100 then 250 VUs
k6 run tests/k6/stress.js
k6 run -e MAX_VUS=100 tests/k6/stress.js    # stop at 100 instead

# Phase 4 — Inventory concurrency
k6 run tests/k6/inventory.js
```

Stop the collector with Ctrl-C when k6 finishes; it writes its JSON report and
prints a layer-attribution reading.

Run the phases in order and stop if a phase fails badly — 250 VUs against a
system that already struggles at 50 produces noise, not information.

## Running Phase 1 from GitHub Actions

`.github/workflows/k6-smoke-test.yml` runs the smoke phase from a GitHub
runner, which is useful when the machine you are working from cannot reach the
deployed API.

Configure three repository secrets under **Settings → Secrets and variables →
Actions**:

| Secret | Value |
|---|---|
| `API_URL` | e.g. `https://<service>.up.railway.app/api/v1` — include the `/api/v1` suffix |
| `K6_EMAIL` | test account email |
| `K6_PASSWORD` | test account password |

Then **Actions → k6 Smoke Test → Run workflow**. It is `workflow_dispatch` only
— it authenticates against a live environment and consumes that tenant's
rate-limit budget, so it is not wired to push or pull_request.

Results appear in two places: a rendered table in the run's job summary (total
requests, p95, error rate, breached thresholds, CPU/RAM, slowest endpoints), and
a `k6-smoke-results-<run>` artifact containing `summary.json`, `console.log` and
`server-metrics.json`.

### Artifacts are sanitized before upload

`k6 run --summary-export` embeds whatever `setup()` returned under a
`setup_data` key. Our `setup()` returns the logged-in sessions so VUs can share
them, so that file contains **live JWT access tokens**. Workflow artifacts are
downloadable by anyone with repo read access and are retained for weeks, so the
raw file is written to `$RUNNER_TEMP` — never into the uploaded directory — and
`tools/sanitize-results.js` produces the published copy.

GitHub's secret masking does not cover this: it only redacts configured secrets,
and only in the live log view. Files written by `tee` never pass through the
masker.

The sanitizer drops `setup_data`, redacts credential-bearing keys at any depth,
scrubs the literal `API_URL` and `K6_EMAIL` values, and **fails the step** if
anything JWT-shaped or a long hex string survives — a red build is cheaper than
a leaked token in a downloadable artifact.

## Thresholds

```
p95 < 500ms    reads   (kind:read)
p95 < 1500ms   writes  (kind:write)
p95 < 2000ms   reports (kind:report) and auth (kind:auth)
error rate < 1%
no request over 30s
checks > 99%
```

Reads and writes are held to different bars deliberately. `POST /invoices`
makes 12–18 sequential round-trips by design; holding it to a read's 500ms
would fail every run for an architectural reason and bury the findings that
matter. Auth gets 2000ms because `bcryptjs` at cost 12 is pure JS on a
single-threaded process.

Phase 3 records thresholds but does not enforce them — running past the point
of failure is the entire purpose of that phase.

### What counts as a failure

`http_req_failed` counts genuine faults only. Two statuses are excluded:

- **429** — throttling is configured behaviour, tracked separately on
  `throttled_429` and `throttled_rate`. Counting it as an error would turn the
  error-rate threshold into a throttle detector.
- **404 on barcode lookup only** — a miss is a valid answer there.

Everything else (other 4xx, all 5xx, timeouts) still fails.

## Reading the results: backend, database, or frontend

k6 alone cannot tell these apart — it only sees latency from outside. The
collector supplies the other half:

| Evidence | Reading |
|---|---|
| Event-loop lag p99 high (>100ms) | **Backend.** One Node process, no cluster mode. `bcryptjs` and JS report aggregation both compete for that thread. |
| Lag low, `avgDbQueries` high (>8) | **Database access pattern.** Round-trip count dominates, not query execution. `POST /invoices` sits here by construction. |
| Lag low, `avgDbQueries` low, latency still high | **Database.** Individual queries are slow — take the endpoint to `EXPLAIN ANALYZE`. |
| Latency only via the web origin | **Frontend/proxy.** The Vercel rewrite hop. Compare by pointing `API_URL` at each origin in turn. |

k6 never exercises the frontend. Requests go straight to the API unless
`API_URL` is set to the web origin, in which case the Next.js rewrite
(`next.config.ts`) proxies them and the difference between the two runs is the
proxy's cost.

## Per-phase report template

```
Phase:              
Target / origin:    
Virtual users:      
Duration:           
Distinct tenants:   

Requests:           total / per second
Avg response time:  
p95 latency:        overall, and split read / write / report
Error rate:         excluding 429
Throttled (429):    count and rate
Slowest endpoint:   from /internal/perf-metrics, with avgDbQueries

CPU utilisation:    core-seconds per second
Peak RSS / heap:    
Event-loop lag p99: 

Bottleneck:         backend / database / access pattern / proxy — with the
                    evidence above, not an assertion
```

## Files

```
tests/k6/
  config.js                  target, thresholds, auth, discovery, tagging
  smoke.js                   Phase 1
  load.js                    Phase 2
  stress.js                  Phase 3
  inventory.js               Phase 4 — contended vs spread comparison
  tools/collect-metrics.js   server-side CPU / RAM / lag / per-endpoint sampler
```

`config.js` discovers branch, warehouse, items, customers and the open shift
from the live API at setup time rather than carrying fixtures, so the suite
exercises whatever data actually exists in the target environment and fails
loudly when a precondition is missing.
