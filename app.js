/* Work Hours Tracker - stopwatch, history and Google Sheets sync */
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

function sessionsFor(key) { return sessions.filter(s => s.date === key); }
function totalFor(key) { return sessionsFor(key).reduce((a, s) => a + s.seconds, 0); }

function weekStart(date) { // Sunday
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Stopwatch ---------- */
let swState = 'idle'; // idle | running | paused
let swStart = 0;      // timestamp when current run started
let swElapsed = 0;    // accumulated ms before current run
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
  $('btnReset').disabled = (state === 'idle' && swElapsed === 0);

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
  if (totalMs < 1000) { toast('Session too short to save'); return; }
  const end = new Date();
  const start = new Date(end.getTime() - totalMs);
  const session = {
    id: 's' + Date.now(),
    date: dateKey(start),
    start: start.toISOString(),
    end: end.toISOString(),
    seconds: Math.round(totalMs / 1000)
  };
  sessions.push(session);
  saveSessions(sessions);
  swElapsed = 0; setState('idle');
  renderAll();
  toast('Session saved: ' + fmtHours(session.seconds) + ' hrs');
  try { await syncSession(session); } catch (e) { console.warn('Sheet sync failed', e); }
};

/* ---------- Session list rendering ---------- */
function sessionRow(s, showDate) {
  const div = document.createElement('div');
  div.className = 'session';
  div.innerHTML =
    '<div class="session-time">' + fmtTime(s.start) + ' - ' + fmtTime(s.end) +
    (showDate ? '<small>' + fmtDateLong(s.date) + '</small>' : '') + '</div>' +
    '<div style="display:flex;align-items:center;gap:6px">' +
    '<div class="session-dur">' + fmtHours(s.seconds) + 'h</div>' +
    '<button class="session-del" data-id="' + s.id + '" title="Delete">×</button>' +
    '</div>';
  div.querySelector('.session-del').onclick = async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this session?')) return;
    sessions = sessions.filter(x => x.id !== s.id);
    saveSessions(sessions);
    renderAll();
    toast('Session deleted');
    try { await fullSync(); } catch (err) { console.warn('Sheet re-sync failed', err); }
  };
  return div;
}

function renderToday() {
  const key = dateKey(new Date());
  const list = sessionsFor(key).sort((a, b) => a.start.localeCompare(b.start));
  $('todayTotal').textContent = fmtHours(totalFor(key));
  const box = $('todaySessions');
  box.innerHTML = '';
  list.forEach(s => box.appendChild(sessionRow(s, false)));
}

/* ---------- Day page ---------- */
let dayCursor = dateKey(new Date());

function renderDay() {
  $('dayPicker').value = dayCursor;
  const list = sessionsFor(dayCursor).sort((a, b) => a.start.localeCompare(b.start));
  $('dayTotal').textContent = fmtHours(totalFor(dayCursor));
  $('dayCap').textContent = fmtDateLong(dayCursor) + ' · ' + list.length + ' session' + (list.length === 1 ? '' : 's');
  const box = $('daySessions');
  box.innerHTML = '';
  list.forEach(s => box.appendChild(sessionRow(s, false)));
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

$('btnClear').onclick = () => {
  if (!confirm('Delete ALL sessions on this device? This cannot be undone.')) return;
  sessions = [];
  saveSessions(sessions);
  renderAll();
  toast('All data cleared');
};

/* ---------- Google Sheets sync ---------- */
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
let gToken = null;
let tokenClient = null;

function setSyncUI(connected) {
  $('syncDot').className = 'sync-dot ' + (connected ? 'on' : 'off');
  $('btnGoogle').classList.toggle('hidden', connected);
  $('btnDisconnect').classList.toggle('hidden', !connected);
  $('btnSyncNow').disabled = !connected;
  $('sheetLink').classList.toggle('hidden', !(connected && settings.sheetId));
  if (connected && settings.sheetId) {
    $('sheetLink').href = 'https://docs.google.com/spreadsheets/d/' + settings.sheetId;
  }
  $('syncStatus').textContent = connected
    ? 'Connected' + (settings.sheetId ? ' · Sheet linked' : '')
    : 'Not connected';
}

function initGIS() {
  if (typeof google === 'undefined' || !google.accounts) {
    setTimeout(initGIS, 500);
    return;
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: settings.clientId || '',
    scope: SHEETS_SCOPE,
    callback: async (resp) => {
      if (resp.error) { toast('Google auth failed'); return; }
      gToken = resp.access_token;
      try {
        await ensureSheet();
        setSyncUI(true);
        toast('Connected to Google Sheets');
        await fullSync();
      } catch (e) {
        console.error(e);
        toast('Sheet setup failed: ' + (e.message || e));
      }
    }
  });
}

