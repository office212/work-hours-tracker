# Work Hours Tracker

A beautiful, clean stopwatch app for tracking work hours. Start, pause, stop and save sessions. Edit or manually add past hours. View totals by day, week and month. Private cloud sync via Google Drive.

## Features

- **Stopwatch**: start, pause, resume, stop and save, reset
- **Edit sessions**: tap the pencil on any session to change date and times
- **Add hours manually**: log hours already worked, any date
- **Today view**: live total plus session list
- **Daily log**: pick any date, see sessions and total
- **Weekly view**: bar chart plus per-day breakdown, navigate weeks
- **Monthly view**: per-day breakdown with monthly total, navigate months
- **Private cloud sync**: sign in with Google, data is stored in a private app-only folder in your Google Drive, synced across all devices
- **Local first**: works offline, data stored on device, exportable as JSON

## Cloud sync setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Enable the **Google Drive API** (APIs and Services > Library).
3. Create an **OAuth 2.0 Client ID** (APIs and Services > Credentials > Create Credentials), type **Web application**.
4. Under **Authorized JavaScript origins** add your hosted URL, e.g. `https://office212.github.io`.
5. Copy the Client ID, open the app, go to the **Sync** tab, paste it and tap **Sign in with Google**.
6. On every other device or browser, paste the same Client ID and sign in with the same Google account. Everything stays in sync, privately.

## Hosting

Designed for GitHub Pages. Enable Pages on the `main` branch and the app is live.
