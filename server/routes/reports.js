// ============================================================
// Explore — server/routes/reports.js
// Laporan informasi dari explorer (login wajib).
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { withDb } from '../db/pg.js';
import { asyncHandler } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const reportSchema = z.object({
  destination_id: z.string().uuid('Destinasi tidak valid'),
  report_type: z.enum(['wrong_info', 'closed', 'unsafe', 'outdated', 'other']),
  description: z.string().trim().min(10, 'Jelaskan laporan minimal 10 karakter').max(2000),
});

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const body = reportSchema.parse(req.body);
  const userId = req.auth.user.id;

  const { rows } = await withDb({ id: userId }, (c) => c.query(
    `INSERT INTO reports (reporter_id, destination_id, report_type, description)
     VALUES ($1, $2, $3, $4)
     RETURNING id, status, created_at`,
    [userId, body.destination_id, body.report_type, body.description]
  ));

  res.status(201).json({
    message: 'Laporan terkirim. Terima kasih sudah membantu menjaga akurasi data.',
    report: rows[0],
  });
}));

export default router;
