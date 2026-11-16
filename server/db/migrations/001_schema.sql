-- ============================================================
-- Explore — 001_schema.sql
-- Ekstensi, tipe enumerasi, tabel, indeks, dan fungsi bantu.
-- Dijalankan sebagai superuser (owner skema) oleh server/db/migrate.js
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- pencarian nama destinasi

-- ------------------------------------------------------------
-- Tipe enumerasi
-- ------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('admin', 'contributor', 'explorer');
CREATE TYPE account_status AS ENUM ('active', 'suspended');
CREATE TYPE submission_status AS ENUM (
  'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED'
);
CREATE TYPE destination_status AS ENUM ('draft', 'pending_review', 'published', 'archived');
CREATE TYPE review_status AS ENUM ('approved', 'hidden', 'rejected');
CREATE TYPE report_status AS ENUM ('open', 'in_review', 'resolved', 'dismissed');

-- ------------------------------------------------------------
-- USERS — akun inti (role ditentukan server, tidak bisa diubah sendiri)
-- ------------------------------------------------------------
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        VARCHAR(120) NOT NULL,
  email            VARCHAR(255) NOT NULL,
  password_hash    TEXT,                          -- NULL untuk provider OAuth
  provider         VARCHAR(30)  NOT NULL DEFAULT 'local',
  provider_id      VARCHAR(255),
  role             user_role    NOT NULL DEFAULT 'explorer',
  avatar           TEXT,
  account_status   account_status NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT users_email_unique UNIQUE (email),
  CONSTRAINT users_provider_unique UNIQUE (provider, provider_id)
);

-- ------------------------------------------------------------
-- USER_PROFILES — data pelengkap pengguna
-- ------------------------------------------------------------
CREATE TABLE user_profiles (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL UNIQUE
                     REFERENCES users (id) ON DELETE CASCADE,
  bio                TEXT,
  country            VARCHAR(80),
  preferred_language VARCHAR(10) NOT NULL DEFAULT 'id',
  travel_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- CONTRIBUTOR_APPLICATIONS — pengajuan menjadi contributor (disetujui admin)
-- ------------------------------------------------------------
CREATE TABLE contributor_applications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL
                     REFERENCES users (id) ON DELETE CASCADE,
  application_reason TEXT NOT NULL,
  expertise          TEXT[] NOT NULL DEFAULT '{}',
  status             submission_status NOT NULL DEFAULT 'PENDING',
  admin_note         TEXT,
  reviewed_by        UUID REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT applications_reviewer_check
    CHECK (reviewed_at IS NULL OR reviewed_by IS NOT NULL)
);
-- Satu pengajuan aktif per pengguna
CREATE UNIQUE INDEX applications_one_active_idx
  ON contributor_applications (user_id)
  WHERE status IN ('PENDING', 'UNDER_REVIEW');

-- ------------------------------------------------------------
-- CATEGORIES — kategori destinasi (Alam, Budaya, Pantai, ...)
-- ------------------------------------------------------------
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(80) NOT NULL UNIQUE,
  description TEXT,
  icon        VARCHAR(10),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- DESTINATIONS — sumber informasi utama Explore
-- ------------------------------------------------------------
CREATE TABLE destinations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(150) NOT NULL,
  slug           VARCHAR(180) NOT NULL UNIQUE,
  description    TEXT NOT NULL,
  category_id    UUID NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  country        VARCHAR(80) NOT NULL DEFAULT 'Indonesia',
  city           VARCHAR(100),
  address        TEXT,
  latitude       DOUBLE PRECISION,
  longitude      DOUBLE PRECISION,
  estimated_cost INTEGER NOT NULL DEFAULT 0,
  status         destination_status NOT NULL DEFAULT 'pending_review',
  rating_avg     NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count   INTEGER NOT NULL DEFAULT 0,
  created_by     UUID REFERENCES users (id) ON DELETE SET NULL,
  verified_by    UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT destinations_coords_check
    CHECK (latitude  IS NULL OR latitude  BETWEEN -90  AND 90),
  CONSTRAINT destinations_lon_check
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CONSTRAINT destinations_cost_check CHECK (estimated_cost >= 0)
);

CREATE INDEX destinations_status_idx  ON destinations (status);
CREATE INDEX destinations_category_idx ON destinations (category_id);
CREATE INDEX destinations_country_idx ON destinations (country);
CREATE INDEX destinations_coords_idx  ON destinations (latitude, longitude);
CREATE INDEX destinations_name_trgm_idx ON destinations USING gin (name gin_trgm_ops);

