/**
 * Per-worker setup for the integration project (setupFilesAfterEnv).
 *  1. Re-points every DB env var at the TEST_* values (or blanks them) BEFORE a
 *     spec's own `import 'dotenv/config'` runs — dotenv never overrides an
 *     already-set variable, so the app's real .env can't leak in.
 *  2. Replaces @supabase/supabase-js#createClient with a version that
 *     re-validates the project identity and returns a guarded client.
 */
import * as path from 'path';
import { assertSafeOrThrow, evaluateFromEnv } from './db-safety';

process.env.SUPABASE_URL = process.env.TEST_SUPABASE_URL ?? '';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ?? '';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';

jest.mock('@supabase/supabase-js', () => {
  const actual = jest.requireActual('@supabase/supabase-js');
  const safety = require('./db-safety');
  const { guardClient } = require('./guarded-client');
  const nodePath = require('path');
  return {
    ...actual,
    createClient: (url: string, key: string, opts?: unknown) => {
      const result = safety.evaluateFromEnv(
        process.env,
        nodePath.resolve(__dirname, '..', '..'),
      );
      safety.assertSafeOrThrow(result);
      if (safety.projectRefFromUrl(url) !== result.ref) {
        throw new Error(
          'Test guard: createClient URL is not the allowed test project',
        );
      }
      const tenants = (
        process.env.TEST_ALLOWED_TENANT_IDS ?? process.env.TEST_TENANT_ID ?? ''
      )
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      // The local docker stack exposes bare PostgREST (no Kong), so the
      // '/rest/v1' prefix supabase-js adds must be stripped for loopback URLs.
      let finalOpts: any = opts;
      if (result.ref === 'local') {
        const baseFetch = (opts as any)?.global?.fetch ?? fetch;
        finalOpts = {
          ...(opts as object),
          global: {
            ...((opts as any)?.global ?? {}),
            fetch: (input: any, init?: any) =>
              baseFetch(
                typeof input === 'string'
                  ? input.replace('/rest/v1/', '/')
                  : input,
                init,
              ),
          },
        };
      }
      return guardClient(actual.createClient(url, key, finalOpts), tenants);
    },
  };
});

// Fail the worker immediately if somehow started without the global guard.
assertSafeOrThrow(evaluateFromEnv(process.env, path.resolve(__dirname, '..', '..')));
