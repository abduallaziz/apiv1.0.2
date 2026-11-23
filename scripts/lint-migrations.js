#!/usr/bin/env node
/* eslint-disable */
// Migration lint (WP-C). Blocks, in migration SQL:
//   DROP_TABLE / DROP_COLUMN / DROP_SCHEMA, TRUNCATE, DELETE without WHERE, UPDATE without WHERE,
//   NON_IDEMPOTENT_CREATE (CREATE TABLE/INDEX/SEQUENCE/SCHEMA/EXTENSION/TYPE without IF NOT EXISTS,
//   ADD COLUMN without IF NOT EXISTS, CREATE TRIGGER/POLICY and ADD CONSTRAINT without a preceding
//   DROP ... IF EXISTS of the same name).
// A statement is allowed only with an annotation WITH A REASON, either in the comment block right
// before it or inside it:   -- lint:allow <reason>
//
// Only top-level statements and DO blocks are checked: DELETE/UPDATE inside a function body is run-time
// logic, not a one-off data change.
//
// CLI:
//   node scripts/lint-migrations.js --changed <base-ref>   lint migration files added/changed vs base (CI mode)
//   node scripts/lint-migrations.js --pending              lint src/database/migrations_pending/*.sql
//   node scripts/lint-migrations.js --report               informational scan of every file, always exit 0
//   node scripts/lint-migrations.js file1.sql file2.sql    lint the given files
// Exit code: 0 clean, 1 violations, 2 usage/error.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/** Split SQL into top-level statements. Comments/strings are masked in `code`; dollar bodies are kept in `bodies`. */
function splitStatements(sql) {
  const stmts = [];
  let i = 0;
  const n = sql.length;
  let cur = { code: '', start: 0, bodies: [], lead: '', raw: '', started: false };
  let leadStart = 0;

  function finish(end) {
    cur.raw = sql.slice(cur.start, end);
    if (cur.code.trim()) stmts.push(cur);
    cur = { code: '', start: end, bodies: [], lead: '', raw: '', started: false };
    leadStart = end;
  }
  function beginIfNeeded(pos) {
    if (!cur.started) {
      cur.started = true;
      cur.lead = sql.slice(leadStart, pos);
      cur.start = pos;
    }
  }

  while (i < n) {
    const c = sql[i];
    const c2 = sql.substr(i, 2);
    if (c2 === '--') {
      const e = sql.indexOf('\n', i);
      const end = e === -1 ? n : e;
      if (cur.started) cur.code += ' ';
      i = end;
      continue;
    }
    if (c2 === '/*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql.substr(j, 2) === '/*') { depth++; j += 2; }
        else if (sql.substr(j, 2) === '*/') { depth--; j += 2; }
        else j++;
      }
      if (cur.started) cur.code += ' ';
      i = j;
      continue;
    }
    if (/\s/.test(c)) {
      if (cur.started) cur.code += c;
      i++;
      continue;
    }
    beginIfNeeded(i);
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") { j++; break; }
        else j++;
      }
      cur.code += "''";
      i = j;
      continue;
    }
    if (c === '"') {
      const j = sql.indexOf('"', i + 1);
      const end = j === -1 ? n : j + 1;
      cur.code += sql.slice(i, end); // quoted identifiers are kept (names matter)
      i = end;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const bodyEnd = close === -1 ? n : close;
        cur.bodies.push(sql.slice(i + tag.length, bodyEnd));
        cur.code += '$$$$';
        i = close === -1 ? n : close + tag.length;
        continue;
      }
    }
    if (c === ';') {
      i++;
      finish(i);
      continue;
    }
    cur.code += c;
    i++;
  }
  finish(n);
  return stmts;
}

