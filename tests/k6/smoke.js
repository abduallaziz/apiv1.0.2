// Phase 1 — Smoke test.
//
// Goal: confirm the system works and the suite's own assumptions hold, before
// any load is applied. 5 VUs / 2 minutes.
//
// Covers: authentication, dashboard, products, customers, reports (read-only).
// No writes at all — the first phase must never be the one that discovers a
// write path is broken under concurrency.
//
//   k6 run tests/k6/smoke.js
//
// Required env: API_URL and either ACCOUNTS or K6_EMAIL/K6_PASSWORD.

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import {
  BASE_URL,
  baseThresholds,
  authHeaders,
  classify,
  dashboardFlow,
  discoverContext,
  headroomReport,
  isOk,
  loadAccounts,
  loginAll,
  pick,
} from './config.js';

export const options = {
  vus: 5,
  duration: '2m',
  // Logins are staggered 2.5s apart to stay inside the 30/min auth bucket.
  setupTimeout: '300s',
  thresholds: baseThresholds,
};

export function setup() {
  const accounts = loadAccounts();
  const sessions = loginAll(accounts);
  const ctx = discoverContext(sessions[0]);

  headroomReport(sessions, options.vus);

  console.log('--- discovered context --------------------------------------');
  console.log('  branch     : ' + ctx.branchId);
  console.log('  warehouse  : ' + (ctx.warehouseId || 'none'));
  console.log('  items      : ' + ctx.items.length);
  console.log('  customers  : ' + ctx.customerIds.length);
  console.log('  shift      : ' + (ctx.shiftId || 'none open'));
  for (let i = 0; i < ctx.warnings.length; i++) {
    console.log('  WARNING    : ' + ctx.warnings[i]);
  }
  console.log('-------------------------------------------------------------');

  return { sessions: sessions, ctx: ctx };
}

export default function (data) {
  const session = data.sessions[__VU % data.sessions.length];
  const ctx = data.ctx;
  const headers = authHeaders(session, ctx.branchId);

  group('auth', function () {
    // /auth/me is the cheapest authenticated call — it proves the token is
    // valid without touching any business table.
    const res = http.get(BASE_URL + '/auth/me', {
      headers: headers,
      tags: { kind: 'read', name: 'GET /auth/me' },
    });
    check(res, { 'auth/me is 200': function (r) { return r.status === 200; } });
    classify(res);
  });

  group('dashboard', function () {
    // The real dashboard fires these in parallel on mount
    // (DashboardOverview.tsx). http.batch reproduces that concurrency rather
    // than serialising it, which is what the server actually sees.
    const started = Date.now();
    const responses = http.batch([
      ['GET', BASE_URL + '/reports/revenue?period=today', null, { headers: headers, tags: { kind: 'report', name: 'GET /reports/revenue' } }],
      ['GET', BASE_URL + '/reports/payments?period=today', null, { headers: headers, tags: { kind: 'report', name: 'GET /reports/payments' } }],
      ['GET', BASE_URL + '/reports/expenses?period=today', null, { headers: headers, tags: { kind: 'report', name: 'GET /reports/expenses' } }],
      ['GET', BASE_URL + '/reports/sparklines', null, { headers: headers, tags: { kind: 'report', name: 'GET /reports/sparklines' } }],
      ['GET', BASE_URL + '/reports/top-items?period=today', null, { headers: headers, tags: { kind: 'report', name: 'GET /reports/top-items' } }],
      ['GET', BASE_URL + '/reports/recent-activity', null, { headers: headers, tags: { kind: 'report', name: 'GET /reports/recent-activity' } }],
      ['GET', BASE_URL + '/customers/stats', null, { headers: headers, tags: { kind: 'read', name: 'GET /customers/stats' } }],
      ['GET', BASE_URL + '/items?page=1&per_page=50', null, { headers: headers, tags: { kind: 'read', name: 'GET /items' } }],
      ['GET', BASE_URL + '/shifts/current?branch_id=' + ctx.branchId, null, { headers: headers, tags: { kind: 'read', name: 'GET /shifts/current' } }],
    ]);
    dashboardFlow.add(Date.now() - started);

    let allOk = true;
    for (let i = 0; i < responses.length; i++) {
      if (!isOk(responses[i])) {
        allOk = false;
      }
    }
    check(null, { 'dashboard batch fully served': function () { return allOk; } });
  });

  group('products', function () {
    const list = http.get(BASE_URL + '/items?page=1&per_page=50', {
      headers: headers,
      tags: { kind: 'read', name: 'GET /items' },
    });
    check(list, { 'items list is 200': function (r) { return r.status === 200; } });

    if (isOk(list)) {
      const item = pick(ctx.items);
      const detail = http.get(BASE_URL + '/items/' + item.id, {
        headers: headers,
        tags: { kind: 'read', name: 'GET /items/:id' },
      });
      check(detail, { 'item detail is 200': function (r) { return r.status === 200; } });
      classify(detail);
    }
  });

  group('customers', function () {
    const list = http.get(BASE_URL + '/customers?page=1&limit=20', {
      headers: headers,
      tags: { kind: 'read', name: 'GET /customers' },
    });
    check(list, { 'customers list is 200': function (r) { return r.status === 200; } });
    classify(list);

    // Server-side search: leading-wildcard ILIKE across full_name/phone plus a
    // second unbounded query for order stats (customers.repository.ts).
    const search = http.get(BASE_URL + '/customers?page=1&limit=20&search=a', {
      headers: headers,
      tags: { kind: 'read', name: 'GET /customers?search' },
    });
    check(search, { 'customer search is 200': function (r) { return r.status === 200; } });
    classify(search);
  });

  group('inventory-read', function () {
    if (!ctx.warehouseId) {
      return;
    }
    const levels = http.get(
      BASE_URL + '/inventory/stock/levels?warehouse_id=' + ctx.warehouseId,
      { headers: headers, tags: { kind: 'read', name: 'GET /inventory/stock/levels' } }
    );
    check(levels, { 'stock levels is 200': function (r) { return r.status === 200; } });
    classify(levels);
  });

  sleep(1);
}
