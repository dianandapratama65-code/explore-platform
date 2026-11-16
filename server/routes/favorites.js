// ============================================================
// Explore — server/routes/favorites.js
// Favorit destinasi per pengguna (login wajib).
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { withDb } from '../db/pg.js';
import { asyncHandler } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Daftar favorit saya (dengan detail destinasi)
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT f.id, f.created_at, d.id AS destination_id, d.name, d.slug,
            d.city, d.country, d.estimated_cost, d.rating_avg,
            (SELECT image_url FROM destination_images
              WHERE destination_id = d.id ORDER BY created_at LIMIT 1) AS image_url
       FROM favorites f
       JOIN destinations d ON d.id = f.destination_id
      WHERE f.user_id = $1
      ORDER BY f.created_at DESC`,
    [req.auth.user.id]
  ));
  res.json({ favorites: rows });
}));

const addSchema = z.object({
  destination_id: z.string().uuid('Destinasi tidak valid'),
});

router.post('/', asyncHandler(async (req, res) => {
  const { destination_id } = addSchema.parse(req.body);
  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `INSERT INTO favorites (user_id, destination_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, destination_id) DO NOTHING
     RETURNING id, destination_id, created_at`,
    [req.auth.user.id, destination_id]
  ));
  if (!rows[0]) {
    res.json({ message: 'Sudah tersimpan di favorit.', favorite: null });
  } else {
    res.status(201).json({ message: 'Destinasi disimpan ke favorit.', favorite: rows[0] });
  }
}));

router.delete('/:destinationId', asyncHandler(async (req, res) => {
  const destId = String(req.params.destinationId);
  const { rowCount } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `DELETE FROM favorites WHERE user_id = $1 AND destination_id = $2`,
    [req.auth.user.id, destId]
  ));
  if (rowCount === 0) {
    res.status(404).json({ error: { code: 'not_found', message: 'Favorit tidak ditemukan.' } });
  } else {
    res.json({ message: 'Dihapus dari favorit.' });
  }
}));

export default router;
