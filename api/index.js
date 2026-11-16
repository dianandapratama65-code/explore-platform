// Vercel serverless entry point.
// Membungkus aplikasi Express agar berjalan sebagai serverless function.
// Database connection (Neon) dilakukan lazily via pool di server/db/pg.js.
import { buildApp } from '../server/app.js';

const app = buildApp();

export default app;
