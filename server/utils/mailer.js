// ============================================================
// Explore — server/utils/mailer.js
// Pengiriman email verifikasi & reset password.
//   - SMTP_URL kosong  → mode dev: disimpan ke var/mail/*.eml + log
//   - SMTP_URL terisi  → dikirim lewat SMTP (nodemailer)
// Tidak ada kredensial yang dikarang — isi SMTP_URL di .env bila tersedia.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { createTransport } from 'nodemailer';
import { config } from '../config.js';
import { ROOT } from '../db/pg.js';

const MAIL_DIR = path.join(ROOT, 'var', 'mail');

/** Arsip email terakhir (dipakai test & debugging). */
export const sent = [];

let transporter = null;
if (config.mail.smtpUrl) {
  transporter = createTransport(config.mail.smtpUrl);
}

/**
 * Kirim email.
 * @returns {Promise<{id:string, devPath?:string}>}
 */
export async function sendMail({ to, subject, text, html }) {
  const record = {
    to,
    from: config.mail.from,
    subject,
    text,
    html,
    sentAt: new Date().toISOString(),
  };
  sent.push(record);
  if (sent.length > 50) sent.shift();

  if (transporter) {
    await transporter.sendMail(record);
    return { id: record.sentAt };
  }

  // Mode pengembangan: tulis file .eml
  fs.mkdirSync(MAIL_DIR, { recursive: true });
  const safe = to.replace(/[^a-z0-9._-]/gi, '_');
  const file = path.join(MAIL_DIR, `${Date.now()}-${safe}.eml`);
  const eml = [
    `From: ${record.from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    '',
    text,
    '',
  ].join('\r\n');
  fs.writeFileSync(file, eml, 'utf8');
  record.devPath = file;
  console.log(`[mail:dev] → ${to} | ${subject}\n            ${file}`);
  return { id: record.sentAt, devPath: file };
}

/** Tautan bantuan akun (dipakai email verifikasi/reset). */
export function accountLink(page, token) {
  return `${config.appUrl}/pages/${page}.html?token=${encodeURIComponent(token)}`;
}
