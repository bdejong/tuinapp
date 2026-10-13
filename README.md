# TuinApp

A private garden planner built with Vue and TypeScript, prepared for Cloudflare Pages, D1 and R2. Manage plants, sowing and planting periods, seed orders, activities and monthly printable PDF calendars.

The Cloudflare port preserves the existing UI and PDF layout. Daily backups save changed garden data to private R2 storage; Settings lists downloadable SQL dumps. Restoration is an operator-only shell utility, with a verified recovery backup before replacement. Database migrations run before deployment with a verified recovery dump.

## Development and tests

Requires Node.js 24 or newer. Cloudflare account access is unnecessary for local testing.

```sh
npm ci
npm run check
npx playwright install chromium firefox
npm run test:e2e
```

See [Cloudflare operations](docs/cloudflare-operations.md) for local setup, account configuration, GitHub push deployments, Gandi DNS, backups and recovery. [Migration plan](docs/plans/2026-10-12-cloudflare-migration.md) records the current architecture and status; [verification record](docs/cloudflare-verification.md) records completed checks and remaining production limitations. Production resources, HTTPS and GitHub deployment credentials are configured; pushes to `main` run the deployment workflow.

Garden data stays in the configured D1 database and private R2 backups. Settings provides downloadable application dumps; restore them with the operator utility documented in [Cloudflare operations](docs/cloudflare-operations.md). Browser and backend tests use disposable synthetic data.

## License

MIT
