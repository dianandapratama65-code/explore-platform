// ============================================================
// Explore — public/js/api.js
// Klien REST API: cookie sesi httpOnly dikirim otomatis
// (credentials: 'include'), error dinormalkan.
// ============================================================

export class ApiError extends Error {
  constructor(message, code, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server. Jalankan npm run dev.', 'network_error', 0);
  }

  let data = null;
  try { data = await res.json(); } catch { /* respons kosong */ }

  if (!res.ok) {
    const e = data?.error || {};
    throw new ApiError(
      e.message || 'Terjadi kesalahan.',
      e.code || 'error',
      res.status,
      e.details
    );
  }
  return data;
}
