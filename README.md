# TuinApp

A private garden planner built with Vue and TypeScript, prepared for Cloudflare Pages, D1 and R2. Manage plants, sowing and planting periods, seed orders, activities and monthly printable PDF calendars.

The Cloudflare port preserves the existing UI and PDF layout. Daily backups save changed garden data to private R2 storage; Settings lists downloadable SQL dumps and provides a validated restore flow with a recovery backup before replacement. Database migrations run before deployment with a verified recovery dump.

## Development and tests

Requires Node.js 24 or newer. Cloudflare account access is unnecessary for local testing.

```sh
npm ci
npm run check
npx playwright install chromium firefox
npm run test:e2e
```

See [Cloudflare operations](docs/cloudflare-operations.md) for local setup, initial data import, account configuration, GitHub push deployments, Gandi DNS, backups and recovery. [Migration plan](docs/plans/2026-10-12-cloudflare-migration.md) records the architecture and acceptance criteria; [verification record](docs/cloudflare-verification.md) records completed checks and production limitations. Production deployment remains disabled until account resources and credentials are configured.

## Data preservation

The original golden database is read-only and unchanged. A separate private D1-compatible copy lives in ignored `data/cloudflare-golden/`, with SQL, SQLite and a checksum manifest. Neither golden data nor secrets are committed or used by public CI. Browser tests create disposable databases.

```sh
npm run cloudflare:data -- verify-golden data/cloudflare-golden
TUINAPP_GOLDEN_DB=/absolute/path/to/db.golden.sqlite npm run test:golden
```

The old Rust implementation remains available for comparison under `server/`; it is not part of the Cloudflare build. [Historical Rust setup](docs/legacy-rust-readme.md) and previous web verification documents describe that earlier runtime.

## License

MIT
