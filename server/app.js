// ============================================================
// Explore — server/app.js
// Perakit aplikasi Express (dipakai server & test).
// ============================================================
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import apiRoutes from './routes/index.js';
import { attachAuth } from './middleware/auth.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './utils/http.js';

export function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  // Keamanan header + CSP yang mengakomodasi Leaflet, Google Fonts,
  // Unsplash (gambar), dan gaya/inline handler prototipe.
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://*.tile.openstreetmap.org'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }));

  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use(apiLimiter);
  app.use(attachAuth);

  app.use('/api', apiRoutes);
  app.use('/api', notFound);

  // Aset frontend (index.html, css, js, halaman token)
  app.use(express.static(config.publicDir));

  app.use(errorHandler);
  return app;
}
