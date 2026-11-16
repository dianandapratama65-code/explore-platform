// ============================================================
// Explore — public/js/auth.js
// Status sesi, modal login/register/forgot (gaya Explore),
// navigasi role, dan penjaga fitur khusus pengguna.
// ============================================================
import { api } from './api.js';
import { openModal, closeModal, showToast, esc, firstName } from './ui.js';

export const auth = { user: null, profile: null };

const ROLE_LABEL = {
  admin: 'Admin',
  contributor: 'Contributor',
  explorer: 'Explorer',
};

// ------------------------------------------------------------
// Form (dimuat ke modal yang sama dengan detail destinasi)
// ------------------------------------------------------------
const views = {
  login: () => `
    <div class="modal-body auth">
      <button class="close" onclick="closeModal()" aria-label="Tutup">×</button>
      <div class="eyebrow">Selamat datang kembali</div>
      <h2>Masuk ke Explore</h2>
      <form onsubmit="return handleLogin(event)" novalidate>
        <label class="field"><span>Email</span>
          <input type="email" name="email" required autocomplete="email"
                 placeholder="nama@email.com"></label>
        <label class="field"><span>Password</span>
          <input type="password" name="password" required autocomplete="current-password"
                 placeholder="••••••••"></label>
        <button class="btn btn-dark btn-block" type="submit">Masuk</button>
      </form>
      <div class="auth-error" id="authError" hidden></div>
      <div class="auth-links">
        <button type="button" class="linkbtn" onclick="openAuth('forgot')">Lupa password?</button>
        <button type="button" class="linkbtn" onclick="openAuth('register')">Belum punya akun? Daftar</button>
      </div>
    </div>`,

  register: () => `
    <div class="modal-body auth">
      <button class="close" onclick="closeModal()" aria-label="Tutup">×</button>
      <div class="eyebrow">Mulai jelajahi</div>
      <h2>Buat akun</h2>
      <form onsubmit="return handleRegister(event)" novalidate>
        <label class="field"><span>Nama lengkap</span>
          <input type="text" name="full_name" required minlength="2" maxlength="120"
                 autocomplete="name" placeholder="Nama kamu"></label>
        <label class="field"><span>Email</span>
          <input type="email" name="email" required autocomplete="email"
                 placeholder="nama@email.com"></label>
        <label class="field"><span>Password</span>
          <input type="password" name="password" required minlength="8"
                 autocomplete="new-password" placeholder="Minimal 8 karakter, ada angka"></label>
        <label class="field"><span>Ulangi password</span>
          <input type="password" name="password2" required autocomplete="new-password"
                 placeholder="••••••••"></label>
        <button class="btn btn-dark btn-block" type="submit">Daftar</button>
      </form>
      <div class="auth-error" id="authError" hidden></div>
      <div class="auth-links">
        <button type="button" class="linkbtn" onclick="openAuth('login')">Sudah punya akun? Masuk</button>
      </div>
      <p class="auth-note">Ingin menjadi <b>contributor</b>? Daftar dulu, verifikasi email,
      lalu kirim pengajuan dari halaman profil — disetujui oleh admin.</p>
    </div>`,

  forgot: () => `
    <div class="modal-body auth">
      <button class="close" onclick="closeModal()" aria-label="Tutup">×</button>
      <div class="eyebrow">Pemulihan akun</div>
      <h2>Lupa password?</h2>
      <form onsubmit="return handleForgot(event)" novalidate>
        <label class="field"><span>Email terdaftar</span>
          <input type="email" name="email" required autocomplete="email"
                 placeholder="nama@email.com"></label>
        <button class="btn btn-dark btn-block" type="submit">Kirim tautan reset</button>
      </form>
      <div class="auth-error" id="authError" hidden></div>
      <p class="auth-note">Tautan berlaku 1 jam. Mode pengembangan: email ditulis ke
      folder <code>var/mail/</code>.</p>
      <div class="auth-links">
        <button type="button" class="linkbtn" onclick="openAuth('login')">← Kembali ke login</button>
      </div>
    </div>`,
};

export function openAuth(view = 'login') {
  const render = views[view] || views.login;
  openModal(render());
  setTimeout(() => document.querySelector('#modalContent input')?.focus(), 60);
}

function authError(message) {
  const el = document.getElementById('authError');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());

