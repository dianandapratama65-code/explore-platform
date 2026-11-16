// ============================================================
// Explore — test/moderation-api.test.js
// Pengujian Phase 4: dashboard admin, manajemen user,
// workflow moderasi kontribusi & pengajuan contributor.
// Menjalankan: npm test
// ============================================================
import './setup-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, withDb, getSuperPool } from '../server/db/pg.js';
import { buildApp } from '../server/app.js';

let server;
let base;
const createdEmails = [];

before(async () => {
  await startDatabase();
  const app = buildApp();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  const pool = getSuperPool();
  if (createdEmails.length) {
    for (const email of createdEmails) {
      await pool.query('DELETE FROM users WHERE email = $1', [email]).catch(() => {});
    }
  }
  // bersihkan destinasi hasil kontribusi test
  await pool.query(
    `DELETE FROM destinations WHERE name LIKE 'Air Terjun Selogejek %'`).catch(() => {});
  await new Promise((r) => server.close(r));
  await stopDatabase();
});

class Client {
  constructor() { this.cookie = ''; }

  async req(path, { method = 'GET', body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookies = res.headers.getSetCookie?.() || [];
    for (const sc of setCookies) {
      const pair = sc.split(';')[0];
      const name = pair.split('=')[0];
      const others = this.cookie.split('; ').filter((c) => c && !c.startsWith(name + '='));
      others.push(pair);
      if (sc.includes('Max-Age=0')) {
        this.cookie = others.filter((c) => !c.startsWith(name + '=')).join('; ');
      } else {
        this.cookie = others.join('; ');
      }
    }
    let data = null;
    try { data = await res.json(); } catch { /* kosong */ }
    return { status: res.status, data, headers: res.headers };
  }

  async login(email, password) {
    return this.req('/api/auth/login', { method: 'POST', body: { email, password } });
  }
}

const newVerifiedUser = async (label) => {
  const c = new Client();
  const email = `t-${label}-${Date.now()}@explore.test`;
  createdEmails.push(email);
  const reg = await c.req('/api/auth/register', {
    method: 'POST',
    body: { full_name: `Tester ${label}`, email, password: 'rahasia123' },
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  // tandai terverifikasi langsung (peran email sudah diuji di Phase 3)
  await getSuperPool().query(
    `UPDATE users SET email_verified_at = now() WHERE email = $1`, [email]);
  await c.login(email, 'rahasia123');
  return { client: c, email };
};

const admin = new Client();
const contributor = new Client();

// ============================================================
// DASHBOARD ADMIN — statistik & daftar
// ============================================================
test('admin: stats dashboard lengkap & hanya admin', async () => {
  const login = await admin.login('admin@explore.test', 'Admin123!');
  assert.equal(login.status, 200);

  const r = await admin.req('/api/admin/stats');
  assert.equal(r.status, 200);
  for (const key of ['total_users', 'published_destinations', 'pending_contributions',
    'pending_applications', 'open_reports', 'users_by_role']) {
    assert.ok(key in r.data.stats, `stats.${key} harus ada`);
  }
  assert.ok(r.data.stats.total_users >= 6);

  const explorer = new Client();
  await explorer.login('explorer@explore.test', 'Explorer123!');
  const denied = await explorer.req('/api/admin/stats');
  assert.equal(denied.status, 403);
  assert.equal(denied.data.error.code, 'role_forbidden');
});

test('admin: daftar pengguna & pencarian', async () => {
  const r = await admin.req('/api/admin/users?q=admin');
  assert.equal(r.status, 200);
  assert.ok(r.data.users.length >= 1);
  assert.ok(r.data.users.every((u) => u.email.includes('admin')
    || u.full_name.toLowerCase().includes('admin')));

  const byRole = await admin.req('/api/admin/users?role=contributor');
  assert.equal(byRole.status, 200);
  assert.ok(byRole.data.users.every((u) => u.role === 'contributor'));
  assert.ok(!('password_hash' in (byRole.data.users[0] || {})),
    'password_hash tidak boleh ikut dikirim');
});

test('admin: ubah role user lain berhasil; ubah akun sendiri ditolak', async () => {
  const { client: applicant } = await newVerifiedUser('role-test');

  const list = await admin.req('/api/admin/users?q=role-test');
  const target = list.data.users.find((u) => u.email.includes('role-test'));
  assert.ok(target, 'user baru harus muncul di daftar admin');

  const upd = await admin.req(`/api/admin/users/${target.id}`, {
    method: 'PATCH', body: { role: 'contributor' },
  });
  assert.equal(upd.status, 200, JSON.stringify(upd.data));
  assert.equal(upd.data.user.role, 'contributor');

  // konfirmasi lewat sesi user itu sendiri
  const me = await applicant.req('/api/auth/me');
  assert.equal(me.data.user.role, 'contributor', 'role baru terlihat setelah re-check DB');

  // admin tidak boleh mengubah akunnya sendiri
  const adminMe = await admin.req('/api/auth/me');
  const self = await admin.req(`/api/admin/users/${adminMe.data.user.id}`, {
    method: 'PATCH', body: { role: 'explorer' },
  });
  assert.equal(self.status, 400);
  assert.equal(self.data.error.code, 'self_change_forbidden');
});

// ============================================================
// PENGAJUAN CONTRIBUTOR
// ============================================================
test('pengajuan contributor: wajib login & email terverifikasi', async () => {
  const anon = new Client();
  const r1 = await anon.req('/api/contributor/apply', {
    method: 'POST', body: { reason: 'x'.repeat(30) },
  });
  assert.equal(r1.status, 401);

  // user tanpa verifikasi email
  const c = new Client();
  const email = `t-unverified-${Date.now()}@explore.test`;
  createdEmails.push(email);
  await c.req('/api/auth/register', {
    method: 'POST',
    body: { full_name: 'Belum Verif', email, password: 'rahasia123' },
  });
  await c.login(email, 'rahasia123');
  const r2 = await c.req('/api/contributor/apply', {
    method: 'POST',
    body: { reason: 'Saya suka menulis tentang destinasi lokal indonesia.' },
  });
  assert.equal(r2.status, 403);
  assert.equal(r2.data.error.code, 'email_not_verified');
});

test('pengajuan contributor: alur kirim → antrean admin → disetujui', async () => {
  const { client: applicant, email } = await newVerifiedUser('applicant');

  const apply = await applicant.req('/api/contributor/apply', {
    method: 'POST',
    body: {
      reason: 'Saya penulis travel lokal Jawa Timur dan ingin berbagi info destinasi terkurasi.',
      expertise: ['Alam', 'Jawa Timur'],
    },
  });
  assert.equal(apply.status, 201, JSON.stringify(apply.data));

  // pengajuan ganda ditolak
  const dup = await applicant.req('/api/contributor/apply', {
    method: 'POST', body: { reason: 'Alasan kedua yang cukup panjang untuk lolos validasi.' },
  });
  assert.equal(dup.status, 409);

  // terlihat di antrean admin
  const queue = await admin.req('/api/admin/applications?status=PENDING');
  assert.equal(queue.status, 200);
  const mine = queue.data.applications.find((a) => a.email === email);
  assert.ok(mine, 'pengajuan harus muncul di antrean admin');
  assert.equal(mine.status, 'PENDING');

  // contributor biasa tidak boleh melihat antrean
  await contributor.login('contributor@explore.test', 'Contributor123!');
  const denied = await contributor.req('/api/admin/applications');
  assert.equal(denied.status, 403);

  // admin menyetujui
  const review = await admin.req(`/api/admin/applications/${mine.id}/review`, {
    method: 'POST', body: { status: 'APPROVED', note: 'Portofolio cocok.' },
  });
  assert.equal(review.status, 200, JSON.stringify(review.data));

  // role user naik menjadi contributor
  const me = await applicant.req('/api/auth/me');
  assert.equal(me.data.user.role, 'contributor');

  // notifikasi ke pemohon
  const notif = await applicant.req('/api/notifications');
  assert.ok(notif.data.notifications.some((n) =>
    n.title.includes('disetujui')), 'harus ada notifikasi persetujuan');

  // transisi tidak sah ditolak: APPROVED → UNDER_REVIEW
  const bad = await admin.req(`/api/admin/applications/${mine.id}/review`, {
    method: 'POST', body: { status: 'UNDER_REVIEW' },
  });
  assert.equal(bad.status, 409);
  assert.equal(bad.data.error.code, 'invalid_transition');
});

// ============================================================
// MODERASI KONTRIBUSI
// ============================================================
test('kontribusi: hanya contributor & terverifikasi yang boleh mengirim', async () => {
  const explorer = new Client();
  await explorer.login('explorer@explore.test', 'Explorer123!');
  const r1 = await explorer.req('/api/contributor/contributions', {
    method: 'POST',
    body: {
      submission_type: 'new_destination',
      data: { name: 'Pantai Uji', description: 'x'.repeat(30), category: 'Pantai' },
    },
  });
  assert.equal(r1.status, 403, 'explorer biasa tidak boleh mengirim kontribusi');

  const anon = new Client();
  const r2 = await anon.req('/api/contributor/contributions');
  assert.equal(r2.status, 401);
});

test('kontribusi baru: PENDING → APPROVED → tayang & terlihat guest', async () => {
  await contributor.login('contributor@explore.test', 'Contributor123!');

  const destName = `Air Terjun Selogejek ${Date.now()}`;
  const payload = {
    submission_type: 'new_destination',
    data: {
      name: destName,
      description: 'Air terjun kecil di kawasan hutan dengan jalur jalan setapak yang tenang untuk pejalan kaki.',
      category: 'Alam',
      city: 'Banyuwangi',
      estimated_cost: 75000,
      image_url: 'https://images.unsplash.com/photo-1432405972618-c60b0225b8f9?auto=format&fit=crop&w=900&q=80',
    },
  };

  const create = await contributor.req('/api/contributor/contributions', {
    method: 'POST', body: payload,
  });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  assert.equal(create.data.contribution.status, 'PENDING');
  const conId = create.data.contribution.id;

  // konten PENDING TIDAK boleh tayang — cek langsung di DB sebagai guest
  const beforeCount = await withDb(null, (c) => c.query(
    `SELECT count(*)::int AS n FROM destinations WHERE name = $1`,
    [destName]));
  assert.equal(beforeCount.rows[0].n, 0,
    'Destinasi dari kontribusi PENDING tidak boleh ada di tabel publik');

  // contributor tidak boleh mengubah status sendiri
  const selfReview = await withDb(
    { id: (await contributor.req('/api/auth/me')).data.user.id },
    (c) => c.query(
      `UPDATE contributions SET status = 'APPROVED' WHERE id = $1`, [conId])
  ).catch((e) => e);
  assert.ok(selfReview instanceof Error || selfReview.rowCount === 0,
    'Trigger DB harus menolak kontributor menyetujui kirimannya sendiri');

  // admin: PENDING → UNDER_REVIEW → APPROVED
  const r1 = await admin.req(`/api/admin/contributions/${conId}/review`, {
    method: 'POST', body: { status: 'UNDER_REVIEW' },
  });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));

  const r2 = await admin.req(`/api/admin/contributions/${conId}/review`, {
    method: 'POST', body: { status: 'APPROVED', note: 'Bagus, terbitkan.' },
  });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.applied.action, 'destination_created');

  // sekarang guest bisa melihatnya
  const afterCount = await withDb(null, (c) => c.query(
    `SELECT status FROM destinations WHERE name = $1`,
    [destName]));
  assert.equal(afterCount.rows.length, 1, 'Setelah APPROVED destinasi boleh tayang');
  assert.equal(afterCount.rows[0].status, 'published');

  // notifikasi ke kontributor
  const notif = await contributor.req('/api/notifications');
  assert.ok(notif.data.notifications.some((n) => n.title.includes('disetujui')));

  // kontributor tidak bisa mengubah data peninjauan
  // (RLS memblokir baris APPROVED; bila lolos RLS, trigger menolak)
  const tamper = await withDb(
    { id: (await contributor.req('/api/auth/me')).data.user.id },
    (c) => c.query(
      `UPDATE contributions SET admin_note = 'diubah sendiri' WHERE id = $1`,
      [conId])
  ).catch((e) => e);
  assert.ok(tamper instanceof Error || tamper.rowCount === 0,
    'Kontributor tidak boleh mengubah catatan admin setelah ditinjau');
});

