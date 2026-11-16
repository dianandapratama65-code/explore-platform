// ============================================================
// Explore — public/js/app.js
// Logika utama halaman Explore — dipertahankan dari prototipe
// explore-prototype-indonesia.html (pencarian, filter, favorit,
// detail modal, kalkulator budget, peta Leaflet), ditambah:
//   • escaping HTML (anti-XSS)
//   • penjaga aksi khusus login (role Guest dibatasi)
//   • status sesi dari server
// Data destinasi masih lokal; Phase 5 menghubungkannya ke database.
// ============================================================
import { showToast, esc, formatRp, openModal } from './ui.js';
import { api } from './api.js';
import {
  initAuth, requireLogin, openAuth, handleLogin, handleRegister,
  handleForgot, doLogout, resendVerification, toggleUserMenu,
  renderAuth, auth,
} from './auth.js';
import { loadDestinations, toPlace } from './destinations.js';

// ------------------------------------------------------------
// Data tempat (fallback prototipe — diganti database pada Phase 5)
// ------------------------------------------------------------
const fallbackPlaces = [
  { id: 'bromo', name: 'Gunung Bromo', region: 'Jawa Timur', category: 'Alam', price: 'Mulai Rp150 ribu', rating: '4,9', lat: -7.9425, lng: 112.953, cost: 150000, desc: 'Lanskap pegunungan dengan lautan pasir dan panorama matahari terbit yang ikonik. Periksa status aktivitas gunung dan aturan kawasan sebelum berkunjung.', image: 'https://images.unsplash.com/photo-1589307357647-5e4c6b4b5e4f?auto=format&fit=crop&w=900&q=80', type: 'orange' },
  { id: 'rajaampat', name: 'Raja Ampat', region: 'Papua Barat Daya', category: 'Pantai', price: 'Mulai Rp650 ribu', rating: '4,9', lat: -0.2346, lng: 130.5167, cost: 650000, desc: 'Kepulauan dengan perairan jernih dan kekayaan bawah laut. Rencanakan transportasi antarpulau dan biaya perjalanan sejak awal.', image: 'https://images.unsplash.com/photo-1516690561799-46d8f74f9abf?auto=format&fit=crop&w=900&q=80', type: 'blue' },
  { id: 'ubud', name: 'Ubud', region: 'Bali', category: 'Budaya', price: 'Mulai Rp200 ribu', rating: '4,8', lat: -8.5069, lng: 115.2625, cost: 200000, desc: 'Pusat seni, suasana desa, persawahan, dan pengalaman budaya Bali. Hormati aturan tempat suci dan adat setempat.', image: 'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?auto=format&fit=crop&w=900&q=80', type: 'green' },
  { id: 'borobudur', name: 'Candi Borobudur', region: 'Magelang, Jawa Tengah', category: 'Budaya', price: 'Mulai Rp150 ribu', rating: '4,8', lat: -7.6079, lng: 110.2038, cost: 150000, desc: 'Warisan budaya dunia dengan relief dan arsitektur bersejarah. Cek jadwal kunjungan, ketentuan tiket, dan akses terbaru sebelum datang.', image: 'https://images.unsplash.com/photo-1596402184320-417e7178b2cd?auto=format&fit=crop&w=900&q=80', type: 'green' },
  { id: 'pinkbeach', name: 'Pink Beach', region: 'Labuan Bajo, NTT', category: 'Pantai', price: 'Mulai Rp300 ribu', rating: '4,7', lat: -8.6208, lng: 119.5475, cost: 300000, desc: 'Pantai dengan pasir bernuansa merah muda di kawasan Taman Nasional Komodo. Ikuti arahan petugas dan jangan mengambil pasir atau biota laut.', image: 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80', type: 'blue' },
  { id: 'dieng', name: 'Dataran Tinggi Dieng', region: 'Jawa Tengah', category: 'Alam', price: 'Mulai Rp120 ribu', rating: '4,7', lat: -7.209, lng: 109.91, cost: 120000, desc: 'Kawasan dataran tinggi dengan telaga, kawah, dan kompleks candi. Siapkan pakaian hangat dan patuhi peringatan keselamatan di area kawah.', image: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=900&q=80', type: 'orange' },
];

let places = fallbackPlaces;
let activeFilter = 'Semua';
let saved = JSON.parse(localStorage.getItem('exploreSaved') || '[]');

// ------------------------------------------------------------
// Render kartu destinasi
// ------------------------------------------------------------
function renderPlaces() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const filtered = places.filter((p) =>
    (activeFilter === 'Semua' || p.category === activeFilter) &&
    (`${p.name} ${p.region} ${p.category}`).toLowerCase().includes(q));

  document.getElementById('placeGrid').innerHTML = filtered.map((p) => `
    <article class="place-card" onclick="openPlace('${esc(p.id)}')">
      <div class="place-image">
        <img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy">
        <span class="pill">${esc(p.category)}</span>
        <button class="heart ${saved.includes(p.id) ? 'saved' : ''}" aria-label="Simpan favorit"
                onclick="event.stopPropagation();toggleSave('${esc(p.id)}')">${saved.includes(p.id) ? '♥' : '♡'}</button>
      </div>
      <div class="place-info">
        <div class="place-title">
          <div><h3>${esc(p.name)}</h3><p>⌖ ${esc(p.region)}</p></div>
          <span class="rating">★ ${esc(p.rating)}</span>
        </div>
        <div class="place-meta"><span>Estimasi biaya awal</span><b>${esc(p.price)}</b></div>
      </div>
    </article>`).join('');

  document.getElementById('emptyState').style.display = filtered.length ? 'none' : 'block';
}

function setFilter(f, el) {
  activeFilter = f;
  document.querySelectorAll('.filter').forEach((b) => b.classList.remove('active'));
  el.classList.add('active');
  refreshPlaces({ q: document.getElementById('searchInput')?.value || '', category: f });
}

// ------------------------------------------------------------
// Favorit — Guest harus login (kebijakan role)
// ------------------------------------------------------------
// Favorit — Guest harus login; login → sinkron ke database
// ------------------------------------------------------------
function toggleSave(id) {
  if (!requireLogin('menyimpan destinasi favorit')) return;
  const wasSaved = saved.includes(id);

  // optimistic update
  saved = wasSaved ? saved.filter((x) => x !== id) : [...saved, id];
  localStorage.setItem('exploreSaved', JSON.stringify(saved));
  renderPlaces();
  showToast(wasSaved ? 'Dihapus dari favorit' : 'Destinasi disimpan ke favorit');

  // sinkron ke server (fire-and-forget, rollback bila gagal)
  (async () => {
    try {
      if (wasSaved) await api(`/api/favorites/${id}`, { method: 'DELETE' });
      else await api('/api/favorites', { method: 'POST', body: { destination_id: id } });
    } catch (err) {
      // rollback
      saved = wasSaved ? [...saved, id] : saved.filter((x) => x !== id);
      localStorage.setItem('exploreSaved', JSON.stringify(saved));
      renderPlaces();
      showToast(err.message);
    }
  })();
}

function saveFromModal(id) {
  if (!requireLogin('menyimpan destinasi favorit')) return;
  toggleSave(id);
  closeModal();
}

// ------------------------------------------------------------
// Detail destinasi (modal)
// ------------------------------------------------------------
function openPlace(id) {
  const p = places.find((x) => x.id === id);
  if (!p) return;

  document.getElementById('modalContent').innerHTML = `
    <img src="${esc(p.image)}" alt="${esc(p.name)}">
    <div class="modal-body">
      <button class="close" onclick="closeModal()" aria-label="Tutup">×</button>
      <div class="eyebrow">${esc(p.category)} • ${esc(p.region)}</div>
      <h2>${esc(p.name)}</h2>
      <p>${esc(p.desc)}</p>
      <div class="place-meta"><span>Estimasi biaya awal (ilustrasi)</span><b>${formatRp(p.cost)}</b></div>
      <div class="modal-actions">
        <button class="btn btn-dark" onclick="window.open('https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}','_blank')">Lihat di Google Maps ↗</button>
        <button class="btn btn-light" onclick="saveFromModal('${esc(p.id)}')">${saved.includes(p.id) ? '♥ Tersimpan' : '♡ Simpan favorit'}</button>
        <button class="btn btn-outline" onclick="reportPlace('${esc(p.id)}')">Laporkan info</button>
      </div>
      <div class="disclaimer">Harga dan rating pada prototipe ini merupakan data contoh, bukan informasi resmi atau real-time. Verifikasi ke pengelola destinasi sebelum berangkat.</div>
    </div>`;
  document.getElementById('modal').classList.add('show');
}

function closeModal() {
  document.getElementById('modal').classList.remove('show');
}

/** Pelaporan informasi — memerlukan login, dikirim ke admin. */
function reportPlace(id) {
  if (!requireLogin('melaporkan informasi')) return;
  const p = places.find((x) => x.id === id);
  if (!p) return;

  // Destinasi dari database (UUID) bisa dilaporkan; data lokal prototipe tidak.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if (!isUuid) {
    showToast('Data prototipe belum terhubung ke database (fase destinasi berikutnya).');
    return;
  }

  openModal(`
    <div class="modal-body">
      <button class="close" onclick="closeModal()" aria-label="Tutup">×</button>
      <div class="eyebrow">Laporan informasi</div>
      <h2>${esc(p.name)}</h2>
      <p>Beri tahu admin bila informasi di bawah ini sudah tidak akurat.</p>
      <form onsubmit="return submitReport(event, '${esc(id)}')" style="display:flex;flex-direction:column;gap:13px;margin-top:14px">
        <label class="field"><span>Jenis laporan</span>
          <select name="report_type" required>
            <option value="wrong_info">Informasi salah</option>
            <option value="outdated">Kadaluarsa</option>
            <option value="closed">Tempat tutup</option>
            <option value="unsafe">Tidak aman</option>
            <option value="other">Lainnya</option>
          </select></label>
        <label class="field"><span>Deskripsi (min. 10 karakter)</span>
          <textarea name="description" minlength="10" maxlength="2000" required
            style="border:1px solid var(--line);border-radius:12px;padding:11px 13px;font-size:13px;min-height:90px;font-family:inherit"
            placeholder="Jelaskan bagian informasi yang perlu diperbaiki…"></textarea></label>
        <button class="btn btn-dark" type="submit">Kirim laporan</button>
      </form>
    </div>`);
}

