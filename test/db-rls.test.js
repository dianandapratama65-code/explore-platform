// ============================================================
// Explore — test/db-rls.test.js
// Verifikasi Phase 2: skema, integritas, dan Row Level Security.
// Menjalankan: npm test
// ============================================================
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startDatabase, stopDatabase, getSuperPool, ensureAppRole, withDb,
} from '../server/db/pg.js';

let pool;
const ids = {};

before(async () => {
  await startDatabase();
  await ensureAppRole();
  pool = getSuperPool();
  const users = await pool.query(
    `SELECT id, email, role FROM users WHERE email IN
      ('admin@explore.test','contributor@explore.test','explorer@explore.test')`
  );
  for (const u of users.rows) ids[u.role] = u.id;
});

after(async () => {
  await stopDatabase();
});

test('database menggunakan encoding UTF-8', async () => {
  const { rows } = await pool.query(
    `SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database
      WHERE datname = current_database()`
  );
  assert.equal(rows[0].enc, 'UTF8');
});

test('seluruh tabel inti mengaktifkan RLS', async () => {
  const { rows } = await pool.query(`
    SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname NOT LIKE 'schema_migrations%'
      AND NOT c.relrowsecurity
  `);
  assert.deepEqual(rows.map((r) => r.relname), [],
    `Tabel tanpa RLS: ${rows.map((r) => r.relname).join(', ')}`);
});

// ------------------------------------------------------------
// GUEST (tanpa login)
// ------------------------------------------------------------
test('guest hanya melihat destinasi berstatus published', async () => {
  const { rows } = await withDb(null, (c) =>
    c.query(`SELECT count(*)::int AS n FROM destinations`)
  );
  const { rows: pub } = await withDb(null, (c) =>
    c.query(`SELECT count(*)::int AS n FROM destinations WHERE status = 'published'`)
  );
  assert.equal(rows[0].n, pub[0].n, 'Guest tidak boleh melihat konten unpublished');

  const { rows: hidden } = await pool.query(
    `SELECT count(*)::int AS n FROM destinations WHERE status <> 'published'`
  );
  assert.ok(hidden[0].n >= 0);
  if (hidden[0].n > 0) {
    assert.equal(rows[0].n, pub[0].n);
  }
});

test('guest tidak dapat membaca kolom password_hash', async () => {
  await assert.rejects(
    () => withDb(null, (c) => c.query(`SELECT password_hash FROM users LIMIT 1`)),
    (err) => err.code === '42501',
    'password_hash harus terlarang dibaca role aplikasi'
  );
});

test('guest tidak dapat melihat ulasan yang disembunyikan admin', async () => {
  const { rows } = await withDb(null, (c) =>
    c.query(`SELECT count(*)::int AS n FROM reviews WHERE status <> 'approved'`)
  );
  assert.equal(rows[0].n, 0, 'RLS reviews harus menyaring status non-approved');
});

