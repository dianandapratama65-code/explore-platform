-- ============================================================
-- Explore — 004_triggers.sql
-- Trigger keamanan (penjaga role & status) dan integritas data.
-- ============================================================

-- ------------------------------------------------------------
-- updated_at otomatis
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER destinations_updated_at
  BEFORE UPDATE ON destinations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER contributions_updated_at
  BEFORE UPDATE ON contributions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER itineraries_updated_at
  BEFORE UPDATE ON itineraries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- PENJAGA ROLE PENGGUNA
-- Pengguna TIDAK BOLEH mengubah role / status akunnya sendiri.
-- Hanya admin yang dapat menaikkan role atau menonaktifkan akun.
-- ============================================================
CREATE OR REPLACE FUNCTION guard_user_role()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Pendaftar selalu menjadi explorer; role lain hanya via admin.
    IF NOT is_admin() THEN
      NEW.role := 'explorer';
      NEW.account_status := 'active';
      NEW.email_verified_at := NULL;
    END IF;
    NEW.email := lower(NEW.email);
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NOT is_admin() THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'role_change_forbidden: Role akun hanya dapat diubah oleh admin.';
    END IF;
    IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
      RAISE EXCEPTION 'account_status_change_forbidden: Status akun hanya dapat diubah oleh admin.';
    END IF;
    -- Perubahan email memerlukan verifikasi ulang (dinonaktifkan via API)
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'email_change_forbidden: Perubahan email tidak diizinkan melalui sesi ini.';
    END IF;
  ELSE
    NEW.email := lower(NEW.email);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER users_guard_role
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION guard_user_role();

-- ============================================================
-- PROFIL & AUDIT saat registrasi
-- ============================================================
CREATE OR REPLACE FUNCTION after_user_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  INSERT INTO user_profiles (user_id) VALUES (NEW.id);
  PERFORM log_activity(NEW.id, 'auth.register', 'user', NEW.id::text,
                       jsonb_build_object('role', NEW.role, 'provider', NEW.provider));
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_after_insert
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION after_user_insert();

-- ============================================================
-- PENJAGA STATUS KONTRIBUSI
-- Pemilik kontribusi tidak boleh menyetujui / menolak karyanya sendiri,
-- tidak boleh mengubah peninjau, dan hanya boleh:
--   - mengubah isi selama PENDING / REVISION_REQUIRED
--   - mengirim ulang (status -> PENDING) dari REVISION_REQUIRED
-- ============================================================
CREATE OR REPLACE FUNCTION guard_contribution_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.contributor_id IS DISTINCT FROM OLD.contributor_id
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.admin_note IS DISTINCT FROM OLD.admin_note THEN
    RAISE EXCEPTION 'contribution_review_forbidden: Hanya admin yang dapat mengubah data peninjauan.';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (OLD.status IN ('PENDING', 'REVISION_REQUIRED')
            AND NEW.status = 'PENDING') THEN
      RAISE EXCEPTION 'contribution_status_forbidden: Status kontribusi hanya dapat diubah oleh admin.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER contributions_guard
  BEFORE UPDATE ON contributions
  FOR EACH ROW EXECUTE FUNCTION guard_contribution_status();

-- ============================================================
-- PENJAGA STATUS PENGAJUAN CONTRIBUTOR
-- ============================================================
CREATE OR REPLACE FUNCTION guard_application_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
     OR NEW.admin_note IS DISTINCT FROM OLD.admin_note THEN
    RAISE EXCEPTION 'application_review_forbidden: Hanya admin yang dapat meninjau pengajuan contributor.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER applications_guard
  BEFORE UPDATE ON contributor_applications
  FOR EACH ROW EXECUTE FUNCTION guard_application_status();

-- ============================================================
-- PENJAGA ULASAN
-- Non-admin tidak boleh mengubah status ulasan (hidden/rejected).
-- ============================================================
CREATE OR REPLACE FUNCTION guard_review_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT is_admin() AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'review_status_forbidden: Status ulasan hanya dapat diubah oleh admin.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reviews_guard
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION guard_review_status();

-- ============================================================
-- RATING OTOMATIS — agregasi ulasan ke destinations
-- ============================================================
CREATE OR REPLACE FUNCTION maintain_destination_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_dest uuid;
BEGIN
  v_dest := COALESCE(NEW.destination_id, OLD.destination_id);

  UPDATE destinations d
     SET rating_avg = COALESCE(s.avg_rating, 0),
         rating_count = COALESCE(s.cnt, 0)
    FROM (
      SELECT round(avg(r.rating), 2)::numeric(3,2) AS avg_rating,
             count(*)::int AS cnt
      FROM reviews r
      WHERE r.destination_id = v_dest
        AND r.status = 'approved'
    ) s
   WHERE d.id = v_dest;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER reviews_maintain_rating
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION maintain_destination_rating();

-- ============================================================
-- VERIFIKASI OTOMATIS — admin yang menerbitkan menjadi verified_by
-- ============================================================
CREATE OR REPLACE FUNCTION mark_destination_verified()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'published'
     AND OLD.status IS DISTINCT FROM 'published'
     AND is_admin() THEN
    NEW.verified_by := current_user_id();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER destinations_mark_verified
  BEFORE UPDATE ON destinations
  FOR EACH ROW EXECUTE FUNCTION mark_destination_verified();

-- ============================================================
-- HAPUS ULASAN TANPA TUJUAN — jaga agar agregasi tetap akurat
-- (trigger maintain_destination_rating sudah menangani DELETE)
-- ============================================================
