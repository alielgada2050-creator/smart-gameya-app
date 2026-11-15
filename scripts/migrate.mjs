// Applies infrastructure/database/migrations/*.sql in order, once each, recording them in schema_migrations.
// Usage: DATABASE_URL=postgresql://... node scripts/migrate.mjs
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps/api/package.json'));
const { Client } = require('pg');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }

const dir = join(root, 'infrastructure/database/migrations');
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
const db = new Client({ connectionString: url, ssl: process.env.PGSSL === 'require' ? { rejectUnauthorized: true } : undefined });
await db.connect();
try {
  await db.query('SELECT pg_advisory_lock(727001)');
  await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) { console.log(`skip   ${f}`); continue; }
    await db.query('BEGIN');
    try {
      await db.query(await readFile(join(dir, f), 'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await db.query('COMMIT');
      console.log(`apply  ${f}`);
    } catch (e) { await db.query('ROLLBACK'); console.error(`FAILED ${f}: ${e.message}`); process.exit(1); }
  }
} finally { await db.end(); }