const IDENT = '(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$.]*)';
const norm = (s) => s.replace(/"/g, '').toLowerCase();

function hasAllow(text) {
  const m = /lint:allow\b[ \t]*(.*)/i.exec(text);
  if (!m) return { present: false };
  const reason = m[1].replace(/\*\/.*$/, '').trim();
  return { present: true, reason };
}

function lineOf(sql, pos) {
  let l = 1;
  for (let k = 0; k < pos && k < sql.length; k++) if (sql[k] === '\n') l++;
  return l;
}

const PLPGSQL_LEAD = /^(?:BEGIN|THEN|ELSE|LOOP|IF.*?THEN|ELSIF.*?THEN|FOR.*?LOOP|WHILE.*?LOOP|EXCEPTION\s+WHEN\s+\S+\s+THEN|DECLARE.*?BEGIN)\s+/i;

function destructiveRules(code, nested) {
  const out = [];
  let c = code.replace(/\s+/g, ' ').trim();
  if (nested) {
    // PL/pgSQL statements start after block keywords; peel them so DELETE/UPDATE/... are recognised
    for (let k = 0; k < 6 && PLPGSQL_LEAD.test(c); k++) c = c.replace(PLPGSQL_LEAD, '');
  }
  if (/^DROP (TABLE|FOREIGN TABLE)\b/i.test(c)) out.push(['DROP_TABLE', 'DROP TABLE removes data']);
  if (/^DROP (SCHEMA|DATABASE)\b/i.test(c)) out.push(['DROP_TABLE', 'DROP SCHEMA/DATABASE removes data']);
  if (/^ALTER (TABLE|FOREIGN TABLE)\b.*\bDROP (COLUMN)\b/i.test(c) || /^ALTER TABLE\b.*\bDROP COLUMN\b/i.test(c))
    out.push(['DROP_COLUMN', 'DROP COLUMN removes data']);
  if (/^TRUNCATE\b/i.test(c)) out.push(['TRUNCATE', 'TRUNCATE removes all rows']);
  if (/^DELETE FROM\b/i.test(c) && !/\bWHERE\b/i.test(c)) out.push(['DELETE_NO_WHERE', 'DELETE without WHERE']);
  if (/^UPDATE\b/i.test(c) && !/\bWHERE\b/i.test(c)) out.push(['UPDATE_NO_WHERE', 'UPDATE without WHERE']);
  return out;
}

function idempotencyRules(code, priorDrops) {
  const out = [];
  const c = code.replace(/\s+/g, ' ').trim();
  let m;
  if (/^CREATE (UNLOGGED |TEMP |TEMPORARY )?TABLE\b/i.test(c) && !/^CREATE (UNLOGGED |TEMP |TEMPORARY )?TABLE IF NOT EXISTS\b/i.test(c))
    out.push(['NON_IDEMPOTENT_CREATE', 'CREATE TABLE without IF NOT EXISTS']);
  if (/^CREATE (UNIQUE )?INDEX\b/i.test(c) && !/^CREATE (UNIQUE )?INDEX (CONCURRENTLY )?IF NOT EXISTS\b/i.test(c))
    out.push(['NON_IDEMPOTENT_CREATE', 'CREATE INDEX without IF NOT EXISTS']);
  if (/^CREATE SEQUENCE\b/i.test(c) && !/^CREATE SEQUENCE IF NOT EXISTS\b/i.test(c))
    out.push(['NON_IDEMPOTENT_CREATE', 'CREATE SEQUENCE without IF NOT EXISTS']);
  if (/^CREATE SCHEMA\b/i.test(c) && !/^CREATE SCHEMA IF NOT EXISTS\b/i.test(c))
    out.push(['NON_IDEMPOTENT_CREATE', 'CREATE SCHEMA without IF NOT EXISTS']);
  if (/^CREATE EXTENSION\b/i.test(c) && !/^CREATE EXTENSION IF NOT EXISTS\b/i.test(c))
    out.push(['NON_IDEMPOTENT_CREATE', 'CREATE EXTENSION without IF NOT EXISTS']);
  if (/^CREATE TYPE\b/i.test(c))
    out.push(['NON_IDEMPOTENT_CREATE', 'CREATE TYPE is not idempotent (guard it in a DO block or annotate)']);
  if ((m = new RegExp(`^CREATE (?:OR REPLACE )?(?:CONSTRAINT )?TRIGGER (${IDENT}) .*? ON (${IDENT})`, 'i').exec(c))) {
    if (!/^CREATE OR REPLACE\b/i.test(c) && !priorDrops.has(`trigger:${norm(m[1])}`))
      out.push(['NON_IDEMPOTENT_CREATE', `CREATE TRIGGER ${m[1]} without a preceding DROP TRIGGER IF EXISTS`]);
  }
  if ((m = new RegExp(`^CREATE POLICY (${IDENT}|'[^']*') ON`, 'i').exec(c))) {
    if (!priorDrops.has(`policy:${norm(m[1])}`))
      out.push(['NON_IDEMPOTENT_CREATE', `CREATE POLICY ${m[1]} without a preceding DROP POLICY IF EXISTS`]);
  }
  if (/^ALTER TABLE\b/i.test(c)) {
    const adds = c.match(/\bADD COLUMN\b(?! IF NOT EXISTS)/gi);
    if (adds) out.push(['NON_IDEMPOTENT_CREATE', 'ADD COLUMN without IF NOT EXISTS']);
    const cons = [...c.matchAll(new RegExp(`\\bADD CONSTRAINT (${IDENT})`, 'gi'))];
    for (const cm of cons) {
      if (!priorDrops.has(`constraint:${norm(cm[1])}`))
        out.push(['NON_IDEMPOTENT_CREATE', `ADD CONSTRAINT ${cm[1]} without a preceding DROP CONSTRAINT IF EXISTS`]);
    }
  }
  return out;
}

function collectDrops(code, set) {
  const c = code.replace(/\s+/g, ' ').trim();
  let m;
  if ((m = new RegExp(`^DROP TRIGGER IF EXISTS (${IDENT})`, 'i').exec(c))) set.add(`trigger:${norm(m[1])}`);
  if ((m = new RegExp(`^DROP POLICY IF EXISTS (${IDENT}|'[^']*')`, 'i').exec(c))) set.add(`policy:${norm(m[1])}`);
  for (const cm of c.matchAll(new RegExp(`\\bDROP CONSTRAINT IF EXISTS (${IDENT})`, 'gi'))) set.add(`constraint:${norm(cm[1])}`);
}

/** @returns {{file:string,line:number,rule:string,message:string,allowed:boolean}[]} violations (allowed ones omitted) */
function lintSql(sql, file = '<sql>') {
  const violations = [];
  const priorDrops = new Set();

  function check(stmt, baseLine, isNested) {
    collectDrops(stmt.code, priorDrops);
    const found = destructiveRules(stmt.code, isNested);
    if (!isNested) found.push(...idempotencyRules(stmt.code, priorDrops));
    if (/^DO\b/i.test(stmt.code.trim())) {
      for (const body of stmt.bodies) {
        for (const inner of splitStatements(body)) check(inner, baseLine, true);
      }
    }
    if (found.length === 0) return;
    const a = hasAllow(`${stmt.lead}\n${stmt.raw}`);
    for (const [rule, message] of found) {
      if (a.present && a.reason) continue;
      violations.push({
        file,
        line: baseLine,
        rule,
        message: a.present ? `${message} ("-- lint:allow" needs a reason)` : message,
      });
    }
  }

  for (const s of splitStatements(sql)) {
    const stmtLine = lineOf(sql, s.start);
    // nested statements inherit the DO statement's line and its annotation (lead/raw of the DO block)
    const nestedOwner = s;
    check(s, stmtLine, false);
    void nestedOwner;
  }
  return violations;
}

function lintFile(p) {
  return lintSql(fs.readFileSync(p, 'utf8'), p);
}

function gitChanged(base, root) {
  const out = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=AM', `${base}...HEAD`, '--', 'src/database/migrations', 'src/database/migrations_pending'],
    { cwd: root, encoding: 'utf8' },
  );
  // rollback scripts are destructive by nature; they are reviewed together with their migration
  return out.split(/\r?\n/).filter((f) => f.endsWith('.sql') && !/\/rollback\//.test(f)).map((f) => path.join(root, f));
}

function main(argv) {
  const root = path.resolve(__dirname, '..');
  let files = [];
  let report = false;
  if (argv[0] === '--changed') {
    if (!argv[1]) { console.error('usage: --changed <base-ref>'); return 2; }
    files = gitChanged(argv[1], root);
  } else if (argv[0] === '--pending') {
    const d = path.join(root, 'src/database/migrations_pending');
    files = fs.readdirSync(d).filter((f) => f.endsWith('.sql')).map((f) => path.join(d, f));
  } else if (argv[0] === '--report') {
    report = true;
    for (const dn of ['migrations', 'migrations_pending']) {
      const d = path.join(root, 'src/database', dn);
      files.push(...fs.readdirSync(d).filter((f) => f.endsWith('.sql')).map((f) => path.join(d, f)));
    }
  } else if (argv.length) {
    files = argv.map((f) => path.resolve(f));
  } else {
    console.error('usage: lint-migrations.js --changed <base> | --pending | --report | <files...>');
    return 2;
  }
  let total = 0;
  const perRule = {};
  for (const f of files) {
    for (const v of lintFile(f)) {
      total++;
      perRule[v.rule] = (perRule[v.rule] || 0) + 1;
      if (!report) console.error(`${path.relative(root, v.file)}:${v.line}  [${v.rule}] ${v.message}`);
    }
  }
  if (report) {
    console.log(`scanned ${files.length} files; ${total} finding(s)`, perRule);
    return 0;
  }
  if (total > 0) {
    console.error(`\nmigration lint: ${total} violation(s) in ${files.length} file(s). ` +
      'Fix them, or annotate the statement with "-- lint:allow <reason>" and get owner review.');
    return 1;
  }
  console.log(`migration lint: ${files.length} file(s) clean.`);
  return 0;
}

module.exports = { lintSql, lintFile, splitStatements };

if (require.main === module) process.exit(main(process.argv.slice(2)));
