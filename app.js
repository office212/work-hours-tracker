/* Work Hours Tracker - stopwatch, history, edit, manual entry, Supabase cloud sync */
'use strict';

/* ---------- Storage ---------- */
const LS_SESSIONS = 'wht_sessions_v1';
const LS_SETTINGS = 'wht_settings_v1';

function loadSessions() {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS)) || []; }
  catch { return []; }
}
function saveSessions(s) { localStorage.setItem(LS_SESSIONS, JSON.stringify(s)); }

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_SETTINGS)) || {}; }
  catch { return {}; }
}
function saveSettings(s) { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); }

let sessions = loadSessions();
let settings = loadSettings();

/* ---------- Helpers ---------- */
const $ = id => document.getElementById(id);

function pad(n) { return String(n).padStart(2, '0'); }

function fmtHMS(totalSec) {
  totalSec = Math.floor(totalSec);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return pad(h) + ':' + pad(m) + ':' + pad(s);
}

function fmtHours(sec) { return (sec / 3600).toFixed(2); }

function dateKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDateLong(key) {
  return parseKey(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function fmtTimeInput(iso) {
  const d = new Date(iso);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function sessionsFor(key) { return sessions.filter(s => s.date === key); }
function totalFor(key) { return sessionsFor(key).reduce((a, s) => a + s.seconds, 0); }

function weekStart(date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Google Drive sync (private appDataFolder) ---------- */
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const DATA_FILENAME = 'work-hours.json';
let gToken = null;
let tokenClient = null;
let driveFileId = null;

function setSyncUI(state) {
  // state: 'off' | 'on' | 'syncing' | 'error'
  const dot = $('syncDot');
  if (dot) dot.className = 'sync-dot ' + (state === 'on' ? 'on' : 'off');
  const labels = {
    off: 'Not signed in.',
    on: 'Signed in. Your hours are private to your Google account.',
    syncing: 'Loading your hours...',
    error: 'Sync failed. Try signing in again.'
  };
  const info = $('accountInfo');
  if (info) info.textContent = labels[state] || labels.off;
}

function showApp() {
  $('loginGate').classList.add('hidden');
  $('mainApp').classList.remove('hidden');
}

function showGate() {
  $('mainApp').classList.add('hidden');
  $('loginGate').classList.remove('hidden');
  // show client ID field only if not configured yet
  const hasId = !!settings.clientId;
  $('clientIdField').style.display = hasId ? 'none' : '';
  if (hasId) renderGoogleButton();
}

function makeTokenClient(clientId) {
  return google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    callback: async (resp) => {
      if (resp.error) { toast('Google sign-in failed'); return; }
      gToken = resp.access_token;
      setSyncUI('syncing');
      try {
        await drivePull();
        setSyncUI('on');
        showApp();
        renderAll();
        toast('Welcome back.');
      } catch (e) {
        console.warn('Drive pull failed', e);
        setSyncUI('error');
      }
    }
  });
}

function initGIS() {
  if (typeof google === 'undefined' || !google.accounts) {
    setTimeout(initGIS, 500);
    return;
  }
  tokenClient = makeTokenClient(settings.clientId || '');
  if (settings.clientId) renderGoogleButton();
}

function renderGoogleButton() {
  const container = $('googleBtn');
  if (!container || !settings.clientId) return;
  container.innerHTML = '';
  try {
    google.accounts.id.initialize({
      client_id: settings.clientId,
      callback: () => {
        // Official sign-in complete, now authorize Drive access
        tokenClient.requestAccessToken({ prompt: 'consent' });
      }
    });
    google.accounts.id.renderButton(container, {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      width: 280
    });
  } catch (e) {
    console.warn('Google button render failed', e);
  }
}

$('btnSaveClientId').onclick = () => {
  const cid = $('clientIdInput').value.trim();
  if (!cid) { toast('Enter your Google OAuth Client ID first'); return; }
  settings.clientId = cid;
  saveSettings(settings);
  tokenClient = makeTokenClient(cid);
  $('clientIdField').style.display = 'none';
  renderGoogleButton();
  toast('Saved. Now sign in with Google.');
};

$('btnGoogleOut').onclick = () => {
  if (gToken && typeof google !== 'undefined') {
    try { google.accounts.oauth2.revoke(gToken, () => {}); } catch (e) {}
  }
  gToken = null;
  driveFileId = null;
  setSyncUI('off');
  showGate();
  toast('Signed out');
};

async function dFetch(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers, { Authorization: 'Bearer ' + gToken });
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error('Drive API ' + r.status);
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

async function drivePull() {
  if (!gToken) return;
  // find existing data file
  const q = encodeURIComponent("'" + 'appDataFolder' + "' in parents and name='" + DATA_FILENAME + "' and trashed=false");
  const list = await dFetch('https://www.googleapis.com/drive/v3/files?q=' + q + '&spaces=appDataFolder&fields=files(id,name,modifiedTime)');
  if (list.files && list.files.length) {
    driveFileId = list.files[0].id;
    const text = await dFetch('https://www.googleapis.com/drive/v3/files/' + driveFileId + '?alt=media');
    try {
      const cloud = JSON.parse(text);
      if (Array.isArray(cloud.sessions)) {
        // merge: cloud wins on conflict by updatedAt
        const byId = {};
        sessions.forEach(s => byId[s.id] = s);
        cloud.sessions.forEach(s => {
          const local = byId[s.id];
          if (!local || (s.updatedAt && local.updatedAt && s.updatedAt > local.updatedAt) || !local.updatedAt) {
            byId[s.id] = s;
          }
        });
        sessions = Object.values(byId).sort((a, b) => a.start.localeCompare(b.start));
        saveSessions(sessions);
        renderAll();
      }
    } catch (e) { console.warn('Parse cloud data failed', e); }
  }
}

let pushTimer = null;
function drivePush() {
  if (!gToken) return;
  // debounce: batch rapid changes into one upload
  clearTimeout(pushTimer);
  pushTimer = setTimeout(uploadNow, 1500);
}

async function uploadNow() {
  if (!gToken) return;
  try {
    const payload = JSON.stringify({ sessions, exportedAt: new Date().toISOString() });
    const metadata = { name: DATA_FILENAME, parents: ['appDataFolder'] };
    const boundary = 'wht' + Date.now();
    const body =
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      payload + '\r\n' +
      '--' + boundary + '--';
    let url, method;
    if (driveFileId) {
      url = 'https://www.googleapis.com/upload/drive/v3/files/' + driveFileId + '?uploadType=multipart';
      method = 'PATCH';
    } else {
      url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
      method = 'POST';
    }
    const r = await fetch(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + gToken,
        'Content-Type': 'multipart/related; boundary=' + boundary
      },
      body
    });
    if (!r.ok) throw new Error('Upload ' + r.status);
    const j = await r.json();
    driveFileId = j.id;
  } catch (e) {
    console.warn('Drive push failed', e);
  }
}

