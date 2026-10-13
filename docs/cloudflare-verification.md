# Cloudflare verification record

Verified locally on 12 October 2026. Implementation was delegated to GPT-6 Luna; GPT-6 Astra reviewed the application, data safety, rendering and deployment code. Production account, DNS and billing checks await Cloudflare access. No remote database or DNS record has been changed.

## Checks completed

- Production Vue build and strict frontend/Cloudflare TypeScript checks pass.
- Backend, data, migration, PDF and release tests pass (59 cases; the private golden test is skipped in public CI); UI tests pass (129 cases).
- Chromium and Firefox browser tests against a disposable empty D1/R2 environment: **68 passed, 2 golden-only tests skipped**.
- Chromium and Firefox browser tests against a disposable golden-data D1/R2 environment: **70 passed**. This includes authenticated browser PDF generation, actual SQL download/upload restoration, malformed-upload nonmutation, and cross-tab stale-draft invalidation.
- Optional private golden D1/R2 round-trip test passes separately. It compares every preserved field, sequence and all 24 half-month bits, then verifies a downloaded R2 dump. The original source remains read-only with SHA-256 `ad2e267df1ad06250204f3fd2a9a7f8c19bc5f531f4c7285c61f966bf3dd29a6`.
- `verify-golden` confirms the separate ignored SQL/SQLite copy and manifest in `data/cloudflare-golden/`: 177 plants, 9 activities, 0 photos. Native Wrangler import into a disposable local D1 database also confirms 17 reorder flags.
- Native Wrangler applies both migrations successfully; a second application reports no migrations to apply. Separate D1 tests prove failed batches roll back and existing fields survive upgrades.
- Wrangler successfully builds the scheduled Worker in deployment dry-run mode. Workflow YAML parses, migration checksums match, and the release tests prove failed preflight/upload/read-back checks cannot reach migration or deployment.
- PDF comparison across all 12 golden months, empty calendar and overflow: **14 fixtures, 25 pages**, with identical extracted text and pagination. Cloud symbols use the original cubic curves. Raster differences remain (at most 2,557 pixels per 150dpi page), so output is not described as pixel-identical. Private comparison report and April reference images are saved under ignored `.local/cloudflare-pdf-typescript/`.
- Git whitespace/diff validation passes.

## Review-driven corrections

The expensive-model review found and prompted corrections for production-only PBKDF2 limits, real D1 BLOB return types, truncated-dump acceptance, stale drafts after restore, the Pages CLI configuration rule, D1 binding-size/query limits, missing/corrupt R2 backup repair, Unicode name validation, fixture sequence handling and PDF cloud curves. Tests cover these regressions, plus login throttle boundaries, overlapping scheduled backup runs and retention of 90 scheduled points without deleting protected recovery points. The final GPT-6 Astra review closed with no remaining code findings. Expensive password derivation and PDF generation now run in the browser; the Worker supplies authenticated data and verifies the password proof.

Native release exports in `releases/` and application recovery dumps in `backups/` are distinct formats with separate recovery instructions. Golden/private artifacts and local test logs are ignored by Git.

## Production acceptance still required

After account provisioning: validate token scopes, actual D1/R2 bindings, Pages deployment, Gandi CNAME/TLS, scheduled execution, R2 read-back and a real restore drill. Measure free-plan Worker CPU and usage limits on production hardware. Local emulation does not reproduce every production quota; no cost or uptime guarantee is inferred from local test success.
