// ============================================================
// Explore — test/auth-api.test.js
// Pengujian endpoint autentikasi + RBAC (Phase 3).
// Menjalankan: npm test
// ============================================================
import './setup-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, getSuperPool } from '../server/db/pg.js';
import { buildApp } from '../server/app.js';
import { sent as mailbox } from '../server/utils/mailer.js';

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
  if (createdEmails.length) {
    const pool = getSuperPool();
    for (const email of createdEmails) {
      await pool.query('DELETE FROM users WHERE email = $1', [email]).catch(() => {});
    }
  }
  await new Promise((r) => server.close(r));
  await stopDatabase();
});

// ------------------------------------------------------------
// Klien mini dengan cookie jar
// ------------------------------------------------------------
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
      const others = this.cookie
        .split('; ').filter((c) => c && !c.startsWith(name + '='));
      others.push(pair);
      this.cookie = others.join('; ');
      if (sc.includes('Max-Age=0') || sc.includes('expires=Thu, 01 Jan 1970')) {
        this.cookie = others.filter((c) => !c.startsWith(name + '=')).join('; ');
      }
    }

    let data = null;
    try { data = await res.json(); } catch { /* kosong */ }
    return { status: res.status, data, headers: res.headers };
  }
}

const tokenFromMail = (email, marker) => {
  const mail = [...mailbox].reverse()
    .find((m) => m.to === email && m.subject.includes(marker));
  assert.ok(mail, `Email "${marker}" tidak ditemukan di mailbox`);
  const m = /token=([A-Za-z0-9_-]+)/.exec(mail.text);
  assert.ok(m, 'Token tidak ditemukan dalam email');
  return m[1];
};

// ============================================================
// REGISTER
// ============================================================
test('register: berhasil & role dipaksa explorer', async () => {
  const c = new Client();
  const email = `t-register-${Date.now()}@explore.test`;
  createdEmails.push(email);

  const r = await c.req('/api/auth/register', {
    method: 'POST',
    body: { full_name: 'Tester Register', email, password: 'rahasia123' },
  });

  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.user.role, 'explorer');
  assert.equal(r.data.needs_verification, true);
  assert.ok(r.data.user.id);
  assert.equal(r.data.user.email, email, 'Email harus ikut dikembalikan');
});

test('register: email duplikat ditolak 409', async () => {
  const c = new Client();
  const email = `t-dup-${Date.now()}@explore.test`;
  createdEmails.push(email);

  const first = await c.req('/api/auth/register', {
    method: 'POST',
    body: { full_name: 'Duplikat', email, password: 'rahasia123' },
  });
  assert.equal(first.status, 201);

  const second = await c.req('/api/auth/register', {
    method: 'POST',
    body: { full_name: 'Duplikat', email, password: 'rahasia123' },
  });
  assert.equal(second.status, 409);
  assert.equal(second.data.error.code, 'email_taken');
});

test('register: password lemah / email invalid ditolak 400', async () => {
  const c = new Client();
  const r1 = await c.req('/api/auth/register', {
    method: 'POST',
    body: { full_name: 'Lemah', email: `t-weak-${Date.now()}@explore.test`, password: 'abc' },
  });
  assert.equal(r1.status, 400);
  assert.equal(r1.data.error.code, 'validation_error');

  const r2 = await c.req('/api/auth/register', {
    method: 'POST',
    body: { full_name: 'Email Salah', email: 'bukan-email', password: 'rahasia123' },
  });
  assert.equal(r2.status, 400);
});

// ============================================================
// LOGIN
// ============================================================
test('login: password salah → 401, benar → cookie sesi', async () => {
  const bad = new Client();
  const r1 = await bad.req('/api/auth/login', {
    method: 'POST',
    body: { email: 'explorer@explore.test', password: 'salah!' },
  });
  assert.equal(r1.status, 401);
  assert.equal(r1.data.error.code, 'invalid_credentials');

  const ok = new Client();
  const r2 = await ok.req('/api/auth/login', {
    method: 'POST',
    body: { email: 'explorer@explore.test', password: 'Explorer123!' },
  });
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal(r2.data.user.role, 'explorer');
  assert.ok(ok.cookie.includes('explore_session='), 'Cookie sesi harus di-set');
});

