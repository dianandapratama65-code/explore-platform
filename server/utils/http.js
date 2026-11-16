// ============================================================
// Explore — server/utils/http.js
// Utilitas HTTP: error terstruktur, wrapper async, penangan error.
// ============================================================

export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Bungkus handler async agar error diteruskan ke errorHandler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** 404 untuk rute API yang tidak dikenal. */
export const notFound = (req, res, next) =>
  next(new ApiError(404, 'not_found', `Rute tidak ditemukan: ${req.method} ${req.path}`));

/** Penangan error global — format respons konsisten. */
export function errorHandler(err, req, res, _next) {
  // Payload terlalu besar
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      error: { code: 'payload_too_large', message: 'Ukuran data melebihi batas.' },
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  // Pelanggaran unique constraint (email duplikat, dll.)
  if (err?.code === '23505') {
    const col = err.constraint || '';
    if (col.includes('email')) {
      return res.status(409).json({
        error: { code: 'email_taken', message: 'Email sudah terdaftar.' },
      });
    }
    return res.status(409).json({
      error: { code: 'conflict', message: 'Data sudah ada.', details: err.constraint },
    });
  }

  // Pelanggaran kebijakan di trigger database (RAISE EXCEPTION 'kode: pesan')
  if (err?.code === 'P0001') {
    const m = /^([a-z_]+):\s*(.*)$/i.exec(String(err.message));
    const ruleCode = m ? m[1] : 'rule_violation';
    const message = m ? m[2] : String(err.message);
    const status = ruleCode === 'authentication_required' ? 401
      : ruleCode.endsWith('_forbidden') ? 403
      : 400;
    return res.status(status).json({ error: { code: ruleCode, message } });
  }

  // Pelanggaran RLS / privilege — jangan bocorkan detail internal
  if (err?.code === '42501' || /row-level security|permission denied/i.test(String(err.message || ''))) {
    console.error('[db-access]', err.message);
    return res.status(403).json({
      error: { code: 'access_denied', message: 'Anda tidak memiliki akses untuk operasi ini.' },
    });
  }

  // Validasi Zod
  if (err?.name === 'ZodError') {
    return res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'Data tidak valid.',
        details: err.issues?.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  console.error('[error]', err);
  res.status(500).json({
    error: { code: 'internal_error', message: 'Terjadi kesalahan pada server.' },
  });
}
