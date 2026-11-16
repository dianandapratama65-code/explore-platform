// ============================================================
// Explore — server/middleware/rateLimit.js
// Pembatas laju untuk endpoint sensitif (anti brute-force).
// ============================================================
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

const mult = config.isTest ? 50 : 1;   // uji otomatis tidak boleh terblokir

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Terlalu banyak permintaan. Coba lagi beberapa saat lagi.',
    },
  },
};

/** Login / forgot / reset / verify — ketat. */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: config.rate.auth * mult,
});

/** Seluruh endpoint API. */
export const apiLimiter = rateLimit({
  ...base,
  windowMs: 60_000,
  limit: config.rate.api * mult,
});
