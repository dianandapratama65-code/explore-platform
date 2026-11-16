-- ============================================================
-- Explore — 002_functions.sql
-- Fungsi bantu RLS, fungsi autentikasi, notifikasi, dan audit.
-- Semua fungsi SECURITY DEFINER dimiliki superuser sehingga
-- dapat menembus RLS untuk operasi sistem yang sah.
-- ============================================================

-- ------------------------------------------------------------
-- Fungsi bantu konteks (dipakai kebijakan RLS)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = current_user_id()
      AND u.role = 'admin'
      AND u.account_status = 'active'
  );
$$;

-- ------------------------------------------------------------
-- Fungsi sistem: kredensial login (hanya role aplikasi)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_get_credentials(p_email text)
RETURNS TABLE (
  id               uuid,
  password_hash    text,
  role             user_role,
  account_status   account_status,
  email_verified_at timestamptz,
  full_name        text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.password_hash, u.role, u.account_status,
         u.email_verified_at, u.full_name
  FROM users u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1;
$$;

-- ------------------------------------------------------------
-- Fungsi sistem: buat token verifikasi / reset password
-- Mengembalikan token mentah; yang disimpan hanya hash SHA-256.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_create_token(
  p_user_id uuid,
  p_purpose varchar,
  p_ttl_seconds int DEFAULT 3600
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_token text;
BEGIN
  -- satu token aktif per tujuan
  UPDATE auth_tokens
     SET used_at = now()
   WHERE user_id = p_user_id AND purpose = p_purpose AND used_at IS NULL;

  v_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO auth_tokens (user_id, token_hash, purpose, expires_at)
  VALUES (p_user_id,
          encode(digest(v_token, 'sha256'), 'hex'),
          p_purpose,
          now() + make_interval(secs => p_ttl_seconds));

  RETURN v_token;
END;
$$;

-- ------------------------------------------------------------
-- Fungsi sistem: tukarkan token (sekali pakai)
-- Mengembalikan user_id bila valid, NULL bila tidak.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_consume_token(
  p_token text,
  p_purpose varchar
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user uuid;
BEGIN
  UPDATE auth_tokens
     SET used_at = now()
   WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex')
     AND purpose = p_purpose
     AND used_at IS NULL
     AND expires_at > now()
  RETURNING user_id INTO v_user;

  RETURN v_user;
END;
$$;

-- ------------------------------------------------------------
-- Fungsi sistem: kirim notifikasi ke pengguna
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_user(
  p_user_id uuid,
  p_title varchar,
  p_message text,
  p_type varchar DEFAULT 'system',
  p_link varchar DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO notifications (user_id, title, message, notification_type, link)
  VALUES (p_user_id, p_title, p_message, p_type, p_link)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------
-- Fungsi sistem: catat aktivitas (audit log)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_activity(
  p_user_id uuid,
  p_action varchar,
  p_entity_type varchar DEFAULT NULL,
  p_entity_id varchar DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO activity_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (p_user_id, p_action, p_entity_type, p_entity_id, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------
-- Fungsi sistem: ajukan diri menjadi contributor
-- Hanya dapat dipanggil saat sesi login (current_user_id terisi).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_for_contributor(
  p_reason text,
  p_expertise text[] DEFAULT '{}'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_uid uuid := current_user_id();
  v_app uuid;
  v_name users.full_name%TYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication_required: Harus login untuk mengajukan diri menjadi contributor.';
  END IF;

  INSERT INTO contributor_applications (user_id, application_reason, expertise)
  VALUES (v_uid, p_reason, p_expertise)
  RETURNING id INTO v_app;

  SELECT full_name INTO v_name FROM users WHERE id = v_uid;

  -- beri tahu seluruh admin
  PERFORM notify_user(
    a.id,
    'Pengajuan contributor baru',
    v_name || ' mengajukan diri sebagai contributor.',
    'moderation',
    '/admin/applications'
  ) FROM users a WHERE a.role = 'admin' AND a.account_status = 'active';

  PERFORM log_activity(v_uid, 'contributor.application.created',
                       'contributor_application', v_app::text);

  RETURN v_app;
END;
$$;

-- ------------------------------------------------------------
-- Integritas email: unique case-insensitive
-- ------------------------------------------------------------
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));