test('login: akun dengan email tidak terdaftar → 401 (tanpa bocor detail)', async () => {
  const c = new Client();
  const r = await c.req('/api/auth/login', {
    method: 'POST',
    body: { email: `t-tidakada-${Date.now()}@explore.test`, password: 'rahasia123' },
  });
  assert.equal(r.status, 401);
  assert.equal(r.data.error.code, 'invalid_credentials');
});

// ============================================================
// ME & SESI
// ============================================================
test('/api/auth/me: 401 tanpa login, 200 dengan sesi', async () => {
  const anon = new Client();
  const r1 = await anon.req('/api/auth/me');
  assert.equal(r1.status, 401);

  const c = new Client();
  await c.req('/api/auth/login', {
    method: 'POST',
    body: { email: 'explorer@explore.test', password: 'Explorer123!' },
  });
  const r2 = await c.req('/api/auth/me');
  assert.equal(r2.status, 200);
  assert.equal(r2.data.user.email, 'explorer@explore.test');
  assert.ok(r2.data.profile, 'Profil wajib dibuat otomatis saat registrasi');
  assert.equal(r2.data.profile.preferred_language, 'id');
});

test('sesi: logout mencabut sesi (me berikutnya → 401)', async () => {
  const c = new Client();
  await c.req('/api/auth/login', {
    method: 'POST',
    body: { email: 'explorer@explore.test', password: 'Explorer123!' },
  });
  const out = await c.req('/api/auth/logout', { method: 'POST' });
  assert.equal(out.status, 200);
  const me = await c.req('/api/auth/me');
  assert.equal(me.status, 401, 'Sesi harus langsung tidak berlaku');
});

test('sesi: daftar & cabut sesi perangkat lain', async () => {
  const perangkatA = new Client();
  await perangkatA.req('/api/auth/login', {
    method: 'POST',
    body: { email: 'explorer@explore.test', password: 'Explorer123!' },
  });

  const perangkatB = new Client();
  await perangkatB.req('/api/auth/login', {
    method: 'POST',
    body: { email: 'explorer@explore.test', password: 'Explorer123!' },
  });

  const list = await perangkatA.req('/api/auth/sessions');
  assert.equal(list.status, 200);
  assert.ok(list.data.sessions.length >= 2, 'Harus ada minimal 2 sesi aktif');
  assert.equal(list.data.sessions.filter((s) => s.current).length, 1);

  const lain = list.data.sessions.find((s) => !s.current);
  const revoke = await perangkatA.req(`/api/auth/sessions/${lain.id}`, { method: 'DELETE' });
  assert.equal(revoke.status, 200);

  const meB = await perangkatB.req('/api/auth/me');
  assert.equal(meB.status, 401, 'Sesi B yang dicabut harus langsung mati');
});

