// Menjalankan server database embedded secara terpisah (opsional).
// Aplikasi juga otomatis menjalankannya saat `npm run dev`.
import { startDatabase, stopDatabase, dbConfig } from './pg.js';

startDatabase()
  .then(async () => {
    console.log(`PostgreSQL berjalan di 127.0.0.1:${dbConfig.port}`);
    console.log(`Database: ${dbConfig.database}`);
    await stopDatabase();
    process.exit(0);
  })
  .catch((err) => {
    console.error('Gagal menjalankan database:', err.message);
    process.exit(1);
  });
