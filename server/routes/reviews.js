// ============================================================
// Explore — server/routes/reviews.js
// Ulasan & rating explorer terhadap destinasi.
// Rating agregat dihitung otomatis oleh trigger maintain_destination_rating.
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { withDb } from '../db/pg.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const createSchema = z.object({
  destination_id: z.string().uuid('Destinasi tidak valid'),
  rating: z.coerce.number().int().min(1, 'Rating 1–5').max(5, 'Rating 1–5'),
  review_text: z.string().trim().max(2000).optional().or(z.literal('')),
});

const updateSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  review_text: z.string().trim().max(2000).optional().or(z.literal('')),
}).refine((b) => b.rating !== undefined || b.review_text !== undefined, {
  message: 'Tidak ada perubahan',
});

// Ulasan saya (semua destinasi)
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT r.id, r.destination_id, r.rating, r.review_text, r.status, r.created_at,
            d.name AS destination_name
       FROM reviews r JOIN destinations d ON d.id = r.destination_id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC`,
    [req.auth.user.id]
  ));
  res.json({ reviews: rows });
}));

// Kirim ulasan (login wajib; status approved, agregat otomatis)
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const userId = req.auth.user.id;

  const { rows } = await withDb({ id: userId }, (c) => c.query(
    `INSERT INTO reviews (user_id, destination_id, rating, review_text, status)
     VALUES ($1, $2, $3, NULLIF($4, ''), 'approved')
     RETURNING id, destination_id, rating, review_text, status, created_at`,
    [userId, body.destination_id, body.rating, body.review_text || '']
  ));

  // rating agregat diperbarui oleh trigger maintain_destination_rating
  res.status(201).json({
    message: 'Ulasan terkirim. Terima kasih!',
    review: rows[0],
  });
}));

// Ubah ulasan sendiri
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const body = updateSchema.parse(req.body);
  const userId = req.auth.user.id;

  const { rowCount, rows } = await withDb({ id: userId }, (c) => c.query(
    `UPDATE reviews
        SET rating = COALESCE($3, rating),
            review_text = COALESCE(NULLIF($4, ''), review_text)
      WHERE id = $1 AND user_id = $2
      RETURNING id, rating, review_text, updated_at`,
    [id, userId, body.rating ?? null, body.review_text ?? '']
  ));
  if (rowCount === 0) {
    throw new ApiError(404, 'review_not_found', 'Ulasan tidak ditemukan atau bukan milikmu.');
  }
  res.json({ message: 'Ulasan diperbarui.', review: rows[0] });
}));

// Hapus ulasan (pemilik atau admin)
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const { rowCount } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `DELETE FROM reviews WHERE id = $1 AND (user_id = $2 OR is_admin())`,
    [id, req.auth.user.id]
  ));
  if (rowCount === 0) {
    throw new ApiError(404, 'review_not_found', 'Ulasan tidak ditemukan.');
  }
  res.json({ message: 'Ulasan dihapus.' });
}));

export default router;