/* ---------- Stopwatch ---------- */
let swState = 'idle';
let swStart = 0;
let swElapsed = 0;
let rafId = null;

function swTotalMs() {
  return swElapsed + (swState === 'running' ? Date.now() - swStart : 0);
}

function renderTimer() {
  $('timerDisplay').textContent = fmtHMS(swTotalMs() / 1000);
}

function tick() {
  renderTimer();
  rafId = requestAnimationFrame(tick);
}

function setState(state) {
  swState = state;
  const pill = $('statusPill');
  const sub = $('timerSub');
  $('btnStart').classList.toggle('hidden', state !== 'idle');
  $('btnPause').classList.toggle('hidden', state !== 'running');
  $('btnResume').classList.toggle('hidden', state !== 'paused');
  $('btnStop').classList.toggle('hidden', state === 'idle');

  pill.className = 'status-pill';
  if (state === 'running') {
    pill.classList.add('running'); pill.textContent = 'Running';
    sub.textContent = 'Tracking your time...';
    tick();
  } else if (state === 'paused') {
    pill.classList.add('paused'); pill.textContent = 'Paused';
    sub.textContent = 'Paused. Resume or stop to save.';
    cancelAnimationFrame(rafId); renderTimer();
  } else {
    pill.textContent = 'Ready';
    sub.textContent = swElapsed > 0 ? 'Reset or start a new session' : 'Tap start to begin tracking';
    cancelAnimationFrame(rafId); renderTimer();
  }
}

