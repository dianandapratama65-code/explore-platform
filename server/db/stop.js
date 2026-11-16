// Menghentikan server database embedded.
import { stopDatabase } from './pg.js';

stopDatabase()
  .then(() => { console.log('Database dihentikan.'); process.exit(0); })
  .catch((err) => { console.error('Gagal:', err.message); process.exit(1); });
