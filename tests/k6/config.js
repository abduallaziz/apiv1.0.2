// Shared configuration, auth handling and discovery helpers for every k6 phase.
//
// Design constraints taken directly from the codebase (not assumed):
//
//  - The global ValidationPipe runs with `forbidNonWhitelisted: true`
//    (src/main.ts), so every request body here matches its DTO exactly. One
//    stray property is a 400, not a warning.
//  - `EmailLoginThrottleGuard` allows 5 login attempts per email per minute
//    and the `auth` throttler allows 30/min per IP (core/security/*). k6 runs
//    from one IP, so every VU logging in independently is not viable — tokens
//    are minted once in setup() and handed to the VUs.
//  - `PER_TENANT_LIMIT` is 600 req/min per tenant (core/security/throttler.config.ts).
//    Limits are deliberately left untouched, so headroom comes from spreading
//    load across several accounts/tenants instead. See headroomReport().
//  - Every write is tagged with RUN_ID through fields that already exist on
//    the DTOs (`notes` on invoices, `reason` on adjustments) so the rows this
//    suite creates stay identifiable afterwards.

import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

// Trailing slashes stripped so `${BASE_URL}/auth/login` never doubles up.
export const BASE_URL = (__ENV.API_URL || 'http://localhost:3001/api/v1').replace(/\/+$/, '');

// Prometheus endpoint lives at the API root and is @Public() — no auth needed.
// Derived from BASE_URL so a single API_URL env var configures everything.
export const METRICS_URL = BASE_URL + '/metrics';
export const PERF_METRICS_URL = BASE_URL + '/internal/perf-metrics';

export const RUN_ID = __ENV.RUN_ID || 'k6-' + Date.now();
export const LOADTEST_TAG = '[LOADTEST:' + RUN_ID + ']';

// ---------------------------------------------------------------------------
// What counts as a failed request
// ---------------------------------------------------------------------------

// k6 marks every non-2xx response as a failure by default, which would make
// `http_req_failed` useless here for two reasons:
//
//   429 — throttling limits are deliberately left unchanged, so at higher VU
//         counts a 429 is the system behaving exactly as configured. Counting
//         it as an error would turn the error-rate threshold into a throttle
//         detector and hide real faults behind it. Throttling is tracked on
//         its own `throttled_429` / `throttled_rate` metrics instead.
//
//   404 — only on the barcode lookup, where a miss is a valid answer. Applied
//         per-request via EXPECTED_WITH_404, never globally.
//
// Everything else — 4xx, 5xx, timeouts — still counts as a failure, which is
// what the <1% threshold is meant to police.
export const EXPECTED_STATUSES = http.expectedStatuses({ min: 200, max: 299 }, 429);
export const EXPECTED_WITH_404 = http.expectedStatuses({ min: 200, max: 299 }, 404, 429);

http.setResponseCallback(EXPECTED_STATUSES);

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

// 429s are counted separately and excluded from the failure rate: with limits
// intentionally unchanged, a throttled request is the system behaving as
// designed, not an error. Mixing them into http_req_failed would make the
// error-rate threshold measure the throttler instead of the application.
export const throttled = new Counter('throttled_429');
export const throttleRate = new Rate('throttled_rate');

// Business-flow timings, separate from raw HTTP timings, because one logical
// "action" can be several requests (the dashboard is 11).
export const dashboardFlow = new Trend('flow_dashboard_ms', true);
export const saleFlow = new Trend('flow_create_sale_ms', true);
export const reportFlow = new Trend('flow_reports_ms', true);
export const adjustmentFlow = new Trend('flow_adjustment_ms', true);

export const businessErrors = new Counter('business_errors');

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

// Reads and writes are held to different bars on purpose. `POST /invoices`
// performs 12-18 sequential PostgREST round-trips by design
// (modules/invoices/invoices.service.ts) — holding it to the same 500ms as a
// cached list read would fail on every run for a reason that is architectural,
// not a regression, and would drown out the findings that matter.
export const baseThresholds = {
  'http_req_duration{kind:read}': ['p(95)<500'],
  'http_req_duration{kind:write}': ['p(95)<1500'],
  'http_req_duration{kind:auth}': ['p(95)<2000'], // bcryptjs cost 12, single-threaded
  'http_req_duration{kind:report}': ['p(95)<2000'],
  'http_req_failed': ['rate<0.01'],
  'http_req_duration': ['max<30000'], // no request may hang to a timeout
  'checks': ['rate>0.99'],
};

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * Accounts come from the environment, never from a file committed to the repo.
 *
 *   ACCOUNTS='[{"email":"a@x.com","password":"..."},{"email":"b@y.com","password":"..."}]'
 *
 * or, for a single account:
 *
 *   K6_EMAIL=a@x.com K6_PASSWORD=...
 */
