# Work Hours Tracker

A beautiful, clean stopwatch app for tracking work hours. Start, pause, stop and save sessions. Edit or manually add past hours. View totals by day, week and month. Sync across all devices via Supabase.

## Features

- **Stopwatch**: start, pause, resume, stop and save, reset
- **Edit sessions**: tap the pencil on any session to change date and times
- **Add hours manually**: log hours already worked, any date
- **Today view**: live total plus session list
- **Daily log**: pick any date, see sessions and total
- **Weekly view**: bar chart plus per-day breakdown, navigate weeks
- **Monthly view**: per-day breakdown with monthly total, navigate months
- **Cloud sync**: Supabase backend keeps every device and browser in sync
- **Local first**: works offline, data stored on device, exportable as JSON

## Cloud sync setup (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run:
   ```sql
   create table sessions (
     id text primary key,
     date text not null,
     start_time timestamptz not null,
     end_time timestamptz not null,
     seconds integer not null,
     updated_at timestamptz default now()
   );
   ```
3. Disable Row Level Security on the `sessions` table (or add an open policy).
4. Copy the **Project URL** and **anon key** from Project Settings.
5. Open the app, go to the **Sync** tab, paste both, tap **Connect & Sync**.
6. Repeat step 5 on every device or browser. All data stays in sync.

## Hosting

Designed for GitHub Pages. Enable Pages on the `main` branch and the app is live.
