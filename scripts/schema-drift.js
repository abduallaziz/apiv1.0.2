#!/usr/bin/env node
/* eslint-disable */
// Schema drift check (WP-C, C3). LOCAL ONLY: talks to the loopback Postgres of test/local-db and refuses
// any other host. It never connects to any hosted database.
//
// What it does:
//   1. creates two throw-away databases on the local server (sefay_drift_local, sefay_drift_snap);
//   2. builds "local" = test/local-db/bootstrap.sql + every file of src/database/migrations (+ pending with --with-pending);
//   3. builds "snapshot" = bootstrap.sql + the schema-only SQL you give it (pg_restore -s -f - dump / pg_dump -s);
//      statements are replayed one by one and individual failures are reported, not fatal;
//   4. introspects both (schema public: tables, columns, constraints, indexes, functions, triggers, policies, RLS flags,
//      views, sequences, enums) and prints every difference by object;
//   5. drops both databases (unless --keep).
//
// Usage:
//   node scripts/schema-drift.js --snapshot-sql <schema.sql> [--with-pending] [--json out.json] [--keep] [--report-only]
// Env: LOCAL_DB_PORT (default 54332) or LOCAL_ADMIN_DATABASE_URL (loopback only).
// Exit: 0 no differences (or --report-only), 1 differences, 2 usage/error.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LOOPBACK = ['127.0.0.1', 'localhost', '::1', '[::1]'];

// ---------- pure comparison (unit tested) ----------
const CATEGORIES = [
  'tables', 'columns', 'constraints', 'indexes', 'functions', 'triggers', 'policies', 'rls', 'views', 'sequences', 'enums',
];

/** Each schema: { category: { key: stringValue } }. Returns a flat, sorted list of differences. */
function compareSchemas(local, snapshot) {
  const out = [];
  for (const cat of CATEGORIES) {
    const a = local[cat] || {};
    const b = snapshot[cat] || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) {
      if (!(k in b)) out.push({ category: cat, key: k, kind: 'only_in_migrations', local: a[k] });
      else if (!(k in a)) out.push({ category: cat, key: k, kind: 'only_in_snapshot', snapshot: b[k] });
      else if (a[k] !== b[k]) out.push({ category: cat, key: k, kind: 'different', local: a[k], snapshot: b[k] });
    }
  }
  return out;
}

const squash = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

// ---------- introspection ----------
const NOT_EXT = (alias, cls) =>
  `NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.objid = ${alias}.oid AND dep.classid = '${cls}'::regclass AND dep.deptype = 'e')`;