$('btnStart').onclick = () => { swStart = Date.now(); setState('running'); };
$('btnPause').onclick = () => { swElapsed = swTotalMs(); setState('paused'); };
$('btnResume').onclick = () => { swStart = Date.now(); setState('running'); };
$('btnReset').onclick = () => { swElapsed = 0; setState('idle'); };

$('btnStop').onclick = async () => {
  const totalMs = swTotalMs();
  if (totalMs < 60000) { toast('Session too short to save (min 1 minute)'); return; }
  const end = new Date();
  const start = new Date(end.getTime() - totalMs);
  const session = {
    id: 's' + Date.now(),
    date: dateKey(start),
    start: start.toISOString(),
    end: end.toISOString(),
    seconds: Math.round(totalMs / 1000),
    updatedAt: new Date().toISOString()
  };
  sessions.push(session);
  saveSessions(sessions);
  swElapsed = 0; setState('idle');
  renderAll();
  toast('Session saved: ' + fmtHours(session.seconds) + ' hrs');
  drivePush();
};

/* ---------- Sessions: list, edit, delete ---------- */
function sessionRow(s) {
  const div = document.createElement('div');
  div.className = 'session';
  div.innerHTML =
    '<div class="session-time">' + fmtTime(s.start) + ' - ' + fmtTime(s.end) + '</div>' +
    '<div class="session-actions">' +
    '<div class="session-dur">' + fmtHours(s.seconds) + 'h</div>' +
    '<button class="session-edit" data-id="' + s.id + '" title="Edit">✎</button>' +
    '<button class="session-del" data-id="' + s.id + '" title="Delete">×</button>' +
    '</div>';
  div.querySelector('.session-edit').onclick = e => { e.stopPropagation(); openModal(s.id); };
  div.querySelector('.session-del').onclick = e => {
    e.stopPropagation();
    if (!confirm('Delete this session?')) return;
    sessions = sessions.filter(x => x.id !== s.id);
    saveSessions(sessions);
    renderAll();
    toast('Session deleted');
    drivePush();
  };
  return div;
}

function renderToday() {
  const key = dateKey(new Date());
  const list = sessionsFor(key).sort((a, b) => a.start.localeCompare(b.start));
  $('todayTotal').textContent = fmtHours(totalFor(key));
  const box = $('todaySessions');
  box.innerHTML = '';
  list.forEach(s => box.appendChild(sessionRow(s)));
}

/* ---------- Edit / Add modal ---------- */
let editingId = null;

function openModal(sessionId) {
  editingId = sessionId || null;
  if (sessionId) {
    const s = sessions.find(x => x.id === sessionId);
    if (!s) return;
    $('modalTitle').textContent = 'Edit Session';
    $('editDate').value = s.date;
    $('editStart').value = fmtTimeInput(s.start);
    $('editEnd').value = fmtTimeInput(s.end);
  } else {
    $('modalTitle').textContent = 'Add Hours';
    $('editDate').value = dayCursor || dateKey(new Date());
    $('editStart').value = '';
    $('editEnd').value = '';
  }
  updateModalDur();
  $('modalBackdrop').classList.remove('hidden');
}

function closeModal() {
  $('modalBackdrop').classList.add('hidden');
  editingId = null;
}

