/* Work Hours Tracker - stopwatch, history, edit, manual entry, Google Drive sync */
'use strict';

/* Hardcoded OAuth Client ID (public by design, restricted to office212.github.io) */
const DEFAULT_CLIENT_ID = '860448133334-4c5525pl6ok2k2mke3bgjrutmt104t0r.apps.googleusercontent.com';

/* ---------- Storage ---------- */

function getClientId() {
  return settings.clientId || DEFAULT_CLIENT_ID;
}

/* ---------- Projects ---------- */
function getProjects() {
  if (!settings.projects || !settings.projects.length) {
    settings.projects = [{ id: 'p_default', name: 'General' }];
    settings.defaultProjectId = 'p_default';
    saveSettings(settings);
  }
  // ensure default is valid
  if (!settings.projects.find(p => p.id === settings.defaultProjectId)) {
    settings.defaultProjectId = settings.projects[0].id;
    saveSettings(settings);
  }
  return settings.projects;
}

function getProject(id) {
  return getProjects().find(p => p.id === id) || getProjects()[0];
}

function getDefaultProjectId() {
  getProjects();
  return settings.defaultProjectId;
}

// migrate old sessions without projectId
function migrateSessions() {
  const defId = getDefaultProjectId();
  let changed = false;
  sessions.forEach(s => {
    if (!s.projectId) { s.projectId = defId; changed = true; }
  });
  if (changed) saveSessions(sessions);
}

let timerProjectId = null; // current selection on timer tab
function getTimerProjectId() {
  if (!timerProjectId || !getProject(timerProjectId)) {
    timerProjectId = getDefaultProjectId();
  }
  return timerProjectId;
}

let dayFilter = 'all', weekFilter = 'all', monthFilter = 'all';

function fillProjectSelect(sel, includeAll) {
  const cur = sel.value;
  sel.innerHTML = '';
  if (includeAll) {
    const o = document.createElement('option');
    o.value = 'all'; o.textContent = 'All Projects';
    sel.appendChild(o);
  }
  getProjects().forEach(p => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name + (p.id === getDefaultProjectId() ? ' ★' : '');
    sel.appendChild(o);
  });
  if (cur) sel.value = cur;
}

function refreshProjectUI() {
  fillProjectSelect($('timerProject'), false);
  $('timerProject').value = getTimerProjectId();
  fillProjectSelect($('editProject'), false);
  fillProjectSelect($('dayFilter'), true);
  $('dayFilter').value = dayFilter;
  fillProjectSelect($('weekFilter'), true);
  $('weekFilter').value = weekFilter;
  fillProjectSelect($('monthFilter'), true);
  $('monthFilter').value = monthFilter;
  fillProjectSelect($('statsFilter'), true);
  $('statsFilter').value = statsFilter;
  renderProjectList();
}

function filteredSessions(list, filter) {
  if (!filter || filter === 'all') return list;
  return list.filter(s => s.projectId === filter);
}
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
  const hasId = !!getClientId();
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
  tokenClient = makeTokenClient(getClientId());
  if (getClientId()) renderGoogleButton();
}

