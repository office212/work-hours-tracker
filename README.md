# Work Hours Tracker

A beautiful, clean stopwatch app for tracking work hours. Start, pause, stop and save sessions. View totals by day, week and month. Optionally sync everything to Google Sheets.

## Features

- **Stopwatch**: start, pause, resume, stop and save, reset
- **Today view**: live total plus session list with delete
- **Daily log**: pick any date, see sessions and total
- **Weekly view**: bar chart plus per-day breakdown, navigate weeks
- **Monthly view**: per-day breakdown with monthly total, navigate months
- **Google Sheets sync**: every saved session is logged to a spreadsheet with Daily, Weekly and Monthly summary tabs
- **Local first**: all data is stored on the device (localStorage), exportable as JSON

## Google Sheets setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. Enable the **Google Sheets API** (APIs and Services > Library).
3. Create an **OAuth 2.0 Client ID** (APIs and Services > Credentials > Create Credentials), type **Web application**.
4. Under **Authorized JavaScript origins** add your hosted URL, e.g. `https://office212.github.io`.
5. Copy the Client ID, open the app, go to the **Sync** tab and paste it.
6. Tap **Connect Google**. A new spreadsheet called "Work Hours Tracker" is created automatically (or paste an existing Spreadsheet ID first).
7. Every saved session syncs instantly. Tap **Sync Now** anytime for a full refresh.

## Spreadsheet layout

| Tab      | Columns                                    |
|----------|--------------------------------------------|
| Sessions | Date, Start Time, End Time, Duration (hrs) |
| Daily    | Date, Total Hours, Sessions                |
| Weekly   | Week Starting, Total Hours, Days Worked    |
| Monthly  | Month, Total Hours, Days Worked            |

## Hosting

Designed for GitHub Pages. Enable Pages on the `main` branch and the app is live.
