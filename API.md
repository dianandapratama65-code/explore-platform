# Explore — Dokumentasi API

Base URL: `http://localhost:3000` (dev). Semua endpoint di bawah prefix `/api`.
Sesi dikirim via cookie `explore_session` (httpOnly). Gunakan `credentials: 'include'`.

## Format respons
- Sukses: `{ ... }` (struktur per endpoint).
- Gagal: `{ "error": { "code": "...", "message": "...", "details": [...] } }` dengan status HTTP yang sesuai.

## Kode error umum
`authentication_required` (401), `role_forbidden` (403), `email_not_verified` (403),
`account_suspended` (403), `not_found` (404), `validation_error` (400),
`invalid_token` (400), `rate_limited` (429), `payload_too_large` (413).

---

## Konfigurasi publik
### `GET /api/config`
```json
{ "google_maps": { "enabled": false, "api_key": null }, "default_language": "id" }
```
### `GET /api/health`
```json
{ "ok": true, "server_time": "...", "db": "explore" }
```

## Autentikasi (`/api/auth`)

| Method | Path | Auth | Body | Keterangan |
|--------|------|------|------|------------|
| POST | `/register` | — | `{full_name,email,password}` | role dipaksa `explorer` |
| POST | `/login` | — | `{email,password}` | set cookie sesi |
| POST | `/logout` | sesi | — | cabut sesi |
| GET | `/me` | sesi | — | profil + user |
| POST | `/forgot-password` | — | `{email}` | respons identik (anti-enumerasi) |
| POST | `/reset-password` | — | `{token,password}` | token sekali pakai |
| POST | `/verify-email` | — | `{token}` | verifikasi email |
| POST | `/resend-verification` | sesi | — | wajib belum verifikasi |
| GET | `/sessions` | sesi | — | daftar sesi milik sendiri |
| DELETE | `/sessions/:id` | sesi | — | cabut sesi perangkat |

**Validasi password**: min 8, max 72, mengandung huruf & angka.

## Destinasi (`/api/destinations`)
### `GET /api/destinations`
Query: `q`, `category`, `limit` (1–60, default 24), `offset`.
Respons: `{ destinations: [...], count }`. Guest hanya melihat `published`.

### `GET /api/destinations/:id`
`:id` = UUID atau slug. Respons: `{ destination }` (termasuk `images[]`).

### `GET /api/destinations/:id/reviews`
Respons: `{ reviews: [{id,rating,content,created_at,author_name,avatar}] }`.

## Favorit (`/api/favorites`) — login wajib
- `GET /` → `{ favorites: [{destination_id,name,slug,...}] }`
- `POST /` body `{destination_id}` → 201
- `DELETE /:destinationId` → 200

## Ulasan (`/api/reviews`) — login wajib
- `GET /mine` → `{ reviews }`
- `POST /` body `{destination_id,rating (1-5),review_text?}` → 201 (rating agregat otomatis)
- `PUT /:id` body `{rating?,review_text?}` → 200
- `DELETE /:id` → 200 (pemilik atau admin)

## Itineraries (`/api/itineraries`) — login wajib
- `GET /` → `{ itineraries: [{id,title,...,item_count}] }`
- `POST /` body `{title,start_date?,end_date?,estimated_budget?}` → 201
- `GET /:id` → `{ itinerary, items }`
- `PUT /:id` body `{title?,start_date?,end_date?,estimated_budget?}` → 200
- `DELETE /:id` → 200
- `POST /:id/items` body `{destination_id,visit_date?,visit_order,notes?}` → 201
- `PUT /:id/items/:itemId` body `{destination_id?,visit_date?,visit_order?,notes?}` → 200
- `DELETE /:id/items/:itemId` → 200

## Kontributor (`/api/contributor`) — login wajib
- `GET /application` → `{ application }` (null bila belum pernah)
- `POST /apply` body `{reason (min 20), expertise[]}` — wajib email terverifikasi → 201
- `GET /contributions` — role contributor → `{ contributions }`
- `POST /contributions` — role contributor + terverifikasi, body `{submission_type, data}` → 201
  - `submission_type`: `new_destination` | `update_destination` | `add_media`
- `PUT /contributions/:id` — body sama, hanya PENDING/REVISION_REQUIRED → 200
- `DELETE /contributions/:id` — hanya PENDING/REVISION_REQUIRED → 200

## Laporan (`/api/reports`) — login wajib
- `POST /` body `{destination_id, report_type, description (min 10)}` → 201
  - `report_type`: `wrong_info` | `closed` | `unsafe` | `outdated` | `other`

## Notifikasi (`/api/notifications`) — login wajib
- `GET /` → `{ notifications: [{id,title,message,notification_type,link,is_read,created_at}] }`
- `POST /read` → tandai semua dibaca

## Admin (`/api/admin`) — role admin wajib
- `GET /ping` → `{ ok, role }`
- `GET /stats` → statistik (users, destinasi, kontribusi, pengajuan, laporan, sebaran role)
- `GET /users?q=&role=` → `{ users }`
- `PATCH /users/:id` body `{role?,account_status?}` → 200 (dilarang ubah akun sendiri)
- `GET /applications?status=` → `{ applications }`
- `POST /applications/:id/review` body `{status,note?}` → 200 (APPROVED menaikkan role user)
- `GET /contributions?status=` → `{ contributions }`
- `POST /contributions/:id/review` body `{status,note?}` → 200 (APPROVED menerapkan konten)
- `GET /reports?status=` → `{ reports }`
- `POST /reports/:id/review` body `{status}` → 200 (`in_review`|`resolved`|`dismissed`)

## Status enum
- `submission_status`: `PENDING`, `UNDER_REVIEW`, `APPROVED`, `REJECTED`, `REVISION_REQUIRED`
- `destination_status`: `draft`, `pending_review`, `published`, `archived`
- `report_status`: `open`, `in_review`, `resolved`, `dismissed`
- `user_role`: `admin`, `contributor`, `explorer`
- `account_status`: `active`, `suspended`

## Rate limit
- Endpoint auth: 10 req/menit (×50 di mode test).
- Endpoint API umum: 120 req/menit.

## Kredensial demo
Lihat `DEVELOPMENT_PROGRESS.md`.
