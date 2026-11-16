// ============================================================
// Explore — server/routes/contributor.js
// Kontribusi contributor: pengajuan role, kiriman kontribusi,
// dan penarikan koreksi. Status moderasi dijaga trigger database.
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { withDb } from '../db/pg.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import {
  requireAuth, requireRole, requireVerified,
} from '../middleware/auth.js';

const router = Router();

// ------------------------------------------------------------
// Skema
// ------------------------------------------------------------
const applySchema = z.object({
  reason: z.string().trim().min(20, 'Ceritakan alasan minimal 20 karakter').max(2000),
  expertise: z.array(z.string().trim().min(2).max(60)).max(10).default([]),
});

const newDestinationSchema = z.object({
  name: z.string().trim().min(3, 'Nama minimal 3 karakter').max(150),
  description: z.string().trim().min(20, 'Deskripsi minimal 20 karakter').max(4000),
  category: z.string().trim().min(2).max(60),
  city: z.string().trim().max(100).optional().or(z.literal('')),
  address: z.string().trim().max(255).optional().or(z.literal('')),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  estimated_cost: z.coerce.number().int().min(0).max(100_000_000).default(0),
  image_url: z.string().trim().url('URL gambar tidak valid').max(500).optional().or(z.literal('')),
});

const updateDestinationSchema = z.object({
  destination_id: z.string().uuid('Destinasi tidak valid'),
  fields: z.object({
    name: z.string().trim().min(3).max(150).optional(),
    description: z.string().trim().min(20).max(4000).optional(),
    city: z.string().trim().max(100).optional(),
    address: z.string().trim().max(255).optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    estimated_cost: z.coerce.number().int().min(0).max(100_000_000).optional(),
  }).refine((f) => Object.keys(f).some((k) => f[k] !== undefined), {
    message: 'Tidak ada perubahan yang dikirim',
  }),
});

const addMediaSchema = z.object({
  destination_id: z.string().uuid('Destinasi tidak valid'),
  image_url: z.string().trim().url('URL gambar tidak valid').max(500),
  caption: z.string().trim().max(200).optional().or(z.literal('')),
});

const contributionSchema = z.discriminatedUnion('submission_type', [
  z.object({ submission_type: z.literal('new_destination'), data: newDestinationSchema }),
  z.object({ submission_type: z.literal('update_destination'), data: updateDestinationSchema }),
  z.object({ submission_type: z.literal('add_media'), data: addMediaSchema }),
]);

// ------------------------------------------------------------
// GET /api/contributor/application — pengajuan diri saya
// ------------------------------------------------------------
router.get('/application', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT id, application_reason, expertise, status, admin_note,
            reviewed_at, created_at
       FROM contributor_applications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [req.auth.user.id]
  ));
  res.json({ application: rows[0] || null });
}));

// ------------------------------------------------------------
// POST /api/contributor/apply — ajukan diri jadi contributor
// Wajib login + email terverifikasi (kebijakan Phase 3).
// ------------------------------------------------------------
router.post('/apply', requireAuth, requireVerified,
  asyncHandler(async (req, res) => {
    const { reason, expertise } = applySchema.parse(req.body);
    const userId = req.auth.user.id;

    // Cegah pengajuan ganda (unique index parsial juga menjaga, tapi
    // beri pesan yang jelas sebelum kena constraint).
    const existing = await withDb({ id: userId }, (c) => c.query(
      `SELECT status FROM contributor_applications
        WHERE user_id = $1 AND status IN ('PENDING','UNDER_REVIEW')
        LIMIT 1`,
      [userId]
    ));
    if (existing.rows[0]) {
      throw new ApiError(409, 'application_pending',
        'Pengajuan kamu masih menunggu tinjauan admin.');
    }

    const { rows } = await withDb({ id: userId }, (c) => c.query(
      `SELECT apply_for_contributor($1, $2::text[]) AS id`,
      [reason, expertise]
    ));

    res.status(201).json({
      message: 'Pengajuan terkirim. Admin akan meninjau.',
      application_id: rows[0].id,
    });
  }));

// ------------------------------------------------------------
// GET /api/contributor/contributions — kiriman saya
// ------------------------------------------------------------
router.get('/contributions', requireRole('contributor'),
  asyncHandler(async (req, res) => {
    const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
      `SELECT id, submission_type, submission_data, status, admin_note,
              destination_id, created_at, updated_at
         FROM contributions
        WHERE contributor_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [req.auth.user.id]
    ));
    res.json({ contributions: rows });
  }));

// ------------------------------------------------------------
// POST /api/contributor/contributions — kirim kontribusi baru
// Wajib contributor terverifikasi; selalu PENDING (ditegakkan RLS).
// ------------------------------------------------------------
router.post('/contributions', requireRole('contributor'), requireVerified,
  asyncHandler(async (req, res) => {
    const parsed = contributionSchema.parse(req.body);
    const userId = req.auth.user.id;

    const { rows } = await withDb({ id: userId }, (c) => c.query(
      `INSERT INTO contributions
         (contributor_id, destination_id, submission_type, submission_data)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING id, status, created_at`,
      [
        userId,
        parsed.data.destination_id || null,
        parsed.submission_type,
        JSON.stringify(parsed.data),
      ]
    ));

    res.status(201).json({
      message: 'Kontribusi terkirim dan menunggu tinjauan admin.',
      contribution: rows[0],
    });
  }));

// ------------------------------------------------------------
// PUT /api/contributor/contributions/:id — ubah koreksi
// Hanya selama PENDING/REVISION_REQUIRED; edit mengembalikan
// status ke PENDING (diizinkan guard trigger untuk pemilik).
// ------------------------------------------------------------
router.put('/contributions/:id', requireRole('contributor'), requireVerified,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const parsed = contributionSchema.parse(req.body);
    const userId = req.auth.user.id;

    const { rowCount } = await withDb({ id: userId }, (c) => c.query(
      `UPDATE contributions
          SET submission_type = $3,
              submission_data = $4::jsonb,
              destination_id  = $5,
              status          = 'PENDING',
              updated_at      = now()
        WHERE id = $1
          AND contributor_id = $2
          AND status IN ('PENDING','REVISION_REQUIRED')`,
      [id, userId, parsed.submission_type, JSON.stringify(parsed.data),
       parsed.data.destination_id || null]
    ));

    if (rowCount === 0) {
      throw new ApiError(409, 'contribution_locked',
        'Kontribusi sudah ditinjau dan tidak dapat diubah. Kirim kiriman baru.');
    }

    res.json({ message: 'Kontribusi diperbarui dan dikirim ulang ke antrean.' });
  }));

// ------------------------------------------------------------
// DELETE /api/contributor/contributions/:id — tarik kiriman
// ------------------------------------------------------------
router.delete('/contributions/:id', requireRole('contributor'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const userId = req.auth.user.id;

    const { rowCount } = await withDb({ id: userId }, (c) => c.query(
      `DELETE FROM contributions
        WHERE id = $1 AND contributor_id = $2
          AND status IN ('PENDING','REVISION_REQUIRED')`,
      [id, userId]
    ));

    if (rowCount === 0) {
      throw new ApiError(409, 'contribution_locked',
        'Kiriman sudah ditinjau dan tidak dapat ditarik.');
    }
    res.json({ message: 'Kiriman ditarik.' });
  }));

export default router;