$('btnGoogle').onclick = () => {
  const cid = $('clientIdInput').value.trim();
  const sid = $('sheetIdInput').value.trim();
  if (!cid) { toast('Enter your Google OAuth Client ID first'); return; }
  settings.clientId = cid;
  if (sid) settings.sheetId = sid;
  saveSettings(settings);
  tokenClient.requestAccessToken({ prompt: 'consent' });
};

$('btnDisconnect').onclick = () => {
  if (gToken && typeof google !== 'undefined') google.accounts.oauth2.revoke(gToken, () => {});
  gToken = null;
  setSyncUI(false);
  toast('Disconnected');
};

$('btnSyncNow').onclick = async () => {
  if (!gToken) { toast('Connect Google first'); return; }
  $('btnSyncNow').disabled = true;
  try { await fullSync(); toast('Synced to Google Sheets'); }
  catch (e) { toast('Sync failed: ' + (e.message || e)); }
  $('btnSyncNow').disabled = false;
};

async function gfetch(url, opts) {
  opts = opts || {};
  opts.headers = Object.assign({}, opts.headers, { Authorization: 'Bearer ' + gToken });
  const r = await fetch(url, opts);
  if (!r.ok) {
    const t = await r.text();
    throw new Error('Google API ' + r.status + ': ' + t.slice(0, 120));
  }
  return r.json();
}

const SHEET_TABS = ['Sessions', 'Daily', 'Weekly', 'Monthly'];
const HEADERS = {
  Sessions: ['Date', 'Start Time', 'End Time', 'Duration (hrs)'],
  Daily: ['Date', 'Total Hours', 'Sessions'],
  Weekly: ['Week Starting', 'Total Hours', 'Days Worked'],
  Monthly: ['Month', 'Total Hours', 'Days Worked']
};

async function ensureSheet() {
  if (!settings.sheetId) {
    const r = await gfetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { title: 'Work Hours Tracker' },
        sheets: SHEET_TABS.map(t => ({ properties: { title: t } }))
      })
    });
    settings.sheetId = r.spreadsheetId;
    saveSettings(settings);
    $('sheetIdInput').value = settings.sheetId;
  } else {
    // make sure all tabs exist
    const meta = await gfetch('https://sheets.googleapis.com/v4/spreadsheets/' + settings.sheetId + '?fields=sheets.properties.title');
    const have = meta.sheets.map(s => s.properties.title);
    const missing = SHEET_TABS.filter(t => !have.includes(t));
    if (missing.length) {
      await gfetch('https://sheets.googleapis.com/v4/spreadsheets/' + settings.sheetId + ':batchUpdate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: missing.map(t => ({ addSheet: { properties: { title: t } } })) })
      });
    }
  }
  // write headers if first row empty
  for (const tab of SHEET_TABS) {
    const v = await gfetch('https://sheets.googleapis.com/v4/spreadsheets/' + settings.sheetId +
      '/values/' + encodeURIComponent(tab) + '!A1:D1');
    if (!v.values || !v.values.length) {
      await gfetch('https://sheets.googleapis.com/v4/spreadsheets/' + settings.sheetId +
        '/values/' + encodeURIComponent(tab) + '!A1:D1?valueInputOption=RAW', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [HEADERS[tab]] })
      });
    }
  }
}