function updateModalDur() {
  const d = $('editDate').value, st = $('editStart').value, en = $('editEnd').value;
  if (d && st && en) {
    const start = new Date(d + 'T' + st);
    const end = new Date(d + 'T' + en);
    const sec = Math.round((end - start) / 1000);
    $('editDur').textContent = sec > 0 ? 'Duration: ' + fmtHours(sec) + ' hrs' : 'End time must be after start time';
  } else {
    $('editDur').textContent = '';
  }
}

['editDate', 'editStart', 'editEnd'].forEach(id => $(id).addEventListener('input', updateModalDur));

$('btnModalCancel').onclick = closeModal;
$('modalBackdrop').onclick = e => { if (e.target === $('modalBackdrop')) closeModal(); };

$('btnModalSave').onclick = () => {
  const d = $('editDate').value, st = $('editStart').value, en = $('editEnd').value;
  if (!d || !st || !en) { toast('Fill in date, start and end time'); return; }
  const start = new Date(d + 'T' + st);
  const end = new Date(d + 'T' + en);
  const sec = Math.round((end - start) / 1000);
  if (sec <= 0) { toast('End time must be after start time'); return; }

  if (editingId) {
    const s = sessions.find(x => x.id === editingId);
    if (s) {
      s.date = d;
      s.start = start.toISOString();
      s.end = end.toISOString();
      s.seconds = sec;
      s.updatedAt = new Date().toISOString();
      drivePush();
      toast('Session updated');
    }
  } else {
    const s = {
      id: 's' + Date.now(),
      date: d,
      start: start.toISOString(),
      end: end.toISOString(),
      seconds: sec,
      updatedAt: new Date().toISOString()
    };
    sessions.push(s);
    drivePush();
    toast('Hours added: ' + fmtHours(sec) + ' hrs');
  }
  saveSessions(sessions);
  closeModal();
  renderAll();
};

$('btnAddManual').onclick = () => openModal(null);
$('btnAddManualDay').onclick = () => openModal(null);

/* ---------- Day page ---------- */
let dayCursor = dateKey(new Date());

function renderDay() {
  $('dayPicker').value = dayCursor;
  const list = sessionsFor(dayCursor).sort((a, b) => a.start.localeCompare(b.start));
  $('dayTotal').textContent = fmtHours(totalFor(dayCursor));
  $('dayCap').textContent = fmtDateLong(dayCursor) + ' · ' + list.length + ' session' + (list.length === 1 ? '' : 's');
  const box = $('daySessions');
  box.innerHTML = '';
  list.forEach(s => box.appendChild(sessionRow(s)));
}
$('dayPicker').onchange = e => { dayCursor = e.target.value; renderDay(); };

/* ---------- Week page ---------- */
let weekCursor = weekStart(new Date());

