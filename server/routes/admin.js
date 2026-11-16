// ============================================================
// Explore — server/routes/admin.js
// Panel admin: statistik, manajemen pengguna, dan moderasi
// (pengajuan contributor, kontribusi, laporan).
// Seluruh keputusan juga dijaga trigger + RLS di database.
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { withDb } from '../db/pg.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireRole('admin'));   // seluruh rute admin

// Gerbang role untuk pengujian RBAC
router.get('/ping', (req, res) => {
  res.json({ ok: true, role: req.auth.user.role });
});

// ------------------------------------------------------------
// Skema
// ------------------------------------------------------------
const reviewSchema = z.object({
  status: z.enum(['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED']),
  note: z.string().trim().max(2000).optional().or(z.literal('')),
});

const userUpdateSchema = z.object({
  role: z.enum(['admin', 'contributor', 'explorer']).optional(),
  account_status: z.enum(['active', 'suspended']).optional(),
}).refine((b) => b.role || b.account_status, {
  message: 'Tidak ada perubahan yang dikirim',
});

const reportReviewSchema = z.object({
  status: z.enum(['in_review', 'resolved', 'dismissed']),
});

// Transisi status yang sah untuk moderasi
const ALLOWED = {
  PENDING: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'REVISION_REQUIRED'],
  REVISION_REQUIRED: ['APPROVED', 'REJECTED', 'UNDER_REVIEW'],
};

function assertTransition(from, to) {
  if (from === to) return;
  if (!(ALLOWED[from] || []).includes(to)) {
    throw new ApiError(409, 'invalid_transition',
      `Transisi status ${from} → ${to} tidak diizinkan.`);
  }
}

const audit = (userId, action, entity, id, meta = {}) =>
  withDb(null, (c) => c.query(
    `SELECT log_activity($1, $2, $3, $4, $5::jsonb)`,
    [userId, action, entity, id, JSON.stringify(meta)]
  ));

// ============================================================
// STATISTIK
// ============================================================
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = await withDb({ id: req.auth.user.id }, async (c) => {
    const [users, dests, pending, apps, reports, byRole] = await Promise.all([
      c.query(`SELECT count(*)::int AS n FROM users`),
      c.query(`SELECT count(*)::int AS n FROM destinations WHERE status = 'published'`),
      c.query(`SELECT count(*)::int AS n FROM contributions
                WHERE status IN ('PENDING','UNDER_REVIEW','REVISION_REQUIRED')`),
      c.query(`SELECT count(*)::int AS n FROM contributor_applications
                WHERE status IN ('PENDING','UNDER_REVIEW')`),
      c.query(`SELECT count(*)::int AS n FROM reports WHERE status IN ('open','in_review')`),
      c.query(`SELECT role, count(*)::int AS n FROM users GROUP BY role`),
    ]);
    return {
      total_users: users.rows[0].n,
      published_destinations: dests.rows[0].n,
      pending_contributions: pending.rows[0].n,
      pending_applications: apps.rows[0].n,
      open_reports: reports.rows[0].n,
      users_by_role: Object.fromEntries(byRole.rows.map((r) => [r.role, r.n])),
    };
  });
  res.json({ stats });
}));

