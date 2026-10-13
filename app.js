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

/* ---------- Supabase cloud sync ---------- */
function sbConfigured() {
  return !!(settings.sbUrl && settings.sbKey);
}

function sbHeaders() {
  return {
    'apikey': settings.sbKey,
    'Authorization': 'Bearer ' + settings.sbKey,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
}

function setSyncUI(state) {
  // state: 'off' | 'on' | 'syncing' | 'error'
  const dot = $('syncDot');
  dot.className = 'sync-dot ' + (state === 'on' ? 'on' : state === 'syncing' ? 'on' : 'off');
  const connected = state === 'on' || state === 'syncing';
  $('btnSbConnect').classList.toggle('hidden', connected);
  $('btnSbDisconnect').classList.toggle('hidden', !connected);
  const labels = {
    off: 'Not connected. Data stays on this device only.',
    on: 'Connected. Data syncs across all your devices.',
    syncing: 'Syncing...',
    error: 'Connection failed. Check URL and key.'
  };
  $('syncStatus').textContent = labels[state] || labels.off;
}

async function sbPull() {
  if (!sbConfigured()) return;
  setSyncUI('syncing');
  try {
    const r = await fetch(settings.sbUrl.replace(/\/$/, '') + '/rest/v1/sessions?select=*&order=start_time.asc', {
      headers: sbHeaders()
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    // merge: cloud wins on conflict (by updated_at)
    const byId = {};
    sessions.forEach(s => byId[s.id] = s);
    rows.forEach(row => {
      const s = {
        id: row.id,
        date: row.date,
        start: row.start_time,
        end: row.end_time,
        seconds: row.seconds,
        updatedAt: row.updated_at
      };
      const local = byId[s.id];
      if (!local || (s.updatedAt && local.updatedAt && s.updatedAt > local.updatedAt) || !local.updatedAt) {
        byId[s.id] = s;
      }
    });
    sessions = Object.values(byId).sort((a, b) => a.start.localeCompare(b.start));
    saveSessions(sessions);
    setSyncUI('on');
    renderAll();
  } catch (e) {
    console.warn('Pull failed', e);
    setSyncUI('error');
  }
}

async function sbPush(session) {
  if (!sbConfigured()) return;
  try {
    const base = settings.sbUrl.replace(/\/$/, '');
    const body = {
      id: session.id,
      date: session.date,
      start_time: session.start,
      end_time: session.end,
      seconds: session.seconds,
      updated_at: new Date().toISOString()
    };
    session.updatedAt = body.updated_at;
    const r = await fetch(base + '/rest/v1/sessions', {
      method: 'POST',
      headers: Object.assign({}, sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    saveSessions(sessions);
  } catch (e) {
    console.warn('Push failed', e);
    toast('Saved locally. Cloud sync failed.');
  }
}

async function sbDelete(id) {
  if (!sbConfigured()) return;
  try {
    const r = await fetch(settings.sbUrl.replace(/\/$/, '') + '/rest/v1/sessions?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: sbHeaders()
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
  } catch (e) {
    console.warn('Delete failed', e);
  }
}

$('btnSbConnect').onclick = async () => {
  const url = $('sbUrlInput').value.trim().replace(/\/$/, '');
  const key = $('sbKeyInput').value.trim();
  if (!url || !key) { toast('Enter both the Project URL and Anon Key'); return; }
  settings.sbUrl = url;
  settings.sbKey = key;
  saveSettings(settings);
  toast('Connecting...');
  await sbPull();
  if ($('syncDot').classList.contains('on')) toast('Connected. Data is now synced.');
};

$('btnSbDisconnect').onclick = () => {
  settings.sbUrl = '';
  settings.sbKey = '';
  saveSettings(settings);
  setSyncUI('off');
  toast('Disconnected. Data stays on this device.');
};

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
  sbPush(session);
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
    sbDelete(s.id);
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
      sbPush(s);
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
    sbPush(s);
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
  for (const id of ids) await sbDelete(id);
};

/* ---------- Init ---------- */
function renderAll() {
  renderToday();
  renderDay();
  renderWeek();
  renderMonth();
}

$('todayLabel').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
$('sbUrlInput').value = settings.sbUrl || '';
$('sbKeyInput').value = settings.sbKey || '';
setSyncUI(sbConfigured() ? 'on' : 'off');
setState('idle');
renderAll();
if (sbConfigured()) sbPull();
