// DB-backed regression/integration specs. NEVER runs unless the safety guard
// passes (see test/support/db-safety.ts): dedicated allow-listed test project,
// explicit ALLOW_DB_WRITE_TESTS=<project ref>, dedicated TEST_TENANT_ID, and
// not the app's own (production/staging) database. Serial on purpose: specs
// share the test tenant's fixtures.
const { findDbSpecs } = require('./test/support/db-specs');

module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testMatch: findDbSpecs(__dirname).map((p) => '<rootDir>/' + p),
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/support/integration-global-setup.ts',
  setupFilesAfterEnv: ['<rootDir>/test/support/integration-setup.ts'],
  maxWorkers: 1,
};
