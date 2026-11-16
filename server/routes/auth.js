// ============================================================
// Explore — server/routes/auth.js
// Register, Login, Logout, Forgot/Reset password, Verifikasi email,
// Manajemen sesi, dan info sesi berjalan.
// ============================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { withDb } from '../db/pg.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import {
  requireAuth, setAuthCookie, clearAuthCookie,
} from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { sendMail, accountLink, sent } from '../utils/mailer.js';

const router = Router();

// ------------------------------------------------------------
// Skema validasi (validasi ganda: client & server)
// ------------------------------------------------------------
const registerSchema = z.object({
  full_name: z.string().trim().min(2, 'Nama minimal 2 karakter').max(120),
  email: z.string().trim().toLowerCase().email('Email tidak valid').max(255),
  password: z.string()
    .min(8, 'Password minimal 8 karakter')
    .max(72, 'Password maksimal 72 karakter')
    .regex(/[A-Za-z]/, 'Password harus mengandung huruf')
    .regex(/[0-9]/, 'Password harus mengandung angka'),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email tidak valid'),
  password: z.string().min(1, 'Password wajib diisi'),
});

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email tidak valid'),
});

const resetSchema = z.object({
  token: z.string().min(10, 'Token tidak valid'),
  password: z.string()
    .min(8).max(72)
    .regex(/[A-Za-z]/, 'Password harus mengandung huruf')
    .regex(/[0-9]/, 'Password harus mengandung angka'),
});

const tokenSchema = z.object({ token: z.string().min(10, 'Token tidak valid') });

// ------------------------------------------------------------
// Bantuan
// ------------------------------------------------------------
const publicUser = (u) => ({
  id: u.id,
  full_name: u.full_name,
  email: u.email,
  role: u.role,
  avatar: u.avatar,
  account_status: u.account_status,
  email_verified_at: u.email_verified_at,
});

async function findCredentials(email) {
  const { rows } = await withDb(null, (c) =>
    c.query(`SELECT * FROM auth_get_credentials($1)`, [email]));
  return rows[0] || null;
}

function issueSessionCookie(user, session) {
  return jwt.sign(
    { sub: user.id, sid: session.id },
    config.auth.secret,
    { expiresIn: `${config.auth.sessionDays}d` }
  );
}

/** Catat audit (fungsi SECURITY DEFINER — aman dipanggil dari konteks mana pun). */
const audit = (userId, action, entityType = null, entityId = null, meta = {}) =>
  withDb(null, (c) => c.query(
    `SELECT log_activity($1, $2, $3, $4, $5::jsonb)`,
    [userId, action, entityType, entityId, JSON.stringify(meta)]
  ));

// ============================================================
// POST /api/auth/register
// ============================================================
router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const { full_name, email, password } = registerSchema.parse(req.body);

  const hash = await bcrypt.hash(password, config.auth.bcryptRounds);

  // Catatan: tanpa RETURNING — kebijakan SELECT PostgreSQL berlaku pada
  // RETURNING, sesi anon tidak boleh membaca baris yang baru dibuat.
  await withDb(null, (c) => c.query(
    `INSERT INTO users (full_name, email, password_hash, provider)
     VALUES ($1, $2, $3, 'local')`,
    [full_name, email, hash]
  ));

  const creds = await findCredentials(email);

  // Token verifikasi email (di-hash di database)
  const token = (await withDb(null, (c) => c.query(
    `SELECT auth_create_token($1, 'verify_email', $2) AS t`,
    [creds.id, config.auth.verifyTtlSeconds]
  ))).rows[0].t;

  await sendMail({
    to: email,
    subject: 'Verifikasi email kamu — Explore',
    text:
      `Halo ${full_name},\n\n` +
      `Terima kasih sudah mendaftar di Explore.\n` +
      `Verifikasi email kamu dengan membuka tautan berikut:\n` +
      `${accountLink('verify-email', token)}\n\n` +
      `Tautan berlaku 24 jam. Bila kamu tidak mendaftar, abaikan email ini.\n\n— Explore`,
  });

  res.status(201).json({
    message: 'Pendaftaran berhasil. Silakan login.',
    needs_verification: true,
    user: {
      id: creds.id,
      full_name: creds.full_name,
      email: creds.email,
      role: creds.role,
      avatar: null,
      account_status: creds.account_status,
      email_verified_at: creds.email_verified_at,
    },
  });
}));

