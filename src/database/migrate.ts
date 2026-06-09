import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const PROJECT_REF = 'uugxagglmkxcjmncxgja';

async function runSQL(sql: string): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('Missing SUPABASE_ACCESS_TOKEN in .env');

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query: sql }),
    },
  );

  const data = await response.json() as { error?: string; message?: string };

  if (!response.ok) {
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }
}

async function querySQL<T>(sql: string): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('Missing SUPABASE_ACCESS_TOKEN in .env');

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ query: sql }),
    },
  );

  const data = await response.json() as T[] | { error?: string; message?: string };

  if (!response.ok) {
    const err = data as { error?: string; message?: string };
    throw new Error(err.error || err.message || `HTTP ${response.status}`);
  }

  return data as T[];
}

async function ensureMigrationsTable(): Promise<void> {
  await runSQL(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT NOT NULL UNIQUE,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const rows = await querySQL<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY id ASC',
  );
  return new Set(rows.map((r) => r.filename));
}

async function getPendingMigrations(applied: Set<string>): Promise<string[]> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.filter((f) => !applied.has(f));
}

async function applyMigration(filename: string): Promise<void> {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, 'utf-8');

  console.log(`  → Applying: ${filename}`);

  await runSQL(sql);
  await runSQL(
    `INSERT INTO schema_migrations (filename) VALUES ('${filename}')`,
  );

  console.log(`  ✅ Applied: ${filename}`);
}

async function runMigrations(): Promise<void> {
  console.log('\n🚀 Sefay Migration Runner — Starting\n');

  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const pending = await getPendingMigrations(applied);

  if (pending.length === 0) {
    console.log('✅ Database is up to date. No migrations to apply.\n');
    return;
  }

  console.log(`📋 ${pending.length} migration(s) to apply:\n`);

  for (const filename of pending) {
    await applyMigration(filename);
  }

  console.log(`\n✅ Done. ${pending.length} migration(s) applied successfully.\n`);
}

runMigrations().catch((err) => {
  console.error('\n❌ Migration failed:\n', err.message);
  process.exit(1);
});