async function submitReport(e, destinationId) {
  e.preventDefault();
  const f = e.target;
  try {
    const res = await api('/api/reports', {
      method: 'POST',
      body: {
        destination_id: destinationId,
        report_type: f.report_type.value,
        description: f.description.value,
      },
    });
    closeModal();
    showToast(res.message);
  } catch (err) {
    showToast(err.message);
  }
  return false;
}

// ------------------------------------------------------------
// Kalkulator budget
// ------------------------------------------------------------
function calcBudget() {
  const d = Math.max(1, Number(document.getElementById('days').value) || 1);
  const v = Math.max(0, Number(document.getElementById('daily').value) || 0);
  document.getElementById('dayLabel').textContent = d + ' hari';
  document.getElementById('totalBudget').textContent = formatRp(d * v);
}

function openGoogleMaps() {
  window.open('https://www.google.com/maps/search/?api=1&query=destinasi+wisata+Indonesia', '_blank');
}

// ------------------------------------------------------------
// Peta (Leaflet + OpenStreetMap; Google Maps API opsional)
// ------------------------------------------------------------
let map = null;
let markersGroup = null;

function markerColor(type) {
  return type === 'blue' ? '#5b91b8' : type === 'green' ? '#4f8a69' : '#e98b55';
}

function buildMarkers() {
  if (!map || !window.L) return;
  if (markersGroup) markersGroup.clearLayers();
  else markersGroup = L.featureGroup().addTo(map);

  places.forEach((p) => {
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;border:3px solid white;border-radius:50%;background:${markerColor(p.type)};box-shadow:0 2px 8px #3455"></div>`,
      iconSize: [16, 16], iconAnchor: [8, 8],
    });
    const m = L.marker([p.lat, p.lng], { icon })
      .bindPopup(`<b>${esc(p.name)}</b><br>${esc(p.region)}<br><a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}" target="_blank" rel="noopener">Buka di Google Maps ↗</a>`);
    markersGroup.addLayer(m);
  });

  if (markersGroup.getLayers().length) {
    map.fitBounds(markersGroup.getBounds().pad(0.15));
  }
}

