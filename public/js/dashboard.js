// ============================================================
// Explore — public/js/dashboard.js
// Dashboard per role (admin / contributor / explorer).
// Data diambil dari API; seluruh otorisasi juga dijaga backend
// dan database — tampilan di sini hanya penyajian.
// ============================================================
import { api } from './api.js';
import { showToast, esc, formatRp, closeModal } from './ui.js';
import {
  initAuth, auth, renderAuth, doLogout, toggleUserMenu,
  openAuth, handleLogin, handleRegister, handleForgot, resendVerification,
} from './auth.js';

const STATUS_LABEL = {
  PENDING: 'Menunggu', UNDER_REVIEW: 'Ditinjau', APPROVED: 'Disetujui',
  REJECTED: 'Ditolak', REVISION_REQUIRED: 'Perlu revisi',
  open: 'Terbuka', in_review: 'Ditinjau', resolved: 'Selesai', dismissed: 'Diabaikan',
  active: 'Aktif', suspended: 'Ditangguhkan',
};
const ROLE_LABEL = { admin: 'Admin', contributor: 'Contributor', explorer: 'Explorer' };

const badge = (s) => `<span class="badge ${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
const roleBadge = (r) => `<span class="badge role-${esc(r)}">${esc(ROLE_LABEL[r] || r)}</span>`;

let currentTab = '';

// ------------------------------------------------------------
// Navigasi tab per role
// ------------------------------------------------------------
const NAVS = {
  admin: [
    ['stats', '📊 Statistik'],
    ['users', '👥 Pengguna'],
    ['applications', '📋 Pengajuan contributor'],
    ['contributions', '📝 Moderasi kontribusi'],
    ['reports', '⚑ Laporan'],
  ],
  contributor: [
    ['submit', '✏️ Kirim kontribusi'],
    ['mine', '📦 Kontribusi saya'],
    ['notifications', '🔔 Notifikasi'],
  ],
  explorer: [
    ['profile', '👤 Profil'],
    ['apply', '🌱 Ajukan contributor'],
    ['notifications', '🔔 Notifikasi'],
  ],
};

function renderNav() {
  const u = auth.user;
  const items = NAVS[u.role] || NAVS.explorer;
  document.getElementById('dashNav').innerHTML = `
    <div class="who">
      <span class="avatar">${esc((u.full_name || '?').charAt(0).toUpperCase())}</span>
      <span><b>${esc(u.full_name)}</b><small>${roleBadge(u.role)} ${u.email_verified_at ? '✓' : '⚠ belum verif.'}</small></span>
    </div>
    ${items.map(([id, label], i) => `
      <button class="dash-tab ${i === 0 ? 'active' : ''}" data-tab="${id}" onclick="dashTab('${id}')">
        ${label}
      </button>`).join('')}
    <button class="dash-tab" onclick="window.location='/'">🏠 Explore</button>`;
}

function dashTab(id) {
  currentTab = id;
  document.querySelectorAll('.dash-tab[data-tab]').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === id));
  const view = document.getElementById(`view-${id}`);
  if (!view) return;
  document.querySelectorAll('.dash-view').forEach((v) => v.classList.remove('show'));
  view.classList.add('show');
  VIEWS[id]?.();
}

// ------------------------------------------------------------
// Konten tiap tab
// ------------------------------------------------------------
const VIEWS = {
  // ================= ADMIN =================
  async stats() {
    const el = document.getElementById('view-stats');
    if (el.dataset.loaded) return;
    try {
      const { stats } = await api('/api/admin/stats');
      el.dataset.loaded = '1';
      el.innerHTML = `
        <div class="stat-grid">
          <div class="stat-card"><b>${stats.total_users}</b><span>Total pengguna</span></div>
          <div class="stat-card"><b>${stats.published_destinations}</b><span>Destinasi tayang</span></div>
          <div class="stat-card hot"><b>${stats.pending_contributions}</b><span>Kontribusi menunggu</span></div>
          <div class="stat-card hot"><b>${stats.pending_applications}</b><span>Pengajuan contributor</span></div>
          <div class="stat-card hot"><b>${stats.open_reports}</b><span>Laporan terbuka</span></div>
        </div>
        <div class="panel">
          <h2>Sebaran role</h2>
          <p class="hint">Distribusi pengguna berdasarkan peran mereka.</p>
          <div class="stat-grid">
            ${Object.entries(stats.users_by_role).map(([r, n]) =>
              `<div class="stat-card"><b>${n}</b><span>${roleBadge(r)}</span></div>`).join('')}
          </div>
        </div>`;
    } catch (err) {
      el.innerHTML = `<div class="empty-note">${esc(err.message)}</div>`;
    }
  },

  async users() {
    const el = document.getElementById('view-users');
    const render = async (q = '', role = '') => {
      el.innerHTML = `
        <div class="toolbar">
          <input class="grow" id="userQ" placeholder="Cari nama atau email…" value="${esc(q)}">
          <select id="userRoleF">
            <option value="">Semua role</option>
            ${['admin', 'contributor', 'explorer'].map((r) =>
              `<option value="${r}" ${role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
          </select>
        </div>
        <div class="panel" id="userTable"><div class="empty-note">Memuat…</div></div>`;
      el.querySelector('#userQ').addEventListener('input', (e) => load(e.target.value, role));
      el.querySelector('#userRoleF').addEventListener('change', (e) => load(q, e.target.value));

      const load = async (qq, rr) => {
        try {
          const params = new URLSearchParams();
          if (qq) params.set('q', qq);
          if (rr) params.set('role', rr);
          const { users } = await api(`/api/admin/users?${params}`);
          const me = auth.user.id;
          document.getElementById('userTable').innerHTML = users.length ? `
            <table class="table">
              <thead><tr><th>Pengguna</th><th>Role</th><th>Status</th><th>Verifikasi</th><th>Aksi</th></tr></thead>
              <tbody>${users.map((u) => `
                <tr>
                  <td><b>${esc(u.full_name)}</b><br><small style="color:var(--muted)">${esc(u.email)}</small>
                    ${u.has_pending_application ? ' <span class="badge PENDING">pengajuan</span>' : ''}</td>
                  <td>${roleBadge(u.role)}</td>
                  <td>${badge(u.account_status)}</td>
                  <td>${u.email_verified_at ? '✓' : '—'}</td>
                  <td class="row-actions">
                    ${u.id === me ? '<small style="color:var(--muted)">akunmu</small>' : `
                      <select data-uid="${u.id}" class="roleSel">
                        ${['admin', 'contributor', 'explorer'].map((r) =>
                          `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
                      </select>
                      <button class="btn-xs ${u.account_status === 'active' ? 'reject' : 'approve'}"
                              onclick="toggleStatus('${u.id}','${u.account_status}')">
                        ${u.account_status === 'active' ? 'Tangguhkan' : 'Aktifkan'}
                      </button>`}
                  </td>
                </tr>`).join('')}</tbody>
            </table>` : '<div class="empty-note">Tidak ada pengguna cocok.</div>';

          el.querySelectorAll('.roleSel').forEach((sel) =>
            sel.addEventListener('change', () => changeRole(sel.dataset.uid, sel.value)));
        } catch (err) {
          document.getElementById('userTable').innerHTML =
            `<div class="empty-note">${esc(err.message)}</div>`;
        }
      };
      await load(q, role);
    };
    await render();
  },

  async applications() {
    const el = document.getElementById('view-applications');
    el.innerHTML = `
      <div class="toolbar">
        <select id="appF">
          <option value="">Semua status</option>
          ${['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED'].map((s) =>
            `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}
        </select>
      </div>
      <div id="appList"><div class="empty-note">Memuat…</div></div>`;
    const load = async (status = '') => {
      try {
        const params = status ? `?status=${status}` : '';
        const { applications } = await api(`/api/admin/applications${params}`);
        document.getElementById('appList').innerHTML = applications.length
          ? applications.map((a) => `
            <div class="review-card" id="app-${a.id}">
              <div class="head"><b>${esc(a.full_name)}</b> ${badge(a.status)}</div>
              <div class="meta">${esc(a.email)} • diajukan ${new Date(a.created_at).toLocaleDateString('id-ID')}
                ${a.email_verified_at ? '• ✓ terverifikasi' : '• ⚠ belum verifikasi'}</div>
              <div class="body">${esc(a.application_reason)}
${a.expertise?.length ? '\nKeahlian: ' + a.expertise.join(', ') : ''}</div>
              ${a.admin_note ? `<div class="meta">Catatan admin: ${esc(a.admin_note)}</div>` : ''}
              ${['PENDING', 'UNDER_REVIEW', 'REVISION_REQUIRED'].includes(a.status) ? `
                <div class="note-row">
                  <input placeholder="Catatan untuk pemohon (opsional)" data-note="${a.id}">
                  <button class="btn-xs review" onclick="reviewApp('${a.id}','UNDER_REVIEW')">Tinjau</button>
                  <button class="btn-xs approve" onclick="reviewApp('${a.id}','APPROVED')">Setujui</button>
                  <button class="btn-xs revision" onclick="reviewApp('${a.id}','REVISION_REQUIRED')">Minta revisi</button>
                  <button class="btn-xs reject" onclick="reviewApp('${a.id}','REJECTED')">Tolak</button>
                </div>` : ''}
            </div>`).join('')
          : '<div class="empty-note">Tidak ada pengajuan pada filter ini.</div>';
      } catch (err) {
        document.getElementById('appList').innerHTML = `<div class="empty-note">${esc(err.message)}</div>`;
      }
    };
    el.querySelector('#appF').addEventListener('change', (e) => load(e.target.value));
    await load();
  },

  async contributions() {
    const el = document.getElementById('view-contributions');
    el.innerHTML = `
      <div class="toolbar">
        <select id="conF">
          <option value="">Semua status</option>
          ${['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED'].map((s) =>
            `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}
        </select>
      </div>
      <div id="conList"><div class="empty-note">Memuat…</div></div>`;
    const load = async (status = '') => {
      try {
        const params = status ? `?status=${status}` : '';
        const { contributions } = await api(`/api/admin/contributions${params}`);
        document.getElementById('conList').innerHTML = contributions.length
          ? contributions.map((c) => `
            <div class="review-card" id="con-${c.id}">
              <div class="head">
                <b>${esc(c.submission_type.replace('_', ' '))}</b> ${badge(c.status)}
              </div>
              <div class="meta">oleh ${esc(c.contributor_name)} • ${esc(c.email)} •
                ${new Date(c.created_at).toLocaleDateString('id-ID')}</div>
              <div class="body">${esc(JSON.stringify(c.submission_data, null, 2))}</div>
              ${c.admin_note ? `<div class="meta">Catatan: ${esc(c.admin_note)}</div>` : ''}
              ${['PENDING', 'UNDER_REVIEW', 'REVISION_REQUIRED'].includes(c.status) ? `
                <div class="note-row">
                  <input placeholder="Catatan keputusan (opsional)" data-note="${c.id}">
                  <button class="btn-xs review" onclick="reviewCon('${c.id}','UNDER_REVIEW')">Tinjau</button>
                  <button class="btn-xs approve" onclick="reviewCon('${c.id}','APPROVED')">Setujui & terbitkan</button>
                  <button class="btn-xs revision" onclick="reviewCon('${c.id}','REVISION_REQUIRED')">Minta revisi</button>
                  <button class="btn-xs reject" onclick="reviewCon('${c.id}','REJECTED')">Tolak</button>
                </div>` : ''}
            </div>`).join('')
          : '<div class="empty-note">Tidak ada kontribusi pada filter ini.</div>';
      } catch (err) {
        document.getElementById('conList').innerHTML = `<div class="empty-note">${esc(err.message)}</div>`;
      }
    };
    el.querySelector('#conF').addEventListener('change', (e) => load(e.target.value));
    await load();
  },

  async reports() {
    const el = document.getElementById('view-reports');
    el.innerHTML = `
      <div class="toolbar">
        <select id="repF">
          <option value="">Semua status</option>
          ${['open', 'in_review', 'resolved', 'dismissed'].map((s) =>
            `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}
        </select>
      </div>
      <div id="repList"><div class="empty-note">Memuat…</div></div>`;
    const load = async (status = '') => {
      try {
        const params = status ? `?status=${status}` : '';
        const { reports } = await api(`/api/admin/reports${params}`);
        document.getElementById('repList').innerHTML = reports.length
          ? reports.map((r) => `
            <div class="review-card">
              <div class="head"><b>${esc(r.destination_name)}</b> ${badge(r.status)}</div>
              <div class="meta">${esc(r.report_type)} • oleh ${esc(r.reporter_name)} •
                ${new Date(r.created_at).toLocaleDateString('id-ID')}</div>
              <div class="body">${esc(r.description)}</div>
              ${['open', 'in_review'].includes(r.status) ? `
                <div class="note-row">
                  <button class="btn-xs review" onclick="reviewRep('${r.id}','in_review')">Tinjau</button>
                  <button class="btn-xs approve" onclick="reviewRep('${r.id}','resolved')">Selesaikan</button>
                  <button class="btn-xs reject" onclick="reviewRep('${r.id}','dismissed')">Abaikan</button>
                </div>` : ''}
            </div>`).join('')
          : '<div class="empty-note">Tidak ada laporan pada filter ini.</div>';
      } catch (err) {
        document.getElementById('repList').innerHTML = `<div class="empty-note">${esc(err.message)}</div>`;
      }
    };
    el.querySelector('#repF').addEventListener('change', (e) => load(e.target.value));
    await load();
  },

  // ================= CONTRIBUTOR =================
  submit() {
    const el = document.getElementById('view-submit');
    if (!auth.user.email_verified_at) {
      el.innerHTML = `
        <div class="panel">
          <h2>Email belum terverifikasi</h2>
          <p class="hint">Verifikasi email dulu sebelum mengirim kontribusi.</p>
          <button class="btn btn-dark" onclick="resendVerification()">Kirim ulang email verifikasi</button>
        </div>`;
      return;
    }
    el.innerHTML = `
      <div class="panel">
        <h2>Kirim kontribusi baru</h2>
        <p class="hint">Kontribusi masuk antrean moderasi (PENDING) dan hanya tayang setelah disetujui admin.</p>
        <form onsubmit="return submitContribution(event)">
          <div class="form-grid">
            <label class="field"><span>Jenis kiriman</span>
              <select name="submission_type" onchange="conTypeChanged(this.value)" required>
                <option value="new_destination">Destinasi baru</option>
                <option value="update_destination">Perbarui destinasi</option>
                <option value="add_media">Tambah media</option>
              </select></label>
            <label class="field" id="fDest" hidden><span>Destination ID (UUID)</span>
              <input name="destination_id" placeholder="xxxxxxxx-xxxx-…"></label>
            <label class="field" id="fName"><span>Nama destinasi</span>
              <input name="name" maxlength="150" placeholder="Air Terjun X" required></label>
            <label class="field" id="fCat"><span>Kategori</span>
              <input name="category" list="catList" placeholder="Alam / Budaya / Pantai" required>
              <datalist id="catList"><option>Alam</option><option>Budaya</option><option>Pantai</option></datalist></label>
            <label class="field" id="fCity"><span>Kota / wilayah</span>
              <input name="city" maxlength="100" placeholder="Banyuwangi"></label>
            <label class="field" id="fCost"><span>Estimasi biaya (Rp)</span>
              <input name="estimated_cost" type="number" min="0" value="0"></label>
            <label class="field" id="fImage"><span>URL gambar (opsional)</span>
              <input name="image_url" type="url" placeholder="https://…"></label>
            <label class="field full" id="fDesc"><span>Deskripsi</span>
              <textarea name="description" minlength="20" maxlength="4000"
                placeholder="Jelaskan destinasi, akses, dan aturan kunjungan (min. 20 karakter)" required></textarea></label>
            <label class="field full" id="fFields" hidden><span>Perubahan (JSON)</span>
              <textarea name="fields" placeholder='{"estimated_cost": 150000}'></textarea></label>
            <label class="field full" id="fCaption" hidden><span>Keterangan gambar</span>
              <input name="caption" maxlength="200" placeholder="Keterangan singkat"></label>
          </div>
          <div class="form-actions">
            <button class="btn btn-dark" type="submit">Kirim ke antrean moderasi</button>
            <small style="color:var(--muted)">Status dapat dipantau di tab “Kontribusi saya”.</small>
          </div>
        </form>
      </div>`;
  },

  async mine() {
    const el = document.getElementById('view-mine');
    el.innerHTML = '<div class="panel"><div class="empty-note">Memuat…</div></div>';
    try {
      const { contributions } = await api('/api/contributor/contributions');
      el.innerHTML = `
        <div class="panel">
          <h2>Kontribusi saya</h2>
          <p class="hint">Kiriman terbaru beserta status moderasi dan catatan admin.</p>
          ${contributions.length ? contributions.map((c) => `
            <div class="mine">
              <div class="m-info">
                <b>${esc(c.submission_type.replace('_', ' '))}</b>
                <small>${new Date(c.created_at).toLocaleDateString('id-ID')}
                  ${c.admin_note ? '• ' + esc(c.admin_note) : ''}</small>
              </div>
              <div class="m-actions">
                ${badge(c.status)}
                ${['PENDING', 'REVISION_REQUIRED'].includes(c.status) ? `
                  <button class="btn-xs reject" onclick="withdrawCon('${c.id}')">Tarik</button>` : ''}
              </div>
            </div>`).join('') : '<div class="empty-note">Belum ada kontribusi. Mulai dari tab “Kirim kontribusi”.</div>'}
        </div>`;
    } catch (err) {
      el.innerHTML = `<div class="panel"><div class="empty-note">${esc(err.message)}</div></div>`;
    }
  },

  // ================= EXPLORER =================
  profile() {
    const u = auth.user;
    const p = auth.profile || {};
    document.getElementById('view-profile').innerHTML = `
      <div class="panel">
        <h2>Profil saya</h2>
        <p class="hint">Informasi akun yang tersimpan di server.</p>
        <table class="table">
          <tr><td>Nama</td><td><b>${esc(u.full_name)}</b></td></tr>
          <tr><td>Email</td><td>${esc(u.email)}</td></tr>
          <tr><td>Role</td><td>${roleBadge(u.role)}</td></tr>
          <tr><td>Status email</td><td>${u.email_verified_at ? '✓ Terverifikasi' : '⚠ Belum diverifikasi'}</td></tr>
          <tr><td>Status akun</td><td>${badge(u.account_status)}</td></tr>
          ${p.bio ? `<tr><td>Bio</td><td>${esc(p.bio)}</td></tr>` : ''}
          ${p.country ? `<tr><td>Negara</td><td>${esc(p.country)}</td></tr>` : ''}
        </table>
        ${!u.email_verified_at ? `
          <div class="form-actions">
            <button class="btn btn-dark" onclick="resendVerification()">Kirim email verifikasi</button>
          </div>` : ''}
      </div>`;
  },

  apply() {
    const el = document.getElementById('view-apply');
    if (!auth.user.email_verified_at) {
      el.innerHTML = `
        <div class="panel">
          <h2>Email belum terverifikasi</h2>
          <p class="hint">Verifikasi email dulu sebelum mengajukan diri menjadi contributor.</p>
          <button class="btn btn-dark" onclick="resendVerification()">Kirim email verifikasi</button>
        </div>`;
      return;
    }
    el.innerHTML = `
      <div class="panel">
        <h2>Ajukan diri menjadi contributor</h2>
        <p class="hint">Pengajuan ditinjau admin. Bila disetujui, role kamu otomatis naik menjadi contributor.</p>
        <div id="appStatus"></div>
        <form onsubmit="return submitApplication(event)">
          <div class="form-grid">
            <label class="field full"><span>Alasan (min. 20 karakter)</span>
              <textarea name="reason" minlength="20" maxlength="2000" required
                placeholder="Ceritakan pengalaman menulis / fotografi / pengetahuan destinasi kamu…"></textarea></label>
            <label class="field full"><span>Keahlian (pisahkan dengan koma)</span>
              <input name="expertise" placeholder="Alam, Budaya, Jawa Timur"></label>
          </div>
          <div class="form-actions">
            <button class="btn btn-dark" type="submit">Kirim pengajuan</button>
          </div>
        </form>
      </div>`;
    loadApplicationStatus();
  },

  notifications: loadNotifications,
};

// ------------------------------------------------------------
// Aksi
// ------------------------------------------------------------
async function loadApplicationStatus() {
  const box = document.getElementById('appStatus');
  if (!box) return;
  try {
    const { application } = await api('/api/contributor/application');
    if (!application) return;
    box.innerHTML = `
      <div class="review-card">
        <div class="head"><b>Pengajuan terakhir</b> ${badge(application.status)}</div>
        <div class="meta">${new Date(application.created_at).toLocaleDateString('id-ID')}</div>
        ${application.admin_note ? `<div class="meta">Catatan admin: ${esc(application.admin_note)}</div>` : ''}
      </div>`;
  } catch { /* belum ada pengajuan */ }
}

async function loadNotifications() {
  const el = document.getElementById('view-notifications');
  el.innerHTML = '<div class="panel"><div class="empty-note">Memuat…</div></div>';
  try {
    const { notifications } = await api('/api/notifications');
    el.innerHTML = `
      <div class="panel">
        <h2>Notifikasi</h2>
        <p class="hint">Keputusan moderasi, verifikasi, dan kabar akun.</p>
        ${notifications.length ? notifications.map((n) => `
          <div class="notif ${n.is_read ? 'read' : ''}">
            <span class="n-dot"></span>
            <span><b>${esc(n.title)}</b>
              <span class="n-msg">${esc(n.message)}</span>
              <small>${new Date(n.created_at).toLocaleString('id-ID')}</small></span>
          </div>`).join('') : '<div class="empty-note">Belum ada notifikasi.</div>'}
        ${notifications.some((n) => !n.is_read) ? `
          <div class="form-actions">
            <button class="btn btn-light" onclick="markRead()">Tandai semua dibaca</button>
          </div>` : ''}
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="panel"><div class="empty-note">${esc(err.message)}</div></div>`;
  }
}

function conTypeChanged(type) {
  const show = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.hidden = !on;
  };
  const isNew = type === 'new_destination';
  const isUpdate = type === 'update_destination';
  show('fDest', !isNew);
  show('fName', isNew);
  show('fCat', isNew);
  show('fCity', isNew);
  show('fCost', isNew || isUpdate);
  show('fImage', isNew);
  show('fDesc', isNew || isUpdate);
  show('fFields', isUpdate);
  show('fCaption', type === 'add_media');
}

async function submitContribution(e) {
  e.preventDefault();
  const f = e.target;
  const type = f.submission_type.value;
  let data;

  try {
    if (type === 'new_destination') {
      data = {
        name: f.name.value,
        description: f.description.value,
        category: f.category.value,
        city: f.city.value,
        estimated_cost: Number(f.estimated_cost.value || 0),
        image_url: f.image_url.value,
      };
    } else if (type === 'update_destination') {
      let fields;
      try { fields = JSON.parse(f.fields.value || '{}'); }
      catch { showToast('Perubahan harus berupa JSON yang valid.'); return false; }
      data = { destination_id: f.destination_id.value.trim(), fields };
    } else {
      data = {
        destination_id: f.destination_id.value.trim(),
        image_url: f.image_url.value || '',
        caption: f.caption.value,
      };
      if (!data.image_url) { showToast('URL gambar wajib diisi.'); return false; }
    }

    const res = await api('/api/contributor/contributions', {
      method: 'POST', body: { submission_type: type, data },
    });
    showToast(res.message);
    f.reset();
    dashTab('mine');
  } catch (err) {
    showToast(err.message);
  }
  return false;
}

async function withdrawCon(id) {
  try {
    const res = await api(`/api/contributor/contributions/${id}`, { method: 'DELETE' });
    showToast(res.message);
    VIEWS.mine();
  } catch (err) { showToast(err.message); }
}

async function submitApplication(e) {
  e.preventDefault();
  const f = e.target;
  try {
    const res = await api('/api/contributor/apply', {
      method: 'POST',
      body: {
        reason: f.reason.value,
        expertise: f.expertise.value.split(',').map((s) => s.trim()).filter(Boolean),
      },
    });
    showToast(res.message);
    loadApplicationStatus();
    f.reset();
  } catch (err) { showToast(err.message); }
  return false;
}

async function changeRole(uid, role) {
  try {
    const res = await api(`/api/admin/users/${uid}`, {
      method: 'PATCH', body: { role },
    });
    showToast(res.message);
  } catch (err) {
    showToast(err.message);
    VIEWS.users();   // muat ulang agar select kembali ke nilai asli
  }
}

async function toggleStatus(uid, current) {
  try {
    const res = await api(`/api/admin/users/${uid}`, {
      method: 'PATCH',
      body: { account_status: current === 'active' ? 'suspended' : 'active' },
    });
    showToast(res.message);
    VIEWS.users();
  } catch (err) { showToast(err.message); }
}

async function reviewApp(id, status) {
  const note = document.querySelector(`[data-note="${id}"]`)?.value || '';
  try {
    const res = await api(`/api/admin/applications/${id}/review`, {
      method: 'POST', body: { status, note },
    });
    showToast(res.message);
    VIEWS.applications();
  } catch (err) { showToast(err.message); }
}

async function reviewCon(id, status) {
  const note = document.querySelector(`[data-note="${id}"]`)?.value || '';
  try {
    const res = await api(`/api/admin/contributions/${id}/review`, {
      method: 'POST', body: { status, note },
    });
    showToast(res.message);
    VIEWS.contributions();
  } catch (err) { showToast(err.message); }
}

async function reviewRep(id, status) {
  try {
    const res = await api(`/api/admin/reports/${id}/review`, {
      method: 'POST', body: { status },
    });
    showToast(res.message);
    VIEWS.reports();
  } catch (err) { showToast(err.message); }
}

async function markRead() {
  try {
    await api('/api/notifications/read', { method: 'POST' });
    showToast('Notifikasi ditandai dibaca.');
    loadNotifications();
  } catch (err) { showToast(err.message); }
}

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------
function renderViews() {
  const items = NAVS[auth.user.role] || NAVS.explorer;
  document.getElementById('dashMain').innerHTML = `
    <h1>${esc(ROLE_LABEL[auth.user.role] || 'Dashboard')} dashboard</h1>
    <p class="sub">Selamat datang, ${esc(auth.user.full_name.split(' ')[0])}.</p>
    ${items.map(([id], i) => `
      <div class="dash-view ${i === 0 ? 'show' : ''}" id="view-${id}"></div>`).join('')}`;
}

async function boot() {
  const state = await initAuth();   // isi auth.user / auth.profile
  renderAuth();

  const gate = document.getElementById('dashGate');
  const root = document.getElementById('dashRoot');

  if (!state.user) {
    gate.hidden = false;
    root.hidden = true;
    return;
  }
  gate.hidden = true;
  root.hidden = false;

  renderNav();
  renderViews();
  dashTab((NAVS[state.user.role] || NAVS.explorer)[0][0]);
}

Object.assign(window, {
  dashTab, conTypeChanged, submitContribution, submitApplication,
  withdrawCon, changeRole, toggleStatus, reviewApp, reviewCon, reviewRep,
  markRead, doLogout, toggleUserMenu, openAuth, closeModal,
  handleLogin, handleRegister, handleForgot, resendVerification, showToast,
  get authState() { return auth; },
});

boot();