function renderWeek() {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekCursor);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  const end = new Date(weekCursor); end.setDate(end.getDate() + 6);
  const isThisWeek = dateKey(weekStart(new Date())) === dateKey(weekCursor);
  $('weekLabel').textContent = isThisWeek ? 'This Week' :
    weekCursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' - ' +
    end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  let weekSec = 0, maxSec = 1;
  const secs = days.map(d => { const s = totalFor(dateKey(d)); weekSec += s; maxSec = Math.max(maxSec, s); return s; });

  $('weekTotal').textContent = fmtHours(weekSec);
  const worked = secs.filter(s => s > 0).length;
  $('weekCap').textContent = worked + ' of 7 days worked';

  const chart = $('weekChart');
  chart.innerHTML = '';
  const dowNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const todayK = dateKey(new Date());
  days.forEach((d, i) => {
    const col = document.createElement('div');
    col.className = 'bar-col' + (dateKey(d) === todayK ? ' today' : '');
    const h = Math.max(3, Math.round((secs[i] / maxSec) * 100));
    col.innerHTML = '<div class="bar" style="height:' + h + '%" title="' + fmtHours(secs[i]) + ' hrs"></div><div class="bar-lbl">' + dowNames[i] + '</div>';
    chart.appendChild(col);
  });

  const rows = $('weekRows');
  rows.innerHTML = '';
  days.forEach((d, i) => {
    const k = dateKey(d);
    const r = document.createElement('div');
    r.className = 'day-row' + (k === todayK ? ' today' : '');
    r.innerHTML = '<div class="dow">' + d.toLocaleDateString('en-US', { weekday: 'long' }) +
      '<small>' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</small></div>' +
      '<div class="hrs' + (secs[i] === 0 ? ' zero' : '') + '">' + (secs[i] === 0 ? '—' : fmtHours(secs[i]) + ' hrs') + '</div>';
    r.style.cursor = 'pointer';
    r.onclick = () => { dayCursor = k; switchPage('day'); };
    rows.appendChild(r);
  });
}
$('weekPrev').onclick = () => { weekCursor.setDate(weekCursor.getDate() - 7); renderWeek(); };
$('weekNext').onclick = () => { weekCursor.setDate(weekCursor.getDate() + 7); renderWeek(); };

/* ---------- Month page ---------- */
let monthCursor = new Date(); monthCursor.setDate(1);

function renderMonth() {
  $('monthLabel').textContent = monthCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const y = monthCursor.getFullYear(), m = monthCursor.getMonth();
  const daysIn = new Date(y, m + 1, 0).getDate();
  let monthSec = 0, workedDays = 0;
  const rows = $('monthRows');
  rows.innerHTML = '';
  const todayK = dateKey(new Date());
  for (let d = 1; d <= daysIn; d++) {
    const k = y + '-' + pad(m + 1) + '-' + pad(d);
    const s = totalFor(k);
    if (s > 0) { monthSec += s; workedDays++; }
    const dt = new Date(y, m, d);
    const r = document.createElement('div');
    r.className = 'day-row' + (k === todayK ? ' today' : '');
    r.innerHTML = '<div class="dow">' + dt.toLocaleDateString('en-US', { weekday: 'short' }) +
      '<small>' + dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '</small></div>' +
      '<div class="hrs' + (s === 0 ? ' zero' : '') + '">' + (s === 0 ? '—' : fmtHours(s) + ' hrs') + '</div>';
    if (s > 0) { r.style.cursor = 'pointer'; r.onclick = () => { dayCursor = k; switchPage('day'); }; }
    rows.appendChild(r);
  }
  $('monthTotal').textContent = fmtHours(monthSec);
  $('monthCap').textContent = workedDays + ' day' + (workedDays === 1 ? '' : 's') + ' worked';
}
$('monthPrev').onclick = () => { monthCursor.setMonth(monthCursor.getMonth() - 1); renderMonth(); };
$('monthNext').onclick = () => { monthCursor.setMonth(monthCursor.getMonth() + 1); renderMonth(); };

/* ---------- Navigation ---------- */
function switchPage(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === name));
  document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  if (name === 'day') renderDay();
  if (name === 'week') renderWeek();
  if (name === 'month') renderMonth();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchPage(t.dataset.page));

/* ---------- Settings / data ---------- */
$('btnExport').onclick = () => {
  const blob = new Blob([JSON.stringify(sessions, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'work-hours-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup downloaded');
};

$('btnClear').onclick = async () => {
  if (!confirm('Delete ALL sessions on this device? This cannot be undone.')) return;
  const ids = sessions.map(s => s.id);
  sessions = [];
  saveSessions(sessions);
  renderAll();
  toast('All data cleared');
  drivePush();
};

/* ---------- Init ---------- */
function renderAll() {
  renderToday();
  renderDay();
  renderWeek();
  renderMonth();
}

$('todayLabel').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
$('clientIdInput').value = settings.clientId || '';
setState('idle');
renderAll();
showGate();
initGIS();
