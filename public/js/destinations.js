// ============================================================
// Explore — public/js/destinations.js
// Jembatan data: mengambil destinasi dari API (database) dan
// memetakannya ke bentuk tempat milik prototipe.
// Kontrak API (diimplementasikan Phase 5):
//   GET /api/destinations?q=&category=&limit=
//   → { destinations: [{ id, name, city, country, category_name,
//        description, estimated_cost, rating_avg, rating_count,
//        latitude, longitude, image_url, slug }] }
// Bila API belum tersedia, pemanggil menggunakan data lokal.
// ============================================================
import { api } from './api.js';
import { formatRp } from './ui.js';

const CATEGORY_TYPE = {
  Pantai: 'blue',
  Budaya: 'green',
  Alam: 'orange',
};

export function toPlace(d) {
  const rating = Number(d.rating_avg || 0);
  return {
    id: d.id,
    slug: d.slug,
    name: d.name,
    region: d.city || d.country || 'Indonesia',
    category: d.category_name || 'Alam',
    price: d.estimated_cost ? `Mulai ${formatRp(d.estimated_cost)}` : 'Informasi terkurasi',
    rating: rating ? rating.toFixed(1).replace('.', ',') : 'Baru',
    lat: Number(d.latitude || -2.5),
    lng: Number(d.longitude || 118),
    cost: Number(d.estimated_cost || 0),
    desc: d.description || '',
    image: d.image_url || 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?auto=format&fit=crop&w=900&q=80',
    type: CATEGORY_TYPE[d.category_name] || 'orange',
    status: d.status,
  };
}

export async function loadDestinations({ q = '', category = '' } = {}) {
  const params = new URLSearchParams({ limit: '24' });
  if (q) params.set('q', q);
  if (category && category !== 'Semua') params.set('category', category);

  const data = await api(`/api/destinations?${params}`);
  return data.destinations || [];
}
