# Explore — Laporan Akhir Proyek

## 1. Ringkasan

**Explore** adalah platform discovery destinasi, kuliner, budaya, dan perjalanan di Indonesia.
Awalnya berupa **prototipe single-file** (`explore-prototype-indonesia.html`, 23,5 KB, vanilla JS
+ Leaflet + Google Maps deep-links), dikembangkan bertahap menjadi **aplikasi web multi-pengguna**
dengan PostgreSQL, autentikasi, RBAC 4 role, dashboard per role, dan workflow moderasi konten —
**tanpa mengubah UI/UX, warna, layout, atau fitur prototipe yang sudah berjalan.**

## 2. Arsitektur

```
┌────────────────────────────────────────────────────────────┐
│  Browser (vanilla JS ES modules, no build tool)           │
│  public/index.html + public/js/* + public/css/*           │
└──────────────────────┬─────────────────────────────────────┘
                       │ HTTP (cookie sesi httpOnly)
┌──────────────────────┴─────────────────────────────────────┐
│  Node.js / Express (server/app.js)                        │
│  ├─ middleware: helmet (CSP), cookie-parser, rate-limit,   │
│  │              attachAuth (verifikasi DB tiap request)     │
│  ├─ routes: auth, admin, contributor, reports,            │
│  │          destinations, favorites, reviews, itineraries, │
│  │          notifications                                 │
│  └─ utils: http (error handler), mailer (dev/SMTP)        │
└──────────────────────┬─────────────────────────────────────┘
                       │ pg (role explore_app, non-superuser)
┌──────────────────────┴─────────────────────────────────────┐
│  PostgreSQL 18 (embedded, port 5433)                      │
│  ├─ 17 tabel, enum status, FK, index (incl. GIN trigram)  │
│  ├─ RLS penuh untuk role explore_app                      │
│  ├─ Guard trigger (role/status immutability, moderasi)     │
│  └─ SECURITY DEFINER functions (auth, notify, log, apply)  │
└────────────────────────────────────────────────────────────┘
```

- **Database**: embedded-postgres (lokal, port 5433) — siap migrasi ke Supabase.
- **Frontend**: vanilla JS ES modules di `public/`, tanpa bundler.
- **Auth**: bcrypt + JWT penunjuk; status selalu diverifikasi ulang ke DB (pencabutan sesi langsung berlaku).

## 3. Fitur yang diimplementasikan

### Fase 1 — Audit
- 8 fitur prototipe diidentifikasi & dipertahankan: pencarian, filter kategori, peta Leaflet,
  favorit, detail modal, kalkulator budget, deep-link Google Maps, toast.

### Fase 2 — Database
- 17 tabel, RLS penuh, guard trigger, fungsi SECURITY DEFINER, view `public_profiles`,
  migrasi 001–006, seed data (3 kategori, 6 destinasi, 6 demo user, 12 ulasan).

