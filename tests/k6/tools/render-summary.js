#!/usr/bin/env node
/**
 * Renders a sanitized k6 run into GitHub-flavoured Markdown for a job summary.
 *
 * Reads only files that have already been through `sanitize-results.js`, so it
 * never has to reason about credentials itself. Writes to stdout; the workflow
 * redirects that into $GITHUB_STEP_SUMMARY.
 *
 * Usage:
 *   node render-summary.js <results-dir> [--title "..."] [--run-id "..."]
 *
 * The Phase 1 workflow currently inlines an equivalent renderer. This file
 * exists so Phase 2 (and later phases) share one implementation rather than
 * growing a third copy; Phase 1 can adopt it in a separate change, since the
 * brief for this one was to leave that workflow untouched.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const resultsDir = args[0] || 'k6-results';

function flag(name, fallback) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const title = flag('--title', 'k6 Run');
const runId = flag('--run-id', null);

const out = [];
const say = (line = '') => out.push(line);

function readJson(file) {
  const full = path.join(resultsDir, file);
  if (!fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    say(`> Could not parse \`${file}\`: ${err.message}`);
    return null;
  }
}

const ms = (n) => (n == null ? 'n/a' : n.toFixed(2) + ' ms');
const num = (n, digits = 2) => (n == null ? 'n/a' : n.toFixed(digits));

say(`## ${title}`);
say();

const summary = readJson('summary.json');

if (!summary || !summary.metrics) {
  say('**No summary produced.** k6 most likely failed during `setup()` —');
  say('check the console log in the artifact. Common causes: unreachable');
  say('`API_URL`, wrong credentials, or a tenant with no branches/items.');
  process.stdout.write(out.join('\n') + '\n');
  process.exit(0);
}

const m = summary.metrics;
const dur = m.http_req_duration || {};
const reqs = m.http_reqs || {};
const failed = m.http_req_failed || {};
const checks = m.checks || {};

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

say('| Metric | Value |');
say('| --- | --- |');
say(`| Total requests | ${reqs.count ?? 'n/a'} |`);
say(`| Requests / sec | ${num(reqs.rate)} |`);
say(`| Avg response time | ${ms(dur.avg)} |`);
say(`| p95 latency | ${ms(dur['p(95)'])} |`);
say(`| Max latency | ${ms(dur.max)} |`);
say(
  `| Failed requests | ${failed.passes ?? 0}` +
    (failed.value != null ? ` (${(failed.value * 100).toFixed(2)}%)` : '') +
    ' |',
);
say(`| Throttled (429) | ${(m.throttled_429 || {}).count ?? 0} |`);
say(`| Business errors | ${(m.business_errors || {}).count ?? 0} |`);
say(
  `| Checks passed | ${checks.passes ?? 0} / ${(checks.passes ?? 0) + (checks.fails ?? 0)} |`,
);

// ---------------------------------------------------------------------------
// Latency split by request kind — this is where a single p95 hides the story.
// A sale is 12-18 sequential round-trips by design and will always sit far
// above a cached list read; averaging them together says nothing useful.
// ---------------------------------------------------------------------------

const kinds = ['read', 'write', 'auth', 'report'];
const kindRows = kinds
  .map((kind) => [kind, m[`http_req_duration{kind:${kind}}`]])
  .filter(([, metric]) => metric && metric.count !== 0);

if (kindRows.length) {
  say();
  say('### Latency by request kind');
  say();
  say('| Kind | Avg | p95 | Max |');
  say('| --- | --- | --- | --- |');
  for (const [kind, v] of kindRows) {
    say(`| ${kind} | ${ms(v.avg)} | ${ms(v['p(95)'])} | ${ms(v.max)} |`);
  }
}

// ---------------------------------------------------------------------------
// Business flows — one logical user action can be many requests (the dashboard
// is 9), so these are timed separately from raw HTTP.
// ---------------------------------------------------------------------------

const flows = [
  ['Dashboard open (9 parallel requests)', 'flow_dashboard_ms'],
  ['Create sale (POST /invoices)', 'flow_create_sale_ms'],
  ['Reports read', 'flow_reports_ms'],
  ['Inventory adjustment (create + post)', 'flow_adjustment_ms'],
];
const flowRows = flows.filter(([, key]) => m[key] && m[key].count !== 0);

if (flowRows.length) {
  say();
  say('### Business flows');
  say();
  say('| Flow | Avg | p95 | Max |');
  say('| --- | --- | --- | --- |');
  for (const [label, key] of flowRows) {
    const v = m[key];
    say(`| ${label} | ${ms(v.avg)} | ${ms(v['p(95)'])} | ${ms(v.max)} |`);
  }
}

// ---------------------------------------------------------------------------
// Thresholds
//
// In --summary-export each threshold maps to a boolean that is TRUE when the
// threshold was BREACHED (verified empirically: a failing threshold exports
// true and exits k6 with code 99, a passing one exports false). Reading it as
// "ok" inverts the entire report.
// ---------------------------------------------------------------------------

const breached = Object.entries(m).flatMap(([name, v]) =>
  Object.entries(v.thresholds || {})
    .filter(([, isBreached]) => isBreached === true)
    .map(([t]) => `${name}: ${t}`),
);

say();
say('### Thresholds');
say();
if (breached.length) {
  say('Breached:');
  say();
  for (const b of breached) say(`- \`${b}\``);
} else {
  say('All thresholds passed.');
}

// ---------------------------------------------------------------------------
// Server-side
// ---------------------------------------------------------------------------

const server = readJson('server-metrics.json');

if (server && server.summary) {
  const s = server.summary;
  say();
  say('### Server-side (Railway)');
  say();
  say('| Metric | Value |');
  say('| --- | --- |');
  say(`| CPU utilisation | ${s.cpuUtilisation ?? 'n/a'} core-s/s |`);
  say(`| Peak RSS | ${s.peakResidentMemoryMB ?? 'n/a'} MB |`);
  say(`| Peak heap used | ${s.peakHeapUsedMB ?? 'n/a'} MB |`);
  say(`| Event-loop lag p99 | ${s.peakEventLoopLagP99Ms ?? 'n/a'} ms |`);
  say(`| Requests served | ${s.httpRequestsInWindow ?? 'n/a'} |`);
  say(`| Invoices created | ${s.invoicesInWindow ?? 'n/a'} |`);
}

if (server && Array.isArray(server.verdict) && server.verdict.length) {
  say();
  say('### Bottleneck reading');
  say();
  for (const line of server.verdict) say(`- ${line}`);
}

if (server && Array.isArray(server.endpoints) && server.endpoints.length) {
  say();
  say('### Slowest endpoints');
  say();
  say('| Endpoint | Requests | Avg | DB queries/req |');
  say('| --- | --- | --- | --- |');
  for (const e of server.endpoints.slice(0, 10)) {
    say(`| \`${e.endpoint}\` | ${e.requests} | ${e.avgDurationMs} ms | ${e.avgDbQueries} |`);
  }
}

// ---------------------------------------------------------------------------
// Cleanup — only meaningful for phases that write.
// ---------------------------------------------------------------------------

if (runId) {
  const tag = `[LOADTEST:${runId}]`;
  say();
  say('### Test data created by this run');
  say();
  say(`Every write is tagged \`${tag}\`. To find it:`);
  say();
  say('```sql');
  say('-- Sales (note: the invoices module writes to `orders`, not `invoices`)');
  say(`SELECT id, created_at, total, branch_id`);
  say(`FROM orders`);
  say(`WHERE notes LIKE '${tag}%';`);
  say('');
  say('-- Their line items');
  say(`SELECT oi.*`);
  say(`FROM order_items oi`);
  say(`JOIN orders o ON o.id = oi.order_id`);
  say(`WHERE o.notes LIKE '${tag}%';`);
  say('');
  say('-- Inventory adjustments');
  say(`SELECT id, created_at, item_id, warehouse_id, quantity_delta, status`);
  say(`FROM stock_adjustments`);
  say(`WHERE reason LIKE '${tag}%';`);
  say('');
  say('-- Ledger rows produced by posting those adjustments');
  say(`SELECT sm.*`);
  say(`FROM stock_movements sm`);
  say(`WHERE sm.reference_type = 'stock_adjustment'`);
  say(`  AND sm.reference_id IN (`);
  say(`    SELECT id FROM stock_adjustments WHERE reason LIKE '${tag}%'`);
  say(`  );`);
  say('```');
  say();
  say('> **Deleting the ledger rows is not safe as a plain `DELETE`.**');
  say('> `stock_movements` is an immutable ledger and `stock_levels` is its');
  say('> projection, so removing movements without also correcting');
  say('> `stock_levels` and `cost_layers` leaves quantities that no longer');
  say('> match their history. Sales additionally consume FIFO cost layers.');
  say('> Reverse the effect through the normal inventory operations, or');
  say('> restore from a snapshot taken before the run — do not hand-delete.');
  say('>');
  say('> `orders` / `order_items` / `stock_adjustments` rows themselves carry');
  say('> no such coupling and can be removed directly.');
}

process.stdout.write(out.join('\n') + '\n');
