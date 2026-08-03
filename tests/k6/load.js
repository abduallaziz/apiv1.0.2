// Phase 2 — Normal load.
//
// Goal: simulate a company using the system through a working day. 50 VUs /
// 10 minutes, ramped rather than stepped on at once.
//
// Journey per virtual user, mapped to what the frontend actually does:
//   1. open the dashboard        -> 9 parallel report/list calls
//   2. look a product up         -> barcode lookup + customer search
//                                   (there is NO server-side product search;
//                                    POS filters a preloaded list in-browser)
//   3. create a sale             -> POST /invoices
//   4. read reports              -> revenue + top items
//   5. update inventory          -> create + post an adjustment
//
// Every written row carries RUN_ID:
//   - invoices  -> `notes`
//   - adjustments -> `reason`
//
//   k6 run tests/k6/load.js

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import {
  BASE_URL,
  LOADTEST_TAG,
  adjustmentFlow,
  authHeaders,
  EXPECTED_WITH_404,
  baseThresholds,
  classify,
  dashboardFlow,
  discoverContext,
  headroomReport,
  isOk,
  loadAccounts,
  loginAll,
  pick,
  reportFlow,
  saleFlow,
} from './config.js';

const PEAK_VUS = 50;

export const options = {
  stages: [
    { duration: '1m', target: 10 },       // warm caches and connections
    { duration: '1m', target: PEAK_VUS },  // ramp to full load
    { duration: '7m', target: PEAK_VUS },  // hold — this is the measured window
    { duration: '1m', target: 0 },         // ramp down
  ],
  setupTimeout: '300s',
  thresholds: baseThresholds,
};

export function setup() {
  const accounts = loadAccounts();
  const sessions = loginAll(accounts);
  const ctx = discoverContext(sessions[0]);

  headroomReport(sessions, PEAK_VUS);

  for (let i = 0; i < ctx.warnings.length; i++) {
    console.log('  WARNING: ' + ctx.warnings[i]);
  }
  console.log('Writes from this run are tagged: ' + LOADTEST_TAG);

  return { sessions: sessions, ctx: ctx };
}

export default function (data) {
  const session = data.sessions[__VU % data.sessions.length];
  const ctx = data.ctx;
  const headers = authHeaders(session, ctx.branchId);

  // ---- 1. dashboard --------------------------------------------------------
  group('01-dashboard', function () {
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
    for (let i = 0; i < responses.length; i++) {
      classify(responses[i]);
    }
  });

  sleep(2); // the user reads the dashboard

  // ---- 2. find a product ---------------------------------------------------
  group('02-product-lookup', function () {
    // The only server-side product lookup that exists. A miss is a legitimate
    // 404, so it is not counted as an error — what is being measured is the
    // lookup cost, not whether this synthetic barcode happens to exist.
    const barcode = '629' + Math.floor(Math.random() * 1000000000);
    const lookup = http.get(BASE_URL + '/item-barcodes/lookup/' + barcode, {
      headers: headers,
      tags: { kind: 'read', name: 'GET /item-barcodes/lookup/:barcode' },
      // A miss is a valid answer here, so 404 must not inflate http_req_failed.
      responseCallback: EXPECTED_WITH_404,
    });
    check(lookup, {
      'barcode lookup resolved': function (r) { return r.status === 200 || r.status === 404; },
    });
    if (lookup.status !== 404) {
      classify(lookup);
    }

    const search = http.get(BASE_URL + '/customers?page=1&limit=20&search=a', {
      headers: headers,
      tags: { kind: 'read', name: 'GET /customers?search' },
    });
    classify(search);
  });

  sleep(1);

  // ---- 3. create a sale ----------------------------------------------------
  group('03-create-sale', function () {
    const lineCount = 1 + Math.floor(Math.random() * 3); // 1-3 lines
    const lines = [];
    let total = 0;
    for (let i = 0; i < lineCount; i++) {
      const item = pick(ctx.items);
      const quantity = 1 + Math.floor(Math.random() * 2);
      const unitPrice = item.price > 0 ? item.price : 1;
      total += unitPrice * quantity;
      lines.push({
        item_id: item.id,
        item_name: item.name,
        quantity: quantity,
        unit_price: unitPrice,
      });
    }

    // Body matches CreateInvoiceDto exactly — the global ValidationPipe runs
    // with forbidNonWhitelisted, so an extra key is a 400.
    const payload = {
      branch_id: ctx.branchId,
      items: lines,
      payment_method: 'cash',
      // Required by the service whenever payment_method is 'cash'.
      cash_tendered: Math.ceil(total * 1.5) + 100,
      notes: LOADTEST_TAG + ' vu=' + __VU + ' iter=' + __ITER,
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

    check(res, { 'sale created': function (r) { return r.status === 201 || r.status === 200; } });
    classify(res);
  });

  sleep(2);

  // ---- 4. read reports -----------------------------------------------------
  group('04-reports', function () {
    const started = Date.now();
    const responses = http.batch([
      ['GET', BASE_URL + '/reports/revenue?period=week', null, { headers: headers, tags: { kind: 'report', name: 'GET /reports/revenue?week' } }],
      ['GET', BASE_URL + '/reports/top-items?period=week', null, { headers: headers, tags: { kind: 'report', name: 'GET /reports/top-items?week' } }],
    ]);
    reportFlow.add(Date.now() - started);
    for (let i = 0; i < responses.length; i++) {
      classify(responses[i]);
    }
  });

  sleep(1);

  // ---- 5. update inventory -------------------------------------------------
  group('05-inventory-adjustment', function () {
    if (!ctx.warehouseId) {
      return;
    }
    const item = pick(ctx.items);

    // A positive delta on purpose. A negative one would race the sales running
    // concurrently in step 3 and fail with INSUFFICIENT_STOCK, which would
    // measure stock availability rather than the write path's performance.
    // Phase 4 is where contention is exercised deliberately.
    const createBody = {
      warehouse_id: ctx.warehouseId,
      item_id: item.id,
      quantity_delta: 1,
      unit_cost: 1,
      reason: LOADTEST_TAG + ' load-phase restock vu=' + __VU,
    };

    const started = Date.now();
    const created = http.post(
      BASE_URL + '/inventory/adjustments',
      JSON.stringify(createBody),
      { headers: headers, tags: { kind: 'write', name: 'POST /inventory/adjustments' } }
    );

    if (isOk(created)) {
      const adjustment = created.json();
      // Only an approved adjustment can be posted (adjustments.service.ts).
      // Whether it auto-approves depends on
      // INVENTORY_ADJUSTMENT_APPROVAL_THRESHOLD in the target environment.
      if (adjustment && adjustment.id && adjustment.status === 'approved') {
        const posted = http.post(
          BASE_URL + '/inventory/adjustments/' + adjustment.id + '/post',
          null,
          { headers: headers, tags: { kind: 'write', name: 'POST /inventory/adjustments/:id/post' } }
        );
        check(posted, { 'adjustment posted': function (r) { return r.status === 200 || r.status === 201; } });
        classify(posted);
      }
    }
    adjustmentFlow.add(Date.now() - started);
  });

  sleep(3); // think time before the next cycle
}
