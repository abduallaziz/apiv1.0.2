#!/usr/bin/env node
/**
 * WP-B — fiscal-year dry-run / controlled backfill tool (migration 325).
 *
 * DEFAULT IS READ-ONLY. It lists, per tenant, which fiscal years WOULD be created
 * (12 monthly periods each) and refuses anything unsafe. Fiscal years are APPEND-ONLY
 * (they can never be deleted), so real generation needs ALL of:
 *   --apply  --confirm <approval.json>
 * where approval.json is a file the owner reviewed after the dry-run:
 *   { "tenants": ["<uuid>", ...], "through": "YYYY-MM-DD", "approved_by": "...", "approved_at": "..." }
 * Only the tenants listed in that file are touched, each in its own transaction.
 *
 * Connection: env FISCAL_DATABASE_URL (never printed, never logged).
 *   - loopback host (127.0.0.1 / localhost / ::1): allowed.
 *   - any other host: the dry-run additionally needs --allow-remote-read, and --apply is
 *     refused unless env FISCAL_ALLOW_REMOTE_APPLY equals the exact host name.
 *   (Running against a hosted database is an owner-approved production step, not part of
 *   local development.)
 *
 * Usage:
 *   node scripts/fiscal-years.js --years 2                       # dry-run, horizon = today + 2y
 *   node scripts/fiscal-years.js --through 2028-12-31 --tenant <uuid>
 *   node scripts/fiscal-years.js --years 2 --report report.json  # also write the JSON report
 *   node scripts/fiscal-years.js --apply --confirm approval.json
 */
const fs = require('fs');
const { Client } = require('pg');

function parseArgs(argv) {
  const a = { apply: false, years: 2, allowRemoteRead: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--apply') a.apply = true;
    else if (k === '--confirm') a.confirm = v();
    else if (k === '--through') a.through = v();
    else if (k === '--years') a.years = Number(v());
    else if (k === '--tenant') a.tenant = v();
    else if (k === '--report') a.report = v();
    else if (k === '--allow-remote-read') a.allowRemoteRead = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

function throughFromYears(years) {
  if (!Number.isFinite(years) || years < 0 || years > 5) throw new Error('--years must be between 0 and 5');
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear() + years, n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
}

const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    return;
  }
  const url = process.env.FISCAL_DATABASE_URL;
  if (!url) throw new Error('FISCAL_DATABASE_URL is not set');
  const host = new URL(url).hostname;
  const loopback = LOOPBACK.includes(host);
  if (!loopback) {
    if (args.apply) {
      if (process.env.FISCAL_ALLOW_REMOTE_APPLY !== host) {
        throw new Error('refusing to APPLY against a non-loopback host (needs the owner-approved FISCAL_ALLOW_REMOTE_APPLY=<exact host>)');
      }
    } else if (!args.allowRemoteRead) {
      throw new Error('refusing a non-loopback host without --allow-remote-read');
    }
  }

  let through = args.through || throughFromYears(args.years);
  let approvedTenants = null;
  if (args.apply) {
    if (!args.confirm) throw new Error('--apply requires --confirm <approval.json>');
    const approval = JSON.parse(fs.readFileSync(args.confirm, 'utf8'));
    if (!Array.isArray(approval.tenants) || approval.tenants.length === 0 || !approval.tenants.every((t) => UUID.test(t))) {
      throw new Error('approval.json must list tenant uuids');
    }
    if (!approval.through || !approval.approved_by || !approval.approved_at) {
      throw new Error('approval.json needs through, approved_by, approved_at');
    }
    through = approval.through;
    approvedTenants = approval.tenants;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) throw new Error('through date must be YYYY-MM-DD');

  const c = new Client({ connectionString: url });
  await c.connect();
  const report = {
    mode: args.apply ? 'apply' : 'dry-run',
    through,
    generated_at: new Date().toISOString(),
    tenants: 0,
    to_create_years: 0,
    to_create_periods: 0,
    created_years: 0,
    refused: 0,
    errors: 0,
    per_tenant: [],
  };
  try {
    let tenantIds;
    if (approvedTenants) tenantIds = approvedTenants;
    else if (args.tenant) tenantIds = [args.tenant];
    else tenantIds = (await c.query('SELECT tenant_id FROM v_fiscal_coverage ORDER BY tenant_id')).rows.map((r) => r.tenant_id);
    if (args.tenant && !UUID.test(args.tenant)) throw new Error('--tenant must be a uuid');
    report.tenants = tenantIds.length;

    for (const tenantId of tenantIds) {
      const entry = { tenant_id: tenantId, rows: [], created: 0 };
      try {
        await c.query(args.apply ? 'BEGIN' : 'BEGIN READ ONLY');
        const res = args.apply
          ? await c.query('SELECT * FROM fn_ensure_fiscal_years($1, $2::date, false)', [tenantId, through])
          : await c.query('SELECT * FROM fn_plan_fiscal_years($1, $2::date)', [tenantId, through]);
        await c.query('COMMIT');
        entry.rows = res.rows;
        const create = res.rows.filter((r) => r.action === 'create').length;
        report.to_create_years += create;
        report.to_create_periods += create * 12;
        if (res.rows.some((r) => r.action === 'refuse')) report.refused += 1;
        entry.created = res.rows.filter((r) => r.created).length;
        report.created_years += entry.created;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => undefined);
        report.errors += 1;
        entry.error = e.message;
      }
      report.per_tenant.push(entry);
    }
  } finally {
    await c.end();
  }

  console.log(`mode=${report.mode} through=${report.through} tenants=${report.tenants}`);
  console.log(`years to create=${report.to_create_years} (periods=${report.to_create_periods}) created=${report.created_years} refused=${report.refused} errors=${report.errors}`);
  for (const t of report.per_tenant) {
    const first = t.rows.find((r) => r.action === 'refuse') || t.rows.find((r) => r.action === 'create') || t.rows[0];
    console.log(`  ${t.tenant_id}  ${t.error ? 'ERROR ' + t.error : (first ? first.action + (first.year_label ? ' ' + first.year_label : '') : '-')}`);
  }
  if (args.report) fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
  if (report.errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('fiscal-years:', e.message);
  process.exit(2);
});