### Fase 3 — Autentikasi & RBAC
- Register/login/logout, forgot/reset password, verifikasi email, manajemen sesi.
- 4 role: admin, contributor, explorer, guest. Email wajib verifikasi untuk kontribusi.
- Mailer dev (var/mail/*.eml) + SMTP opsional.

### Fase 4 — Dashboard & Moderasi
- Dashboard per role (admin/contributor/explorer) dengan statistik, manajemen user,
  antrean pengajuan contributor, moderasi kontribusi, laporan.
- Workflow: PENDING → UNDER_REVIEW → APPROVED/REJECTED/REVISION_REQUIRED.
- Keputusan APPROVED mengeksekusi konten nyata (destinasi terbit, perubahan diterapkan, media ditambah).
- Notifikasi otomatis + audit log.

### Fase 5 — Integrasi Data
- `GET /api/destinations` (search + filter + paginasi, RLS guest=published).
- Favorit sinkron ke DB untuk pengguna login (optimistic + rollback).
- Explore memuat data dari DB dengan fallback ke data lokal.

### Fase 6 — Fitur Lanjutan
- Ulasan & rating (agregat otomatis via trigger).
- CRUD Itinerary + item (isolasi antar pengguna).

### Fase 7 — Hardening & Dokumentasi
- Test keamanan: SQL injection, XSS (register & kontribusi), path traversal, payload oversized,
  cookie palsu, role escalation, akses endpoint admin, header keamanan.
- `API.md` (dokumentasi endpoint lengkap).
- `FINAL_REPORT.md` (dokumen ini).
- `DEVELOPMENT_PROGRESS.md` (status 7 fase).

## 4. Keamanan (berlapis: backend + database)

- **RLS** di setiap tabel (role `explore_app` non-superuser) — guest hanya melihat published.
- **Guard trigger**: role/status pengguna tidak bisa diubah sendiri; keputusan moderasi
  hanya admin; activity_logs append-only.
- **Middleware**: `attachAuth` verifikasi DB tiap request; `requireAuth`, `requireRole`,
  `requireVerified`; rate limit anti brute-force.
- **Validasi**: Zod di setiap endpoint; parameter query diparameterisasi (anti SQL injection).
- **CSP** (helmet) + `x-powered-by` dimatikan.
- **Cookie sesi**: httpOnly, sameSite=lax; JWT hanya penunjuk.
- **Token email**: di-hash di DB, sekali pakai, TTL (verifikasi 24 jam, reset 1 jam).
- **Anti-enumerasi**: forgot-password respons identik.
- **Test**: 10 test keamanan tambahan (Phase 7) + seluruh test Phase 2–6.

## 5. Pengujian

| Fase | Test | Jumlah |
|------|------|--------|
| 2 (RLS) | test/db-rls.test.js | 13 |
| 3 (Auth API) | test/auth-api.test.js | 15 |
| 4 (Moderasi) | test/moderation-api.test.js | 12 |
| 5 (Destinasi) | test/destinations-api.test.js | 8 |
| 6 (Ulasan/Itinerary) | test/phase6-api.test.js | 5 |
| 7 (Keamanan) | test/security-api.test.js | 10 |
| **Total** | | **63** |

**Semua 63 test lulus (0 gagal).** Menjalankan: `npm test` (serial, `--test-concurrency=1`).

## 6. Cara menjalankan

```bash
npm install          # sekali
npm run migrate      # migrasi SQL (001–006)
npm run seed         # data awal (opsional, untuk demo)
npm run dev          # server + PostgreSQL lokal → http://localhost:3000
npm test             # seluruh test
```

## 7. Konfigurasi (`.env`)

| Variabel | Status | Keterangan |
|----------|--------|------------|
| `PORT` | 3000 | Port server |
| `JWT_SECRET` | terisi (acak) | Secret sesi |
| `GOOGLE_MAPS_API_KEY` | **kosong** | Peta tetap jalan (OpenStreetMap) |
| `SMTP_URL` | **kosong** | Mode dev: email → `var/mail/*.eml` |
| `APP_URL` | http://localhost:3000 | Dasar tautan email |

> Tidak ada kredensial eksternal yang dikarang. Fitur yang bergantung pada key/SMTP
> dilaporkan apa adanya: belum aktif sampai diisi.

## 8. Kredensial demo

| Role | Email | Password |
|------|-------|----------|
| admin | admin@explore.test | Admin123! |
| contributor | contributor@explore.test | Contributor123! |
| explorer | explorer@explore.test | Explorer123! |
| reviewer | reviewer1@explore.test / reviewer2@explore.test | Reviewer123! |
| applicant | applicant@explore.test | Applicant123! |

## 9. Struktur akhir

```
explore-prototype-indonesia.html   # prototipe asli (tidak diubah)
server/  index.js app.js config.js
  db/  pg.js migrate.js seed.js migrations/001…006
  middleware/  auth.js rateLimit.js
  routes/  index.js auth.js admin.js contributor.js reports.js
           destinations.js favorites.js reviews.js itineraries.js
  utils/  http.js mailer.js
public/  index.html css/styles.css css/dashboard.css
  js/  app.js auth.js api.js ui.js dashboard.js destinations.js
  pages/  dashboard.html verify-email.html reset-password.html
test/  db-rls.test.js auth-api.test.js moderation-api.test.js
       destinations-api.test.js phase6-api.test.js security-api.test.js
DEVELOPMENT_PROGRESS.md  API.md  FINAL_REPORT.md
```

## 10. Keterbatasan & arah pengembangan lanjut

- Google Maps API & SMTP belum dikonfigurasi.
- Follows, sinkronisasi profil, dan real-time notifikasi belum diimplementasikan.
- Verifikasi browser manual terhambat tooling screenshot; fungsi backend terbukti oleh 63 test.
- Siap migrasi ke Supabase (skema & RLS kompatibel).

---

**Proyek Explore — 7 fase selesai. 63/63 test lulus.**
