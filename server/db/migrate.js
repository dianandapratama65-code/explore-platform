// ============================================================
// Explore — server/db/migrate.js
// Menjalankan file SQL di migrations/ secara berurutan dan
// mencatatnya di tabel schema_migrations (idempoten).
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ROOT, startDatabase, stopDatabase, getSuperPool, ensureAppRole,
} from './pg.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrate() {
  await startDatabase();
  await ensureAppRole();

  const pool = getSuperPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const ran = [];
  for (const file of files) {
    if (applied.has(file)) continue;

    const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sqlText);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
      console.log(`  ✓ ${file}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migrasi gagal di ${file}: ${err.message}`);
    } finally {
      client.release();
    }
  }

  if (ran.length === 0) console.log('  Database sudah up-to-date.');
  return ran;
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  console.log('Menjalankan migrasi Explore...');
  migrate()
    .then(async (ran) => {
      console.log(`Selesai. ${ran.length} migrasi diterapkan.`);
      await stopDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('GAGAL:', err.message);
      await stopDatabase().catch(() => {});
      process.exit(1);
    });
}