function weekKeyFor(key) { return dateKey(weekStart(parseKey(key))); }
function monthKeyFor(key) { const d = parseKey(key); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }

async function upsertRow(tab, key, row) {
  const sid = settings.sheetId;
  const col = await gfetch('https://sheets.googleapis.com/v4/spreadsheets/' + sid +
    '/values/' + encodeURIComponent(tab) + '!A2:A');
  const keys = (col.values || []).map(r => r[0]);
  const idx = keys.indexOf(key);
  const range = encodeURIComponent(tab) + '!A' + (idx >= 0 ? idx + 2 : keys.length + 2) + ':D' + (idx >= 0 ? idx + 2 : keys.length + 2);
  const method = idx >= 0 ? 'PUT' : 'POST';
  const url = 'https://sheets.googleapis.com/v4/spreadsheets/' + sid + '/values/' + range +
    (idx >= 0 ? '?valueInputOption=USER_ENTERED' : ':append?valueInputOption=USER_ENTERED');
  await gfetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] })
  });
}

function aggregate() {
  const byDay = {}, byWeek = {}, byMonth = {};
  sessions.forEach(s => {
    const dk = s.date, wk = weekKeyFor(dk), mk = monthKeyFor(dk);
    byDay[dk] = byDay[dk] || { sec: 0, n: 0 };
    byDay[dk].sec += s.seconds; byDay[dk].n++;
    byWeek[wk] = byWeek[wk] || { sec: 0, days: new Set() };
    byWeek[wk].sec += s.seconds; byWeek[wk].days.add(dk);
    byMonth[mk] = byMonth[mk] || { sec: 0, days: new Set() };
    byMonth[mk].sec += s.seconds; byMonth[mk].days.add(dk);
  });
  return { byDay, byWeek, byMonth };
}

async function syncSession(s) {
  if (!gToken || !settings.sheetId) return;
  const sid = settings.sheetId;
  await gfetch('https://sheets.googleapis.com/v4/spreadsheets/' + sid + '/values/Sessions!A:D:append?valueInputOption=USER_ENTERED', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[s.date, fmtTime(s.start), fmtTime(s.end), fmtHours(s.seconds)]] })
  });
  const { byDay, byWeek, byMonth } = aggregate();
  const d = byDay[s.date];
  await upsertRow('Daily', s.date, [s.date, fmtHours(d.sec), d.n]);
  const wk = weekKeyFor(s.date), w = byWeek[wk];
  await upsertRow('Weekly', wk, [wk, fmtHours(w.sec), w.days.size]);
  const mk = monthKeyFor(s.date), mo = byMonth[mk];
  await upsertRow('Monthly', mk, [mk, fmtHours(mo.sec), mo.days.size]);
}

async function fullSync() {
  if (!gToken || !settings.sheetId) return;
  const { byDay, byWeek, byMonth } = aggregate();
  for (const k of Object.keys(byDay).sort()) {
    const d = byDay[k];
    await upsertRow('Daily', k, [k, fmtHours(d.sec), d.n]);
  }
  for (const k of Object.keys(byWeek).sort()) {
    const w = byWeek[k];
    await upsertRow('Weekly', k, [k, fmtHours(w.sec), w.days.size]);
  }
  for (const k of Object.keys(byMonth).sort()) {
    const m = byMonth[k];
    await upsertRow('Monthly', k, [k, fmtHours(m.sec), m.days.size]);
  }
}

/* ---------- Init ---------- */
function renderAll() {
  renderToday();
  renderDay();
  renderWeek();
  renderMonth();
}

$('todayLabel').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
$('clientIdInput').value = settings.clientId || '';
$('sheetIdInput').value = settings.sheetId || '';
setSyncUI(false);
setState('idle');
renderAll();
initGIS();
