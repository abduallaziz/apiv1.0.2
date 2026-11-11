// Default Jest config = UNIT tests only. Specs that talk to a real
// Supabase/Postgres (detected by content, see test/support/db-specs.js) are
// excluded here and run only via `npm run test:integration`, which enforces
// the isolated-test-project guard.
const { findDbSpecs } = require('./test/support/db-specs');

const dbSpecs = findDbSpecs(__dirname);
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test/support'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', ...dbSpecs.map((p) => escape(p) + '$')],
};
