-- ============================================================
-- Explore — 003_rls.sql
-- Row Level Security: pembatasan akses data ditegakkan di level
-- DATABASE, bukan hanya di UI/API. Koneksi runtime memakai role
-- non-superuser `explore_app` sehingga kebijakan ini aktif.
--
-- Konteks per sesi diatur server dengan:
--   SET LOCAL app.user_id = '<uuid>';   -- NULL untuk guest
-- ============================================================

-- ------------------------------------------------------------
-- Fungsi bantu kebijakan
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION owns_itinerary(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM itineraries i
    WHERE i.id = p_id AND i.user_id = current_user_id()
  );
$$;

CREATE OR REPLACE FUNCTION dest_published(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM destinations d
    WHERE d.id = p_id AND d.status = 'published'
  );
$$;

CREATE OR REPLACE FUNCTION owns_destination(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM destinations d
    WHERE d.id = p_id AND d.created_by = current_user_id()
  );
$$;

-- ------------------------------------------------------------
-- Aktifkan RLS pada seluruh tabel
-- ------------------------------------------------------------
ALTER TABLE users                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributor_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories              ENABLE ROW LEVEL SECURITY;
ALTER TABLE destinations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE destination_images      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites               ENABLE ROW LEVEL SECURITY;
ALTER TABLE itineraries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE itinerary_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows                 ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- USERS
-- ============================================================
-- Baca: admin atau diri sendiri. (Login memakai auth_get_credentials)
CREATE POLICY users_select ON users FOR SELECT
  USING (is_admin() OR id = current_user_id());

-- INSERT: terbuka untuk registrasi; trigger 004_memaksa role='explorer'
-- untuk pendaftar non-admin (role tidak bisa dipilih sendiri).
CREATE POLICY users_insert ON users FOR INSERT
  WITH CHECK (true);

-- UPDATE/DELETE: admin atau pemilik akun (kolom RBAC dijaga trigger).
CREATE POLICY users_update ON users FOR UPDATE
  USING (is_admin() OR id = current_user_id())
  WITH CHECK (is_admin() OR id = current_user_id());

CREATE POLICY users_delete ON users FOR DELETE
  USING (is_admin());

-- ============================================================
-- USER_PROFILES
-- ============================================================
CREATE POLICY user_profiles_select ON user_profiles FOR SELECT
  USING (is_admin() OR user_id = current_user_id());
CREATE POLICY user_profiles_insert ON user_profiles FOR INSERT
  WITH CHECK (is_admin() OR user_id = current_user_id());
CREATE POLICY user_profiles_update ON user_profiles FOR UPDATE
  USING (is_admin() OR user_id = current_user_id())
  WITH CHECK (is_admin() OR user_id = current_user_id());
CREATE POLICY user_profiles_delete ON user_profiles FOR DELETE
  USING (is_admin() OR user_id = current_user_id());

-- ============================================================
-- CONTRIBUTOR_APPLICATIONS
-- Pendaftaran contributor lewat fungsi apply_for_contributor().
-- ============================================================
CREATE POLICY applications_select ON contributor_applications FOR SELECT
  USING (is_admin() OR user_id = current_user_id());
CREATE POLICY applications_insert ON contributor_applications FOR INSERT
  WITH CHECK (user_id = current_user_id()
              AND status = 'PENDING'
              AND reviewed_by IS NULL);
-- Peninjauan hanya admin (disetujui/ditolak/direvisi).
CREATE POLICY applications_update ON contributor_applications FOR UPDATE
  USING (is_admin()) WITH CHECK (is_admin());
-- Pengguna dapat menarik pengajuan yang masih PENDING.
CREATE POLICY applications_delete ON contributor_applications FOR DELETE
  USING (is_admin() OR (user_id = current_user_id() AND status = 'PENDING'));

-- ============================================================
-- CATEGORIES — publik membaca, admin mengelola
-- ============================================================
CREATE POLICY categories_select ON categories FOR SELECT USING (true);
CREATE POLICY categories_insert ON categories FOR INSERT
  WITH CHECK (is_admin());
CREATE POLICY categories_update ON categories FOR UPDATE
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY categories_delete ON categories FOR DELETE
  USING (is_admin());

-- ============================================================
-- DESTINATIONS
-- Publik hanya melihat status 'published'.
-- Contributor menyimpan sebagai 'draft'/'pending_review'.
-- ============================================================
CREATE POLICY destinations_select ON destinations FOR SELECT
  USING (status = 'published'
         OR is_admin()
         OR created_by = current_user_id());