// ============================================================
// POST /api/auth/login
// ============================================================
router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  const creds = await findCredentials(email);
  const ok = creds?.password_hash
    ? await bcrypt.compare(password, creds.password_hash)
    : await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidin');

  if (!creds || !ok) {
    await audit(null, 'auth.login_failed', 'user', null, { email });
    throw new ApiError(401, 'invalid_credentials', 'Email atau password salah.');
  }

  if (creds.account_status !== 'active') {
    await audit(creds.id, 'auth.login_blocked', 'user', creds.id,
      { reason: creds.account_status });
    throw new ApiError(403, 'account_suspended',
      'Akun dinonaktifkan. Hubungi administrator.');
  }

  const ua = String(req.get('user-agent') || '').slice(0, 290);
  const ip = req.ip || null;

  // Konteks user diset SETELAH kata sandi terverifikasi (RLS: baris sendiri)
  const session = await withDb({ id: creds.id }, async (c) => {
    const s = await c.query(
      `INSERT INTO sessions (user_id, user_agent, ip, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(days => $4))
       RETURNING id, expires_at`,
      [creds.id, ua, ip, config.auth.sessionDays]
    );
    await c.query(
      `SELECT log_activity($1, 'auth.login', 'user', $2::text, '{}'::jsonb)`,
      [creds.id, creds.id]
    );
    return s.rows[0];
  });

  setAuthCookie(res, issueSessionCookie(creds, session));

  res.json({
    message: 'Login berhasil.',
    user: publicUser({
      id: creds.id, full_name: creds.full_name, email: creds.email,
      role: creds.role, avatar: null, account_status: creds.account_status,
      email_verified_at: creds.email_verified_at,
    }),
  });
}));

// ============================================================
// POST /api/auth/logout
// ============================================================
router.post('/logout', asyncHandler(async (req, res) => {
  if (req.auth) {
    const { user, session } = req.auth;
    await withDb({ id: user.id }, (c) => c.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
      [session.id, user.id]
    ));
    await audit(user.id, 'auth.logout', 'user', user.id);
  }
  clearAuthCookie(res);
  res.json({ message: 'Berhasil keluar.' });
}));

// ============================================================
// GET /api/auth/me
// ============================================================
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { user } = req.auth;
  const profile = (await withDb({ id: user.id }, (c) => c.query(
    `SELECT bio, country, preferred_language, travel_preferences
       FROM user_profiles WHERE user_id = $1`,
    [user.id]
  ))).rows[0] || null;

  res.json({ user: publicUser(user), profile });
}));

// ============================================================
// POST /api/auth/forgot-password
// ============================================================
router.post('/forgot-password', authLimiter, asyncHandler(async (req, res) => {
  const { email } = emailSchema.parse(req.body);

  const creds = await findCredentials(email);
  if (creds) {
    const token = (await withDb(null, (c) => c.query(
      `SELECT auth_create_token($1, 'reset_password', $2) AS t`,
      [creds.id, config.auth.resetTtlSeconds]
    ))).rows[0].t;

    await sendMail({
      to: creds.email,
      subject: 'Reset password — Explore',
      text:
        `Halo ${creds.full_name},\n\n` +
        `Buka tautan berikut untuk mengganti password (berlaku 1 jam):\n` +
        `${accountLink('reset-password', token)}\n\n` +
        `Bila kamu tidak meminta ini, abaikan email ini.\n\n— Explore`,
    });
  }

  // Respons identik untuk email terdaftar/tidak (cegah enumerasi)
  res.json({
    message: 'Jika email terdaftar, tautan reset password akan dikirim.',
  });
}));

