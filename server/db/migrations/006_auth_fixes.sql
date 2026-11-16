-- ============================================================
-- Explore — 006_auth_fixes.sql
-- auth_get_credentials: sertakan kolom email (dipakai route
-- register/login untuk respons & pengiriman email).
-- Catatan: perubahan RETURN TABLE memerlukan DROP + CREATE ulang,
-- sehingga grant dieksekusi ulang di sini.
-- ============================================================

DROP FUNCTION IF EXISTS auth_get_credentials(text);

CREATE FUNCTION auth_get_credentials(p_email text)
RETURNS TABLE (
  id                uuid,
  password_hash     text,
  email             text,
  role              user_role,
  account_status    account_status,
  email_verified_at timestamptz,
  full_name         text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.password_hash, lower(u.email) AS email, u.role,
         u.account_status, u.email_verified_at, u.full_name
  FROM users u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION auth_get_credentials(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_get_credentials(text) TO explore_app;
