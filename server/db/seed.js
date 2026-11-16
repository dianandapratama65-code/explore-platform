// ============================================================
// Explore — server/db/seed.js
// Data awal: kategori, akun demo (4 role), destinasi dari
// prototipe asli, ulasan, serta contoh antrean moderasi admin.
// Idempoten — aman dijalankan berulang.
// ============================================================
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { startDatabase, stopDatabase, getSuperPool } from './pg.js';
import { migrate } from './migrate.js';

const CATEGORIES = [
  { name: 'Alam',   icon: '⛰', description: 'Pegunungan, air terjun, dan taman nasional' },
  { name: 'Budaya', icon: '🏛', description: 'Candi, desa adat, dan warisan budaya' },
  { name: 'Pantai', icon: '🌊', description: 'Pantai, pulau, dan kehidupan bawah laut' },
];

const PASSWORDS = {
  admin: 'Admin123!',
  contributor: 'Contributor123!',
  explorer: 'Explorer123!',
  reviewer: 'Reviewer123!',
  applicant: 'Applicant123!',
};

const USERS = [
  { full_name: 'Admin Explore',   email: 'admin@explore.test',     password: PASSWORDS.admin,       role: 'admin' },
  { full_name: 'Budi Contributor', email: 'contributor@explore.test', password: PASSWORDS.contributor, role: 'contributor' },
  { full_name: 'Citra Explorer',  email: 'explorer@explore.test',  password: PASSWORDS.explorer,    role: 'explorer' },
  { full_name: 'Rina Reviewer',   email: 'reviewer1@explore.test', password: PASSWORDS.reviewer,    role: 'explorer' },
  { full_name: 'Dewi Reviewer',   email: 'reviewer2@explore.test', password: PASSWORDS.reviewer,    role: 'explorer' },
  { full_name: 'Applicant Baru',  email: 'applicant@explore.test', password: PASSWORDS.applicant,   role: 'explorer' },
];

// Data destinasi dipertahankan dari prototipe
// explore-prototype-indonesia.html (nilai lat/lng & biaya sudah dikoreksi).
const DESTINATIONS = [
  {
    name: 'Gunung Bromo', slug: 'gunung-bromo', category: 'Alam',
    city: 'Jawa Timur', address: 'Tumpang, Malang, Jawa Timur',
    lat: -7.9425, lng: 112.9530, cost: 150000,
    desc: 'Lanskap pegunungan dengan lautan pasir dan panorama matahari terbit yang ikonik. Periksa status aktivitas gunung dan aturan kawasan sebelum berkunjung.',
    image: 'https://images.unsplash.com/photo-1589307357647-5e4c6b4b5e4f?auto=format&fit=crop&w=900&q=80',
    reviews: [
      { user: 'reviewer1@explore.test', rating: 5, text: 'Sunrise dari Penanjakan luar biasa. Datang jam 4 pagi agar dapat spot terbaik.' },
      { user: 'reviewer2@explore.test', rating: 4, text: 'Pemandangan keren, tapi cukup ramai di akhir pekan.' },
    ],
  },
  {
    name: 'Raja Ampat', slug: 'raja-ampat', category: 'Pantai',
    city: 'Papua Barat Daya', address: 'Waigeo, Raja Ampat, Papua Barat Daya',
    lat: -0.2346, lng: 130.5167, cost: 650000,
    desc: 'Kepulauan dengan perairan jernih dan kekayaan bawah laut. Rencanakan transportasi antarpulau dan biaya perjalanan sejak awal.',
    image: 'https://images.unsplash.com/photo-1516690561799-46d8f74f9abf?auto=format&fit=crop&w=900&q=80',
    reviews: [
      { user: 'reviewer1@explore.test', rating: 5, text: 'Spot snorkeling terbaik yang pernah saya kunjungi.' },
      { user: 'reviewer2@explore.test', rating: 5, text: 'Air sebening kaca, terumbu karangnya sehat.' },
    ],
  },
  {
    name: 'Ubud', slug: 'ubud', category: 'Budaya',
    city: 'Bali', address: 'Gianyar, Bali',
    lat: -8.5069, lng: 115.2625, cost: 200000,
    desc: 'Pusat seni, suasana desa, persawahan, dan pengalaman budaya Bali. Hormati aturan tempat suci dan adat setempat.',
    image: 'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?auto=format&fit=crop&w=900&q=80',
    reviews: [
      { user: 'reviewer1@explore.test', rating: 5, text: 'Sawah Tegallalang pagi hari sangat tenang.' },
      { user: 'reviewer2@explore.test', rating: 4, text: 'Banyak pilihan kelas yoga dan kafe sehat.' },
    ],
  },
  {
    name: 'Candi Borobudur', slug: 'candi-borobudur', category: 'Budaya',
    city: 'Magelang, Jawa Tengah', address: 'Jl. Badrawati, Magelang, Jawa Tengah',
    lat: -7.6079, lng: 110.2038, cost: 150000,
    desc: 'Warisan budaya dunia dengan relief dan arsitektur bersejarah. Cek jadwal kunjungan, ketentuan tiket, dan akses terbaru sebelum datang.',
    image: 'https://images.unsplash.com/photo-1596402184320-417e7178b2cd?auto=format&fit=crop&w=900&q=80',
    reviews: [
      { user: 'reviewer1@explore.test', rating: 5, text: 'Reliefnya detail sekali, naik sebelum panas terik.' },
      { user: 'reviewer2@explore.test', rating: 4, text: 'Tiket harus dipesan jauh hari saat musim liburan.' },
    ],
  },
  {
    name: 'Pink Beach', slug: 'pink-beach', category: 'Pantai',
    city: 'Labuan Bajo, NTT', address: 'Taman Nasional Komodo, Nusa Tenggara Timur',
    lat: -8.6208, lng: 119.5475, cost: 300000,
    desc: 'Pantai dengan pasir bernuansa merah muda di kawasan Taman Nasional Komodo. Ikuti arahan petugas dan jangan mengambil pasir atau biota laut.',
    image: 'https://images.unsplash.com/photo-1500375592092-40eb2168fd21?auto=format&fit=crop&w=900&q=80',
    reviews: [
      { user: 'reviewer1@explore.test', rating: 4, text: 'Pasir merah muda unik, perjalanan kapal cukup jauh.' },
      { user: 'reviewer2@explore.test', rating: 5, text: 'Air jernih dan tidak terlalu ramai saat weekday.' },
    ],
  },
  {
    name: 'Dataran Tinggi Dieng', slug: 'dataran-tinggi-dieng', category: 'Alam',
    city: 'Jawa Tengah', address: 'Wonosobo, Jawa Tengah',
    lat: -7.209, lng: 109.91, cost: 120000,
    desc: 'Kawasan dataran tinggi dengan telaga, kawah, dan kompleks candi. Siapkan pakaian hangat dan patuhi peringatan keselamatan di area kawah.',
    image: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=900&q=80',
    reviews: [
      { user: 'reviewer1@explore.test', rating: 5, text: 'Kawah Sikidang pagi hari berpadu kabut.' },
      { user: 'reviewer2@explore.test', rating: 4, text: 'Sangat dingin, bawa jaket tebal.' },
    ],
  },
];

