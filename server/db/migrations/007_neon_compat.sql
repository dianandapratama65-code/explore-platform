-- ============================================================
-- Explore — 007_neon_compat.sql
-- Kompatibilitas dengan managed PostgreSQL (Neon, dsb.):
--   - Role owner database (bukan superuser) tetap bisa menjalankan
--     migrasi/seed tanpa dihambat guard trigger.
--   - Role aplikasi (explore_app) TIDAK mendapat hak ini (RLS tetap).
-- Idempoten: CREATE OR REPLACE.
-- ============================================================

CREATE OR REPLACE FUNCTION is_super()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false
  )
  OR pg_has_role(current_user, 'pg_database_owner', 'USAGE');
$$;
