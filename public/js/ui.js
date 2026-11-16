// ============================================================
// Explore — public/js/ui.js
// Komponen UI bersama: toast, modal, escaping (anti-XSS).
// Dipertahankan dari prototipe, ditambah eskalasi keamanan.
// ============================================================

/** Escape teks sebelum disisipkan ke innerHTML (mencegah XSS). */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

export function openModal(html) {
  document.getElementById('modalContent').innerHTML = html;
  document.getElementById('modal').classList.add('show');
}

export function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

/** Format rupiah. */
export function formatRp(n) {
  return 'Rp' + Number(n || 0).toLocaleString('id-ID');
}

/** Nama depan untuk sapaan. */
export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'Explorer';
}