async function one(pool, text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0];
}

export async function seed() {
  await migrate();
  const pool = getSuperPool();

  // --- Kategori ---
  for (const c of CATEGORIES) {
    await pool.query(
      `INSERT INTO categories (name, description, icon)
       VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
      [c.name, c.description, c.icon]
    );
  }
  console.log(`  ✓ ${CATEGORIES.length} kategori`);

  // --- Pengguna ---
  // Catatan: trigger penjaga role dimatikan sementara agar bootstrap
  // dapat membuat akun admin pertama (hanya owner yang boleh).
  await pool.query('ALTER TABLE users DISABLE TRIGGER users_guard_role');
  try {
    for (const u of USERS) {
      const hash = bcrypt.hashSync(u.password, 10);
      await pool.query(
        `INSERT INTO users (full_name, email, password_hash, role, email_verified_at)
         VALUES ($1, lower($2), $3, $4::user_role, now())
         ON CONFLICT (email) DO NOTHING`,
        [u.full_name, u.email, hash, u.role]
      );
    }
  } finally {
    await pool.query('ALTER TABLE users ENABLE TRIGGER users_guard_role');
  }
  console.log(`  ✓ ${USERS.length} pengguna demo`);

  const userId = async (email) =>
    (await one(pool, 'SELECT id FROM users WHERE email = $1', [email])).id;
  const categoryId = async (name) =>
    (await one(pool, 'SELECT id FROM categories WHERE name = $1', [name])).id;

  const adminId = await userId('admin@explore.test');
  const contributorId = await userId('contributor@explore.test');
  const explorerId = await userId('explorer@explore.test');
  const applicantId = await userId('applicant@explore.test');

  // --- Destinasi + gambar + ulasan ---
  for (const d of DESTINATIONS) {
    const catId = await categoryId(d.category);
    const existing = await one(
      pool, 'SELECT id FROM destinations WHERE slug = $1', [d.slug]
    );
    let destId = existing?.id;

    if (!destId) {
      const row = await one(
        pool,
        `INSERT INTO destinations
           (name, slug, description, category_id, country, city, address,
            latitude, longitude, estimated_cost, status, created_by, verified_by)
         VALUES ($1, $2, $3, $4, 'Indonesia', $5, $6, $7, $8, $9,
                 'published', $10, $10)
         RETURNING id`,
        [d.name, d.slug, d.desc, catId, d.city, d.address, d.lat, d.lng,
         d.cost, adminId]
      );
      destId = row.id;

      await pool.query(
        `INSERT INTO destination_images (destination_id, image_url, caption, uploaded_by)
         VALUES ($1, $2, $3, $4)`,
        [destId, d.image, d.name, adminId]
      );
    }

    for (const r of d.reviews) {
      await pool.query(
        `INSERT INTO reviews (user_id, destination_id, rating, review_text, status)
         VALUES ($1, $2, $3, $4, 'approved')
         ON CONFLICT (user_id, destination_id) DO NOTHING`,
        [await userId(r.user), destId, r.rating, r.text]
      );
    }
  }
  console.log(`  ✓ ${DESTINATIONS.length} destinasi + gambar + ulasan`);

  // --- Pengajuan contributor (contoh antrean moderasi) ---
  const appExists = await one(
    pool,
    `SELECT id FROM contributor_applications WHERE user_id = $1`,
    [applicantId]
  );
  if (!appExists) {
    await pool.query(
      `INSERT INTO contributor_applications
         (user_id, application_reason, expertise, status)
       VALUES ($1, $2, $3, 'PENDING')`,
      [applicantId,
       'Saya sering backpacking ke Jawa Timur dan ingin berbagi informasi destinasi terbaru.',
       '{Alam,Kuliner}']
    );
    for (const a of await pool.query(
      `SELECT id FROM users WHERE role = 'admin' AND account_status = 'active'`
    ).then((r) => r.rows)) {
      await pool.query(
        `SELECT notify_user($1, 'Pengajuan contributor baru',
                            'Applicant Baru mengajukan diri sebagai contributor.',
                            'moderation', '/admin/applications')`,
        [a.id]
      );
    }
  }

  // --- Kontribusi menunggu moderasi (contoh) ---
  const bromoId = (await one(pool, `SELECT id FROM destinations WHERE slug = 'gunung-bromo'`)).id;
  const contribCount = await one(pool, `SELECT count(*)::int AS n FROM contributions`);
  if (contribCount.n === 0) {
    await pool.query(
      `INSERT INTO contributions
         (contributor_id, destination_id, submission_type, submission_data, status)
       VALUES ($1, NULL, 'new_destination',
               $2::jsonb, 'PENDING')`,
      [contributorId,
       JSON.stringify({
         name: 'Kawah Ijen',
         category: 'Alam',
         city: 'Banyuwangi, Jawa Timur',
         address: 'Kabupaten Banyuwangi, Jawa Timur',
         latitude: -8.0586, longitude: -114.2414,
         estimated_cost: 100000,
         description: 'Kawah belerang dengan api biru yang terkenal. Wajib memakai masker dan mendaki bersama pemandu resmi.',
         image_url: 'https://images.unsplash.com/photo-1518548419970-58e3b4079ab2?auto=format&fit=crop&w=900&q=80',
       })],
    );
    await pool.query(
      `INSERT INTO contributions
         (contributor_id, destination_id, submission_type, submission_data, status)
       VALUES ($1, $2, 'update_destination',
               $3::jsonb, 'REVISION_REQUIRED')`,
      [contributorId, bromoId,
       JSON.stringify({
         field: 'estimated_cost',
         from: 150000,
         to: 175000,
         reason: 'Tiket masuk terbaru naik menjadi Rp175.000 per orang.',
       })],
    );
    await pool.query(
      `SELECT notify_user($1, 'Kontribusi menunggu tinjauan',
                          'Ada pengajuan destinasi baru yang menunggu verifikasi.',
                          'moderation', '/admin/contributions')`,
      [adminId]
    );
    console.log('  ✓ 2 kontribusi contoh untuk panel moderasi');
  }

  // --- Follow: explorer mengikuti contributor ---
  await pool.query(
    `INSERT INTO follows (follower_id, followee_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [explorerId, contributorId]
  );

  // --- Aktivitas audit contoh ---
  const logCount = await one(pool, `SELECT count(*)::int AS n FROM activity_logs`);
  if (logCount.n === 0) {
    await pool.query(`SELECT log_activity($1, 'auth.login', 'user', $2::text, '{}'::jsonb)`, [adminId, adminId]);
    await pool.query(`SELECT log_activity($1, 'auth.login', 'user', $2::text, '{}'::jsonb)`, [explorerId, explorerId]);
    await pool.query(`SELECT log_activity($1, 'seed.run', 'system', NULL, '{"note":"data awal Explore"}'::jsonb)`, [adminId]);
  }

  console.log('  ✓ Seed selesai');
}

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  console.log('Menyiapkan data awal Explore...');
  seed()
    .then(async () => {
      console.log('Seed berhasil.');
      await stopDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('GAGAL:', err);
      await stopDatabase().catch(() => {});
      process.exit(1);
    });
}