-- ------------------------------------------------------------
-- DESTINATION_IMAGES — galeri foto destinasi
-- ------------------------------------------------------------
CREATE TABLE destination_images (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id UUID NOT NULL REFERENCES destinations (id) ON DELETE CASCADE,
  image_url      TEXT NOT NULL,
  caption        VARCHAR(200),
  uploaded_by    UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX destination_images_dest_idx ON destination_images (destination_id);

-- ------------------------------------------------------------
-- REVIEWS — rating & ulasan explorer (satu ulasan per destinasi)
-- ------------------------------------------------------------
CREATE TABLE reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations (id) ON DELETE CASCADE,
  rating         SMALLINT NOT NULL,
  review_text    TEXT,
  status         review_status NOT NULL DEFAULT 'approved',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reviews_rating_check CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT reviews_unique_user_destination UNIQUE (user_id, destination_id)
);
CREATE INDEX reviews_destination_idx ON reviews (destination_id, status);

-- ------------------------------------------------------------
-- FAVORITES — tempat tersimpan milik explorer
-- ------------------------------------------------------------
CREATE TABLE favorites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations (id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT favorites_unique UNIQUE (user_id, destination_id)
);
CREATE INDEX favorites_user_idx ON favorites (user_id);

-- ------------------------------------------------------------
-- ITINERARIES + ITINERARY_ITEMS — perencanaan perjalanan
-- ------------------------------------------------------------
CREATE TABLE itineraries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title            VARCHAR(150) NOT NULL,
  start_date       DATE,
  end_date         DATE,
  estimated_budget INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT itineraries_dates_check
    CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT itineraries_budget_check CHECK (estimated_budget >= 0)
);
CREATE INDEX itineraries_user_idx ON itineraries (user_id);

CREATE TABLE itinerary_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  itinerary_id   UUID NOT NULL REFERENCES itineraries (id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations (id) ON DELETE RESTRICT,
  visit_date     DATE,
  visit_order    INTEGER NOT NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT itinerary_items_order_unique UNIQUE (itinerary_id, visit_order),
  CONSTRAINT itinerary_items_order_check CHECK (visit_order >= 1)
);
CREATE INDEX itinerary_items_itinerary_idx ON itinerary_items (itinerary_id);

-- ------------------------------------------------------------
-- CONTRIBUTIONS — pengajuan kontributor (moderasi admin)
-- ------------------------------------------------------------
CREATE TABLE contributions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contributor_id   UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  destination_id   UUID REFERENCES destinations (id) ON DELETE SET NULL,
  submission_type  VARCHAR(30) NOT NULL
                   CHECK (submission_type IN ('new_destination', 'update_destination', 'add_media')),
  submission_data  JSONB NOT NULL,
  status           submission_status NOT NULL DEFAULT 'PENDING',
  admin_note       TEXT,
  reviewed_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contributions_reviewer_check
    CHECK (reviewed_at IS NULL OR reviewed_by IS NOT NULL)
);
CREATE INDEX contributions_status_idx ON contributions (status, created_at DESC);
CREATE INDEX contributions_contributor_idx ON contributions (contributor_id, created_at DESC);

-- ------------------------------------------------------------
-- REPORTS — laporan informasi salah dari pengguna
-- ------------------------------------------------------------
CREATE TABLE reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  destination_id UUID NOT NULL REFERENCES destinations (id) ON DELETE CASCADE,
  report_type    VARCHAR(40) NOT NULL
                 CHECK (report_type IN ('wrong_info', 'closed', 'unsafe', 'outdated', 'other')),
  description    TEXT NOT NULL,
  status         report_status NOT NULL DEFAULT 'open',
  handled_by     UUID REFERENCES users (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);

-- ------------------------------------------------------------
-- NOTIFICATIONS — pusat notifikasi per pengguna
-- ------------------------------------------------------------
CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title             VARCHAR(150) NOT NULL,
  message           TEXT NOT NULL,
  notification_type VARCHAR(40) NOT NULL DEFAULT 'system'
                    CHECK (notification_type IN
                      ('system', 'verification', 'moderation', 'review', 'social')),
  link              VARCHAR(255),
  is_read           BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, is_read, created_at DESC);

-- ------------------------------------------------------------
-- ACTIVITY_LOGS — jejak audit aktivitas penting (append-only)
-- ------------------------------------------------------------
CREATE TABLE activity_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID REFERENCES users (id) ON DELETE SET NULL,
  action      VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40),
  entity_id   VARCHAR(60),
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_logs_user_idx ON activity_logs (user_id, created_at DESC);
CREATE INDEX activity_logs_time_idx ON activity_logs (created_at DESC);
CREATE INDEX activity_logs_entity_idx ON activity_logs (entity_type, entity_id);

-- ------------------------------------------------------------
-- SESSIONS — manajemen sesi per perangkat
-- ------------------------------------------------------------
CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_agent  VARCHAR(300),
  ip          INET,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id, revoked_at);

-- ------------------------------------------------------------
-- AUTH_TOKENS — token verifikasi email & reset password (disimpan hash)
-- ------------------------------------------------------------
CREATE TABLE auth_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  purpose    VARCHAR(30) NOT NULL
             CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_hash_idx ON auth_tokens (token_hash);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, purpose);

-- ------------------------------------------------------------
-- FOLLOWS — explorer mengikuti contributor
-- ------------------------------------------------------------
CREATE TABLE follows (
  follower_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  followee_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT follows_no_self CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id);
