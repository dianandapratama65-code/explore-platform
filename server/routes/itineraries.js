// ============================================================
// Explore — server/routes/itineraries.js
// Rencana perjalanan (itinerary) per pengguna.
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { withDb } from '../db/pg.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  title: z.string().trim().min(2, 'Judul minimal 2 karakter').max(150),
  start_date: z.string().trim().optional().or(z.literal('')),
  end_date: z.string().trim().optional().or(z.literal('')),
  estimated_budget: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
});

const updateSchema = z.object({
  title: z.string().trim().min(2).max(150).optional(),
  start_date: z.string().trim().optional().or(z.literal('')),
  end_date: z.string().trim().optional().or(z.literal('')),
  estimated_budget: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
});

const itemSchema = z.object({
  destination_id: z.string().uuid('Destinasi tidak valid'),
  visit_date: z.string().trim().optional().or(z.literal('')),
  visit_order: z.coerce.number().int().min(1),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

// Daftar itinerary milik sendiri
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT i.id, i.title, i.start_date, i.end_date, i.estimated_budget,
            i.created_at, i.updated_at,
            (SELECT count(*)::int FROM itinerary_items WHERE itinerary_id = i.id) AS item_count
       FROM itineraries i
      WHERE i.user_id = $1
      ORDER BY i.created_at DESC`,
    [req.auth.user.id]
  ));
  res.json({ itineraries: rows });
}));

// Detail + items
router.get('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const it = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT id, title, start_date, end_date, estimated_budget, created_at, updated_at
       FROM itineraries WHERE id = $1 AND user_id = $2`,
    [id, req.auth.user.id]
  ));
  if (!it.rows[0]) throw new ApiError(404, 'not_found', 'Itinerary tidak ditemukan.');

  const items = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT ii.id, ii.destination_id, ii.visit_date, ii.visit_order, ii.notes,
            d.name AS destination_name, d.city
       FROM itinerary_items ii
       JOIN destinations d ON d.id = ii.destination_id
      WHERE ii.itinerary_id = $1
      ORDER BY ii.visit_order`,
    [id]
  ));
  res.json({ itinerary: it.rows[0], items: items.rows });
}));

// Buat itinerary baru
router.post('/', asyncHandler(async (req, res) => {
  const body = createSchema.parse(req.body);
  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `INSERT INTO itineraries (user_id, title, start_date, end_date, estimated_budget)
     VALUES ($1, $2, NULLIF($3,'')::date, NULLIF($4,'')::date, $5)
     RETURNING id, title, start_date, end_date, estimated_budget, created_at`,
    [req.auth.user.id, body.title, body.start_date || '', body.end_date || '', body.estimated_budget]
  ));
  res.status(201).json({ message: 'Itinerary dibuat.', itinerary: rows[0] });
}));

// Ubah itinerary
router.put('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const body = updateSchema.parse(req.body);
  const { rowCount, rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `UPDATE itineraries
        SET title = COALESCE($3, title),
            start_date = CASE WHEN $4::text IS NULL THEN start_date
                             WHEN $4 = '' THEN NULL ELSE $4::date END,
            end_date = CASE WHEN $5::text IS NULL THEN end_date
                           WHEN $5 = '' THEN NULL ELSE $5::date END,
            estimated_budget = COALESCE($6, estimated_budget),
            updated_at = now()
      WHERE id = $1 AND user_id = $2
      RETURNING id, title, start_date, end_date, estimated_budget, updated_at`,
    [id, req.auth.user.id, body.title ?? null, body.start_date ?? null,
     body.end_date ?? null, body.estimated_budget ?? null]
  ));
  if (rowCount === 0) throw new ApiError(404, 'not_found', 'Itinerary tidak ditemukan.');
  res.json({ message: 'Itinerary diperbarui.', itinerary: rows[0] });
}));

// Hapus itinerary
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const { rowCount } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `DELETE FROM itineraries WHERE id = $1 AND user_id = $2`,
    [id, req.auth.user.id]
  ));
  if (rowCount === 0) throw new ApiError(404, 'not_found', 'Itinerary tidak ditemukan.');
  res.json({ message: 'Itinerary dihapus.' });
}));

// Tambah item destinasi ke itinerary
router.post('/:id/items', asyncHandler(async (req, res) => {
  const itineraryId = String(req.params.id);
  const body = itemSchema.parse(req.body);

  // pastikan itinerary milik user
  const own = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT 1 FROM itineraries WHERE id = $1 AND user_id = $2`,
    [itineraryId, req.auth.user.id]
  ));
  if (!own.rows[0]) throw new ApiError(404, 'not_found', 'Itinerary tidak ditemukan.');

  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `INSERT INTO itinerary_items (itinerary_id, destination_id, visit_date, visit_order, notes)
     VALUES ($1, $2, NULLIF($3,'')::date, $4, NULLIF($5,''))
     RETURNING id, destination_id, visit_date, visit_order, notes`,
    [itineraryId, body.destination_id, body.visit_date || '', body.visit_order, body.notes || '']
  ));
  res.status(201).json({ message: 'Item ditambahkan.', item: rows[0] });
}));

// Ubah item
router.put('/:id/items/:itemId', asyncHandler(async (req, res) => {
  const itineraryId = String(req.params.id);
  const itemId = String(req.params.itemId);
  const body = itemSchema.partial().parse(req.body);

  const own = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT 1 FROM itineraries WHERE id = $1 AND user_id = $2`,
    [itineraryId, req.auth.user.id]
  ));
  if (!own.rows[0]) throw new ApiError(404, 'not_found', 'Itinerary tidak ditemukan.');

  const { rowCount, rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `UPDATE itinerary_items
        SET destination_id = COALESCE($3, destination_id),
            visit_date = CASE WHEN $4::text IS NULL THEN visit_date
                             WHEN $4 = '' THEN NULL ELSE $4::date END,
            visit_order = COALESCE($5, visit_order),
            notes = COALESCE(NULLIF($6,''), notes)
      WHERE id = $1 AND itinerary_id = $2
      RETURNING id, destination_id, visit_date, visit_order, notes`,
    [itemId, itineraryId, body.destination_id ?? null, body.visit_date ?? null,
     body.visit_order ?? null, body.notes ?? '']
  ));
  if (rowCount === 0) throw new ApiError(404, 'not_found', 'Item tidak ditemukan.');
  res.json({ message: 'Item diperbarui.', item: rows[0] });
}));

// Hapus item
router.delete('/:id/items/:itemId', asyncHandler(async (req, res) => {
  const itineraryId = String(req.params.id);
  const itemId = String(req.params.itemId);

  const own = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT 1 FROM itineraries WHERE id = $1 AND user_id = $2`,
    [itineraryId, req.auth.user.id]
  ));
  if (!own.rows[0]) throw new ApiError(404, 'not_found', 'Itinerary tidak ditemukan.');

  const { rowCount } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `DELETE FROM itinerary_items WHERE id = $1 AND itinerary_id = $2`,
    [itemId, itineraryId]
  ));
  if (rowCount === 0) throw new ApiError(404, 'not_found', 'Item tidak ditemukan.');
  res.json({ message: 'Item dihapus.' });
}));

export default router;
