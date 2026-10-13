# Cloudflare verification record

The TypeScript migration was built by GPT-6 Luna and reviewed by GPT-6 Astra. Production provisioning and remote verification took place on 13 October 2026. The final release also removes the website restore flow, photo storage, the one-time golden importer and the Rust runtime, and adds phone layouts.

## Data and recovery

- The original read-only golden source remains unchanged. Its SHA-256 is `ad2e267df1ad06250204f3fd2a9a7f8c19bc5f531f4c7285c61f966bf3dd29a6`. Before cutover, conversion compared every preserved field and sequence. The imported garden had 177 plants, 9 activities and 17 reorder flags.
- Production native D1 exports were uploaded to private R2 and downloaded again for SHA-256 comparison before deployment. Application downloads have separate integrity framing and R2 read-back checks; new backups use checksummed JSON and older SQL downloads remain supported.
- A deliberate late failure in a native file import on a disposable **remote** D1 database left all original rows, sessions, generation, restore epoch and sequences unchanged.
- The operator restore shell utility was exercised against that disposable remote database. It created a verified native R2 recovery export, restored long Unicode notes with embedded NUL, a 110,000-byte binary fixture, IDs, revisions, timestamps, reorder flags and sequences exactly, and revoked stale sessions. This verified the schema-2 utility before photo support was removed; final schema-3 compatibility is covered by the current automated tests.
- The disposable remote database and its synthetic R2 recovery object were deleted after validation. Production data was not used for deliberate failure tests.
- One-time golden conversion tooling is removed after successful cutover. Existing private source copies and recovery exports are retained.

## Application and deployment

- Production HTTPS at `https://tuin.familiedejong.be/health` returns success. Gandi retains authoritative DNS, with `tuin CNAME tuinapp.pages.dev.`. Pages, D1, private R2 and the scheduled Worker are provisioned.
- The exact restricted token stored in GitHub's production environment successfully deployed Pages and the scheduled Worker, applied the existing migration ledger, and verified R2 export read-back.
- Measured live HTTP CPU: login parameters 2 ms, login 7 ms, plants 5 ms, activities 2 ms, PDF data 5 ms and backup status 3 ms. PDFs are generated in the browser. Restoration now runs only through the operator shell utility.
- Backend tests cover database/API behavior, backup integrity and retention, migration failure/retry, canonical restore generation and release safety. UI and browser tests cover normal garden workflows and removal of website restore controls. Mobile browser tests exercise narrow layouts, navigation, editing, calendar and backup downloads.
- Native release export logs suppress signed database download URLs, including on subprocess failure. A regression checks both output streams. Private data, credentials, exports and diagnostic logs are ignored by Git and never uploaded as CI artifacts.
- Existing migration files are immutable: CI verifies history and checksums before deployment. A verified native R2 export is required before pending migrations or application deployment. Failure prevents subsequent deployment steps; future migrations still require representative upgrade tests.

## PDF comparison

All 12 original garden months, an empty calendar and an overflow fixture were compared: **14 fixtures, 25 pages**, with matching extracted text and pagination. Cloud symbols use the original cubic curves. Raster differences remain (at most 2,557 pixels per 150dpi page), so output is not described as pixel-identical. Private comparison reports are retained under ignored `.local/cloudflare-pdf-typescript/`. The retired Rust reference remains available in Git history.

## Release verification

- PR #1 merged to `main`; [the first automatic GitHub deployment](https://github.com/bdejong/tuinapp/actions/runs/38359783155) passed both test and deployment jobs. Schema 3 is live, with no photo tables, indexes or triggers. All 177 plants, 9 activities, import records and garden sequences matched the pre-migration capture exactly.
- Final JSON backup changes passed 56 backend tests, 127 UI tests and 72 Chromium/Firefox browser tests locally, including phone layouts. GitHub also tests WebKit. GPT-6 Astra independently reviewed the full migration and subsequent JSON backup changes.
- A synthetic remote backup benchmark (177 plants, 9 activities, 94,178-byte dump) measured 16 ms on the first invocation, 5–10 ms on subsequent changed runs and 4–6 ms unchanged. That HTTP harness included extra verification queries, but these measurements still motivated moving backup execution to a private SQLite-backed Durable Object rather than depending on the ordinary Worker 10 ms allowance.
- The daily Cron Trigger remains on Cloudflare. Its private Durable Object uses the Free-plan-supported SQLite backend, whose documented CPU allowance is 30 seconds per request. The garden remains in D1 and backups remain in R2. See [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/) and [Free-plan pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

The background-object release and its final production backup verification are pending. Local emulation does not reproduce all production quotas; no cost or uptime guarantee is inferred from local test success.