function initMap() {
  if (!window.L) return;
  map = L.map('map', { scrollWheelZoom: false }).setView([-2.5, 118], 4.4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);
  buildMarkers();
}

// ------------------------------------------------------------
// Pemuatan data dari database (dengan fallback ke data lokal)
// ------------------------------------------------------------
async function refreshPlaces({ q = '', category = '' } = {}) {
  try {
    const rows = await loadDestinations({ q, category });
    if (rows.length) {
      places = rows.map(toPlace);
      renderPlaces();
      buildMarkers();
      return;
    }
  } catch {
    // API belum tersedia / gagal → tetap memakai data lokal
  }
  renderPlaces();
}

let searchTimer = null;
function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    refreshPlaces({ q: document.getElementById('searchInput')?.value || '', category: activeFilter });
  }, 300);
}

async function loadFavoritesFromServer() {
  if (!auth.user) return;
  try {
    const { favorites } = await api('/api/favorites');
    saved = (favorites || []).map((f) => f.destination_id);
    localStorage.setItem('exploreSaved', JSON.stringify(saved));
    renderPlaces();
  } catch {
    // tetap memakai localStorage
  }
}

// ------------------------------------------------------------
// Inisialisasi — sumber data utama: database (fallback ke data lokal)
// ------------------------------------------------------------
async function boot() {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.addEventListener('input', onSearchInput);

  renderPlaces();
  calcBudget();
  initMap();

  await initAuth();
  await loadFavoritesFromServer();

  await refreshPlaces({});
}

// ------------------------------------------------------------
// Paparkan fungsi untuk handler inline di index.html
// (prototipe memakai onclick inline — dipertahankan)
// ------------------------------------------------------------
Object.assign(window, {
  renderPlaces, setFilter, toggleSave, saveFromModal, openPlace, closeModal,
  calcBudget, openGoogleMaps, reportPlace, submitReport, buildMarkers,
  showToast, openAuth, handleLogin, handleRegister, handleForgot,
  doLogout, resendVerification, toggleUserMenu, renderAuth,
  get authState() { return auth; },
  get map() { return map; },
  get markersGroup() { return markersGroup; },
});

boot();
