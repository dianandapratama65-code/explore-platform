import './setup-env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDatabase, stopDatabase, withDb, getSuperPool } from '../server/db/pg.js';
import { buildApp } from '../server/app.js';

let server, base;
before(async () => { await startDatabase(); const app = buildApp(); server = app.listen(0); await new Promise(r=>server.once('listening',r)); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { await new Promise(r=>server.close(r)); await stopDatabase(); });

class Client { constructor(){this.cookie='';}
  async req(p,{method='GET',body}={}){const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',...(this.cookie?{Cookie:this.cookie}:{})},body:body?JSON.stringify(body):undefined});const sc=r.headers.getSetCookie?.()||[];for(const c of sc){const pair=c.split(';')[0];const n=pair.split('=')[0];const o=this.cookie.split('; ').filter(x=>x&&!x.startsWith(n+'='));o.push(pair);this.cookie=o.join('; ');}let d=null;try{d=await r.json();}catch{}return{status:r.status,data:d};}
}

test('destinations: guest melihat published, data dari DB', async () => {
  const c = new Client();
  const r = await c.req('/api/destinations?limit=60');
  assert.equal(r.status, 200);
  assert.ok(r.data.destinations.length >= 6, 'seed 6 destinasi published');
  for (const d of r.data.destinations) {
    assert.equal(d.status, 'published', 'guest hanya published');
    assert.ok(d.category_name, 'kategori ikut dimuat');
  }
});

test('destinations: search by name/city', async () => {
  const c = new Client();
  const r = await c.req('/api/destinations?q=bromo');
  assert.equal(r.status, 200);
  assert.ok(r.data.destinations.some(d => /bromo/i.test(d.name)),
    'pencarian menemukan Bromo');
});

test('destinations: filter kategori', async () => {
  const c = new Client();
  const r = await c.req('/api/destinations?category=Pantai');
  assert.equal(r.status, 200);
  assert.ok(r.data.destinations.length >= 1);
  assert.ok(r.data.destinations.every(d => d.category_name === 'Pantai'));
});

test('destinations: detail by slug', async () => {
  const c = new Client();
  const r = await c.req('/api/destinations/gunung-bromo');
  assert.equal(r.status, 200);
  assert.equal(r.data.destination.name, 'Gunung Bromo');
  assert.ok(Array.isArray(r.data.destination.images));
});

test('destinations: detail 404 untuk slug tidak ada', async () => {
  const c = new Client();
  const r = await c.req('/api/destinations/tidak-ada-destinasi-ini');
  assert.equal(r.status, 404);
});

test('destinations: reviews endpoint', async () => {
  const c = new Client();
  const r = await c.req('/api/destinations/gunung-bromo/reviews');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.reviews));
});

test('favorites: wajib login', async () => {
  const c = new Client();
  const r = await c.req('/api/favorites');
  assert.equal(r.status, 401);
  const add = await c.req('/api/favorites', {method:'POST', body:{destination_id:'00000000-0000-0000-0000-000000000000'}});
  assert.equal(add.status, 401);
});

test('favorites: tambah & hapus (login)', async () => {
  const c = new Client();
  const login = await c.req('/api/auth/login', {method:'POST', body:{email:'explorer@explore.test',password:'Explorer123!'}});
  assert.equal(login.status, 200);
  const destId = (await withDb(null, (db)=>db.query(`SELECT id FROM destinations WHERE slug='raja-ampat'`))).rows[0].id;
  const add = await c.req('/api/favorites', {method:'POST', body:{destination_id:destId}});
  assert.ok(add.status === 201 || add.status === 200, JSON.stringify(add.data));
  const list = await c.req('/api/favorites');
  assert.ok(list.data.favorites.some(f => f.destination_id === destId));
  const del = await c.req(`/api/favorites/${destId}`, {method:'DELETE'});
  assert.equal(del.status, 200);
});
