// Phase 3 — Stress test.
//
// Goal: find the breaking point. Steps through 100 and 250 VUs, holding at
// each so the plateau (or the collapse) is visible per step rather than
// smeared across a continuous ramp.
//
// Thresholds are NOT abort-on-fail here: the point of this phase is to run
// past the point where they fail and record what happens next. The pass/fail
// verdict comes from Phase 1 and Phase 2.
//
//   k6 run tests/k6/stress.js
//
// To stop at 100 VUs instead of going to 250:
//   k6 run -e MAX_VUS=100 tests/k6/stress.js

import http from 'k6/http';
import { group, sleep } from 'k6';
import {
  BASE_URL,
  LOADTEST_TAG,
  authHeaders,
  classify,
  dashboardFlow,
  discoverContext,
  headroomReport,
  loadAccounts,
  loginAll,
  pick,
  saleFlow,
} from './config.js';

const MAX_VUS = parseInt(__ENV.MAX_VUS || '250', 10);

export const options = {
  stages: [
    { duration: '1m', target: 50 },
    { duration: '3m', target: 100 },      // step 1 — hold and measure
    { duration: '2m', target: 100 },
    { duration: '2m', target: MAX_VUS },  // step 2 — hold and measure
    { duration: '3m', target: MAX_VUS },
    { duration: '1m', target: 0 },
  ],
  setupTimeout: '300s',
  // Recorded for the report, but deliberately not enforced: a failing
  // threshold here is the finding, not a broken run.
  thresholds: {
    'http_req_duration{kind:read}': [{ threshold: 'p(95)<500', abortOnFail: false }],
    'http_req_duration{kind:write}': [{ threshold: 'p(95)<1500', abortOnFail: false }],
    'http_req_failed': [{ threshold: 'rate<0.01', abortOnFail: false }],
  },
};

export function setup() {
  const accounts = loadAccounts();
  const sessions = loginAll(accounts);
  const ctx = discoverContext(sessions[0]);

  headroomReport(sessions, MAX_VUS);
  console.log('Stress ceiling: ' + MAX_VUS + ' VUs. Writes tagged ' + LOADTEST_TAG);

  return { sessions: sessions, ctx: ctx };
}

export default function (data) {
  const session = data.sessions[__VU % data.sessions.length];
  const ctx = data.ctx;
  const headers = authHeaders(session, ctx.branchId);

  // A 70/30 read-to-write split, roughly matching the load phase's journey
  // without the think time — stress is about sustained pressure, not realism.
  const roll = Math.random();

  if (roll < 0.5) {
    group('read-dashboard', function () {
      const started = Date.now();
      const responses = http.batch([
        ['GET', BASE_URL + '/reports/revenue?period=today', null, { headers: headers, tags: { kind: 'report', name: 'GET /reports/revenue' } }],
        ['GET', BASE_URL + '/reports/sparklines', null, { headers: headers, tags: { kind: 'report', name: 'GET /reports/sparklines' } }],
        ['GET', BASE_URL + '/customers/stats', null, { headers: headers, tags: { kind: 'read', name: 'GET /customers/stats' } }],
        ['GET', BASE_URL + '/items?page=1&per_page=50', null, { headers: headers, tags: { kind: 'read', name: 'GET /items' } }],
      ]);
      dashboardFlow.add(Date.now() - started);
      for (let i = 0; i < responses.length; i++) {
        classify(responses[i]);
      }
    });
  } else if (roll < 0.7) {
    group('read-lists', function () {
      const res = http.get(BASE_URL + '/customers?page=1&limit=20&search=a', {
        headers: headers,
        tags: { kind: 'read', name: 'GET /customers?search' },
      });
      classify(res);

      const invoices = http.get(BASE_URL + '/invoices?page=1&per_page=50', {
        headers: headers,
        tags: { kind: 'read', name: 'GET /invoices' },
      });
      classify(invoices);
    });
  } else {
    group('write-sale', function () {
      const item = pick(ctx.items);
      const unitPrice = item.price > 0 ? item.price : 1;
      const payload = {
        branch_id: ctx.branchId,
        items: [{
          item_id: item.id,
          item_name: item.name,
          quantity: 1,
          unit_price: unitPrice,
        }],
        payment_method: 'cash',
        cash_tendered: Math.ceil(unitPrice * 2) + 100,
        notes: LOADTEST_TAG + ' stress vu=' + __VU + ' iter=' + __ITER,
      };
      if (ctx.shiftId) {
        payload.shift_id = ctx.shiftId;
      }

      const started = Date.now();
      const res = http.post(BASE_URL + '/invoices', JSON.stringify(payload), {
        headers: headers,
        tags: { kind: 'write', name: 'POST /invoices' },
      });
      saleFlow.add(Date.now() - started);
      classify(res);
    });
  }

  sleep(0.5);
}
