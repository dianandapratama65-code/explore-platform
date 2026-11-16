// ============================================================
// Explore — server/index.js
// Titik masuk server: siapkan database → jalankan Express.
// ============================================================
import { config } from './config.js';
import { buildApp } from './app.js';
import { startDatabase, stopDatabase } from './db/pg.js';

await startDatabase();

const app = buildApp();
const server = app.listen(config.port, () => {
  console.log('──────────────────────────────────────────────');
  console.log(`  Explore berjalan di ${config.appUrl}`);
  console.log(`  Database : PostgreSQL lokal (port internal)`);
  console.log(`  Mode     : ${config.env}`);
  console.log(`  Maps     : ${config.integrations.googleMapsKey
    ? 'Google Maps API aktif' : 'OpenStreetMap (Google Maps API belum diisi)'}`);
  console.log('──────────────────────────────────────────────');
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\nMenghentikan server (${signal})...`);
  server.close();
  try {
    await stopDatabase();
    console.log('Berhasil dihentikan.');
  } catch (err) {
    console.error('Gagal menghentikan database:', err.message);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