// ------------------------------------------------------------
// REGISTRASI & ROLE
// ------------------------------------------------------------
test('pendaftar tidak dapat menentukan role sendiri (dipaksa explorer)', async () => {
  const email = `rogue-${Date.now()}@explore.test`;
  // Catatan: INSERT ke users tanpa RETURNING — kebijakan SELECT PostgreSQL
  // berlaku pada klausa RETURNING, sehingga sesi anon tidak boleh memakainya.
  await withDb(null, (c) => c.query(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES ('Rogue', $1, 'x', 'admin')`,
    [email]
  ));
  const { rows } = await pool.query(
    `SELECT role, account_status FROM users WHERE email = $1`, [email]
  );
  assert.equal(rows[0].role, 'explorer', 'Role harus dipaksa menjadi explorer');
  assert.equal(rows[0].account_status, 'active');
  await pool.query('DELETE FROM users WHERE email = $1', [email]);
});

test('pengguna tidak dapat mengubah role sendiri', async () => {
  await assert.rejects(
    () => withDb({ id: ids.explorer }, (c) => c.query(
      `UPDATE users SET role = 'admin' WHERE id = $1`, [ids.explorer]
    )),
    (err) => /role_change_forbidden/.test(err.message)
  );
});

test('admin dapat mengubah role pengguna lain', async () => {
  const email = `promo-${Date.now()}@explore.test`;
  const { rows: created } = await pool.query(
    `INSERT INTO users (full_name, email, password_hash)
     VALUES ('Promo', $1, 'x') RETURNING id`, [email]
  );
  await withDb({ id: ids.admin }, (c) => c.query(
    `UPDATE users SET role = 'contributor' WHERE id = $1`, [created[0].id]
  ));
  const { rows } = await pool.query(`SELECT role FROM users WHERE id = $1`, [created[0].id]);
  assert.equal(rows[0].role, 'contributor');
  await pool.query('DELETE FROM users WHERE id = $1', [created[0].id]);
});

// ------------------------------------------------------------
// DATA PRIBADI
// ------------------------------------------------------------
test('pengguna lain tidak dapat melihat profil/favorit saya', async () => {
  const dest = await pool.query(
    `SELECT id FROM destinations WHERE status = 'published' LIMIT 1`
  );
  await withDb({ id: ids.explorer }, (c) => c.query(
    `INSERT INTO favorites (user_id, destination_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`, [ids.explorer, dest.rows[0].id]
  ));

  const lain = await withDb({ id: ids.contributor }, (c) => c.query(
    `SELECT count(*)::int AS n FROM favorites WHERE user_id = $1`, [ids.explorer]
  ));
  assert.equal(lain.rows[0].n, 0, 'Favorit pengguna lain harus tersembunyi');

  const sendiri = await withDb({ id: ids.explorer }, (c) => c.query(
    `SELECT count(*)::int AS n FROM favorites WHERE user_id = $1`, [ids.explorer]
  ));
  assert.ok(sendiri.rows[0].n >= 1);
});

test('itineraries hanya dapat dibaca pemiliknya', async () => {
  await withDb({ id: ids.explorer }, (c) => c.query(
    `INSERT INTO itineraries (user_id, title) VALUES ($1, 'Trip Uji')`,
    [ids.explorer]
  ));
  const orangLain = await withDb({ id: ids.contributor }, (c) => c.query(
    `SELECT count(*)::int AS n FROM itineraries WHERE user_id = $1`, [ids.explorer]
  ));
  assert.equal(orangLain.rows[0].n, 0);
});

// ------------------------------------------------------------
// MODERASI KONTRIBUSI
// ------------------------------------------------------------
test('contributor tidak dapat menyetujui kontribusi sendiri', async () => {
  // fixture mandiri
  const { rows: created } = await withDb({ id: ids.contributor }, (c) => c.query(
    `INSERT INTO contributions (contributor_id, submission_type, submission_data, status)
     VALUES ($1, 'new_destination', '{"name":"Tempat Uji"}'::jsonb, 'PENDING')
     RETURNING id`, [ids.contributor]
  ));

  await assert.rejects(
    () => withDb({ id: ids.contributor }, (c) => c.query(
      `UPDATE contributions
          SET status = 'APPROVED', reviewed_by = $2, reviewed_at = now()
        WHERE id = $1`, [created[0].id, ids.contributor]
    )),
    (err) => /contribution_review_forbidden|contribution_status_forbidden/.test(err.message)
  );

  // kontribusi tetap PENDING
  const { rows: cek } = await pool.query(
    `SELECT status FROM contributions WHERE id = $1`, [created[0].id]
  );
  assert.equal(cek[0].status, 'PENDING');
  await pool.query('DELETE FROM contributions WHERE id = $1', [created[0].id]);
});

test('admin dapat meninjau kontribusi', async () => {
  const { rows: created } = await withDb({ id: ids.contributor }, (c) => c.query(
    `INSERT INTO contributions (contributor_id, submission_type, submission_data, status)
     VALUES ($1, 'new_destination', '{"name":"Tempat Uji 2"}'::jsonb, 'PENDING')
     RETURNING id`, [ids.contributor]
  ));

  await withDb({ id: ids.admin }, (c) => c.query(
    `UPDATE contributions
        SET status = 'UNDER_REVIEW', reviewed_by = $2
      WHERE id = $1`, [created[0].id, ids.admin]
  ));
  const { rows: after } = await pool.query(
    `SELECT status, reviewed_by FROM contributions WHERE id = $1`, [created[0].id]
  );
  assert.equal(after[0].status, 'UNDER_REVIEW');
  assert.equal(after[0].reviewed_by, ids.admin);

  await pool.query('DELETE FROM contributions WHERE id = $1', [created[0].id]);
});

// ------------------------------------------------------------
// AUDIT LOG
// ------------------------------------------------------------
test('activity_logs bersifat append-only (tidak dapat diubah/dihapus)', async () => {
  const { rows } = await pool.query(`SELECT id FROM activity_logs LIMIT 1`);
  if (!rows.length) return;

  await withDb({ id: ids.admin }, (c) => c.query(
    `UPDATE activity_logs SET action = 'tampered' WHERE id = $1`, [rows[0].id]
  ));
  const { rows: cek } = await pool.query(
    `SELECT action FROM activity_logs WHERE id = $1`, [rows[0].id]
  );
  assert.notEqual(cek[0].action, 'tampered', 'Audit log harus immutable');

  await withDb({ id: ids.admin }, (c) =>
    c.query(`DELETE FROM activity_logs WHERE id = $1`, [rows[0].id])
  );
  const { rows: sisa } = await pool.query(
    `SELECT count(*)::int AS n FROM activity_logs WHERE id = $1`, [rows[0].id]
  );
  assert.equal(sisa[0].n, 1, 'Audit log tidak boleh terhapus');
});