async function introspect(c) {
  const s = Object.fromEntries(CATEGORIES.map((k) => [k, {}]));
  const q = async (sql) => (await c.query(sql)).rows;

  for (const r of await q(`
    SELECT c.relname AS tbl, c.relkind, c.relrowsecurity AS rls, c.relforcerowsecurity AS frls
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f') AND ${NOT_EXT('c', 'pg_class')}`)) {
    s.tables[r.tbl] = r.relkind;
    if (r.relkind === 'r' || r.relkind === 'p') s.rls[r.tbl] = `rls=${r.rls} force=${r.frls}`;
  }
  for (const r of await q(`
    SELECT c.relname AS tbl, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS nn,
           pg_get_expr(d.adbin, d.adrelid) AS def, a.attidentity AS ident, a.attgenerated AS gen
    FROM pg_class c
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f') AND ${NOT_EXT('c', 'pg_class')}`)) {
    s.columns[`${r.tbl}.${r.col}`] = `${r.type} | not_null=${r.nn} | default=${squash(r.def)} | identity=${r.ident} | generated=${r.gen}`;
  }
  for (const r of await q(`
    SELECT cl.relname AS tbl, co.conname, pg_get_constraintdef(co.oid) AS def
    FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid
    WHERE co.connamespace = 'public'::regnamespace`)) {
    s.constraints[`${r.tbl}.${r.conname}`] = squash(r.def);
  }
  for (const r of await q(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`)) {
    s.indexes[`${r.tablename}.${r.indexname}`] = squash(r.indexdef);
  }
  for (const r of await q(`
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig, pg_get_functiondef(p.oid) AS def
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f','p') AND ${NOT_EXT('p', 'pg_proc')}`)) {
    s.functions[r.sig] = squash(r.def);
  }
  for (const r of await q(`
    SELECT cl.relname AS tbl, t.tgname, pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t JOIN pg_class cl ON cl.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND cl.relnamespace = 'public'::regnamespace`)) {
    s.triggers[`${r.tbl}.${r.tgname}`] = squash(r.def);
  }
  for (const r of await q(`SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check FROM pg_policies WHERE schemaname = 'public'`)) {
    s.policies[`${r.tablename}.${r.policyname}`] = `${r.cmd} roles=${r.roles} using=${squash(r.qual)} check=${squash(r.with_check)}`;
  }
  for (const r of await q(`SELECT c.relname AS v, pg_get_viewdef(c.oid) AS def FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v','m')`)) {
    s.views[r.v] = squash(r.def);
  }
  for (const r of await q(`SELECT sequencename, data_type::text AS dt, increment_by FROM pg_sequences WHERE schemaname = 'public'`)) {
    s.sequences[r.sequencename] = `${r.dt} inc=${r.increment_by}`;
  }
  for (const r of await q(`
    SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typnamespace = 'public'::regnamespace GROUP BY t.typname`)) {
    s.enums[r.typname] = r.labels;
  }
  return s;
}

// ---------- runner ----------
function assertLoopback(url) {
  const host = new URL(url).hostname;
  if (!LOOPBACK.includes(host)) {
    console.error('Refusing: schema-drift only talks to a loopback Postgres.');
    process.exit(2);
  }
}

function withDb(adminUrl, dbName) {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function replay(client, sql) {
  const { splitStatements } = require('./lint-migrations.js');
  const cleaned = sql.split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n'); // psql meta-commands (\restrict ...)
  const errors = [];
  let ok = 0;
  for (const st of splitStatements(cleaned)) {
    const text = st.raw.trim();
    if (!text) continue;
    try {
      await client.query(text);
      ok++;
    } catch (e) {
      errors.push(`${e.message}  <<  ${squash(text).slice(0, 110)}`);
    }
  }
  return { ok, errors };
}

async function main(argv) {
  const get = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };
  const snapFile = get('--snapshot-sql');
  if (!snapFile) {
    console.error('usage: schema-drift.js --snapshot-sql <schema.sql> [--with-pending] [--json out.json] [--keep] [--report-only]');
    return 2;
  }
  const { Client } = require('pg');
  const adminUrl = process.env.LOCAL_ADMIN_DATABASE_URL || `postgres://postgres:postgres@127.0.0.1:${process.env.LOCAL_DB_PORT || 54332}/postgres`;
  assertLoopback(adminUrl);
  const withPending = argv.includes('--with-pending');
  const keep = argv.includes('--keep');
  const DBS = { local: 'sefay_drift_local', snap: 'sefay_drift_snap' };

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  for (const d of Object.values(DBS)) {
    await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${d}`);
  }

  try {
    // 1) local = migrations through the same applier the integration tests use
    const localUrl = withDb(adminUrl, DBS.local);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'test/local-db/apply.js'), ...(withPending ? ['--with-pending'] : [])], {
      cwd: ROOT,
      env: { ...process.env, LOCAL_TEST_DATABASE_URL: localUrl },
      encoding: 'utf8',
    });
    process.stderr.write(r.stderr || '');
    if (r.status !== 0) { console.error('building the local schema from migrations failed'); return 2; }
    console.log('local build:', (r.stdout || '').trim());

    // 2) snapshot = bootstrap + schema-only SQL
    const snapClient = new Client({ connectionString: withDb(adminUrl, DBS.snap) });
    await snapClient.connect();
    await snapClient.query(fs.readFileSync(path.join(ROOT, 'test/local-db/bootstrap.sql'), 'utf8'));
    // Supabase keeps extensions in schema "extensions" (the dump references extensions.uuid_generate_v4()).
    await snapClient.query('DROP EXTENSION IF EXISTS "uuid-ossp"; DROP EXTENSION IF EXISTS pgcrypto; CREATE SCHEMA IF NOT EXISTS extensions;' +
      ' CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;' +
      ' GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;' +
      ' CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS btree_gist;'); // referenced as public.gin_trgm_ops / gist uuid ops in the dump
    const rep = await replay(snapClient, fs.readFileSync(snapFile, 'utf8'));
    console.log(`snapshot replay: ${rep.ok} statement(s) ok, ${rep.errors.length} failed (ignored)`);
    const errSummary = {};
    for (const e of rep.errors) { const k = e.split('  <<')[0]; errSummary[k] = (errSummary[k] || 0) + 1; }
    for (const [k, v] of Object.entries(errSummary).slice(0, 15)) console.log(`   replay error x${v}: ${k}`);

    const localClient = new Client({ connectionString: localUrl });
    await localClient.connect();
    // same search_path on both sides so extension functions print the same way
    await localClient.query('SET search_path = public, extensions');
    await snapClient.query('SET search_path = public, extensions');
    const a = await introspect(localClient);
    const b = await introspect(snapClient);
    await localClient.end();
    await snapClient.end();

    const diffs = compareSchemas(a, b);
    if (get('--json')) fs.writeFileSync(get('--json'), JSON.stringify({ diffs, replayErrors: rep.errors }, null, 2));
    console.log(`\nobjects: migrations-built=${CATEGORIES.map((k) => `${k}:${Object.keys(a[k]).length}`).join(' ')}`);
    console.log(`         snapshot       =${CATEGORIES.map((k) => `${k}:${Object.keys(b[k]).length}`).join(' ')}\n`);
    for (const d of diffs) {
      const detail = d.kind === 'different' ? `\n      migrations: ${String(d.local).slice(0, 240)}\n      snapshot:   ${String(d.snapshot).slice(0, 240)}` : '';
      console.log(`${d.kind.padEnd(18)} ${d.category.padEnd(11)} ${d.key}${detail}`);
    }
    console.log(`\n${diffs.length} difference(s).`);
    if (diffs.length === 0 || argv.includes('--report-only')) return 0;
    return 1;
  } finally {
    if (!keep) for (const d of Object.values(DBS)) await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
}

module.exports = { compareSchemas, introspect, CATEGORIES };

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(2); });
}