// ============================================================
// PENGGUNA
// ============================================================
router.get('/users', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const role = req.query.role ? String(req.query.role) : null;

  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT u.id, u.full_name, u.email, u.role, u.account_status,
            u.email_verified_at, u.created_at,
            (a.status IN ('PENDING','UNDER_REVIEW')) AS has_pending_application
       FROM users u
       LEFT JOIN LATERAL (
         SELECT status FROM contributor_applications ca
          WHERE ca.user_id = u.id
          ORDER BY ca.created_at DESC LIMIT 1
       ) a ON true
      WHERE ($1 = '' OR u.full_name ILIKE '%' || $1 || '%'
                   OR u.email ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR u.role = $2::user_role)
      ORDER BY u.created_at DESC
      LIMIT 200`,
    [q, role]
  ));
  res.json({ users: rows });
}));

// Ubah role / status akun. Ditegakkan juga oleh guard trigger
// (role_change_forbidden) — dan tidak boleh mengubah akun sendiri.
router.patch('/users/:id', asyncHandler(async (req, res) => {
  const targetId = String(req.params.id);
  const body = userUpdateSchema.parse(req.body);

  if (targetId === req.auth.user.id) {
    throw new ApiError(400, 'self_change_forbidden',
      'Kamu tidak dapat mengubah role atau status akun sendiri.');
  }

  const { rows } = await withDb({ id: req.auth.user.id }, async (c) => {
    const before = await c.query(
      `SELECT id, role, account_status FROM users WHERE id = $1`, [targetId]);
    if (!before.rows[0]) throw new ApiError(404, 'user_not_found', 'Pengguna tidak ditemukan.');

    const upd = await c.query(
      `UPDATE users
          SET role = COALESCE($2::user_role, role),
              account_status = COALESCE($3::account_status, account_status)
        WHERE id = $1
        RETURNING id, role, account_status`,
      [targetId, body.role || null, body.account_status || null]
    );
    return upd;
  });

  const after = rows[0];
  await audit(req.auth.user.id, 'admin.user_updated', 'user', targetId, {
    role: after.role,
    account_status: after.account_status,
    changed_by: req.auth.user.id,
  });

  res.json({ message: 'Pengguna diperbarui.', user: after });
}));

// ============================================================
// PENGAJUAN CONTRIBUTOR
// ============================================================
router.get('/applications', asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT ca.id, ca.user_id, ca.application_reason, ca.expertise,
            ca.status, ca.admin_note, ca.created_at, ca.reviewed_at,
            u.full_name, u.email, u.email_verified_at
       FROM contributor_applications ca
       JOIN users u ON u.id = ca.user_id
      WHERE ($1::text IS NULL OR ca.status = $1::submission_status)
      ORDER BY ca.created_at ASC
      LIMIT 200`,
    [status]
  ));
  res.json({ applications: rows });
}));

// Keputusan atas pengajuan: APPROVED otomatis menaikkan role user.
router.post('/applications/:id/review', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const { status, note } = reviewSchema.parse(req.body);
  const adminId = req.auth.user.id;

  const result = await withDb({ id: adminId }, async (c) => {
    const cur = await c.query(
      `SELECT id, user_id, status FROM contributor_applications WHERE id = $1`,
      [id]);
    const app = cur.rows[0];
    if (!app) throw new ApiError(404, 'application_not_found', 'Pengajuan tidak ditemukan.');
    assertTransition(app.status, status);

    const upd = await c.query(
      `UPDATE contributor_applications
          SET status = $2::submission_status,
              admin_note = NULLIF($3, ''),
              reviewed_by = $4,
              reviewed_at = now()
        WHERE id = $1
        RETURNING id, status, admin_note, reviewed_at`,
      [id, status, note, adminId]
    );

    // APPROVED → user resmi contributor (guard trigger mengizinkan admin)
    if (status === 'APPROVED') {
      await c.query(
        `UPDATE users SET role = 'contributor' WHERE id = $1 AND role = 'explorer'`,
        [app.user_id]);
    }

    await c.query(
      `SELECT notify_user($1, $2, $3, 'moderation', $4)`,
      [
        app.user_id,
        status === 'APPROVED' ? 'Pengajuan contributor disetujui' :
          status === 'REJECTED' ? 'Pengajuan contributor ditolak' :
            'Pengajuan contributor ditinjau',
        status === 'APPROVED'
          ? 'Selamat! Kamu kini contributor. Kirim kontribusi pertama kamu.'
          : `Status: ${status}.${note ? ' Catatan admin: ' + note : ''}`,
        status === 'APPROVED' ? '/pages/dashboard.html' : null,
      ]
    );
    return upd.rows[0];
  });

  await audit(adminId, 'admin.application_reviewed', 'contributor_application', id,
    { status, note: note || null });

  res.json({
    message: status === 'APPROVED'
      ? 'Pengajuan disetujui — user naik menjadi contributor.'
      : `Pengajuan ditandai ${status}.`,
    application: result,
  });
}));

