// ============================================================
// Explore — server/db/pg.js
// Menjalankan PostgreSQL (embedded / eksternal), membuat pool,
// dan menyediakan koneksi berteks RLS (app.user_id) untuk server.
// ============================================================
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool, Client } = pg;

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..'
);

const cfg = {
  host: process.env.PG_HOST || '127.0.0.1',
  port: Number(process.env.PG_PORT || 5433),
  database: process.env.PG_DATABASE || 'explore',
  user: process.env.PG_USER || 'explore',
  password: process.env.PG_PASSWORD || 'explore_local_dev',
  appUser: process.env.PG_APP_USER || 'explore_app',
  appPassword: process.env.PG_APP_PASSWORD || 'explore_app_dev',
  dataDir: path.resolve(ROOT, process.env.PG_DATA_DIR || 'var/pgdata'),
  external: process.env.PG_EXTERNAL === 'true',
  ssl: (() => {
    if (process.env.PG_SSL === 'true') return { rejectUnauthorized: false };
    if (process.env.PG_SSL === 'false') return undefined;
    // Auto-deteksi Neon (host mengandung 'neon.tech' atau 'neon.database')
    const h = process.env.PG_HOST || '';
    if (/neon\.(tech|database)/i.test(h)) return { rejectUnauthorized: false };
    return undefined;
  })(),
};

// Fail-fast (production): password DB wajib dikonfigurasi, bukan default dev.
if ((process.env.NODE_ENV || 'development') === 'production') {
  if (!process.env.PG_PASSWORD || process.env.PG_PASSWORD === 'explore_local_dev') {
    throw new Error('PG_PASSWORD wajib diisi di production (bukan default dev).');
  }
  if (!process.env.PG_APP_PASSWORD || process.env.PG_APP_PASSWORD === 'explore_app_dev') {
    throw new Error('PG_APP_PASSWORD wajib diisi di production (bukan default dev).');
  }
}

let embedded = null;
let started = false;
let superPool = null;
let appPool = null;

/** Cek apakah server PostgreSQL sudah bisa dihubungi. */
async function ping() {
  const client = new Client({
    host: cfg.host, port: cfg.port, database: cfg.database,
    user: cfg.user, password: cfg.password,
    ssl: cfg.ssl,
    connectionTimeoutMillis: 2500,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

/** Jalankan server PostgreSQL (embedded) bila belum berjalan. */
export async function startDatabase() {
  if (started) return cfg;

  if (await ping()) {
    started = true;
    return cfg;
  }
  if (cfg.external) {
    throw new Error(
      `PostgreSQL eksternal tidak terjangkau di ${cfg.host}:${cfg.port}`
    );
  }

  const initialised = fs.existsSync(path.join(cfg.dataDir, 'PG_VERSION'));
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  embedded = new EmbeddedPostgres({
    databaseDir: cfg.dataDir,
    user: cfg.user,
    password: cfg.password,
    port: cfg.port,
    persistent: true,
    // Cluster UTF-8 agar mendukung emoji/ikon & teks multi-bahasa
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['--listen_addresses=127.0.0.1'],
  });

  if (!initialised) await embedded.initialise();
  await embedded.start();
  await ensureDatabaseExists();

  started = true;
  return cfg;
}

/**
 * Buat database aplikasi bila belum ada.
 * (Pengganti embedded.createDatabase() yang membocorkan koneksi
 *  saat error "already exists".)
 */
async function ensureDatabaseExists() {
  const client = new Client({
    host: cfg.host, port: cfg.port, database: 'postgres',
    user: cfg.user, password: cfg.password,
    ssl: cfg.ssl,
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1', [cfg.database]
    );
    if (rows.length === 0) {
      const ident = `"${cfg.database.replace(/"/g, '""')}"`;
      await client.query(
        `CREATE DATABASE ${ident} ENCODING 'UTF8' TEMPLATE template0`
      );
    }
  } finally {
    await client.end().catch(() => {});
  }
}

/** Hentikan server embedded (dipanggil saat aplikasi berhenti). */
export async function stopDatabase() {
  // Tutup pool lebih dulu agar tidak ada koneksi yang terputus paksa
  await Promise.allSettled([superPool?.end(), appPool?.end()]);
  superPool = null;
  appPool = null;

  if (embedded && started) {
    // Matikan PostgreSQL dengan cara elegan (fast shutdown) terlebih dahulu
    // agar tidak ada koneksi yang memicu ECONNRESET saat berhenti.
    try {
      const { spawnSync } = await import('node:child_process');
      const pgCtl = path.join(ROOT, 'node_modules', '@embedded-postgres',
        'windows-x64', 'native', 'bin', 'pg_ctl.exe');
      if (fs.existsSync(pgCtl)) {
        spawnSync(pgCtl, ['-D', cfg.dataDir, '-m', 'fast', '-w', 'stop'],
          { stdio: 'ignore' });
      }
    } catch { /* lanjut ke taskkill */ }

    try { await embedded.stop(); } catch { /* sudah berhenti */ }
    embedded = null;
  }
  started = false;
}

/** Pool superuser — hanya untuk migrate/seed/script (mem bypass RLS). */
export function getSuperPool() {
  if (!superPool) {
    superPool = new Pool({
      host: cfg.host, port: cfg.port, database: cfg.database,
      user: cfg.user, password: cfg.password,
      ssl: cfg.ssl,
      max: 4,
    });
    superPool.on('error', () => {}); // hindari crash saat server berhenti
  }
  return superPool;
}

/** Pool role aplikasi — DITEGAKKAN RLS-nya (non-superuser). */
export function getAppPool() {
  if (!appPool) {
    appPool = new Pool({
      host: cfg.host, port: cfg.port, database: cfg.database,
      user: cfg.appUser, password: cfg.appPassword,
      ssl: cfg.ssl,
      max: 10,
      idleTimeoutMillis: 30000,
    });
    appPool.on('error', () => {}); // hindari crash saat server berhenti
  }
  return appPool;
}

/**
 * Pastikan role aplikasi ada (dibuat & diperbarui oleh superuser).
 * Tanpa role ini RLS tidak akan ditegakkan (koneksi superuser bypass RLS).
 */
export async function ensureAppRole() {
  const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const pool = getSuperPool();
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${lit(cfg.appUser)}) THEN
        CREATE ROLE ${ident(cfg.appUser)} LOGIN PASSWORD ${lit(cfg.appPassword)};
      ELSE
        ALTER ROLE ${ident(cfg.appUser)} LOGIN PASSWORD ${lit(cfg.appPassword)};
      END IF;
    END
    $$;
  `);
}

/**
 * Jalankan fungsi dalam satu transaksi dengan konteks RLS:
 *   app.user_id = id pengguna (NULL untuk guest).
 *
 * @param {{id:string}|null} user  pengguna yang sedang login
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
export async function withDb(user, fn) {
  const client = await getAppPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      user?.id ? String(user.id) : '',
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    throw err;
  } finally {
    client.release();
  }
}

/** Penjalan query singkat dengan konteks RLS. */
export async function sql(user, text, params = []) {
  return withDb(user, (c) => c.query(text, params));
}

export { cfg as dbConfig };
