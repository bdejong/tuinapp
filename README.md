# TuinApp

A private garden website for desktop screens. Manage plants, sowing and planting periods, seed orders, garden activities, and monthly plans. The browser connects to one small Rust server with a persistent SQLite database. No desktop application needs to stay open once the server is hosted.

Plant Overview shades the current half-month (days 1–15, then day 16 onwards). Use **Show → Active in [month]** to see only plants with sowing or planting planned in that month. The Activities list includes a Months column.

The obsolete desktop application, setup files and starter assets have been removed. The [original Tauri source](https://github.com/bdejong/tuinapp/tree/ea57931e1fac7619717d7df1be0db47a25a51673/src-tauri) remains available in Git history. The web application has no photo or spreadsheet-import feature.

## Run locally

Requires Node.js 24+ and Rust 1.99+ (the toolchain used for validation). On the current workstation, `scripts/cargo.mjs` also recognizes the isolated Rust toolchain installed for this migration.

```sh
npm ci
npm run build
```

On the current workstation, `data/tuinapp.sqlite` has already been imported and backed up; skip the import step and choose your owner password below. On another machine, create a **new** web database by importing a preserved legacy copy:

```sh
npm run server -- import \
  --source /absolute/path/to/legacy-copy.sqlite \
  --database data/tuinapp.sqlite
```

Import opens the source read-only, preserves IDs, timestamps, notes, legacy attachments and period flags, and publishes the new database only after validation. It refuses to replace an existing destination. Do not use the golden file as the server's live database. To start an empty garden instead, use `npm run server -- init --database data/tuinapp.sqlite`.

Generate an owner password hash interactively, then supply that hash to the server. There is no default owner password. Keep the single quotes around a hash because it contains dollar signs.

```sh
npm run server -- hash-password
export TUINAPP_PASSWORD_HASH='paste-the-generated-argon2-hash-here'
npm run server -- serve
```

Open http://127.0.0.1:3000 and sign in with the password you chose. The default server binds only to this computer. For frontend development, run `npm run dev` separately and set `TUINAPP_PUBLIC_ORIGIN=http://127.0.0.1:5173` on the backend. Password changes or server restarts invalidate sessions; an expired session preserves an open browser form for sign-in and retry.

## Printable calendar

Choose a month in Calendar and click **Printable PDF**. Open the downloaded file to print it. It keeps the original desktop application's minimal three-column layout, type sizes and spacing. Black-and-white vector symbols show full sun (sun), half sun (sun behind a cloud) and shade (cloud). The app uses yellow suns and grey clouds with the same shapes; the PDF remains black and white. Numbered references replace `(N)` and link to a compact notes section. Each distinct note is printed once, with line breaks and repeated whitespace collapsed. Long lists and notes continue onto another page when needed.

## Data and backups

- Garden data: `data/tuinapp.sqlite`; all runtime data and credentials are ignored by Git.
- Automatic backups run hourly on the server, independently of browser sessions. Startup and migrations also create verified snapshots.
- Settings shows the last successful backup, failures, overdue status, manual backup, recovery testing, and a downloadable ZIP containing the database and its checksum manifest.
- Retention keeps the newest 48 scheduled snapshots, 30 daily points and 12 monthly points. Manual and pre-migration/pre-import recovery points are not automatically pruned.
- Local backups do **not** protect against loss of the server. Independent encrypted storage, failure alerts and restore drills must be configured when hosting is selected.

See [operations and recovery](docs/web-operations.md) for deployment, configuration, upgrades and restoration. See the [original assessment](docs/plans/2026-10-12-web-migration-assessment.md) for the legacy audit and [verification record](docs/web-verification.md) for coverage and known limits.

## Tests

```sh
npm run check
npx playwright install chromium firefox
npm run test:e2e
```

The browser runner creates its own temporary database, server and test-only password on loopback. It removes that data afterwards. Tests never run against `data/tuinapp.sqlite`.

Private golden data is deliberately not committed or sent to CI. To verify the preserved file locally:

```sh
TUINAPP_GOLDEN_DB=/absolute/path/to/db.golden.sqlite npm run test:golden
TUINAPP_GOLDEN_DB=/absolute/path/to/db.golden.sqlite npm run test:e2e
```

The golden regression compares every original field, all 12 calendar months, IDs and reorder flags through import, reopening, backup and restore, and checks the source SHA-256 before and after. Browser tests additionally load the 177 plants, 9 activities and 17 reorder records. Historical synthetic fixtures include legacy attachments, duplicate names, absent categories, older schemas, and failed migrations.

CI runs build/type checks, frontend component tests, Rust tests, formatting/lint checks, and Chromium/Firefox/WebKit browser tests. Locally, add WebKit with `npx playwright install webkit` and `TUINAPP_TEST_WEBKIT=1 npm run test:e2e` on a supported OS. The current workstation's frozen macOS 14 WebKit build cannot launch with the current Playwright driver; this is a test-environment limitation.

## Run with Docker

Only Docker with Compose is needed on the host; Node and Rust compile inside the image.

```sh
cp .env.example .env
docker compose build
docker compose run --rm tuinapp hash-password
```

Put the generated hash in `.env`, keeping its single quotes, and set `TUINAPP_PUBLIC_ORIGIN` to the browser URL. For an **empty** garden, initialize the new volume once:

```sh
docker compose run --rm tuinapp init --database /app/data/tuinapp.sqlite
docker compose up -d
```

To reuse the reference garden, follow the [read-only legacy-copy import steps](docs/web-operations.md#first-container-startup) instead of `init`. An existing working web database should be transferred using a verified backup and the restore command. Initialization/import never overwrites an existing database. `docker compose down` preserves the data and backup volumes; `down -v` deletes them.

The service uses separate persistent data and backup volumes, a non-root user, a read-only root filesystem, and a health check. `TUINAPP_PORT` changes the host port (default 3000); update `TUINAPP_PUBLIC_ORIGIN` to match. The build context includes only application sources and manifests, excluding garden data, credentials, screenshots and backups.

The **Build and test container** GitHub Actions workflow builds and runs native Linux AMD64 and ARM64 images on pushes, pull requests and manual runs. It tests startup, login, writes, PDF generation, backups, recovery and persistence after restart using temporary volumes. Images are validated in CI; no registry publishing or hosting is configured.

To run the same container check locally:

```sh
docker build -t tuinapp:test .
npm run test:container
# Optional private regression, always copied into disposable Docker volumes:
TUINAPP_GOLDEN_DB=/absolute/path/to/db.golden.sqlite npm run test:container
```

See [operations and recovery](docs/web-operations.md) before first use and [hosting options](docs/hosting-options.md) for the shared-server plan.

## License

MIT