CREATE POLICY destinations_insert ON destinations FOR INSERT
  WITH CHECK (is_admin()
              OR (created_by = current_user_id()
                  AND status IN ('draft', 'pending_review')));

CREATE POLICY destinations_update ON destinations FOR UPDATE
  USING (is_admin()
         OR (created_by = current_user_id()
             AND status IN ('draft', 'pending_review')))
  WITH CHECK (is_admin()
              OR (created_by = current_user_id()
                  AND status IN ('draft', 'pending_review')));

-- Penghapusan hanya admin.
CREATE POLICY destinations_delete ON destinations FOR DELETE
  USING (is_admin());

-- ============================================================
-- DESTINATION_IMAGES
-- ============================================================
CREATE POLICY images_select ON destination_images FOR SELECT
  USING (is_admin()
         OR uploaded_by = current_user_id()
         OR dest_published(destination_id));
CREATE POLICY images_insert ON destination_images FOR INSERT
  WITH CHECK (is_admin()
              OR (uploaded_by = current_user_id()
                  AND owns_destination(destination_id)
                  AND (SELECT d.status FROM destinations d
                        WHERE d.id = destination_id) IN ('draft', 'pending_review')));
CREATE POLICY images_update ON destination_images FOR UPDATE
  USING (is_admin() OR uploaded_by = current_user_id())
  WITH CHECK (is_admin() OR uploaded_by = current_user_id());
CREATE POLICY images_delete ON destination_images FOR DELETE
  USING (is_admin() OR uploaded_by = current_user_id());

-- ============================================================
-- REVIEWS — publik membaca 'approved', pengguna membaca miliknya
-- ============================================================
CREATE POLICY reviews_select ON reviews FOR SELECT
  USING (status = 'approved' OR is_admin() OR user_id = current_user_id());
CREATE POLICY reviews_insert ON reviews FOR INSERT
  WITH CHECK (user_id = current_user_id() AND status = 'approved');
CREATE POLICY reviews_update ON reviews FOR UPDATE
  USING (is_admin() OR user_id = current_user_id())
  WITH CHECK (is_admin() OR user_id = current_user_id());
CREATE POLICY reviews_delete ON reviews FOR DELETE
  USING (is_admin() OR user_id = current_user_id());

-- ============================================================
-- FAVORITES — hanya pemilik (admin untuk statistik)
-- ============================================================
CREATE POLICY favorites_select ON favorites FOR SELECT
  USING (is_admin() OR user_id = current_user_id());
CREATE POLICY favorites_insert ON favorites FOR INSERT
  WITH CHECK (user_id = current_user_id() AND dest_published(destination_id));
CREATE POLICY favorites_delete ON favorites FOR DELETE
  USING (is_admin() OR user_id = current_user_id());

-- ============================================================
-- ITINERARIES & ITEMS — hanya pemilik
-- ============================================================
CREATE POLICY itineraries_select ON itineraries FOR SELECT
  USING (is_admin() OR user_id = current_user_id());
CREATE POLICY itineraries_insert ON itineraries FOR INSERT
  WITH CHECK (user_id = current_user_id());
CREATE POLICY itineraries_update ON itineraries FOR UPDATE
  USING (is_admin() OR user_id = current_user_id())
  WITH CHECK (is_admin() OR user_id = current_user_id());
CREATE POLICY itineraries_delete ON itineraries FOR DELETE
  USING (is_admin() OR user_id = current_user_id());

CREATE POLICY itinerary_items_select ON itinerary_items FOR SELECT
  USING (is_admin() OR owns_itinerary(itinerary_id));
CREATE POLICY itinerary_items_insert ON itinerary_items FOR INSERT
  WITH CHECK ((is_admin() OR owns_itinerary(itinerary_id))
              AND (is_admin() OR dest_published(destination_id)));
CREATE POLICY itinerary_items_update ON itinerary_items FOR UPDATE
  USING (is_admin() OR owns_itinerary(itinerary_id))
  WITH CHECK (is_admin() OR owns_itinerary(itinerary_id));
CREATE POLICY itinerary_items_delete ON itinerary_items FOR DELETE
  USING (is_admin() OR owns_itinerary(itinerary_id));

-- ============================================================
-- CONTRIBUTIONS — alur moderasi admin
-- ============================================================
CREATE POLICY contributions_select ON contributions FOR SELECT
  USING (is_admin() OR contributor_id = current_user_id());

CREATE POLICY contributions_insert ON contributions FOR INSERT
  WITH CHECK (contributor_id = current_user_id()
              AND status = 'PENDING'
              AND reviewed_by IS NULL
              AND reviewed_at IS NULL);