// ============================================================
// KONTRIBUSI (moderasi konten)
// ============================================================
router.get('/contributions', asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT c.id, c.contributor_id, c.destination_id, c.submission_type,
            c.submission_data, c.status, c.admin_note, c.created_at,
            c.reviewed_at, u.full_name AS contributor_name, u.email
       FROM contributions c
       JOIN users u ON u.id = c.contributor_id
      WHERE ($1::text IS NULL OR c.status = $1::submission_status)
      ORDER BY c.created_at ASC
      LIMIT 200`,
    [status]
  ));
  res.json({ contributions: rows });
}));

// Keputusan atas kontribusi. APPROVED mengeksekusi isi kiriman:
//   new_destination → destinasi baru terbit (published)
//   update_destination → perubahan diterapkan ke destinasi
//   add_media → gambar ditambahkan ke galeri
router.post('/contributions/:id/review', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const { status, note } = reviewSchema.parse(req.body);
  const adminId = req.auth.user.id;

  const outcome = await withDb({ id: adminId }, async (c) => {
    const cur = await c.query(
      `SELECT id, contributor_id, submission_type, submission_data,
              destination_id, status
         FROM contributions WHERE id = $1`,
      [id]);
    const con = cur.rows[0];
    if (!con) throw new ApiError(404, 'contribution_not_found', 'Kontribusi tidak ditemukan.');
    assertTransition(con.status, status);

    let applied = null;
    if (status === 'APPROVED') {
      applied = await applyContribution(c, con, adminId);
    }

    const upd = await c.query(
      `UPDATE contributions
          SET status = $2::submission_status,
              admin_note = NULLIF($3, ''),
              reviewed_by = $4,
              reviewed_at = now()
        WHERE id = $1
        RETURNING id, status, admin_note, reviewed_at`,
      [id, status, note, adminId]
    );

    await c.query(
      `SELECT notify_user($1, $2, $3, 'moderation', $4)`,
      [
        con.contributor_id,
        status === 'APPROVED' ? 'Kontribusi disetujui' :
          status === 'REJECTED' ? 'Kontribusi ditolak' :
            status === 'REVISION_REQUIRED' ? 'Kontribusi perlu revisi' :
              'Kontribusi ditinjau',
        status === 'APPROVED'
          ? `Kontribusi kamu "${con.submission_type}" sudah tayang. Terima kasih!`
          : `Status: ${status}.${note ? ' Catatan admin: ' + note : ''}`,
        status === 'APPROVED' ? '/pages/dashboard.html' : null,
      ]
    );

    return { contribution: upd.rows[0], applied };
  });

  await audit(adminId, 'admin.contribution_reviewed', 'contribution', id,
    { status, note: note || null, applied: outcome.applied });

  res.json({
    message: status === 'APPROVED'
      ? 'Kontribusi disetujui dan diterapkan.'
      : `Kontribusi ditandai ${status}.`,
    ...outcome,
  });
}));

/**
 * Eksekusi konten yang disetujui. Dipanggil dalam konteks admin.
 * Konten hanya menjadi publik di titik ini (sebelumnya tidak terlihat
 * oleh guest berkat RLS destinations_select).
 */
async function applyContribution(c, con, adminId) {
  const data = con.submission_data || {};

  if (con.submission_type === 'new_destination') {
    const slugBase = String(data.name || 'destinasi')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 150);

    // slug unik
    let slug = slugBase;
    for (let i = 2; ; i++) {
      const dup = await c.query(`SELECT 1 FROM destinations WHERE slug = $1`, [slug]);
      if (!dup.rows[0]) break;
      slug = `${slugBase}-${i}`;
    }

    // kategori: pakai yang ada, bila belum ada buat baru (admin)
    let cat = await c.query(
      `SELECT id FROM categories WHERE lower(name) = lower($1) LIMIT 1`,
      [String(data.category || '')]);
    if (!cat.rows[0]) {
      cat = await c.query(
        `INSERT INTO categories (name, description)
         VALUES ($1, 'Kategori turunan kontribusi') RETURNING id`,
        [String(data.category || 'Lainnya').slice(0, 60)]);
    }

    const ins = await c.query(
      `INSERT INTO destinations
         (name, slug, description, category_id, city, address,
          latitude, longitude, estimated_cost, status, created_by)
       VALUES ($1, $2, $3, $4, NULLIF($5,''), NULLIF($6,''),
               $7, $8, $9, 'published', $10)
       RETURNING id, slug, status`,
      [
        String(data.name).slice(0, 150), slug, String(data.description),
        cat.rows[0].id, String(data.city || ''), String(data.address || ''),
        data.latitude ?? null, data.longitude ?? null,
        Number(data.estimated_cost || 0), con.contributor_id,
      ]
    );
    const destId = ins.rows[0].id;

    if (data.image_url) {
      await c.query(
        `INSERT INTO destination_images (destination_id, image_url, uploaded_by)
         VALUES ($1, $2, $3)`,
        [destId, data.image_url, con.contributor_id]);
    }

    await c.query(
      `SELECT log_activity($1, 'destination.published', 'destination', $2, $3::jsonb)`,
      [adminId, destId, JSON.stringify({ via: 'contribution', contribution: con.id })]);
    return { destination_id: destId, action: 'destination_created' };
  }

  if (con.submission_type === 'update_destination') {
    const destId = con.destination_id || data.destination_id;
    const f = data.fields || {};

    // Hanya kolom yang diwhitelist — mencegah injeksi nama kolom
    const COLS = {
      name: 'name', description: 'description', city: 'city',
      address: 'address', latitude: 'latitude', longitude: 'longitude',
      estimated_cost: 'estimated_cost',
    };
    const sets = [];
    const vals = [];
    let i = 1;
    for (const [key, col] of Object.entries(COLS)) {
      if (f[key] !== undefined && f[key] !== null && f[key] !== '') {
        sets.push(`${col} = $${i + 1}`);
        vals.push(f[key]);
        i++;
      }
    }
    if (!sets.length) {
      throw new ApiError(400, 'empty_update', 'Tidak ada perubahan untuk diterapkan.');
    }

    const upd = await c.query(
      `UPDATE destinations SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $1 RETURNING id`,
      [destId, ...vals]
    );
    if (!upd.rows[0]) throw new ApiError(404, 'destination_not_found', 'Destinasi tidak ditemukan.');
    return { destination_id: destId, action: 'destination_updated' };
  }

  if (con.submission_type === 'add_media') {
    const destId = con.destination_id || data.destination_id;
    const dest = await c.query(`SELECT 1 FROM destinations WHERE id = $1`, [destId]);
    if (!dest.rows[0]) throw new ApiError(404, 'destination_not_found', 'Destinasi tidak ditemukan.');
    await c.query(
      `INSERT INTO destination_images (destination_id, image_url, caption, uploaded_by)
       VALUES ($1, $2, NULLIF($3,''), $4)`,
      [destId, data.image_url, String(data.caption || ''), con.contributor_id]);
    return { destination_id: destId, action: 'media_added' };
  }

  throw new ApiError(400, 'unknown_type', 'Jenis kontribusi tidak dikenal.');
}

// ============================================================
// LAPORAN
// ============================================================
router.get('/reports', asyncHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const { rows } = await withDb({ id: req.auth.user.id }, (c) => c.query(
    `SELECT r.id, r.destination_id, r.report_type, r.description,
            r.status, r.created_at, d.name AS destination_name,
            u.full_name AS reporter_name
       FROM reports r
       JOIN destinations d ON d.id = r.destination_id
       JOIN users u ON u.id = r.reporter_id
      WHERE ($1::text IS NULL OR r.status = $1::report_status)
      ORDER BY r.created_at ASC
      LIMIT 200`,
    [status]
  ));
  res.json({ reports: rows });
}));

router.post('/reports/:id/review', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const { status } = reportReviewSchema.parse(req.body);
  const adminId = req.auth.user.id;

  const { rows } = await withDb({ id: adminId }, async (c) => {
    const cur = await c.query(`SELECT id, status FROM reports WHERE id = $1`, [id]);
    if (!cur.rows[0]) throw new ApiError(404, 'report_not_found', 'Laporan tidak ditemukan.');
    if (cur.rows[0].status === status) return { rows: [cur.rows[0]] };
    return c.query(
      `UPDATE reports
          SET status = $2::report_status, handled_by = $3, updated_at = now()
        WHERE id = $1
        RETURNING id, status`,
      [id, status, adminId]);
  });

  await audit(adminId, 'admin.report_handled', 'report', id, { status });
  res.json({ message: 'Laporan diperbarui.', report: rows[0] });
}));

export default router;