export function loadAccounts() {
  if (__ENV.ACCOUNTS) {
    const parsed = JSON.parse(__ENV.ACCOUNTS);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('ACCOUNTS must be a non-empty JSON array of {email, password}');
    }
    return parsed;
  }
  if (__ENV.K6_EMAIL && __ENV.K6_PASSWORD) {
    return [{ email: __ENV.K6_EMAIL, password: __ENV.K6_PASSWORD }];
  }
  throw new Error(
    'No credentials supplied. Set ACCOUNTS as JSON, or K6_EMAIL + K6_PASSWORD.'
  );
}

/**
 * Reports how much request budget the supplied accounts actually buy, so a run
 * that is really measuring the throttler is obvious from the console output
 * rather than looking like a latency cliff.
 *
 * PER_TENANT_LIMIT is 600/min. Distinct tenants matter, not distinct accounts:
 * two users of the same tenant share one bucket.
 */
export function headroomReport(sessions, targetVus) {
  const tenants = {};
  for (let i = 0; i < sessions.length; i++) {
    tenants[sessions[i].tenantId] = true;
  }
  const distinctTenants = Object.keys(tenants).length;
  const budgetPerMin = distinctTenants * 600;
  const budgetPerSec = Math.round(budgetPerMin / 60);

  console.log('--- rate-limit headroom -------------------------------------');
  console.log('  accounts logged in : ' + sessions.length);
  console.log('  distinct tenants   : ' + distinctTenants);
  console.log('  budget             : ' + budgetPerMin + ' req/min (' + budgetPerSec + ' req/s)');
  console.log('  peak VUs           : ' + targetVus);
  if (distinctTenants === 1 && targetVus > 10) {
    console.log('  WARNING: one tenant caps this run at ~10 req/s. Expect 429s to');
    console.log('           dominate above ~10 VUs. Results measure the throttler,');
    console.log('           not the application. Supply more tenants for headroom.');
  }
  console.log('-------------------------------------------------------------');

  return { distinctTenants: distinctTenants, budgetPerMin: budgetPerMin };
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Logs one account in. Runs in setup() only — never per-VU.
 *
 * Returns a session: { email, token, userId, tenantId, role }.
 */
export function login(account) {
  const res = http.post(
    BASE_URL + '/auth/login',
    JSON.stringify({
      email: account.email,
      password: account.password,
      // Required by LoginDto (@IsString, not optional).
      device_name: 'k6-' + RUN_ID,
    }),
    { headers: JSON_HEADERS, tags: { kind: 'auth', name: 'POST /auth/login' } }
  );

  if (res.status === 429) {
    throw new Error(
      'Login for ' + account.email + ' was throttled (429). The auth bucket is ' +
      '30/min per IP and 5/min per email — slow the setup stagger or use fewer accounts.'
    );
  }
  if (res.status !== 200) {
    throw new Error(
      'Login failed for ' + account.email + ': HTTP ' + res.status + ' ' + res.body
    );
  }

  const body = res.json();
  return {
    email: account.email,
    token: body.access_token,
    userId: body.user.id,
    tenantId: body.user.tenant_id,
    role: body.user.role,
  };
}

/**
 * Logs every account in, spaced out to stay inside the auth throttler.
 *
 * The `auth` bucket is 30/min per IP and k6 runs from one IP, so logins are
 * spaced 2.5s apart (24/min) to leave margin. With many accounts this makes
 * setup slow — set `setupTimeout` accordingly in each scenario's options.
 */
export function loginAll(accounts) {
  const sessions = [];
  for (let i = 0; i < accounts.length; i++) {
    if (i > 0) {
      sleep(2.5);
    }
    sessions.push(login(accounts[i]));
  }
  return sessions;
}

export function authHeaders(session, branchId) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + session.token,
  };
  if (branchId) {
    // TenantGuard validates x-branch-id against the tenant on every request
    // that carries it (core/tenant/tenant.guard.ts -> BranchValidatorService).
    headers['x-branch-id'] = branchId;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Reads the IDs the write scenarios need out of the live API instead of
 * hardcoding fixtures. This is what keeps the suite honest: it exercises
 * whatever data actually exists in the target environment.
 *
 * Returns a context: { branchId, warehouseId, items[], customerIds[], shiftId }.
 */
export function discoverContext(session) {
  const headers = authHeaders(session);
  const ctx = {
    branchId: null,
    warehouseId: null,
    items: [],
    customerIds: [],
    shiftId: null,
    warnings: [],
  };

  // --- branch ---------------------------------------------------------------
  const branchRes = http.get(BASE_URL + '/branches', {
    headers: headers,
    tags: { kind: 'read', name: 'GET /branches' },
  });
  if (branchRes.status !== 200) {
    throw new Error('Discovery failed at GET /branches: HTTP ' + branchRes.status);
  }
  const branches = branchRes.json();
  if (!branches || branches.length === 0) {
    throw new Error('Tenant ' + session.tenantId + ' has no branches — cannot create invoices.');
  }

  // Prefer a branch with default_warehouse_id set. Without it,
  // InvoicesService.create() skips stock deduction entirely
  // (043_pos_inventory_deduction.sql), so the sale would silently never touch
  // inventory and the invoice phase would measure half the work it looks like.
  let branch = null;
  for (let i = 0; i < branches.length; i++) {
    if (branches[i].default_warehouse_id) {
      branch = branches[i];
      break;
    }
  }
  if (!branch) {
    branch = branches[0];
    ctx.warnings.push(
      'No branch has default_warehouse_id set — sales will NOT deduct stock. ' +
      'The invoice numbers below exclude the cost-layer/stock-movement path.'
    );
  }
  ctx.branchId = branch.id;
  ctx.warehouseId = branch.default_warehouse_id || null;

  // --- warehouse fallback ---------------------------------------------------
  const whRes = http.get(BASE_URL + '/inventory/warehouses', {
    headers: headers,
    tags: { kind: 'read', name: 'GET /inventory/warehouses' },
  });
  if (whRes.status === 200) {
    const warehouses = whRes.json();
    if (warehouses && warehouses.length > 0) {
      // Adjustments need a warehouse even when the branch has no default.
      if (!ctx.warehouseId) {
        ctx.warehouseId = warehouses[0].id;
      }
    }
  }
  if (!ctx.warehouseId) {
    ctx.warnings.push('No warehouse found — inventory adjustment scenarios will be skipped.');
  }

  // --- items ----------------------------------------------------------------
  // per_page is capped at 100 server-side (shared/dto/pagination.dto.ts).
  const itemsRes = http.get(BASE_URL + '/items?page=1&per_page=100', {
    headers: headers,
    tags: { kind: 'read', name: 'GET /items' },
  });
  if (itemsRes.status !== 200) {
    throw new Error('Discovery failed at GET /items: HTTP ' + itemsRes.status);
  }
  const items = itemsRes.json();
  for (let i = 0; i < items.length; i++) {
    // Parent items with variants are never sold directly — POS routes them
    // through the variant picker (see items.service.ts create()), and sending
    // one as a line item does not reflect a real sale.
    if (items[i].has_variants) {
      continue;
    }
    ctx.items.push({
      id: items[i].id,
      name: items[i].name,
      price: items[i].price || 1,
      hasInventory: items[i].has_inventory === true,
    });
  }
  if (ctx.items.length === 0) {
    throw new Error('Tenant ' + session.tenantId + ' has no sellable items — cannot create invoices.');
  }

  const inventoryItems = ctx.items.filter(function (i) { return i.hasInventory; });
  if (inventoryItems.length === 0) {
    ctx.warnings.push(
      'No item has has_inventory=true — sales will not touch stock_levels/cost_layers ' +
      'even with a default warehouse configured.'
    );
  }

  // --- customers ------------------------------------------------------------
  const custRes = http.get(BASE_URL + '/customers?page=1&limit=20', {
    headers: headers,
    tags: { kind: 'read', name: 'GET /customers' },
  });
  if (custRes.status === 200) {
    const customers = custRes.json();
    for (let i = 0; i < customers.length; i++) {
      ctx.customerIds.push(customers[i].id);
    }
  }

  // --- current shift --------------------------------------------------------
  // shift_id is optional on CreateInvoiceDto; sales are recorded either way.
  const shiftRes = http.get(BASE_URL + '/shifts/current?branch_id=' + ctx.branchId, {
    headers: headers,
    tags: { kind: 'read', name: 'GET /shifts/current' },
  });
  if (shiftRes.status === 200 && shiftRes.body && shiftRes.body !== 'null') {
    const shift = shiftRes.json();
    if (shift && shift.id) {
      ctx.shiftId = shift.id;
    }
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/**
 * Records a response against the throttle counters and reports whether it
 * should count as a business success.
 *
 * A 429 is neither a success nor a failure — it is the documented behaviour of
 * an unchanged throttler and is tracked on its own metric.
 */
export function classify(res) {
  const is429 = res.status === 429;
  throttleRate.add(is429);
  if (is429) {
    throttled.add(1);
    return 'throttled';
  }
  if (res.status >= 200 && res.status < 300) {
    return 'ok';
  }
  businessErrors.add(1);
  return 'error';
}

export function isOk(res) {
  return classify(res) === 'ok';
}

/** Picks a pseudo-random element, seeded off the VU so runs stay varied. */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