-- Pemilik hanya boleh mengubah isi selama PENDING/REVISION_REQUIRED;
-- perubahan status & keputusan admin dijaga trigger (004).
CREATE POLICY contributions_update ON contributions FOR UPDATE
  USING (is_admin()
         OR (contributor_id = current_user_id()
             AND status IN ('PENDING', 'REVISION_REQUIRED')))
  WITH CHECK (is_admin()
              OR (contributor_id = current_user_id()
                  AND status IN ('PENDING', 'REVISION_REQUIRED')));

CREATE POLICY contributions_delete ON contributions FOR DELETE
  USING (is_admin()
         OR (contributor_id = current_user_id()
             AND status IN ('PENDING', 'REVISION_REQUIRED')));

-- ============================================================
-- REPORTS
-- ============================================================
CREATE POLICY reports_select ON reports FOR SELECT
  USING (is_admin() OR reporter_id = current_user_id());
CREATE POLICY reports_insert ON reports FOR INSERT
  WITH CHECK (reporter_id = current_user_id() AND status = 'open');
CREATE POLICY reports_update ON reports FOR UPDATE
  USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY reports_delete ON reports FOR DELETE
  USING (is_admin() OR reporter_id = current_user_id());

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE POLICY notifications_select ON notifications FOR SELECT
  USING (is_admin() OR user_id = current_user_id());
CREATE POLICY notifications_insert ON notifications FOR INSERT
  WITH CHECK (user_id = current_user_id() OR is_admin());
CREATE POLICY notifications_update ON notifications FOR UPDATE
  USING (user_id = current_user_id() OR is_admin())
  WITH CHECK (user_id = current_user_id() OR is_admin());
CREATE POLICY notifications_delete ON notifications FOR DELETE
  USING (user_id = current_user_id() OR is_admin());

-- ============================================================
-- ACTIVITY_LOGS — append-only (tanpa UPDATE/DELETE = immutable)
-- ============================================================
CREATE POLICY activity_select ON activity_logs FOR SELECT
  USING (is_admin() OR user_id = current_user_id());
CREATE POLICY activity_insert ON activity_logs FOR INSERT
  WITH CHECK (user_id = current_user_id() OR user_id IS NULL OR is_admin());

-- ============================================================
-- SESSIONS
-- ============================================================
CREATE POLICY sessions_select ON sessions FOR SELECT
  USING (is_admin() OR user_id = current_user_id());
CREATE POLICY sessions_insert ON sessions FOR INSERT
  WITH CHECK (user_id = current_user_id());
CREATE POLICY sessions_update ON sessions FOR UPDATE
  USING (user_id = current_user_id() OR is_admin())
  WITH CHECK (user_id = current_user_id() OR is_admin());
CREATE POLICY sessions_delete ON sessions FOR DELETE
  USING (user_id = current_user_id() OR is_admin());

-- ============================================================
-- AUTH_TOKENS — TANPA kebijakan apa pun.
-- Hanya dapat diakses lewat fungsi SECURITY DEFINER
-- (auth_create_token / auth_consume_token).
-- ============================================================

-- ============================================================
-- FOLLOWS
-- ============================================================
CREATE POLICY follows_select ON follows FOR SELECT
  USING (is_admin() OR follower_id = current_user_id() OR followee_id = current_user_id());
CREATE POLICY follows_insert ON follows FOR INSERT
  WITH CHECK (follower_id = current_user_id());
CREATE POLICY follows_delete ON follows FOR DELETE
  USING (is_admin() OR follower_id = current_user_id());

-- ============================================================
-- GRANTS — hak akses role aplikasi (non-superuser)
-- Catatan: kolom password_hash TIDAK diberikan SELECT;
-- pembacaan hash hanya melalui auth_get_credentials().
-- ============================================================
GRANT USAGE ON SCHEMA public TO explore_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO explore_app;

REVOKE ALL ON users FROM explore_app;
GRANT SELECT (id, full_name, email, avatar, role, account_status,
              email_verified_at, provider, provider_id, created_at, updated_at)
  ON users TO explore_app;
GRANT INSERT (full_name, email, password_hash, provider, provider_id, role)
  ON users TO explore_app;
GRANT UPDATE (full_name, avatar, password_hash, role, account_status,
              email_verified_at)
  ON users TO explore_app;

REVOKE ALL ON auth_tokens FROM explore_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO explore_app;

REVOKE CREATE ON SCHEMA public FROM explore_app;

-- Fungsi hanya untuk role aplikasi, bukan PUBLIC
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO explore_app;

-- Objek masa depan yang dibuat superuser otomatis mendapat grant
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO explore_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO explore_app;
