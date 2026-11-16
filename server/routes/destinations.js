// ============================================================
// Explore — server/routes/destinations.js
// Discovery destinasi: daftar, detail, dan ulasan.
// RLS memastikan guest hanya melihat destinasi published.
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { withDb } from '../db/pg.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

const REVIEW_COLUMNS = `r.id, r.rating, r.review_text AS content, r.created_at,
  u.full_name AS author_name, u.avatar`;

// ------------------------------------------------------------
// GET /api/destinations — daftar destinasi (search + filter)
// ------------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const { q, category, limit, offset } = listQuerySchema.parse(req.query);
  const user = req.auth || null;

  const { rows } = await withDb(user?.user?.id ? { id: user.user.id } : null, (c) => c.query(
    `SELECT d.id, d.name, d.slug, d.description, d.city, d.country,
            d.latitude, d.longitude, d.estimated_cost, d.status,
            d.rating_avg, d.rating_count, d.created_at,
            c.name AS category_name, c.icon AS category_icon,
            (SELECT image_url FROM destination_images
              WHERE destination_id = d.id ORDER BY created_at LIMIT 1) AS image_url
       FROM destinations d
       LEFT JOIN categories c ON c.id = d.category_id
      WHERE ($1 = '' OR d.name ILIKE '%' || $1 || '%'
                      OR d.city ILIKE '%' || $1 || '%'
                      OR d.description ILIKE '%' || $1 || '%')
        AND ($2 = '' OR c.name = $2)
      ORDER BY d.rating_avg DESC, d.created_at DESC
      LIMIT $3 OFFSET $4`,
    [q || '', category || '', limit, offset]
  ));

  res.json({ destinations: rows, count: rows.length });
}));

// ------------------------------------------------------------
// GET /api/destinations/:id — detail (id atau slug)
// ------------------------------------------------------------
router.get('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const user = req.auth || null;

  const { rows } = await withDb(user?.user?.id ? { id: user.user.id } : null, (c) => c.query(
    `SELECT d.id, d.name, d.slug, d.description, d.city, d.country,
            d.address, d.latitude, d.longitude, d.estimated_cost, d.status,
            d.rating_avg, d.rating_count, d.created_at,
            c.name AS category_name, c.icon AS category_icon,
            (SELECT json_agg(json_build_object('id', di.id, 'url', di.image_url, 'caption', di.caption))
               FROM destination_images di WHERE di.destination_id = d.id) AS images
       FROM destinations d
       LEFT JOIN categories c ON c.id = d.category_id
      WHERE ${isUuid ? 'd.id = $1' : 'd.slug = $1'}`,
    [id]
  ));

  if (!rows[0]) throw new ApiError(404, 'destination_not_found', 'Destinasi tidak ditemukan.');
  res.json({ destination: rows[0] });
}));

// ------------------------------------------------------------
// GET /api/destinations/:id/reviews — ulasan yang tayang
// ------------------------------------------------------------
router.get('/:id/reviews', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const user = req.auth || null;

  const dest = await withDb(user?.user?.id ? { id: user.user.id } : null, (c) => c.query(
    `SELECT id FROM destinations WHERE ${isUuid ? 'id' : 'slug'} = $1`, [id]));
  if (!dest.rows[0]) throw new ApiError(404, 'destination_not_found', 'Destinasi tidak ditemukan.');

  const destId = dest.rows[0].id;
  const { rows } = await withDb(user?.user?.id ? { id: user.user.id } : null, (c) => c.query(
    `SELECT ${REVIEW_COLUMNS}
       FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.destination_id = $1 AND r.status = 'approved'
      ORDER BY r.created_at DESC
      LIMIT 50`,
    [destId]
  ));
  res.json({ reviews: rows });
}));

export default router;