test('kontribusi: REVISION_REQUIRED → kontributor memperbaiki → PENDING', async () => {
  await contributor.login('contributor@explore.test', 'Contributor123!');

  const create = await contributor.req('/api/contributor/contributions', {
    method: 'POST',
    body: {
      submission_type: 'update_destination',
      data: {
        destination_id: (await withDb(null, (c) => c.query(
          `SELECT id FROM destinations WHERE slug = 'gunung-bromo'`))).rows[0].id,
        fields: { estimated_cost: 175000 },
      },
    },
  });
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const id = create.data.contribution.id;

  const rev = await admin.req(`/api/admin/contributions/${id}/review`, {
    method: 'POST',
    body: { status: 'REVISION_REQUIRED', note: 'Sertakan sumber harga.' },
  });
  assert.equal(rev.status, 200);

  // kontributor melihat status + catatan di daftarnya
  const mine = await contributor.req('/api/contributor/contributions');
  const row = mine.data.contributions.find((c) => c.id === id);
  assert.equal(row.status, 'REVISION_REQUIRED');
  assert.ok(row.admin_note.includes('sumber harga'));

  // revisi dikirim ulang → kembali PENDING
  const resubmit = await contributor.req(`/api/contributor/contributions/${id}`, {
    method: 'PUT',
    body: {
      submission_type: 'update_destination',
      data: {
        destination_id: row.submission_data.destination_id,
        fields: { estimated_cost: 175000 },
      },
    },
  });
  assert.equal(resubmit.status, 200, JSON.stringify(resubmit.data));

  const after = await contributor.req('/api/contributor/contributions');
  assert.equal(after.data.contributions.find((c) => c.id === id).status, 'PENDING');
});

