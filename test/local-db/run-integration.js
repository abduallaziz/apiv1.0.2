// Runs the DB-backed specs against the LOCAL test database only (docker compose in this folder).
// Usage: node test/local-db/run-integration.js [jest args, e.g. a spec path]
const { spawnSync } = require('child_process');
const path = require('path');
const jwt = require('jsonwebtoken');

const SECRET = 'local-test-only-jwt-secret-0123456789abcdef'; // same as docker-compose (dev-only)
const env = {
  ...process.env,
  TEST_SUPABASE_URL: 'http://127.0.0.1:54331',
  TEST_SUPABASE_SERVICE_ROLE_KEY: jwt.sign({ role: 'service_role' }, SECRET, { expiresIn: '2h' }),
  TEST_TENANT_ID: '9bcd3369-d664-47c8-b297-3bc9b429aacf',
  TEST_DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:54332/sefay_test',
  // the test tenant + the seeded 'other' tenant (isolation specs address it on purpose)
  TEST_ALLOWED_TENANT_IDS: '*', // loopback DB is disposable: negative isolation specs may use any id
  ALLOW_DB_WRITE_TESTS: 'local',
};
const r = spawnSync(
  process.execPath,
  [require.resolve('jest/bin/jest'), '--config', 'jest.integration.config.js', ...process.argv.slice(2)],
  { cwd: path.resolve(__dirname, '..', '..'), env, stdio: 'inherit' },
);
process.exit(r.status ?? 1);
