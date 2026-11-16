# Explore — Progres Pengembangan

Platform discovery destinasi Indonesia. Prototipe single-file dikembangkan bertahap
menjadi produk multi-pengguna dengan PostgreSQL, autentikasi, RBAC, dan moderasi.
**Prinsip: UI/fitur prototipe dipertahankan 100%; setiap fase diuji sebelum lanjut.**

---

## Status Fase

| Fase | Nama | Status | Test |
|------|------|--------|------|
| 1 | Audit prototipe | ✅ Selesai | — |
| 2 | Database PostgreSQL (skema, RLS, trigger) | ✅ Selesai | 13/13 |
| 3 | Autentikasi & 4 role (admin/contributor/explorer/guest) | ✅ Selesai | 28/28 |
| 4 | Dashboard per role & moderasi kontribusi | ✅ Selesai | 40/40 |
| 5 | Integrasi data destinasi (API → frontend) | ✅ Selesai | 48/48 |
| 6 | Fitur lanjutan (ulasan, rating, itineraries) | ✅ Selesai | 53/53 |
| 7 | Pengujian penuh, hardening, dokumentasi | ✅ Selesai | 63/63 |

**Total test: 63 passing (0 gagal).**

---

## Fase 1 — Audit
- Prototipe: `explore-prototype-indonesia.html` (23,5 KB, vanilla JS + Leaflet + Google Maps deep-links).
- 8 fitur teridentifikasi & dipertahankan: pencarian, filter kategori, peta Leaflet,
  favorit (localStorage), detail modal, kalkulator budget, deep-link Google Maps, toast.
- Keputusan: PostgreSQL lokal (`embedded-postgres`, port 5433) + Node/Express;
  frontend vanilla JS dipecah jadi ES module (tanpa build tool).

## Fase 2 — Database
- 17 tabel (users, user_profiles, contributor_applications, categories, destinations,
  destination_images, reviews, favorites, itineraries, itinerary_items, contributions,
  reports, notifications, activity_logs, sessions, auth_tokens, follows).
- Enum status: `submission_status` (PENDING → UNDER_REVIEW → APPROVED/REJECTED/REVISION_REQUIRED),
  `destination_status`, `review_status`, `report_status`, `user_role`, `account_status`.
- RLS penuh untuk role non-superuser `explore_app` + fungsi SECURITY DEFINER
  (`auth_get_credentials`, `auth_create_token`, `auth_consume_token`, `notify_user`,
  `log_activity`, `apply_for_contributor`, `is_admin`, `is_super`).
- Guard trigger: immutability role/status pengguna, proteksi keputusan moderasi,
  agregasi rating otomatis, append-only `activity_logs`.
- Migrasi: `001_schema` … `006_auth_fixes` (jalankan: `npm run migrate`).
- Seed: 3 kategori, 6 destinasi, 6 demo user, 12 ulasan, antrean moderasi contoh (`npm run seed`).

**Kredensial demo (bukan produksi):**
| Role | Email | Password |
|------|-------|----------|
| admin | admin@explore.test | Admin123! |
| contributor | contributor@explore.test | Contributor123! |
| explorer | explorer@explore.test | Explorer123! |
| reviewer | reviewer1@explore.test / reviewer2@explore.test | Reviewer123! |
| applicant | applicant@explore.test | Applicant123! |

## Fase 3 — Autentikasi & RBAC
- Endpoint: register, login, logout, me, forgot/reset password, verify/resend email,
  daftar & cabut sesi (`server/routes/auth.js`).
- Middleware: `attachAuth` (verifikasi DB tiap request — pencabutan sesi & perubahan role
  langsung berlaku), `requireAuth`, `requireRole`, `requireVerified`.
- Cookie sesi `httpOnly` + `sameSite=lax`; password bcrypt; token email di-hash & sekali pakai.
- Kebijakan: login bebas, **email wajib verifikasi untuk kontribusi/pengajuan contributor**.
- Mailer: mode dev menulis `var/mail/*.eml`; SMTP aktif hanya bila `SMTP_URL` diisi.
- Frontend: modal login/register/forgot bergaya Explore, chip pengguna + menu role,
  bar verifikasi email, halaman `pages/verify-email.html` & `pages/reset-password.html`.
- Favorit/laporan guest diblokir → membuka modal login.

## Fase 4 — Dashboard & Moderasi
- **Backend**
  - `server/routes/admin.js` (khusus admin): statistik dashboard, daftar/cari pengguna,
    ubah role & status akun (dilarang ubah akun sendiri), antrean pengajuan contributor,
    antrean kontribusi, antrean laporan + endpoint keputusan.
  - `server/routes/contributor.js`: ajukan diri jadi contributor (wajib terverifikasi),
    kirim/ubah/tarik kontribusi (wajib role contributor + terverifikasi).
  - `server/routes/reports.js`: laporan informasi dari explorer (wajib login).
  - `GET/POST /api/notifications` — pusat notifikasi per pengguna.
  - Keputusan APPROVED dieksekusi nyata: `new_destination` → destinasi terbit (published),
    `update_destination` → perubahan diterapkan (whitelist kolom), `add_media` → galeri.
  - Notifikasi otomatis ke pengguna untuk semua keputusan moderasi.
  - Audit `log_activity` untuk setiap aksi admin.
- **Otorisasi ganda (backend + database)**
  - Transisi status divalidasi (`invalid_transition` 409) & dijaga guard trigger.
  - Kontributor tidak bisa menyetujui kirimannya sendiri / mengubah catatan admin.
  - Konten PENDING tidak pernah terlihat guest (RLS `destinations_select`).
  - Guest tidak dapat membaca `contributions` / `contributor_applications` (0 baris).
