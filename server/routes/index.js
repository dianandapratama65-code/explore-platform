// ============================================================
// Explore — server/routes/index.js
// Pemasangan seluruh rute API.
// ============================================================
import { Router } from 'express';
import authRoutes from './auth.js';
import adminRoutes from './admin.js';
import contributorRoutes from './contributor.js';
import reportRoutes from './reports.js';
import destinationRoutes from './destinations.js';
import favoriteRoutes from './favorites.js';
import reviewRoutes from './reviews.js';
import itineraryRoutes from './itineraries.js';
import { config } from '../config.js';
import { withDb } from '../db/pg.js';
import { asyncHandler } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/admin', adminRoutes);
router.use('/contributor', contributorRoutes);
router.use('/reports', reportRoutes);
router.use('/destinations', destinationRoutes);
router.use('/favorites', favoriteRoutes);
router.use('/reviews', reviewRoutes);
router.use('/itineraries', itineraryRoutes);

// Notifikasi milik sendiri (dashboard explorer & lainnya)
router.get('/notifications', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT id, title, message, notification_type, link, is_read, created_at
       FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [req.auth.user.id]
  ));
  res.json({ notifications: rows });
}));

router.post('/notifications/read', requireAuth, asyncHandler(async (req, res) => {
  await withDb({ id: req.auth.user.id }, (c) => c.query(
    `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
    [req.auth.user.id]
  ));
  res.json({ message: 'Semua notifikasi ditandai dibaca.' });
}));

/** Konfigurasi publik untuk frontend. */
router.get('/config', (req, res) => {
  res.json({
    google_maps: {
      enabled: Boolean(config.integrations.googleMapsKey),
      api_key: config.integrations.googleMapsKey || null,
    },
    default_language: 'id',
  });
});

/** Uji kesehatan server + database. */
router.get('/health', asyncHandler(async (req, res) => {
  const { rows } = await withDb(null, (c) =>
    c.query(`SELECT now() AS server_time, current_database() AS db`));
  res.json({ ok: true, ...rows[0] });
}));

export default router;
