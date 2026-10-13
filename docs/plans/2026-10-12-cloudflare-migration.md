# Cloudflare migration plan

Requested 12 October 2026. Implementation uses cheaper GPT-6 Luna agents; GPT-6 Astra reviews the completed migration. Existing uncommitted work is preserved (a local patch is saved in `.local/pre-cloudflare-changes.patch`). No account provisioning, DNS change or production deployment is performed before the owner supplies access.

## Architecture

- Vue/TypeScript frontend on Cloudflare Pages, with a TypeScript advanced-mode Pages Function for the existing same-origin API. Pages supports an externally managed subdomain, so authoritative DNS can stay at Gandi.
- D1 SQLite for garden data, persisted authentication and change tracking. Separate databases per application and per preview environment.
- Private R2 bucket for versioned logical SQL dumps. A scheduled TypeScript Worker shares the production D1 and R2 bindings and checks daily. Unchanged days produce no new dump; failed uploads remain eligible for retry.
- Pure TypeScript PDF generation in the browser with the existing geometry, typography, symbols, wrapping and pagination. No Rust, headless browser or paid rendering service in the new runtime.
- Settings lists successful dumps, allows downloads and accepts a validated dump to restore. Restore requires a successful recovery dump first and replaces data atomically. SQL uploads are parsed as a restricted data format, never executed as arbitrary SQL.

## Work sequence and ownership

1. Audit existing source/tests and current platform constraints; preserve original and golden data.
2. Cheaper implementation agents work independently on API/auth, PDF renderer/tests, and data/backups/migrations/tests.
3. Integrate Pages/scheduler configuration, local Cloudflare runtime, Settings restore flow and browser tests. Keep legacy sources as reference until parity is verified.
4. Convert a read-only golden source to a separate D1-compatible SQL/SQLite copy; prove field, ID, timestamp, attachment, calendar and sequence preservation and unchanged source checksum.
5. Run TypeScript checks, component tests, translated backend/data/PDF tests and existing browser workflows on the Cloudflare local runtime. Rehearse malformed restores, storage failures, stale edits and failed/repeated migrations.
6. Expensive-model review of all new/changed source, tests, configuration and deployment scripts; fix findings and recheck affected behavior.
7. Deliver account setup, deployment, backup/recovery and Gandi CNAME instructions, with measured results and remaining account-dependent checks.

## Safety and acceptance

Golden source: `/Users/bram/Documents/TuinApp-preserved-data/2026-10-12/db.golden.sqlite`, opened read-only. Expected SHA-256: `ad2e267df1ad06250204f3fd2a9a7f8c19bc5f531f4c7285c61f966bf3dd29a6`. Private converted outputs belong in ignored `data/cloudflare-golden/`; never CI or Git. No tests touch the current `data/tuinapp.sqlite` runtime database.

Migrations are sequential, immutable, recorded and tested from prior versions. Failures must roll back; future/contradictory schemas must be rejected. No promise can cover arbitrary future changes: each new migration needs representative prior-data tests and a recovery point before production application.

Free-tier suitability is a design target, not an unlimited-usage guarantee. Cloudflare quotas are shared by apps on an account; R2 usage beyond its allowance may incur charges. Actual production CPU usage, billing configuration, DNS/TLS and scheduled execution can only be verified after account access.

## Official references

- [Pages external custom subdomains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Pages advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)
- [Pages Function pricing](https://developers.cloudflare.com/pages/functions/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

## Implementation status

The TypeScript port, D1 golden copy, R2 daily backups/restore, versioned migrations and GitHub push-deployment workflow are prepared locally. GPT-6 Luna implemented the port; GPT-6 Astra reviewed all changed application and deployment code and the final review has no remaining findings. See [verification](../cloudflare-verification.md) for observed test results and [operations](../cloudflare-operations.md) for account setup, deployment and Gandi DNS. Production account, DNS/TLS, billing and CPU checks remain pending access. No changes have been pushed, merged or deployed.
