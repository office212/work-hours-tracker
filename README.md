# Work Hours Tracker

A beautiful, clean stopwatch app for tracking work hours. Start, pause, stop and save sessions. Edit or manually add past hours. View totals by day, week and month. Private per-account cloud storage via Google Drive.

## Features

- **Login gate**: no access without Sign in with Google (official Google button)
- **Private by design**: each Google account sees only its own hours, stored in a private app-only folder in the user's Google Drive (no one else can access it)
- **Stopwatch**: start, pause, resume, stop and save, reset
- **Edit sessions**: tap the pencil on any session to change date and times
- **Add hours manually**: log hours already worked, any date
- **Today view**: live total plus session list
- **Daily log**: pick any date, see sessions and total
- **Weekly view**: bar chart plus per-day breakdown, navigate weeks
- **Monthly view**: per-day breakdown with monthly total, navigate months
- **Works everywhere**: sign in on any device or browser, your hours follow you
- **Local first**: works offline, data cached on device, exportable as JSON

## How it works

1. The user opens the site and taps **Sign in with Google**.
2. The app reads/writes a single `work-hours.json` file in the user's private Drive `appDataFolder` (invisible in Drive, accessible only to this app).
3. Every change is uploaded automatically. Signing in on another device downloads the same data.

## Google Cloud setup (one time)

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Drive API** (APIs and Services > Library).
3. Configure the **OAuth consent screen** (External, app name, support email).
4. Create an **OAuth 2.0 Client ID** (Web application) with authorized JavaScript origin `https://office212.github.io`.
5. Publish the app to **Production** (no verification needed for the `drive.appdata` scope).
6. Embed the Client ID in `app.js` as `DEFAULT_CLIENT_ID`.

## Hosting

Designed for GitHub Pages. Enable Pages on the `main` branch and the app is live at `https://office212.github.io/work-hours-tracker/`.
