import 'dotenv/config';
import * as path from 'path';
import {
  EXIT,
  RunnerError,
  createApi,
  loadConfig,
  runMigrations,
  shouldSkipOnBoot,
} from './migration-runner';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function main(): Promise<void> {
  const cfg = loadConfig(process.env, process.argv.slice(2));

  if (shouldSkipOnBoot(cfg)) {
    console.log(
      'MIGRATIONS_ON_BOOT=false: skipping migrations at boot (they run only from the release job).',
    );
    return;
  }

  const api = createApi(cfg, process.env.SUPABASE_ACCESS_TOKEN, fetch as never);
  await runMigrations(cfg, { api, dir: MIGRATIONS_DIR });

  // a dry run never writes anything, seeds included; the release job seeds nothing (no DB-client secrets there)
  if (cfg.dryRun || process.argv.includes('--no-seed')) return;

  // Imported lazily: the seed module creates a Supabase client at import time and a dry run /
  // release job without those variables must not crash before it gets here.
  const { seedPermissions } = await import('./seeds/permissions.seed');
  await seedPermissions();
}

main().catch((err) => {
  console.error('\n❌ Migration failed:\n', err?.message ?? err);
  process.exit(err instanceof RunnerError ? err.exitCode : EXIT.FAILURE);
});