function renderGoogleButton() {
  const container = $('googleBtn');
  if (!container || !getClientId()) return;
  container.innerHTML = '';
  try {
    google.accounts.id.initialize({
      client_id: getClientId(),
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
        // merge sessions: cloud wins on conflict by updatedAt
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
        // merge projects and day notes
        if (Array.isArray(cloud.projects) && cloud.projects.length) {
          const existing = new Set(getProjects().map(p => p.id));
          cloud.projects.forEach(p => { if (!existing.has(p.id)) settings.projects.push(p); });
          if (cloud.defaultProjectId) settings.defaultProjectId = cloud.defaultProjectId;
        }
        if (cloud.dayNotes && typeof cloud.dayNotes === 'object') {
          settings.dayNotes = Object.assign({}, cloud.dayNotes, getDayNotes());
        }
        saveSettings(settings);
        migrateSessions();
        refreshProjectUI();
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
    const payload = JSON.stringify({
      sessions,
      projects: getProjects(),
      defaultProjectId: getDefaultProjectId(),
      dayNotes: getDayNotes(),
      exportedAt: new Date().toISOString()
    });
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

/* ---------- Projects settings UI ---------- */
function renderProjectList() {
  const box = $('projectList');
  if (!box) return;
  box.innerHTML = '';
  const defId = getDefaultProjectId();
  getProjects().forEach(p => {
    const count = sessions.filter(s => s.projectId === p.id).length;
    const totalHrs = fmtHours(sessions.filter(s => s.projectId === p.id).reduce((a, s) => a + s.seconds, 0));
    const row = document.createElement('div');
    row.className = 'project-row' + (p.id === defId ? ' is-default' : '');
    row.innerHTML =
      '<div><div class="project-name">' + escapeHtml(p.name) +
      (p.id === defId ? '<span class="default-badge">Default</span>' : '') + '</div>' +
      '<div class="project-meta">' + count + ' sessions · ' + totalHrs + ' hrs</div></div>' +
      '<div class="project-actions"></div>';
    const acts = row.querySelector('.project-actions');
    if (p.id !== defId) {
      const bDef = document.createElement('button');
      bDef.className = 'primary'; bDef.textContent = 'Set default';
      bDef.onclick = () => {
        settings.defaultProjectId = p.id;
        saveSettings(settings);
        timerProjectId = p.id;
        refreshProjectUI(); renderAll();
        toast('"' + p.name + '" is now the default project');
        drivePush();
      };
      acts.appendChild(bDef);
    }
    const bDel = document.createElement('button');
    bDel.className = 'danger'; bDel.textContent = 'Delete';
    bDel.onclick = () => deleteProject(p.id);
    acts.appendChild(bDel);
    box.appendChild(row);
  });
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t;
  return d.innerHTML;
}

function deleteProject(id) {
  const p = getProject(id);
  const count = sessions.filter(s => s.projectId === id).length;
  if (getProjects().length <= 1) { toast('Cannot delete the last project'); return; }
  const msg = count > 0
    ? 'Delete "' + p.name + '"? Its ' + count + ' sessions will move to the default project.'
    : 'Delete "' + p.name + '"?';
  if (!confirm(msg)) return;
  const defId = settings.defaultProjectId === id
    ? getProjects().find(x => x.id !== id).id
    : settings.defaultProjectId;
  sessions.forEach(s => { if (s.projectId === id) { s.projectId = defId; s.updatedAt = new Date().toISOString(); } });
  settings.projects = settings.projects.filter(x => x.id !== id);
  settings.defaultProjectId = defId;
  if (timerProjectId === id) timerProjectId = defId;
  saveSettings(settings); saveSessions(sessions);
  refreshProjectUI(); renderAll();
  toast('Project deleted');
  drivePush();
}

$('btnAddProject').onclick = () => {
  const name = $('newProjectName').value.trim();
  if (!name) { toast('Enter a project name'); return; }
  if (getProjects().some(p => p.name.toLowerCase() === name.toLowerCase())) {
    toast('A project with this name already exists'); return;
  }
  const p = { id: 'p' + Date.now(), name };
  settings.projects.push(p);
  saveSettings(settings);
  $('newProjectName').value = '';
  refreshProjectUI();
  toast('Project "' + name + '" added');
  drivePush();
};
$('newProjectName').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnAddProject').click(); });

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
  if (totalMs < 1000) { toast('Session too short to save'); return; }
  const end = new Date();
  const start = new Date(end.getTime() - totalMs);
  const session = {
    id: 's' + Date.now(),
    date: dateKey(start),
    start: start.toISOString(),
    end: end.toISOString(),
    seconds: Math.max(1, Math.round(totalMs / 1000)),
    projectId: getTimerProjectId(),
    updatedAt: new Date().toISOString()
  };
  sessions.push(session);
  saveSessions(sessions);
  swElapsed = 0; setState('idle');
  renderAll();
  toast('Session saved: ' + fmtHours(session.seconds) + ' hrs → ' + getProject(session.projectId).name);
  drivePush();
};

$('timerProject').onchange = e => { timerProjectId = e.target.value; };

/* ---------- Sessions: list, edit, delete ---------- */
function sessionRow(s) {
  const div = document.createElement('div');
  div.className = 'session';
  div.innerHTML =
    '<div class="session-time">' + fmtTime(s.start) + ' - ' + fmtTime(s.end) +
    '<span class="session-proj">' + escapeHtml(getProject(s.projectId).name) + '</span>' +
    (s.note ? '<small class="session-note">' + escapeHtml(s.note) + '</small>' : '') + '</div>' +
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
  refreshProjectUI();
  if (sessionId) {
    const s = sessions.find(x => x.id === sessionId);
    if (!s) return;
    $('modalTitle').textContent = 'Edit Session';
    $('editProject').value = s.projectId || getDefaultProjectId();
    $('editDate').value = s.date;
    $('editStart').value = fmtTimeInput(s.start);
    $('editEnd').value = fmtTimeInput(s.end);
    $('editNote').value = s.note || '';
  } else {
    $('modalTitle').textContent = 'Add Hours';
    $('editProject').value = getTimerProjectId();
    $('editDate').value = dayCursor || dateKey(new Date());
    $('editStart').value = '';
    $('editEnd').value = '';
    $('editNote').value = '';
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
  const projId = $('editProject').value || getDefaultProjectId();
  const note = $('editNote').value.trim();
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
      s.projectId = projId;
      s.note = note;
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
      projectId: projId,
      note: note,
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

/* ---------- Day notes ---------- */
function getDayNotes() {
  if (!settings.dayNotes) { settings.dayNotes = {}; saveSettings(settings); }
  return settings.dayNotes;
}

function renderDay() {
  $('dayPicker').value = dayCursor;
  const list = filteredSessions(sessionsFor(dayCursor).sort((a, b) => a.start.localeCompare(b.start)), dayFilter);
  const totalSec = list.reduce((a, s) => a + s.seconds, 0);
  $('dayTotal').textContent = fmtHours(totalSec);
  $('dayCap').textContent = fmtDateLong(dayCursor) + ' · ' + list.length + ' session' + (list.length === 1 ? '' : 's') +
    (dayFilter !== 'all' ? ' · ' + getProject(dayFilter).name : '');
  $('dayNote').value = getDayNotes()[dayCursor] || '';
  const box = $('daySessions');
  box.innerHTML = '';
  list.forEach(s => box.appendChild(sessionRow(s)));
}
$('dayPicker').onchange = e => { dayCursor = e.target.value; renderDay(); };
$('dayFilter').onchange = e => { dayFilter = e.target.value; renderDay(); };

let dayNoteTimer = null;
$('dayNote').addEventListener('input', e => {
  clearTimeout(dayNoteTimer);
  dayNoteTimer = setTimeout(() => {
    const v = e.target.value.trim();
    const notes = getDayNotes();
    if (v) notes[dayCursor] = v;
    else delete notes[dayCursor];
    saveSettings(settings);
    drivePush();
  }, 800);
});

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
  const secs = days.map(d => {
    const s = filteredSessions(sessionsFor(dateKey(d)), weekFilter).reduce((a, x) => a + x.seconds, 0);
    weekSec += s; maxSec = Math.max(maxSec, s); return s;
  });

  $('weekTotal').textContent = fmtHours(weekSec);
  const worked = secs.filter(s => s > 0).length;
  $('weekCap').textContent = worked + ' of 7 days worked' +
    (weekFilter !== 'all' ? ' · ' + getProject(weekFilter).name : '');

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
  const firstDow = new Date(y, m, 1).getDay();
  let monthSec = 0, workedDays = 0;

  // totals (respect filter)
  for (let d = 1; d <= daysIn; d++) {
    const k = y + '-' + pad(m + 1) + '-' + pad(d);
    const s = filteredSessions(sessionsFor(k), monthFilter).reduce((a, x) => a + x.seconds, 0);
    if (s > 0) { monthSec += s; workedDays++; }
  }
  $('monthTotal').textContent = fmtHours(monthSec);
  $('monthCap').textContent = workedDays + ' day' + (workedDays === 1 ? '' : 's') + ' worked' +
    (monthFilter !== 'all' ? ' · ' + getProject(monthFilter).name : '');

  // calendar grid
  const grid = $('calGrid');
  grid.innerHTML = '';
  const dowNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  dowNames.forEach(n => {
    const h = document.createElement('div');
    h.className = 'cal-dow'; h.textContent = n;
    grid.appendChild(h);
  });

  const todayK = dateKey(new Date());
  const prevDays = new Date(y, m, 0).getDate();

  // leading days from previous month
  for (let i = firstDow - 1; i >= 0; i--) {
    const cell = document.createElement('div');
    cell.className = 'cal-day other-month';
    cell.innerHTML = '<div class="dnum">' + (prevDays - i) + '</div>';
    grid.appendChild(cell);
  }
  // current month days
  for (let d = 1; d <= daysIn; d++) {
    const k = y + '-' + pad(m + 1) + '-' + pad(d);
    const s = filteredSessions(sessionsFor(k), monthFilter).reduce((a, x) => a + x.seconds, 0);
    const cell = document.createElement('div');
    cell.className = 'cal-day' + (s > 0 ? ' has-hours' : '') + (k === todayK ? ' today' : '');
    cell.innerHTML = '<div class="dnum">' + d + '</div>' +
      (s > 0 ? '<div class="dhrs">' + fmtHours(s) + 'h</div>' : '');
    if (s > 0) {
      cell.onclick = () => { dayCursor = k; switchPage('day'); };
      cell.title = fmtHours(s) + ' hours — tap to view';
    }
    grid.appendChild(cell);
  }
  // trailing days to complete the last row
  const totalCells = firstDow + daysIn;
  const trailing = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= trailing; d++) {
    const cell = document.createElement('div');
    cell.className = 'cal-day other-month';
    cell.innerHTML = '<div class="dnum">' + d + '</div>';
    grid.appendChild(cell);
  }
}
$('monthPrev').onclick = () => { monthCursor.setMonth(monthCursor.getMonth() - 1); renderMonth(); };
$('monthNext').onclick = () => { monthCursor.setMonth(monthCursor.getMonth() + 1); renderMonth(); };
$('weekFilter').onchange = e => { weekFilter = e.target.value; renderWeek(); };
$('monthFilter').onchange = e => { monthFilter = e.target.value; renderMonth(); };

/* ---------- Statistics ---------- */
let statsFilter = 'all';

function renderStats() {
  const list = filteredSessions(sessions, statsFilter);
  const totalSec = list.reduce((a, s) => a + s.seconds, 0);

  // per-day map
  const byDay = {};
  list.forEach(s => {
    byDay[s.date] = (byDay[s.date] || 0) + s.seconds;
  });
  const dayKeys = Object.keys(byDay).sort();
  const daysWorked = dayKeys.length;

  // this week / this month
  const ws = weekStart(new Date());
  const mk = dateKey(new Date()).slice(0, 7);
  let weekSec = 0, monthSec = 0;
  list.forEach(s => {
    if (parseKey(s.date) >= ws) weekSec += s.seconds;
    if (s.date.slice(0, 7) === mk) monthSec += s.seconds;
  });

  // best day
  let bestDay = null, bestSec = 0;
  dayKeys.forEach(k => { if (byDay[k] > bestSec) { bestSec = byDay[k]; bestDay = k; } });

  // streak (consecutive days ending today or yesterday)
  let streak = 0;
  const d = new Date();
  if (!byDay[dateKey(d)]) d.setDate(d.getDate() - 1);
  while (byDay[dateKey(d)]) { streak++; d.setDate(d.getDate() - 1); }

  const avgDay = daysWorked ? totalSec / daysWorked : 0;
  const avgSession = list.length ? totalSec / list.length : 0;

  const stats = [
    { val: fmtHours(totalSec), unit: 'hrs', lbl: 'Total Hours', accent: true },
    { val: fmtHours(weekSec), unit: 'hrs', lbl: 'This Week' },
    { val: fmtHours(monthSec), unit: 'hrs', lbl: 'This Month' },
    { val: fmtHours(avgDay), unit: 'hrs', lbl: 'Avg / Day' },
    { val: String(list.length), unit: '', lbl: 'Sessions' },
    { val: String(streak), unit: 'days', lbl: 'Day Streak' },
    { val: fmtHours(avgSession), unit: 'hrs', lbl: 'Avg Session' },
    { val: String(daysWorked), unit: '', lbl: 'Days Worked' }
  ];

  const grid = $('statGrid');
  grid.innerHTML = '';
  stats.forEach(st => {
    const b = document.createElement('div');
    b.className = 'stat-box' + (st.accent ? ' accent' : '');
    b.innerHTML = '<div class="stat-val">' + st.val + (st.unit ? '<small> ' + st.unit + '</small>' : '') + '</div>' +
      '<div class="stat-lbl">' + st.lbl + '</div>';
    grid.appendChild(b);
  });

  // by project bars
  const byProj = {};
  list.forEach(s => {
    const pid = s.projectId || getDefaultProjectId();
    byProj[pid] = (byProj[pid] || 0) + s.seconds;
  });
  const entries = Object.entries(byProj).sort((a, b) => b[1] - a[1]);
  const maxP = entries.length ? entries[0][1] : 1;
  const bars = $('projBars');
  bars.innerHTML = '';
  entries.forEach(([pid, sec]) => {
    const row = document.createElement('div');
    row.className = 'proj-bar-row';
    const pct = Math.max(2, Math.round((sec / maxP) * 100));
    row.innerHTML =
      '<div class="proj-bar-top"><span class="pname">' + escapeHtml(getProject(pid).name) + '</span>' +
      '<span class="phrs">' + fmtHours(sec) + ' hrs</span></div>' +
      '<div class="proj-bar-track"><div class="proj-bar-fill" style="width:' + pct + '%"></div></div>';
    bars.appendChild(row);
  });

  // highlights
  const hl = $('statHighlights');
  hl.innerHTML = '';
  const items = [];
  if (bestDay) items.push(['Best Day', parseKey(bestDay).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), fmtHours(bestSec) + ' hrs']);
  if (streak >= 2) items.push(['Current Streak', streak + ' days in a row', '']);
  // busiest weekday
  const dowSec = [0, 0, 0, 0, 0, 0, 0];
  list.forEach(s => { dowSec[parseKey(s.date).getDay()] += s.seconds; });
  const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  let bd = 0;
  dowSec.forEach((v, i) => { if (v > dowSec[bd]) bd = i; });
  if (dowSec[bd] > 0) items.push(['Busiest Weekday', dowNames[bd], fmtHours(dowSec[bd]) + ' hrs total']);
  items.forEach(([t, a, b]) => {
    const r = document.createElement('div');
    r.className = 'day-row';
    r.innerHTML = '<div class="dow">' + t + '<small>' + a + '</small></div>' +
      '<div class="hrs">' + b + '</div>';
    hl.appendChild(r);
  });
  if (!items.length) {
    hl.innerHTML = '<div class="day-row"><div class="dow">No data yet<small>Start tracking to see insights</small></div><div class="hrs zero">—</div></div>';
  }
}
$('statsFilter').onchange = e => { statsFilter = e.target.value; renderStats(); };
function switchPage(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.page === name));
  document.querySelectorAll('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  if (name === 'day') renderDay();
  if (name === 'week') renderWeek();
  if (name === 'month') renderMonth();
  if (name === 'stats') renderStats();
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => switchPage(t.dataset.page));

/* ---------- Settings / data ---------- */
/* ---------- Exports ---------- */
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function csvEsc(v) {
  v = String(v == null ? '' : v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

$('btnExport').onclick = () => {
  downloadFile('work-hours-backup.json', JSON.stringify({
    sessions,
    projects: getProjects(),
    defaultProjectId: getDefaultProjectId(),
    dayNotes: getDayNotes(),
    exportedAt: new Date().toISOString()
  }, null, 2), 'application/json');
  toast('Full backup downloaded');
};

$('btnExportHours').onclick = () => {
  const rows = [['Date', 'Project', 'Start', 'End', 'Duration (hrs)', 'Note']];
  sessions.slice().sort((a, b) => a.start.localeCompare(b.start)).forEach(s => {
    rows.push([
      s.date,
      getProject(s.projectId).name,
      fmtTime(s.start),
      fmtTime(s.end),
      fmtHours(s.seconds),
      s.note || ''
    ]);
  });
  downloadFile('work-hours.csv', rows.map(r => r.map(csvEsc).join(',')).join('\n'), 'text/csv');
  toast('Hours exported (CSV)');
};

$('btnExportNotes').onclick = () => {
  const rows = [['Date', 'Type', 'Project / Time', 'Note']];
  // day notes
  Object.keys(getDayNotes()).sort().forEach(k => {
    const n = getDayNotes()[k];
    if (n) rows.push([k, 'Day', '', n]);
  });
  // session notes
  sessions.slice().sort((a, b) => a.start.localeCompare(b.start)).forEach(s => {
    if (s.note) rows.push([s.date, 'Session', getProject(s.projectId).name + ' ' + fmtTime(s.start) + '-' + fmtTime(s.end), s.note]);
  });
  if (rows.length === 1) { toast('No notes to export'); return; }
  downloadFile('work-notes.csv', rows.map(r => r.map(csvEsc).join(',')).join('\n'), 'text/csv');
  toast('Notes exported (CSV)');
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
migrateSessions();
refreshProjectUI();
setState('idle');
renderAll();
showGate();
initGIS();