// ============================================================
// VERIFIKASI EMAIL
// ============================================================
test('verifikasi email: token dari email → akun terverifikasi', async () => {
  const email = `t-verify-${Date.now()}@explore.test`;
  createdEmails.push(email);

  const c = new Client();
  const reg = await c.req('/api/auth/register', {
    method: 'POST',
    body: { full_name: 'Tester Verify', email, password: 'rahasia123' },
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.email_verified_at, null);

  const token = tokenFromMail(email, 'Verifikasi email');
  const ver = await c.req('/api/auth/verify-email', { method: 'POST', body: { token } });
  assert.equal(ver.status, 200, JSON.stringify(ver.data));

  // login lagi → terverifikasi
  await c.req('/api/auth/login', { method: 'POST', body: { email, password: 'rahasia123' } });
  const me = await c.req('/api/auth/me');
  assert.equal(me.status, 200);
  assert.ok(me.data.user.email_verified_at, 'email_verified_at harus terisi');
});

test('verifikasi email: token bekas → 400', async () => {
  const c = new Client();
  const r = await c.req('/api/auth/verify-email', {
    method: 'POST', body: { token: 'a'.repeat(64) },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.error.code, 'invalid_token');
});

// ============================================================
// FORGOT / RESET PASSWORD
// ============================================================
test('forgot-password: respons sama untuk email ada/tidak ada', async () => {
  const c1 = new Client();
  const r1 = await c1.req('/api/auth/forgot-password', {
    method: 'POST', body: { email: 'explorer@explore.test' },
  });
  const c2 = new Client();
  const r2 = await c2.req('/api/auth/forgot-password', {
    method: 'POST', body: { email: `t-tidakada-${Date.now()}@explore.test` },
  });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  assert.equal(r1.data.message, r2.data.message, 'Tidak boleh membocorkan keberadaan email');
});

test('reset-password: alur lengkap → password lama mati, baru aktif', async () => {
  const email = `t-reset-${Date.now()}@explore.test`;
  createdEmails.push(email);

  const c = new Client();
  await c.req('/api/auth/register', {
    method: 'POST', body: { full_name: 'Tester Reset', email, password: 'lama12345' },
  });

  await c.req('/api/auth/forgot-password', { method: 'POST', body: { email } });
  const token = tokenFromMail(email, 'Reset password');

  const bad = await c.req('/api/auth/reset-password', {
    method: 'POST', body: { token, password: 'x' },
  });
  assert.equal(bad.status, 400, 'Password baru harus lolos validasi');

  const good = await c.req('/api/auth/reset-password', {
    method: 'POST', body: { token, password: 'baru12345' },
  });
  assert.equal(good.status, 200, JSON.stringify(good.data));

  const lama = await c.req('/api/auth/login', { method: 'POST', body: { email, password: 'lama12345' } });
  assert.equal(lama.status, 401, 'Password lama harus sudah tidak berlaku');

  const baru = await c.req('/api/auth/login', { method: 'POST', body: { email, password: 'baru12345' } });
  assert.equal(baru.status, 200);
});

test('reset-password: token dipakai dua kali → 400', async () => {
  const email = `t-reset2-${Date.now()}@explore.test`;
  createdEmails.push(email);

  const c = new Client();
  await c.req('/api/auth/register', {
    method: 'POST', body: { full_name: 'Tester Reset 2', email, password: 'lama12345' },
  });
  await c.req('/api/auth/forgot-password', { method: 'POST', body: { email } });
  const token = tokenFromMail(email, 'Reset password');

  const first = await c.req('/api/auth/reset-password', {
    method: 'POST', body: { token, password: 'baru12345' },
  });
  assert.equal(first.status, 200);

  const second = await c.req('/api/auth/reset-password', {
    method: 'POST', body: { token, password: 'lagilagi123' },
  });
  assert.equal(second.status, 400, 'Token bersifat sekali pakai');
});

// ============================================================
// RBAC — pembatasan antar role
// ============================================================
test('RBAC: admin boleh, explorer ditolak 403 pada rute admin', async () => {
  const admin = new Client();
  const loginAdmin = await admin.req('/api/auth/login', {
    method: 'POST', body: { email: 'admin@explore.test', password: 'Admin123!' },
  });
  assert.equal(loginAdmin.status, 200);
  assert.equal(loginAdmin.data.user.role, 'admin');

  const r1 = await admin.req('/api/admin/ping');
  assert.equal(r1.status, 200);
  assert.equal(r1.data.role, 'admin');

  const explorer = new Client();
  await explorer.req('/api/auth/login', {
    method: 'POST', body: { email: 'explorer@explore.test', password: 'Explorer123!' },
  });
  const r2 = await explorer.req('/api/admin/ping');
  assert.equal(r2.status, 403);
  assert.equal(r2.data.error.code, 'role_forbidden');

  const anon = new Client();
  const r3 = await anon.req('/api/admin/ping');
  assert.equal(r3.status, 401);
});

test('akun ditangguhkan tidak bisa login', async () => {
  const email = `t-suspend-${Date.now()}@explore.test`;
  createdEmails.push(email);

  const c = new Client();
  await c.req('/api/auth/register', {
    method: 'POST', body: { full_name: 'Tester Suspend', email, password: 'rahasia123' },
  });
  await c.req('/api/auth/login', { method: 'POST', body: { email, password: 'rahasia123' } });

  // Tangguhkan via superuser (di luar API — meniru tindakan admin)
  await getSuperPool().query(
    `UPDATE users SET account_status = 'suspended' WHERE email = $1`, [email]);

  const r = await c.req('/api/auth/login', { method: 'POST', body: { email, password: 'rahasia123' } });
  assert.equal(r.status, 403);
  assert.equal(r.data.error.code, 'account_suspended');
});
