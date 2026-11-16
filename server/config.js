// ============================================================
// Explore — server/config.js
// Konfigurasi terpusat dari environment (.env).
// ============================================================
import 'dotenv/config';
import { fileURLToPath } from 'node:url';

// Fail-fast (production): secret wajib dikonfigurasi, bukan default dev.
if ((process.env.NODE_ENV || 'development') === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-secret-ganti-di-produksi') {
    throw new Error('JWT_SECRET wajib diisi di production (bukan default dev).');
  }
}

const port = Number(process.env.PORT || 3000);

export const config = {
  env: process.env.NODE_ENV || 'development',
  isTest: process.env.NODE_ENV === 'test',
  port,
  appUrl: process.env.APP_URL || `http://localhost:${port}`,
  publicDir: fileURLToPath(new URL('../public/', import.meta.url)),

  auth: {
    secret: process.env.JWT_SECRET || 'dev-secret-ganti-di-produksi',
    sessionDays: Number(process.env.SESSION_DAYS || 7),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    cookieName: 'explore_session',
    bcryptRounds: 10,
    verifyTtlSeconds: 24 * 3600,
    resetTtlSeconds: 3600,
  },

  mail: {
    from: process.env.MAIL_FROM || 'Explore <no-reply@explore.local>',
    smtpUrl: process.env.SMTP_URL || '',   // kosong = mode dev (var/mail/*.eml)
  },

  rate: {
    auth: Number(process.env.RATE_LIMIT_AUTH || 10),
    api: Number(process.env.RATE_LIMIT_API || 120),
  },

  integrations: {
    // Kosongkan bila belum punya key — peta tetap memakai OpenStreetMap.
    googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || '',
  },
};
