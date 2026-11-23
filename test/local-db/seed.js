// Seeds the LOCAL test database only: test/local-db/seed.sql (tenant fixtures) and the product
// permission/role seed (src/database/seeds/permissions.seed.ts) which production runs at every
// start (`start:prod`). Run AFTER apply.js and AFTER the REST container is up.
// Usage: node test/local-db/seed.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const DB_PORT = process.env.LOCAL_DB_PORT || 54332;
const REST_PORT = process.env.LOCAL_REST_PORT || 54331;
const URL_ = process.env.LOCAL_TEST_DATABASE_URL || `postgres://postgres:postgres@127.0.0.1:${DB_PORT}/sefay_test`;
const host = new URL(URL_).hostname;
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
  console.error('Refusing: local test DB script only talks to loopback.');
  process.exit(2);
}
const SECRET = 'local-test-only-jwt-secret-0123456789abcdef'; // same dev-only secret as docker-compose
const root = path.resolve(__dirname, '..', '..');

(async () => {
  const c = new Client({ connectionString: URL_ });
  await c.connect();
  await c.query(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'));
  await c.end();
  console.log('seed.sql applied');

  const r = spawnSync(
    process.execPath,
    [require.resolve('ts-node/dist/bin'), '-r', path.join(__dirname, 'strip-rest-prefix.js'), '-r', 'tsconfig-paths/register', 'src/database/seeds/permissions.seed.ts'],
    {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        SUPABASE_URL: `http://127.0.0.1:${REST_PORT}`,
        SUPABASE_SERVICE_ROLE_KEY: jwt.sign({ role: 'service_role' }, SECRET, { expiresIn: '1h' }),
      },
    },
  );
  process.exit(r.status ?? 1);
})();