- **Frontend** — `public/pages/dashboard.html` + `public/js/dashboard.js` + `dashboard.css`
  - Admin: Statistik (kartu + sebaran role), Pengguna (cari, ganti role, tangguhkan),
    Pengajuan contributor (Setujui/Tolak/Minta revisi + catatan), Moderasi kontribusi
    (Tinjau/Setujui & terbitkan/Minta revisi/Tolak), Laporan.
  - Contributor: Kirim kontribusi (3 jenis formulir), Kontribusi saya (status + catatan
    admin + tarik), Notifikasi.
  - Explorer: Profil, Ajukan contributor (dengan status pengajuan), Notifikasi.
  - Redirect berbasis role setelah login: admin & contributor → dashboard; explorer tetap
    di Explore. Menu pengguna punya akses Dashboard.
  - Form laporan destinasi kini fungsional (sebelumnya hanya toast).

---

## Fase 5 — Integrasi Data Destinasi (API → Frontend)
- **Backend**
  - `GET /api/destinations` (search `?q=`, filter `?category=`, paginasi) — RLS memastikan guest hanya published; memakai index trigram.
  - `GET /api/destinations/:id` (id atau slug) + `GET /api/destinations/:id/reviews`.
  - `server/routes/favorites.js`: `GET/POST/DELETE /api/favorites` (login wajib) — sinkron dengan tabel `favorites`.
- **Frontend (Explore)**
  - `places` dimuat dari database (fallback ke 6 data lokal bila API gagal).
  - Pencarian & filter kategori memicu fetch ke server (debounce 300 ms).
  - Favorit sinkron ke DB untuk pengguna login (optimistic update + rollback bila gagal);
    guest tetap memakai localStorage + modal login.
  - Detail modal, peta Leaflet, kalkulator budget & deep-link Google Maps tetap berfungsi
    dengan data DB (id UUID).
  - Laporan destinasi kini fungsional (kirim ke antrean admin).
- **Test**: `test/destinations-api.test.js` (8 test: list/search/filter/detail/reviews/favorites).

## Perintah

```bash
npm install        # sekali
npm run migrate    # jalankan migrasi SQL
npm run seed       # data awal (opsional, untuk demo)
npm run dev        # server + PostgreSQL lokal → http://localhost:3000
npm test           # seluruh test (node --test, serial)
```

## Konfigurasi (`.env`)

| Variabel | Status | Keterangan |
|----------|--------|------------|
| `PORT` | 3000 | Port server |
| `JWT_SECRET` | sudah diisi (acak) | Secret sesi |
| `GOOGLE_MAPS_API_KEY` | **kosong** | Peta tetap jalan (OpenStreetMap); isi untuk fitur Google Maps resmi |
| `SMTP_URL` | **kosong** | Mode dev: email → `var/mail/*.eml`; isi `smtp://…` untuk kirim asli |
| `APP_URL` | http://localhost:3000 | Dasar tautan email verifikasi/reset |

> Tidak ada kredensial eksternal yang dikarang. Fitur yang bergantung pada key/SMTP
> dilaporkan apa adanya: belum aktif sampai diisi.

## Struktur

```
explore-prototype-indonesia.html   # prototipe asli (tidak diubah)
server/
  index.js app.js config.js
  db/  pg.js migrate.js seed.js migrations/001…006
  middleware/  auth.js rateLimit.js
  routes/  index.js auth.js admin.js contributor.js reports.js
  utils/  http.js mailer.js
public/
  index.html css/styles.css css/dashboard.css
  js/  app.js auth.js api.js ui.js dashboard.js destinations.js
  pages/  dashboard.html verify-email.html reset-password.html
test/  db-rls.test.js auth-api.test.js moderation-api.test.js
```

## Fase 6 - Fitur Lanjutan (ulasan, rating, itineraries)

- Backend
  - server/routes/reviews.js: GET /api/reviews/mine, POST /api/reviews, PUT /api/reviews/:id, DELETE /api/reviews/:id. Rating agregat diperbarui otomatis oleh trigger maintain_destination_rating (Phase 2).
  - server/routes/itineraries.js: CRUD itinerary + item (destinasi, tanggal, urutan, catatan) dengan isolasi antar pengguna (RLS + owns_itinerary).
- Test: test/phase6-api.test.js - 5 test (ulasan & agregat, validasi rating, CRUD itinerary, isolasi antar pengguna).

## Fase 7 - Pengujian penuh, hardening, dokumentasi

- Test keamanan: test/security-api.test.js (10 test) - SQL injection, XSS (register & kontribusi),
  path traversal, payload oversized, cookie palsu, role escalation, akses endpoint admin, header keamanan.
- Dokumentasi: API.md (endpoint lengkap), FINAL_REPORT.md (laporan akhir proyek).
- DEVELOPMENT_PROGRESS.md ditandai selesai (7/7 fase).

## Catatan jujur / keterbatasan saat ini
- `GET /api/destinations` sudah aktif - frontend memakai data DB, fallback ke 6 data lokal bila API gagal.
- Favorit sinkron ke tabel `favorites` untuk pengguna login; guest memakai localStorage.
- Google Maps API & SMTP tetap belum dikonfigurasi (placeholder di `.env`).
- Verifikasi browser manual sempat terhambat oleh tooling screenshot (frame basi);
  seluruh fungsi backend/role terbukti oleh 48 test otomatis.
- Proyek selesai (7/7 fase). Follows & sinkronisasi profil dapat ditambahkan sebagai pengembangan lanjut.