// ============================================================
// POST /api/auth/reset-password
// ============================================================
router.post('/reset-password', authLimiter, asyncHandler(async (req, res) => {
  const { token, password } = resetSchema.parse(req.body);

  const userId = (await withDb(null, (c) => c.query(
    `SELECT auth_consume_token($1, 'reset_password') AS uid`,
    [token]
  ))).rows[0].uid;

  if (!userId) {
    throw new ApiError(400, 'invalid_token',
      'Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.');
  }

  const hash = await bcrypt.hash(password, config.auth.bcryptRounds);

  await withDb({ id: userId }, async (c) => {
    await c.query(`UPDATE users SET password_hash = $1 WHERE id = $2`,
      [hash, userId]);
    // cabut seluruh sesi lama
    await c.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    await c.query(
      `SELECT log_activity($1, 'auth.password_reset', 'user', $2::text, '{}'::jsonb)`,
      [userId, userId]);
  });

  clearAuthCookie(res);
  res.json({ message: 'Password berhasil diubah. Silakan login.' });
}));

// ============================================================
// POST /api/auth/verify-email
// ============================================================
router.post('/verify-email', authLimiter, asyncHandler(async (req, res) => {
  const { token } = tokenSchema.parse(req.body);

  const userId = (await withDb(null, (c) => c.query(
    `SELECT auth_consume_token($1, 'verify_email') AS uid`,
    [token]
  ))).rows[0].uid;

  if (!userId) {
    throw new ApiError(400, 'invalid_token',
      'Tautan verifikasi tidak valid atau sudah kedaluwarsa.');
  }

  await withDb({ id: userId }, async (c) => {
    await c.query(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now())
        WHERE id = $1`, [userId]);
    await c.query(
      `SELECT log_activity($1, 'auth.email_verified', 'user', $2::text, '{}'::jsonb)`,
      [userId, userId]);
  });

  res.json({ message: 'Email berhasil diverifikasi. Silakan login.' });
}));

// ============================================================
// POST /api/auth/resend-verification
// ============================================================
router.post('/resend-verification', authLimiter, requireAuth,
  asyncHandler(async (req, res) => {
    const { user } = req.auth;
    if (user.email_verified_at) {
      throw new ApiError(400, 'already_verified', 'Email sudah terverifikasi.');
    }

    const token = (await withDb(null, (c) => c.query(
      `SELECT auth_create_token($1, 'verify_email', $2) AS t`,
      [user.id, config.auth.verifyTtlSeconds]
    ))).rows[0].t;

    await sendMail({
      to: user.email,
      subject: 'Verifikasi email kamu — Explore',
      text:
        `Halo ${user.full_name},\n\nBuka tautan berikut untuk memverifikasi email:\n` +
        `${accountLink('verify-email', token)}\n\nTautan berlaku 24 jam.\n\n— Explore`,
    });

    res.json({ message: 'Email verifikasi dikirim ulang.' });
  }));

// ============================================================
// GET /api/auth/sessions — daftar sesi milik sendiri
// ============================================================
router.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
  const { user, session } = req.auth;
  const { rows } = await withDb({ id: user.id }, (c) => c.query(
    `SELECT id, user_agent, host(inet(ip)) AS ip, created_at, expires_at, revoked_at
       FROM sessions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [user.id]
  ));
  res.json({
    sessions: rows.map((r) => ({
      ...r,
      current: r.id === session.id,
    })),
  });
}));

// ============================================================
// DELETE /api/auth/sessions/:id — cabut sesi (perangkat lain)
// ============================================================
router.delete('/sessions/:id', requireAuth, asyncHandler(async (req, res) => {
  const { user, session } = req.auth;
  const target = String(req.params.id);

  const { rowCount } = await withDb({ id: user.id }, (c) => c.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [target, user.id]
  ));
  if (rowCount === 0) {
    throw new ApiError(404, 'session_not_found', 'Sesi tidak ditemukan.');
  }

  if (target === session.id) clearAuthCookie(res);
  res.json({ message: 'Sesi dicabut.' });
}));

export default router;
export { sent as mailSent };
