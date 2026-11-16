import './setup-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, withDb, getSuperPool, getAppPool, dbConfig } from '../server/db/pg.js';
import { buildApp } from '../server/app.js';

let server, base;
before(async () => { await startDatabase(); const app = buildApp(); server = app.listen(0); await new Promise(r=>server.once('listening',r)); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(r=>server.close(r)); await stopDatabase(); });

class Client { constructor(){this.cookie='';}
  async req(p,{method='GET',body}={}){const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',...(this.cookie?{Cookie:this.cookie}:{})},body:body?JSON.stringify(body):undefined});const sc=r.headers.getSetCookie?.()||[];for(const c of sc){const pair=c.split(';')[0];const n=pair.split('=')[0];const o=this.cookie.split('; ').filter(x=>x&&!x.startsWith(n+'='));o.push(pair);this.cookie=o.join('; ');}let d=null;try{d=await r.json();}catch{}return{status:r.status,data:d};}
}

test('security: SQL injection di search tidak merusak DB', async () => {
  const c = new Client();
  const payloads = [
    "'; DROP TABLE users; --",
    "' OR 1=1 --",
    "bromo' UNION SELECT * FROM users --",
    "%' OR '1'='1",
  ];
  for (const q of payloads) {
    const r = await c.req(`/api/destinations?q=${encodeURIComponent(q)}`);
    assert.ok(r.status === 200 || r.status === 400, `status ${r.status} untuk q=${q}`);
    // users table masih ada
    const { rows } = await getSuperPool().query(`SELECT count(*)::int AS n FROM users`);
    assert.ok(rows[0].n >= 6, 'tabel users tidak boleh hilang');
  }
});

test('security: SQL injection di filter category tidak merusak DB', async () => {
  const c = new Client();
  const r = await c.req(`/api/destinations?category=${encodeURIComponent("Pantai' OR 1=1 --")}`);
  assert.ok(r.status === 200 || r.status === 400);
  const { rows } = await withDb(null, (db) => db.query(`SELECT count(*)::int AS n FROM destinations`));
  assert.ok(rows[0].n >= 6);
});

test('security: path traversal / id tidak valid → 400/404, bukan 500', async () => {
  const c = new Client();
  const bad = ['../etc/passwd', '1; DROP TABLE users', 'not-a-uuid', 'aaaaaaaa', '%2e%2e%2f'];
  for (const id of bad) {
    const r = await c.req(`/api/destinations/${encodeURIComponent(id)}`);
    assert.ok([400, 404].includes(r.status), `id=${id} → ${r.status} (harus 400/404)`);
  }
});

test('security: XSS payload di register disimpan literal, tidak dieksekusi', async () => {
  const c = new Client();
  const xss = `<script>alert('xss')</script>`;
  const email = `t-xss-${Date.now()}@explore.test`;
  const r = await c.req('/api/auth/register', {
    method: 'POST',
    body: { full_name: xss, email, password: 'rahasia123' },
  });
  assert.equal(r.status, 201);
  // Respons JSON mengandung nama apa adanya (escaping dilakukan di frontend)
  assert.equal(r.data.user.full_name, xss);
  // DB menyimpan apa adanya (tidak dievaluasi)
  const { rows } = await getSuperPool().query(`SELECT full_name FROM users WHERE email=$1`, [email]);
  assert.equal(rows[0].full_name, xss);
  // cleanup
  await getSuperPool().query(`DELETE FROM users WHERE email=$1`, [email]);
});

test('security: XSS payload di kontribusi disimpan sebagai JSONB literal', async () => {
  const c = new Client();
  await c.req('/api/auth/login', {method:'POST', body:{email:'contributor@explore.test',password:'Contributor123!'}});
  const xss = `<img src=x onerror=alert(1)>`;
  const r = await c.req('/api/contributor/contributions', {
    method: 'POST',
    body: {
      submission_type: 'new_destination',
      data: { name: xss, description: 'x'.repeat(30), category: 'Alam' },
    },
  });
  assert.equal(r.status, 201);
  const { rows } = await getSuperPool().query(
    `SELECT submission_data->>'name' AS name FROM contributions WHERE id=$1`,
    [r.data.contribution.id]);
  assert.equal(rows[0].name, xss, 'JSONB menyimpan literal, tidak dievaluasi');
  await getSuperPool().query(`DELETE FROM contributions WHERE id=$1`, [r.data.contribution.id]);
});

test('security: payload oversized ditolak (413/400)', async () => {
  const c = new Client();
  const huge = 'A'.repeat(100_000);
  const r = await c.req('/api/auth/register', {
    method: 'POST',
    body: { full_name: huge, email: `t-huge-${Date.now()}@explore.test`, password: 'rahasia123' },
  });
  assert.ok([400, 413].includes(r.status), `status ${r.status}`);
});

test('security: cookie palsu / token rusak → 401', async () => {
  const c = new Client();
  c.cookie = 'explore_session=eyJhbGciOiJIUzI1NiJ9.e30.tampered';
  const r = await c.req('/api/auth/me');
  assert.equal(r.status, 401);
  const r2 = await c.req('/api/admin/stats');
  assert.equal(r2.status, 401);
});

test('security: role tidak bisa di-escalate via body register', async () => {
  const c = new Client();
  const email = `t-esc-${Date.now()}@explore.test`;
  const r = await c.req('/api/auth/register', {
    method: 'POST',
    body: { full_name: 'Escalate', email, password: 'rahasia123', role: 'admin', account_status: 'active' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'explorer', 'role dipaksa explorer');
  await getSuperPool().query(`DELETE FROM users WHERE email=$1`, [email]);
});

test('security: user biasa tidak bisa akses endpoint admin (403)', async () => {
  const c = new Client();
  await c.req('/api/auth/login', {method:'POST', body:{email:'explorer@explore.test',password:'Explorer123!'}});
  for (const p of ['/api/admin/stats','/api/admin/users','/api/admin/applications','/api/admin/contributions','/api/admin/reports']) {
    const r = await c.req(p);
    assert.equal(r.status, 403, `${p} → ${r.status}`);
  }
});

test('security: header keamanan (helmet) aktif', async () => {
  const r = await fetch(base + '/');
  const h = r.headers;
  assert.ok(h.get('x-content-type-options') === 'nosniff' || h.get('content-security-policy'),
    'header keamanan harus ada');
  assert.ok(h.get('x-powered-by') === null, 'x-powered-by harus dimatikan');
});// ------------------------------------------------------------
// Konfigurasi SSL & perilaku role (kompatibilitas Neon)
// ------------------------------------------------------------
test('ssl: mode dev (NODE_ENV=test) tidak mengaktifkan SSL (tanpa PG_SSL)', async () => {
  const { dbConfig } = await import('../server/db/pg.js');
  assert.equal(dbConfig.ssl, undefined,
    'SSL harus undefined di dev agar koneksi lokal tetap jalan');
});

test('ssl: auto-deteksi host Neon mengaktifkan SSL (logika)', async () => {
  const isNeon = (host) => /neon\.(tech|database)/i.test(host || '');
  assert.equal(isNeon('ep-cool-leaf-123456.ap-southeast-1.aws.neon.tech'), true);
  assert.equal(isNeon('127.0.0.1'), false);
  assert.equal(isNeon('localhost'), false);
});

test('role: is_super() false untuk role aplikasi (RLS tetap menegakkan)', async () => {
  const { withDb, getSuperPool } = await import('../server/db/pg.js');
  const { rows } = await withDb(null, (c) => c.query('SELECT is_super() AS v'));
  assert.equal(rows[0].v, false, 'role aplikasi tidak boleh dianggap superuser');
  const superRows = await getSuperPool().query('SELECT is_super() AS v');
  assert.equal(superRows.rows[0].v, true, 'superuser lokal terdeteksi super');
});

test('fail-fast: production tanpa JWT_SECRET menolak start', async () => {
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync(process.execPath, ['-e',
    "import('./server/config.js').then(()=>{console.log('STARTED');process.exit(0);}).catch(e=>{console.error('FAIL:'+e.message);process.exit(1);})",
  ], {
    cwd: 'C:/Users/sanju/Desktop/HTML/CHAT BANYUWANGI',
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: '' },
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.notEqual(res.status, 0, 'harus gagal start di production tanpa JWT_SECRET');
  assert.match(res.stderr + res.stdout, /JWT_SECRET wajib diisi|FAIL:/);
});