// ------------------------------------------------------------
// Aksi form
// ------------------------------------------------------------
export async function handleLogin(e) {
  e.preventDefault();
  const body = formData(e.target);
  try {
    const data = await api('/api/auth/login', { method: 'POST', body });
    auth.user = data.user;
    renderAuth();
    closeModal();
    showToast(`Selamat datang, ${firstName(data.user.full_name)}!`);
    afterLogin(data.user);   // pengalihan berbasis role (Phase 4)
  } catch (err) {
    authError(err.message);
  }
  return false;
}

export async function handleRegister(e) {
  e.preventDefault();
  const body = formData(e.target);

  if (body.password !== body.password2) {
    authError('Konfirmasi password tidak sama.');
    return false;
  }
  delete body.password2;

  try {
    const data = await api('/api/auth/register', { method: 'POST', body });
    showToast(data.message + ' Cek email untuk verifikasi.');
    // pindah ke form login dengan email terisi
    openAuth('login');
    const input = document.querySelector('#modalContent input[name="email"]');
    if (input) input.value = body.email;
  } catch (err) {
    authError(err.message);
  }
  return false;
}

export async function handleForgot(e) {
  e.preventDefault();
  const body = formData(e.target);
  try {
    const data = await api('/api/auth/forgot-password', { method: 'POST', body });
    closeModal();
    showToast(data.message);
  } catch (err) {
    authError(err.message);
  }
  return false;
}

export async function doLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch { /* sesi mungkin sudah mati */ }
  auth.user = null;
  auth.profile = null;
  renderAuth();
  closeUserMenu();
  showToast('Berhasil keluar. Sampai jumpa!');
}

export async function resendVerification() {
  try {
    const data = await api('/api/auth/resend-verification', { method: 'POST' });
    showToast(data.message + ' (mode dev: lihat var/mail/)');
  } catch (err) {
    showToast(err.message);
  }
}

/**
 * Pengalihan berbasis role setelah login (Phase 4).
 * Admin & contributor bekerja dari dashboard; explorer tetap di
 * halaman Explore (dashboard profil dapat dibuka dari menu).
 */
function afterLogin(user) {
  if (user.role === 'admin' || user.role === 'contributor') {
    window.location.href = '/pages/dashboard.html';
  }
}

// ------------------------------------------------------------
// Render navigasi sesuai sesi & role
// ------------------------------------------------------------
export function renderAuth() {
  const guest = document.getElementById('authGuest');
  const userBox = document.getElementById('authUser');
  const verifyBar = document.getElementById('verifyBar');
  if (!guest || !userBox) return;

  const u = auth.user;
  guest.hidden = Boolean(u);
  userBox.hidden = !u;

  if (u) {
    document.getElementById('userName').textContent = u.full_name;
    document.getElementById('userRole').textContent = ROLE_LABEL[u.role] || u.role;
    document.getElementById('userEmail').textContent = u.email;
    document.getElementById('userStatus').textContent = u.email_verified_at
      ? '✓ Email terverifikasi'
      : 'Belum verifikasi email';
    document.getElementById('userAvatar').textContent =
      (u.full_name || '?').trim().charAt(0).toUpperCase();

    if (verifyBar) verifyBar.hidden = Boolean(u.email_verified_at);
  } else if (verifyBar) {
    verifyBar.hidden = true;
  }
}

// ------------------------------------------------------------
// Menu pengguna
// ------------------------------------------------------------
export function toggleUserMenu(e) {
  e?.stopPropagation();
  const menu = document.getElementById('userMenu');
  if (menu) menu.hidden = !menu.hidden;
}

export function closeUserMenu() {
  const menu = document.getElementById('userMenu');
  if (menu) menu.hidden = true;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest?.('#authUser')) closeUserMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeUserMenu(); closeModal(); }
});

// ------------------------------------------------------------
// Penjaga fitur khusus pengguna login (Explore vs Guest)
// ------------------------------------------------------------
/** @returns {boolean} true bila pengguna sudah login. */
export function requireLogin(featureLabel) {
  if (auth.user) return true;
  openAuth('login');
  showToast(`Login untuk ${featureLabel}`);
  return false;
}

/** Status verifikasi email — wajib untuk kontribusi. */
export function requireVerified(featureLabel) {
  if (!requireLogin(featureLabel)) return false;
  if (!auth.user.email_verified_at) {
    showToast('Verifikasi email dulu sebelum mengirim kontribusi.');
    resendVerification();
    return false;
  }
  return true;
}

/** Ambil sesi berjalan (dipakai modul lain). */
export async function initAuth() {
  try {
    const data = await api('/api/auth/me');
    auth.user = data.user;
    auth.profile = data.profile;
  } catch {
    auth.user = null;
    auth.profile = null;
  }
  renderAuth();
  return auth;
}
