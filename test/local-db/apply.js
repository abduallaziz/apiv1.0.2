// Applies bootstrap + every migration to the LOCAL test database only.
// Usage: node test/local-db/apply.js [--with-pending]
// Refuses any host other than loopback.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const URL_ = process.env.LOCAL_TEST_DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:54332/sefay_test';
const host = new URL(URL_).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  console.error('Refusing: local test DB script only talks to loopback.');
  process.exit(2);
}
const withPending = process.argv.includes('--with-pending');
const root = path.resolve(__dirname, '..', '..');
const dirs = [path.join(root, 'src/database/migrations')];
if (withPending) dirs.push(path.join(root, 'src/database/migrations_pending'));

(async () => {
  const c = new Client({ connectionString: URL_ });
  await c.connect();
  await c.query(fs.readFileSync(path.join(__dirname, 'bootstrap.sql'), 'utf8'));
  await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (id SERIAL PRIMARY KEY, filename TEXT UNIQUE NOT NULL, applied_at TIMESTAMPTZ DEFAULT now())');
  const done = new Set((await c.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename));
  const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.sql')).map((f) => ({ f, p: path.join(d, f) })))
    .sort((a, b) => a.f.localeCompare(b.f));
  let n = 0;
  for (const { f, p } of files) {
    if (done.has(f)) continue;
    try {
      await c.query(fs.readFileSync(p, 'utf8'));
      await c.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
      n++;
    } catch (e) {
      console.error(`FAILED ${f}: ${e.message}`);
      await c.end();
      process.exit(1);
    }
  }
  await c.query("NOTIFY pgrst, 'reload schema'");
  console.log(`applied ${n} migration(s); total recorded ${done.size + n}`);
  await c.end();
})();
