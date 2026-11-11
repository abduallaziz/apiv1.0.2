import * as path from 'path';
import { assertSafeOrThrow, evaluateFromEnv } from './db-safety';

/**
 * Runs once in the main Jest process BEFORE any spec is loaded and before any
 * client exists. If any safety condition fails the whole run aborts here, so
 * zero connections / zero writes happen.
 */
export default async function globalSetup(): Promise<void> {
  const result = evaluateFromEnv(process.env, path.resolve(__dirname, '..', '..'));
  assertSafeOrThrow(result);
  process.env.TEST_RUN_ID = `run-${Date.now().toString(36)}`;
  // eslint-disable-next-line no-console
  console.log(
    `\n[test-db-guard] OK — isolated test project ${result.ref}, run ${process.env.TEST_RUN_ID}`,
  );
}
