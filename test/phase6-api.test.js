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

test('reviews: wajib login', async () => {
  const c = new Client();
  const r = await c.req('/api/reviews/mine');
  assert.equal(r.status, 401);
  const post = await c.req('/api/reviews', {method:'POST', body:{destination_id:'00000000-0000-0000-0000-000000000000',rating:5}});
  assert.equal(post.status, 401);
});

test('reviews: kirim ulasan memperbarui rating agregat', async () => {
  const c = new Client();
  await c.req('/api/auth/login', {method:'POST', body:{email:'explorer@explore.test',password:'Explorer123!'}});
  const destId = (await withDb(null, (db)=>db.query(`SELECT id FROM destinations WHERE slug='raja-ampat'`))).rows[0].id;

  const before = (await withDb(null, (db)=>db.query(`SELECT rating_avg, rating_count FROM destinations WHERE id=$1`,[destId]))).rows[0];

  const post = await c.req('/api/reviews', {method:'POST', body:{destination_id:destId, rating:5, review_text:'Indah sekali!'}});
  assert.equal(post.status, 201, JSON.stringify(post.data));

  const after = (await withDb(null, (db)=>db.query(`SELECT rating_avg, rating_count FROM destinations WHERE id=$1`,[destId]))).rows[0];
  assert.equal(Number(after.rating_count), Number(before.rating_count)+1, 'rating_count bertambah');
  assert.ok(Number(after.rating_avg) > 0, 'rating_avg diperbarui trigger');

  // ulasan terlihat di endpoint publik
  const pub = await c.req(`/api/destinations/raja-ampat/reviews`);
  assert.ok(pub.data.reviews.some(r => r.content === 'Indah sekali!'));

  // duplikat ulasan (unique constraint) ditolak
  const dup = await c.req('/api/reviews', {method:'POST', body:{destination_id:destId, rating:4}});
  assert.ok(dup.status === 409 || dup.status === 500, 'duplikat ulasan ditolak');

  // hapus ulasan
  const del = await c.req(`/api/reviews/${post.data.review.id}`, {method:'DELETE'});
  assert.equal(del.status, 200);
});

test('reviews: validasi rating 1-5', async () => {
  const c = new Client();
  await c.req('/api/auth/login', {method:'POST', body:{email:'explorer@explore.test',password:'Explorer123!'}});
  const destId = (await withDb(null, (db)=>db.query(`SELECT id FROM destinations WHERE slug='ubud'`))).rows[0].id;
  const bad = await c.req('/api/reviews', {method:'POST', body:{destination_id:destId, rating:10}});
  assert.equal(bad.status, 400);
});

test('itineraries: CRUD lengkap', async () => {
  const c = new Client();
  await c.req('/api/auth/login', {method:'POST', body:{email:'explorer@explore.test',password:'Explorer123!'}});

  const create = await c.req('/api/itineraries', {method:'POST', body:{title:'Liburan Bali', start_date:'2026-07-01', end_date:'2026-07-05', estimated_budget:5000000}});
  assert.equal(create.status, 201, JSON.stringify(create.data));
  const itId = create.data.itinerary.id;

  // tambah item
  const destId = (await withDb(null, (db)=>db.query(`SELECT id FROM destinations WHERE slug='ubud'`))).rows[0].id;
  const item = await c.req(`/api/itineraries/${itId}/items`, {method:'POST', body:{destination_id:destId, visit_order:1, notes:'Kunjungi pagi'}});
  assert.equal(item.status, 201, JSON.stringify(item.data));

  // detail memuat item
  const detail = await c.req(`/api/itineraries/${itId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.data.items.length, 1);
  assert.equal(detail.data.items[0].destination_name, 'Ubud');

  // ubah itinerary
  const upd = await c.req(`/api/itineraries/${itId}`, {method:'PUT', body:{title:'Liburan Bali Update', estimated_budget:6000000}});
  assert.equal(upd.status, 200);
  assert.equal(upd.data.itinerary.title, 'Liburan Bali Update');

  // ubah item
  const updItem = await c.req(`/api/itineraries/${itId}/items/${item.data.item.id}`, {method:'PUT', body:{visit_order:2, notes:'Sore hari'}});
  assert.equal(updItem.status, 200);

  // daftar
  const list = await c.req('/api/itineraries');
  assert.ok(list.data.itineraries.some(i => i.id === itId));

  // hapus item
  const delItem = await c.req(`/api/itineraries/${itId}/items/${item.data.item.id}`, {method:'DELETE'});
  assert.equal(delItem.status, 200);

  // hapus itinerary
  const del = await c.req(`/api/itineraries/${itId}`, {method:'DELETE'});
  assert.equal(del.status, 200);

  const after = await c.req(`/api/itineraries/${itId}`);
  assert.equal(after.status, 404);
});

test('itineraries: wajib login & isolasi antar pengguna', async () => {
  const c = new Client();
  const r = await c.req('/api/itineraries');
  assert.equal(r.status, 401);

  // user A buat itinerary
  const a = new Client();
  await a.req('/api/auth/login', {method:'POST', body:{email:'explorer@explore.test',password:'Explorer123!'}});
  const created = await a.req('/api/itineraries', {method:'POST', body:{title:'Rahasia A'}});
  assert.equal(created.status, 201);

  // user B tidak bisa melihat/edit/hapus
  const b = new Client();
  await b.req('/api/auth/login', {method:'POST', body:{email:'contributor@explore.test',password:'Contributor123!'}});
  const detail = await b.req(`/api/itineraries/${created.data.itinerary.id}`);
  assert.equal(detail.status, 404);
  const del = await b.req(`/api/itineraries/${created.data.itinerary.id}`, {method:'DELETE'});
  assert.equal(del.status, 404);

  // cleanup
  await a.req(`/api/itineraries/${created.data.itinerary.id}`, {method:'DELETE'});
});