-- ============================================================
-- Explore — 005_views_and_fixes.sql
-- 1. is_super() — agar sesi superuser (script bootstrap/migrasi)
--    tidak dihambat trigger penjaga (RLS tetap menegakkan app role).
-- 2. public_profiles — tampilan aman kolom publik pengguna
--    (tanpa email) untuk fitur "ikuti contributor" & kartu ulasan.
-- 3. Hak DELETE users untuk admin (ditegakkan policy is_admin()).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Penanda superuser (bukan role aplikasi)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_super()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false
  )
  -- Kompatibel dengan Neon: role owner database (bukan superuser) juga
  -- dianggap "super" untuk keperluan bypass guard trigger migrasi/seed,
  -- tanpa memberi hak istimewa kepada role aplikasi (explore_app).
  OR pg_has_role(current_user, 'pg_database_owner', 'USAGE');
$$;

CREATE OR REPLACE FUNCTION guard_user_role()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Pendaftar selalu menjadi explorer; role lain hanya via admin.
    IF NOT (is_admin() OR is_super()) THEN
      NEW.role := 'explorer';
      NEW.account_status := 'active';
      NEW.email_verified_at := NULL;
    END IF;
    NEW.email := lower(NEW.email);
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NOT (is_admin() OR is_super()) THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'role_change_forbidden: Role akun hanya dapat diubah oleh admin.';
    END IF;
    IF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
      RAISE EXCEPTION 'account_status_change_forbidden: Status akun hanya dapat diubah oleh admin.';
    END IF;
    IF NEW.email IS DISTINCT FROM OLD.email THEN
      RAISE EXCEPTION 'email_change_forbidden: Perubahan email tidak diizinkan melalui sesi ini.';
    END IF;
  ELSE
    NEW.email := lower(NEW.email);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guard_contribution_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF is_admin() OR is_super() THEN
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

CREATE OR REPLACE FUNCTION guard_application_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF is_admin() OR is_super() THEN
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

CREATE OR REPLACE FUNCTION guard_review_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT (is_admin() OR is_super())
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'review_status_forbidden: Status ulasan hanya dapat diubah oleh admin.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mark_destination_verified()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'published'
     AND OLD.status IS DISTINCT FROM 'published'
     AND (is_admin() OR is_super()) THEN
    NEW.verified_by := current_user_id();
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 2. Profil publik (tanpa email) — untuk kartu reviewer/follower
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public_profiles AS
  SELECT id, full_name, avatar, role, created_at
  FROM users;

GRANT SELECT ON public_profiles TO explore_app;

-- ------------------------------------------------------------
-- 3. Admin dapat menghapus akun (RLS users_delete = is_admin())
-- ------------------------------------------------------------
GRANT DELETE ON users TO explore_app;
