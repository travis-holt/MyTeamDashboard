# Team Dashboard

A password-protected dashboard for team schedules, roster changes, attendance and discrepancies. The Node service reads the configured Google Sheets through public CSV links. SQLite stores team history and notes.

## Local development

Use Node 20. Install dependencies and create an environment file.

```sh
npm ci
cp .env.example .env
npm run hash-password
node -p "require('node:crypto').randomBytes(48).toString('base64url')"
```

Paste the bcrypt output into `DASHBOARD_PASSWORD_HASH` in `.env`. Set `SESSION_SECRET` to the generated random string.

```sh
npm run sync -- --job=all
npm run dev
```

Use the local Vite address printed by `npm run dev`. It proxies `/api` to port 3000. If you change the server port, update the Vite proxy to match. Fixture mode uses the checked-in synthetic CSVs by default. The sample schedule starts on October 21, 2026. For testing at another time of year, use the Playwright fixture clock or supply matching local fixture data and configure its anchor.

Environment keys live in `.env.example`. The optional `DASHBOARD_SOURCE_CONFIG` setting holds the full live config JSON as a service environment variable. Real config and SQLite data belong in private local files or the hosting service.

## Connect or replace a sheet

1. Open the intended tab and copy its view link. Check the export with `npm run test-link -- '<link>'`. It reports the HTTP status, content type, row count, mapped headers, mismatches and one interpreted sample date. Add `--source=master`, `--source=schedule` or `--source=attendance` to use the configured mapping for a new link. The schedule sample uses its configured anchor. Settings → **Check a link** shows the same diagnostics without changing configuration. Select a column mapping and optionally enter the numeric tab GID, or paste a tab-specific view link.
2. Copy `config/sources.json` to the gitignored `config/sources.local.json` for a local live run. For Railway, set `DASHBOARD_SOURCE_CONFIG` to the full JSON. Set the configured identity, IDs, GIDs and mappings. Set `dateOrder` to `DMY` for slash dates in day/month/year order. The default is `MDY`. Sheet access must be read-only and work without signing in.
3. Keep schedule on CSV export. Set `sources.schedule.anchor.column` and `sources.schedule.anchor.date` to the first date column and its Cairo date, and retain a matching `stopAtHeader`. Check the latest sync for `ANCHOR_MISMATCH`.
4. Confirm attendance column meanings and verify its CSV export before enabling it. A nonempty value from the long layout’s configured `missing` column creates a D4 finding. The parser also supports a wide layout with date columns and no separate Missing field.
5. Restart or redeploy and run **Sync now → All** in Settings. Check that the job results remain healthy and spot-check the dates against the sheet.

The roster sync runs Sundays at 12:00 Cairo. The daily schedule, attendance and discrepancy sync runs at 16:00 Cairo. The app refreshes the roster first when its last successful sync is more than seven days old.

## Railway

Deploy to a single service using Node 20. In Railway service settings, set the build command to `npm run build`, the start command to `npm start`, the healthcheck path to `/api/health`, and the restart policy to **On Failure**. Set `SOURCE_MODE=live`, `TZ=Africa/Cairo`, `DATA_DIR=/data`, both authentication variables, and `DASHBOARD_SOURCE_CONFIG`. Mount a persistent volume at `/data`. Railway supplies `PORT`. Use the Railway HTTPS domain for login and secure session cookies. The checked-in `railway.json` carries the same build and deploy settings for existing services that still use Config as Code.

The GitHub repository may remain public per the owner's instruction. Keep real source IDs, names, CSVs, notes, SQLite files, and environment values outside the repository. On first deploy, run **Sync now → All** from Settings on the authenticated dashboard, then check the sync log after two scheduled runs.

To rotate the password, generate a new hash with `npm run hash-password`, replace `DASHBOARD_PASSWORD_HASH` on the service, then redeploy. Existing sessions expire with the old hash.

## Verification

```sh
npm run lint
npm run typecheck
npm run coverage
npx playwright install chromium
npm run smoke
npm run build
```

Playwright runs against synthetic data and writes light and dark screenshots under `test-results/`. CI runs lint, typechecks and unit tests without fetching live sheets.

## Back up and restore dashboard data

Settings → **Download backup** saves a JSON file with notes, roster history, and discrepancy states and TL comments. The server also writes a nightly backup at 02:00 Africa/Cairo under `DATA_DIR/backups` (on Railway, `/data/backups`). It keeps the 14 most recent dated files. Keep downloaded copies private.

In Settings, choose a JSON file under **Restore from backup** and click **Preview restore**. Review the added, updated, and removed counts, then click **Confirm restore**. Restore replaces notes and roster history in a single transaction. It applies saved states and comments to discrepancies from the file and keeps any newer discrepancies outside the backup. After a new database is seeded, an archived discrepancy can retain its state and comment even if the source text is unavailable. Schedule and attendance remain intact.

On the machine that has the database, run `npm run backup` to save a copy. Run `npm run restore -- /path/to/backup.json` to restore immediately using the same `DATA_DIR` as the running app.

## How to map the attendance sheet

1. Identify the layout and header rows. In a long sheet, each row contains an agent code, date and status. Set `sources.attendance.layout` to `long` and map `long.columns.code`, `date`, `status`, and, if available, `name` and `missing`. Check `dateOrder` against an unambiguous slash date.
2. In a wide sheet, each row is one agent and date headers run across columns. Set `layout` to `wide` and configure `wide.keyColumn`, `keyType`, `firstDateColumn`, `dateHeaderRow`, and `dtlColumn`. Prefer code where present. With names, the parser matches a unique normalized full name. Date headers use the month and day inside the sync window because the printed year may be wrong. CSV cannot carry off-day formatting, so off days use the schedule.
3. In your local live config, fill `sheetId`, `gid`, and `headerRows`. Keep `enabled: false`. Use Settings → **Check a link** with the attendance mapping to check the CSV. Sync roster and schedule before the dry run.
4. Select **Dry-run attendance** in Settings, or run `npm run sync -- --job=attendance --dry-run` with the existing dashboard's `DATA_DIR`. Review source rows, team matches, records and dates that would be stored, sample statuses, and projected D1–D4 counts. Long sheets identify rows by code and cannot distinguish an unrecognized team code from a non-team code. A wide sheet can count unmatched rows under a configured team lead.
5. Enable attendance only after the mappings and sample results agree with the source. Validate the dashboard against the sheet for five working days as part of Phase 6 acceptance.