test('kontribusi: transisi tidak sah ditolak (APPROVED → REJECTED)', async () => {
  const list = await admin.req('/api/admin/contributions?status=APPROVED');
  assert.equal(list.status, 200);
  const done = list.data.contributions[0];
  assert.ok(done, 'harus ada kontribusi APPROVED dari test sebelumnya');

  const r = await admin.req(`/api/admin/contributions/${done.id}/review`, {
    method: 'POST', body: { status: 'REJECTED' },
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, 'invalid_transition');
});

// ============================================================
// KONTEN TIDAK PUBLIK & RLS
// ============================================================
test('guest tidak dapat membaca kontribusi maupun pengajuan', async () => {
  const guestRows = await withDb(null, async (c) => {
    const contributions = await c.query(`SELECT count(*)::int AS n FROM contributions`);
    const applications = await c.query(
      `SELECT count(*)::int AS n FROM contributor_applications`);
    return { contributions: contributions.rows[0].n, applications: applications.rows[0].n };
  });
  assert.equal(guestRows.contributions, 0,
    'RLS harus menyembunyikan kontribusi dari guest');
  assert.equal(guestRows.applications, 0,
    'RLS harus menyembunyikan pengajuan dari guest');
});

test('guest tidak dapat mengubah data lewat API', async () => {
  const anon = new Client();
  const r1 = await anon.req('/api/admin/users');
  assert.equal(r1.status, 401);
  const r2 = await anon.req('/api/contributor/contributions');
  assert.equal(r2.status, 401);
});

// ============================================================
// LAPORAN
// ============================================================
test('laporan: explorer melapor, admin menangani', async () => {
  const explorer = new Client();
  await explorer.login('explorer@explore.test', 'Explorer123!');

  const destId = (await withDb(null, (c) => c.query(
    `SELECT id FROM destinations WHERE slug = 'raja-ampat'`))).rows[0].id;

  const report = await explorer.req('/api/reports', {
    method: 'POST',
    body: {
      destination_id: destId,
      report_type: 'wrong_info',
      description: 'Harga tiket pada deskripsi sudah tidak sesuai dengan tarif terbaru.',
    },
  });
  assert.equal(report.status, 201, JSON.stringify(report.data));

  const anon = new Client();
  const denied = await anon.req('/api/reports', {
    method: 'POST',
    body: { destination_id: destId, report_type: 'other', description: 'x'.repeat(20) },
  });
  assert.equal(denied.status, 401, 'laporan wajib login');

  const queue = await admin.req('/api/admin/reports?status=open');
  assert.equal(queue.status, 200);
  const mine = queue.data.reports.find((r) => r.id === report.data.report.id);
  assert.ok(mine, 'laporan harus muncul di antrean admin');

  const handle = await admin.req(`/api/admin/reports/${mine.id}/review`, {
    method: 'POST', body: { status: 'resolved' },
  });
  assert.equal(handle.status, 200);
  assert.equal(handle.data.report.status, 'resolved');
});
