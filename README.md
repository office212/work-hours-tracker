# ⏱️ Work Hours Tracker

A beautiful, clean stopwatch app for tracking work hours — on any device, in any browser.

**Live:** https://office212.github.io/work-hours-tracker/

---

## ✨ Features

### 🔐 Sign in with Google
- One-tap Google sign-in, no passwords to remember
- Redirect-based login — no popup windows, stays in the same tab
- Stays signed in across refreshes and browser restarts (until you sign out)
- Each Google account gets its own **completely private** data

### ⏱️ Stopwatch
- Start, Pause, Resume, Stop & Save, Reset
- Sessions shorter than a minute can be saved too
- Pick which **project** each session belongs to, right from the timer

### 📁 Projects
- Create unlimited projects (clients, jobs, departments…)
- Set a **default project** — the timer uses it automatically, changeable anytime
- Rename-proof: deleting a project moves its sessions to the default
- Filter every view by project

### 📝 Notes
- **Session notes** — attach a note to any session
- **Day notes** — a free-text note per day, saved automatically
- All notes are searchable in exports

### 📊 Views
| Tab | What you get |
|-----|--------------|
| **Timer** | Stopwatch + today's total and sessions |
| **Day** | Daily log with date picker, day note, edit/delete sessions |
| **Week** | Bar chart + per-day breakdown, navigate weeks |
| **Month** | Real calendar grid — tap any day to see its details |
| **Stats** | Totals, averages, day streak, per-project bars, highlights (best day, busiest weekday…) |
| **Sync** | Projects, account, data export, setup help |

### 📤 Exports
- **Hours (CSV)** — spreadsheet with date, project, start, end, duration, note
- **Notes (CSV)** — all day notes and session notes
- **Full Backup (JSON)** — everything, including projects and settings

### 💾 Private cloud sync
- Data lives in a private app-only folder in **your own Google Drive** (`appDataFolder`)
- Invisible in the Drive UI, accessible only to this app
- Sign in on another device → your hours are there
- Works offline, syncs automatically when back online

### 📱💻 Responsive
- Mobile-first design with bottom tab bar
- Desktop layout: top navigation, side-by-side timer, wider content

---

## 🛠️ How it works

1. User taps **Sign in with Google** → redirected to Google → back to the app, signed in
2. Access token is kept on the device (localStorage) for persistent sessions
3. Every change is saved to `work-hours.json` in the user's Drive `appDataFolder`
4. Sessions, projects, notes and settings all sync through that single file

## 🔧 Google Cloud setup (one-time)

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the **Google Drive API** (APIs & Services → Library)
3. Configure the **OAuth consent screen** (External type, app name, support email)
4. Create an **OAuth 2.0 Client ID** (Web application):
   - Authorized JavaScript origin: `https://office212.github.io`
   - Authorized redirect URI: `https://office212.github.io/work-hours-tracker/`
5. Publish the app to **Production** (no verification needed for the `drive.appdata` scope)
6. Add a `privacy.html` page (required by Google for publishing)
7. Embed the Client ID in `app.js` as `DEFAULT_CLIENT_ID`

## 📁 Project files

| File | Purpose |
|------|---------|
| `index.html` | App structure (login gate, tabs, modals) |
| `styles.css` | All styling, mobile + desktop |
| `app.js` | Stopwatch, projects, notes, stats, Drive sync, auth |
| `privacy.html` | Privacy policy (required by Google OAuth) |

## 🚀 Hosting

Designed for GitHub Pages. Enable Pages on the `main` branch and it's live.
Cache-busting: `index.html` references `styles.css?v=N` / `app.js?v=N` — bump `N` on every CSS/JS change.
