// ============================================================
// Explore — server/middleware/auth.js
// Konteks autentikasi per permintaan + gerbang role (RBAC).
// Setiap request diverifikasi ulang ke database (bukan hanya JWT),
// sehingga pencabutan sesi & perubahan role langsung berlaku.
// ============================================================
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { withDb } from '../db/pg.js';
import { ApiError } from '../utils/http.js';

/**
 * Lampirkan req.auth = { user, session } bila cookie valid.
 * Tidak memblokir request — hanya mengisi konteks.
 */
export async function attachAuth(req, res, next) {
  try {
    req.auth = null;
    const token = req.cookies?.[config.auth.cookieName];
    if (!token) return next();

    let payload;
    try {
      payload = jwt.verify(token, config.auth.secret);
    } catch {
      clearAuthCookie(res);   // cookie basi → hapus
      return next();
    }

    const ctx = await withDb({ id: payload.sub }, async (c) => {
      const s = await c.query(
        `SELECT id, user_id, expires_at, revoked_at
           FROM sessions
          WHERE id = $1 AND user_id = $2`,
        [payload.sid, payload.sub]
      );
      const session = s.rows[0];
      if (!session) return null;
      if (session.revoked_at) return null;
      if (new Date(session.expires_at) < new Date()) return null;

      const u = await c.query(
        `SELECT id, full_name, email, role, avatar, account_status, email_verified_at
           FROM users WHERE id = $1`,
        [payload.sub]
      );
      if (!u.rows[0]) return null;
      return { user: u.rows[0], session };
    });

    req.auth = ctx;
    if (!ctx) clearAuthCookie(res);
    next();
  } catch (err) {
    next(err);
  }
}

/** Wajib login. */
export function requireAuth(req, res, next) {
  if (!req.auth) {
    return next(new ApiError(401, 'authentication_required',
      'Silakan login untuk menggunakan fitur ini.'));
  }
  if (req.auth.user.account_status !== 'active') {
    return next(new ApiError(403, 'account_suspended',
      'Akun Anda dinonaktifkan. Hubungi administrator.'));
  }
  next();
}

/** Wajib memiliki salah satu role. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.auth) {
      return next(new ApiError(401, 'authentication_required',
        'Silakan login untuk menggunakan fitur ini.'));
    }
    if (!roles.includes(req.auth.user.role)) {
      return next(new ApiError(403, 'role_forbidden',
        'Anda tidak memiliki hak akses untuk fitur ini.'));
    }
    next();
  };
}

/**
 * Wajib email terverifikasi — dipakai untuk pengajuan kontribusi
 * (kebijakan: login dulu, verifikasi untuk kontribusi).
 */
export function requireVerified(req, res, next) {
  if (!req.auth?.user?.email_verified_at) {
    return next(new ApiError(403, 'email_not_verified',
      'Verifikasi email terlebih dahulu sebelum mengirim kontribusi.'));
  }
  next();
}

/** Set cookie sesi (httpOnly). */
export function setAuthCookie(res, token) {
  res.cookie(config.auth.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.cookieSecure,
    path: '/',
    maxAge: config.auth.sessionDays * 24 * 3600 * 1000,
  });
}

/** Hapus cookie sesi. */
export function clearAuthCookie(res) {
  res.clearCookie(config.auth.cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.cookieSecure,
    path: '/',
  });
}
