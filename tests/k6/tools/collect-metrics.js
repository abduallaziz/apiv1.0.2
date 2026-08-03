#!/usr/bin/env node
/**
 * Server-side metrics collector for the k6 phases.
 *
 * k6 measures the client's view: latency, throughput, error rate. It cannot
 * see whether a slow p95 came from the Node process saturating its single
 * thread or from Supabase taking its time. This collector supplies that
 * second half by sampling two endpoints the API already exposes:
 *
 *   GET /api/v1/metrics                  Prometheus, @Public() — no auth.
 *                                        collectDefaultMetrics runs with the
 *                                        `sefay_node_` prefix, so process CPU,
 *                                        RSS and event-loop lag are all here.
 *
 *   GET /api/v1/internal/perf-metrics    JWT-guarded. Per-endpoint count,
 *                                        avg/min/max duration and — the useful
 *                                        one — avgDbQueries.
 *
 * Reading the two together is what separates the layers:
 *
 *   high event-loop lag        -> Node is the bottleneck (bcryptjs, JS
 *                                 aggregation in reports.service.ts)
 *   low lag + high avgDbQueries -> the round-trip count to PostgREST dominates
 *   low lag + low  avgDbQueries -> individual queries are slow in Postgres
 *
 * The perf-metrics counters are cumulative and there is no reset endpoint, so
 * a before/after snapshot is diffed rather than read absolutely.
 *
 * Usage:
 *   node tests/k6/tools/collect-metrics.js watch --out run.json [--interval 5]
 *
 * Start it just before `k6 run`, stop it with Ctrl-C when k6 finishes. It
 * writes the sample series plus a computed summary to --out.
 *
 * Env: API_URL (required), K6_TOKEN (optional; without it perf-metrics is
 * skipped and only Prometheus data is collected).
 */

'use strict';

const fs = require('fs');
const path = require('path');

const API_URL = (process.env.API_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.K6_TOKEN || '';

if (!API_URL) {
  console.error('API_URL is required, e.g. API_URL=https://api.example.com/api/v1');
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0] || 'watch';
const outPath = flagValue('--out') || 'k6-server-metrics.json';
const intervalSec = Number(flagValue('--interval') || 5);

function flagValue(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

// ---------------------------------------------------------------------------
// Prometheus text parsing
// ---------------------------------------------------------------------------

/**
 * Minimal Prometheus exposition parser — enough for the scalar series this
 * tool reads. Returns a map of "name{labels}" -> number, plus a `sum` helper
 * keyed by bare metric name for series that carry labels.
 */
function parsePrometheus(text) {
  const values = {};
  const sums = {};
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const lastSpace = trimmed.lastIndexOf(' ');
    if (lastSpace === -1) {
      continue;
    }
    const key = trimmed.slice(0, lastSpace);
    const raw = trimmed.slice(lastSpace + 1);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      continue;
    }
    values[key] = value;

    const braceAt = key.indexOf('{');
    const bare = braceAt === -1 ? key : key.slice(0, braceAt);
    sums[bare] = (sums[bare] || 0) + value;
  }

  return { values, sums };
}

