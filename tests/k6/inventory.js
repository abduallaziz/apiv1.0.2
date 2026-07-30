// Phase 4 — Inventory stress / concurrency.
//
// Inventory is the part of Sefay with real serialization in it, so this phase
// is built as a controlled comparison rather than just "more load".
//
// Every stock-touching sale runs through two row-level lock points per line:
//
//   fn_consume_cost_layers   SELECT ... FROM cost_layers
//                            ORDER BY received_at FOR UPDATE   (019:214-221)
//   fn_apply_stock_movement  _lock_or_create_stock_level        (019:33-52)
//                            + INSERT stock_movements
//                            + INSERT domain_events_outbox
//
// Two sales of the SAME item in the SAME warehouse must serialise on the same
// oldest cost layer. Two sales of DIFFERENT items do not.
//
// So this file runs the identical write load twice:
//
//   scenario `contended` — every VU sells one single shared item
//   scenario `spread`    — every VU sells a randomly chosen item
//
// The delta between the two is the cost of lock contention, isolated from
// every other variable (same VUs, same duration, same payload shape, same
// environment). A large gap points at the FIFO layer; no gap means the
// ceiling is elsewhere and the round-trip count is what dominates.
//
//   k6 run tests/k6/inventory.js

import http from 'k6/http';
import { group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import {
  BASE_URL,
  LOADTEST_TAG,
  authHeaders,
  classify,
  discoverContext,
  headroomReport,
  loadAccounts,
  loginAll,
  pick,
} from './config.js';

const VUS = parseInt(__ENV.INV_VUS || '40', 10);
const PHASE_DURATION = __ENV.INV_DURATION || '3m';

// Gap between the two scenarios so locks, caches and the outbox drain before
// the second one starts and neither phase contaminates the other's numbers.
const GAP_SECONDS = parseInt(__ENV.INV_GAP_SECONDS || '30', 10);

/** Parses k6 duration strings ("3m", "90s", "1m30s") into seconds. */
function durationToSeconds(value) {
  let total = 0;
  const pattern = /(\d+)([hms])/g;
  let match = pattern.exec(value);
  while (match !== null) {
    const amount = parseInt(match[1], 10);
    if (match[2] === 'h') total += amount * 3600;
    else if (match[2] === 'm') total += amount * 60;
    else total += amount;
    match = pattern.exec(value);
  }
  if (total === 0) {
    throw new Error('Could not parse INV_DURATION: ' + value);
  }
  return total;
}

const SPREAD_START = durationToSeconds(PHASE_DURATION) + GAP_SECONDS + 's';

// Separate trends so the two scenarios can be compared directly in the summary.
const contendedSale = new Trend('inv_contended_sale_ms', true);
const spreadSale = new Trend('inv_spread_sale_ms', true);

// Domain-level failures worth counting on their own — these are expected
// outcomes of the design, not HTTP faults, and they say something specific.
const insufficientStock = new Counter('inv_insufficient_stock');
const insufficientLayers = new Counter('inv_insufficient_cost_layers');
const stockWarnings = new Counter('inv_stock_warning_returned');

export const options = {
  scenarios: {
    contended: {
      executor: 'constant-vus',
      vus: VUS,
      duration: PHASE_DURATION,
      exec: 'contendedSales',
      startTime: '0s',
      tags: { phase: 'contended' },
    },
    spread: {
      executor: 'constant-vus',
      vus: VUS,
      duration: PHASE_DURATION,
      exec: 'spreadSales',
      // Starts only after `contended` has fully finished plus the gap, so the
      // two never overlap and neither pollutes the other's numbers.
      startTime: SPREAD_START,
      tags: { phase: 'spread' },
    },
  },
  setupTimeout: '300s',
  thresholds: {
    'inv_contended_sale_ms': [{ threshold: 'p(95)<3000', abortOnFail: false }],
    'inv_spread_sale_ms': [{ threshold: 'p(95)<3000', abortOnFail: false }],
    'http_req_failed': [{ threshold: 'rate<0.05', abortOnFail: false }],
  },
};

export function setup() {
  const accounts = loadAccounts();
  const sessions = loginAll(accounts);
  const ctx = discoverContext(sessions[0]);

  headroomReport(sessions, VUS);

  // This phase is meaningless unless sales actually reach the inventory
  // engine. Both conditions below are required by
  // 043_pos_inventory_deduction.sql; failing loudly here beats producing a
  // clean-looking report that measured nothing.
  if (!ctx.warehouseId) {
    throw new Error(
      'No warehouse resolved. Sales cannot deduct stock, so this phase would ' +
      'measure the invoice path only. Set branches.default_warehouse_id first.'
    );
  }

  const trackedItems = ctx.items.filter(function (i) { return i.hasInventory; });
  if (trackedItems.length === 0) {
    throw new Error(
      'No item has has_inventory=true. fn_process_sale_stock_deduction skips ' +
      'every line, so no cost layer or stock movement would ever be touched.'
    );
  }

  // The single item every contended VU will fight over.
  const hotItem = trackedItems[0];

  // Available-To-Promise is read live and uncached by design
  // (stock.repository.ts findAtp) — a good pre-flight check of real headroom.
  const atpRes = http.get(
    BASE_URL + '/inventory/stock/atp?warehouse_id=' + ctx.warehouseId +
      '&item_id=' + hotItem.id,
    { headers: authHeaders(sessions[0]), tags: { kind: 'read', name: 'GET /inventory/stock/atp' } }
  );

  let available = 0;
  if (atpRes.status === 200) {
    const atp = atpRes.json();
    available = atp.quantity_available || 0;
  }

  console.log('--- inventory phase setup -----------------------------------');
  console.log('  warehouse        : ' + ctx.warehouseId);
  console.log('  hot item         : ' + hotItem.name + ' (' + hotItem.id + ')');
  console.log('  ATP available    : ' + available);
  console.log('  tracked items    : ' + trackedItems.length);
  console.log('  VUs per scenario : ' + VUS + ' for ' + PHASE_DURATION + ' each');
  if (available < VUS * 10) {
    console.log('  NOTE: ATP is low. Once it runs out, sales still succeed but');
    console.log('        deduction fails and returns stock_warning — tracked as');
    console.log('        inv_insufficient_stock, which is itself a finding.');
  }
  console.log('-------------------------------------------------------------');

  return {
    sessions: sessions,
    ctx: ctx,
    hotItem: hotItem,
    trackedItems: trackedItems,
  };
}

/**
 * Issues one single-line cash sale and records the domain outcome.
 *
 * Stock deduction is best-effort inside InvoicesService.create(): a stock
 * failure never blocks the sale, it comes back as `stock_warning` in an
 * otherwise-201 response. So HTTP status alone cannot tell whether inventory
 * actually moved — the body has to be read.
 */
function sell(session, ctx, item, trend, tagName) {
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
    notes: LOADTEST_TAG + ' ' + tagName + ' vu=' + __VU + ' iter=' + __ITER,
  };
  if (ctx.shiftId) {
    payload.shift_id = ctx.shiftId;
  }

  const started = Date.now();
  const res = http.post(BASE_URL + '/invoices', JSON.stringify(payload), {
    headers: authHeaders(session, ctx.branchId),
    tags: { kind: 'write', name: 'POST /invoices [' + tagName + ']' },
  });
  trend.add(Date.now() - started);
  classify(res);

  if (res.status === 200 || res.status === 201) {
    const body = res.json();
    if (body && body.stock_warning) {
      stockWarnings.add(1);
      const warning = String(body.stock_warning);
      if (warning.indexOf('INSUFFICIENT_STOCK') !== -1) {
        insufficientStock.add(1);
      }
      if (warning.indexOf('INSUFFICIENT_COST_LAYERS') !== -1) {
        insufficientLayers.add(1);
      }
    }
  }
}

/** All VUs sell the same item — maximum lock contention. */
export function contendedSales(data) {
  const session = data.sessions[__VU % data.sessions.length];
  group('contended', function () {
    sell(session, data.ctx, data.hotItem, contendedSale, 'contended');
  });
  sleep(0.2);
}

/** Each VU sells a random tracked item — contention spread across rows. */
export function spreadSales(data) {
  const session = data.sessions[__VU % data.sessions.length];
  const item = pick(data.trackedItems);
  group('spread', function () {
    sell(session, data.ctx, item, spreadSale, 'spread');
  });
  sleep(0.2);
}