function firstDefined(parsed, names) {
  for (const name of names) {
    if (parsed.values[name] !== undefined) {
      return parsed.values[name];
    }
    if (parsed.sums[name] !== undefined) {
      return parsed.sums[name];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

async function fetchText(url, headers) {
  const res = await fetch(url, { headers: headers || {} });
  if (!res.ok) {
    throw new Error('HTTP ' + res.status + ' from ' + url);
  }
  return res.text();
}

async function samplePrometheus() {
  const text = await fetchText(API_URL + '/metrics');
  const parsed = parsePrometheus(text);

  return {
    at: new Date().toISOString(),
    cpuSecondsTotal: firstDefined(parsed, ['sefay_node_process_cpu_seconds_total']),
    cpuUserSecondsTotal: firstDefined(parsed, ['sefay_node_process_cpu_user_seconds_total']),
    cpuSystemSecondsTotal: firstDefined(parsed, ['sefay_node_process_cpu_system_seconds_total']),
    residentMemoryBytes: firstDefined(parsed, ['sefay_node_process_resident_memory_bytes']),
    heapUsedBytes: firstDefined(parsed, ['sefay_node_nodejs_heap_size_used_bytes']),
    heapTotalBytes: firstDefined(parsed, ['sefay_node_nodejs_heap_size_total_bytes']),
    eventLoopLagMean: firstDefined(parsed, ['sefay_node_nodejs_eventloop_lag_mean_seconds']),
    eventLoopLagP99: firstDefined(parsed, ['sefay_node_nodejs_eventloop_lag_p99_seconds']),
    eventLoopLagMax: firstDefined(parsed, ['sefay_node_nodejs_eventloop_lag_max_seconds']),
    activeHandles: firstDefined(parsed, ['sefay_node_nodejs_active_handles_total']),
    activeRequests: firstDefined(parsed, ['http_active_requests']),
    httpRequestsTotal: parsed.sums['http_requests_total'] || null,
    invoicesTotal: parsed.sums['sefay_invoices_total'] || null,
  };
}

async function samplePerfMetrics() {
  if (!TOKEN) {
    return null;
  }
  try {
    const text = await fetchText(API_URL + '/internal/perf-metrics', {
      Authorization: 'Bearer ' + TOKEN,
    });
    return JSON.parse(text);
  } catch (err) {
    console.error('  perf-metrics unavailable: ' + err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/**
 * Diffs two perf-metrics snapshots so the numbers describe only the load-test
 * window, not the endpoint's whole lifetime.
 *
 * avgDurationMs is recomputed from the count/total deltas rather than
 * subtracted directly — averaging two averages would be wrong.
 */
function diffPerfMetrics(before, after) {
  if (!before || !after) {
    return null;
  }

  const beforeByKey = {};
  for (const row of before) {
    beforeByKey[row.method + ' ' + row.route] = row;
  }

  const diffed = [];
  for (const row of after) {
    const key = row.method + ' ' + row.route;
    const prev = beforeByKey[key];

    const prevCount = prev ? prev.count : 0;
    const prevTotal = prev ? prev.avgDurationMs * prev.count : 0;
    const prevDbTotal = prev ? prev.avgDbQueries * prev.count : 0;

    const countDelta = row.count - prevCount;
    if (countDelta <= 0) {
      continue; // untouched during the window
    }

    const totalDelta = row.avgDurationMs * row.count - prevTotal;
    const dbDelta = row.avgDbQueries * row.count - prevDbTotal;

    const statusDelta = {};
    for (const code of Object.keys(row.statusCodes || {})) {
      const prevCode = prev && prev.statusCodes ? prev.statusCodes[code] || 0 : 0;
      const delta = row.statusCodes[code] - prevCode;
      if (delta > 0) {
        statusDelta[code] = delta;
      }
    }

    diffed.push({
      endpoint: key,
      requests: countDelta,
      avgDurationMs: round2(totalDelta / countDelta),
      // min/max are lifetime extremes on the server side and cannot be
      // windowed by subtraction — carried through as-is and labelled.
      lifetimeMaxMs: row.maxDurationMs,
      avgDbQueries: round2(dbDelta / countDelta),
      statusCodes: statusDelta,
    });
  }

  diffed.sort((a, b) => b.avgDurationMs - a.avgDurationMs);
  return diffed;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function summarise(samples) {
  if (samples.length < 2) {
    return null;
  }
  const first = samples[0];
  const last = samples[samples.length - 1];

  const elapsedSec =
    (new Date(last.at).getTime() - new Date(first.at).getTime()) / 1000;

  // CPU seconds consumed per wall-clock second. On a single-core allocation,
  // 1.0 means fully saturated; the API runs one Node process with no cluster
  // mode configured (railway.json has no replica settings).
  let cpuUtilisation = null;
  if (first.cpuSecondsTotal !== null && last.cpuSecondsTotal !== null && elapsedSec > 0) {
    cpuUtilisation = round2((last.cpuSecondsTotal - first.cpuSecondsTotal) / elapsedSec);
  }

  const peak = (field) =>
    samples.reduce((max, s) => (s[field] !== null && s[field] > max ? s[field] : max), 0);

  return {
    windowSeconds: Math.round(elapsedSec),
    samples: samples.length,
    cpuUtilisation,
    peakResidentMemoryMB: round2(peak('residentMemoryBytes') / 1024 / 1024),
    peakHeapUsedMB: round2(peak('heapUsedBytes') / 1024 / 1024),
    peakEventLoopLagP99Ms: round2(peak('eventLoopLagP99') * 1000),
    peakEventLoopLagMaxMs: round2(peak('eventLoopLagMax') * 1000),
    peakActiveRequests: peak('activeRequests'),
    httpRequestsInWindow:
      first.httpRequestsTotal !== null && last.httpRequestsTotal !== null
        ? last.httpRequestsTotal - first.httpRequestsTotal
        : null,
    invoicesInWindow:
      first.invoicesTotal !== null && last.invoicesTotal !== null
        ? last.invoicesTotal - first.invoicesTotal
        : null,
  };
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

/**
 * Turns the collected numbers into the Backend / Database / Frontend call the
 * report has to make. Stated as evidence plus a reading, never as a bare
 * assertion — the thresholds here are judgement calls, not measurements.
 */
function verdict(summary, perfDiff) {
  if (!summary) {
    return ['Not enough samples to judge.'];
  }
  const lines = [];

  const lagMs = summary.peakEventLoopLagP99Ms;
  if (lagMs !== null && lagMs > 100) {
    lines.push(
      'Event-loop lag p99 peaked at ' + lagMs + 'ms — the Node process is the ' +
      'constraint. It is single-threaded and runs bcryptjs (cost 12) plus all ' +
      'report aggregation in JS. => BACKEND'
    );
  } else if (lagMs !== null) {
    lines.push(
      'Event-loop lag p99 stayed at ' + lagMs + 'ms — Node kept up. Latency ' +
      'originates downstream of the API process.'
    );
  }

  if (summary.cpuUtilisation !== null) {
    lines.push(
      'CPU utilisation averaged ' + summary.cpuUtilisation + ' core-seconds/second' +
      (summary.cpuUtilisation > 0.85
        ? ' — saturated for a single-process deployment. => BACKEND'
        : ' — headroom remained.')
    );
  }

  if (perfDiff && perfDiff.length) {
    const heaviest = perfDiff
      .slice()
      .sort((a, b) => b.avgDbQueries - a.avgDbQueries)[0];
    lines.push(
      'Most DB round-trips per request: ' + heaviest.endpoint + ' at ' +
      heaviest.avgDbQueries + ' queries/request (avg ' + heaviest.avgDurationMs + 'ms).' +
      (heaviest.avgDbQueries > 8
        ? ' A high count with moderate per-query cost means the round-trip ' +
          'count dominates, not query execution. => DATABASE ACCESS PATTERN'
        : '')
    );

    const slowest = perfDiff[0];
    lines.push(
      'Slowest endpoint by average: ' + slowest.endpoint + ' at ' +
      slowest.avgDurationMs + 'ms over ' + slowest.requests + ' requests ' +
      '(' + slowest.avgDbQueries + ' queries/request).'
    );
  }

  lines.push(
    'Frontend is not exercised by k6 at all — these tests drive the API ' +
    'directly. Any Vercel proxy cost shows up only when API_URL points at the ' +
    'web origin rather than the API origin.'
  );

  return lines;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function watch() {
  console.log('Sampling ' + API_URL + ' every ' + intervalSec + 's. Ctrl-C to stop.');
  if (!TOKEN) {
    console.log('No K6_TOKEN set — per-endpoint perf-metrics will be skipped.');
  }

  const samples = [];
  const perfBefore = await samplePerfMetrics();

  let stopping = false;

  async function finish() {
    if (stopping) {
      return;
    }
    stopping = true;
    clearInterval(timer);

    const perfAfter = await samplePerfMetrics();
    const summary = summarise(samples);
    const perfDiff = diffPerfMetrics(perfBefore, perfAfter);

    const report = {
      apiUrl: API_URL,
      collectedAt: new Date().toISOString(),
      summary,
      verdict: verdict(summary, perfDiff),
      endpoints: perfDiff,
      samples,
    };

    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    console.log('\n--- server-side summary -------------------------------------');
    if (summary) {
      console.log('  window            : ' + summary.windowSeconds + 's');
      console.log('  CPU utilisation   : ' + summary.cpuUtilisation + ' core-s/s');
      console.log('  peak RSS          : ' + summary.peakResidentMemoryMB + ' MB');
      console.log('  peak heap used    : ' + summary.peakHeapUsedMB + ' MB');
      console.log('  event-loop lag p99: ' + summary.peakEventLoopLagP99Ms + ' ms');
      console.log('  requests served   : ' + summary.httpRequestsInWindow);
      console.log('  invoices created  : ' + summary.invoicesInWindow);
    }
    console.log('\n--- reading -------------------------------------------------');
    for (const line of report.verdict) {
      console.log('  * ' + line);
    }
    console.log('\nWritten to ' + outPath);
    process.exit(0);
  }

  const timer = setInterval(async () => {
    try {
      samples.push(await samplePrometheus());
      process.stdout.write('.');
    } catch (err) {
      process.stdout.write('!');
    }
  }, intervalSec * 1000);

  process.on('SIGINT', finish);
  process.on('SIGTERM', finish);
}

if (command === 'watch') {
  watch().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  console.error('Unknown command: ' + command + '. Only `watch` is supported.');
  process.exit(1);
}
