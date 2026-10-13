# Cloudflare operations

TuinApp runs as a Vue site and TypeScript Pages Function, with D1 storage, private R2 dumps and a daily scheduled Worker. The browser generates printable PDFs from authenticated calendar data using the TypeScript renderer, keeping that work outside the Worker CPU budget. DNS remains at Gandi.

## Account setup

Production was provisioned on 13 October 2026: Pages `tuinapp`, D1 `tuinapp`, private R2 `tuinapp-backups`, and scheduler `tuinapp-backups`. The custom domain is `https://tuin.familiedejong.be`; Gandi serves `tuin CNAME tuinapp.pages.dev.` with a 300-second TTL. GitHub production credentials and the deployment enable switch are configured. Do not initialize or replace the live garden as part of routine setup.

Use Cloudflare Workers **Free**, D1, Pages and **R2 Standard**. Enable R2 on the account (Cloudflare may request billing details). Create a Direct Upload Pages project; GitHub Actions below owns deployments, so do not also enable Cloudflare's automatic Git builds.

```sh
npm ci
npx wrangler login
npx wrangler pages project create tuinapp --production-branch main
npx wrangler d1 create tuinapp
npx wrangler r2 bucket create tuinapp-backups
```

Keep the bucket private: do not enable public `r2.dev` access or a public custom domain. Record the D1 UUID returned by creation. Replace the placeholder UUID in both `wrangler.jsonc` and `cloudflare/wrangler.scheduler.jsonc` with that same production database ID. If another Pages project name is needed, use it consistently throughout the setup. Keep preview bindings separate; create preview D1/R2 resources only if needed. Never point preview bindings at production.

Generate an owner password verifier and a random session secret locally:

```sh
npm run cloudflare:password
npx wrangler pages secret put TUINAPP_PASSWORD_HASH --project-name tuinapp
npx wrangler pages secret put TUINAPP_SESSION_SECRET --project-name tuinapp
```

Paste only each value at its secret prompt. The password tool hides interactive input; a password manager can also pipe a password to it. Do not commit secrets. Authentication derives a salted PBKDF2 proof in the browser and verifies its digest on the server, avoiding the Worker password-hashing/CPU limit. The proof is password-equivalent and must only travel over HTTPS (loopback HTTP is for development). Keep the generated verifier private too. Changing the session secret invalidates existing sessions; rotate it alongside a password change.

Initialize a new, empty database only when setting up a separate environment:

```sh
npm run cloudflare:data -- verify-migrations
npx wrangler d1 migrations apply DB --remote
```

For an existing garden, use its current live database and R2 backups. Restore a downloaded application dump with the operator utility below; no private reference database is imported during provisioning.

## GitHub push deployments

The workflow `.github/workflows/build.yml` tests every push and pull request. After a successful check on `main`, the deployment job runs only when repository variable `CLOUDFLARE_DEPLOY_ENABLED` is `true`. Keep it enabled only while the configured production account, secrets and deployment credentials are ready. Use a GitHub `production` environment; repository branch protection can require the test job before merging.

Configure these GitHub Actions variables (repository or `production` environment, except the enable switch must be a repository variable):

| Variable | Value |
| --- | --- |
| `CLOUDFLARE_DEPLOY_ENABLED` | `true` when ready |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `CLOUDFLARE_D1_DATABASE_ID` | Production D1 UUID |
| `CLOUDFLARE_PAGES_PROJECT` | Actual Pages project name, e.g. `tuinapp` |
| `CLOUDFLARE_R2_BUCKET` | `tuinapp-backups` |
| `TUINAPP_PUBLIC_ORIGIN` | `https://tuin.familiedejong.be` |

Add `CLOUDFLARE_API_TOKEN` as a GitHub **secret**, restricted to this account with Pages Edit, Workers Scripts Edit, D1 Edit and Workers R2 Storage Edit permissions. Never use a global API key. The scheduler only needs D1/R2 bindings; it has no public HTTP route or owner credentials.

On a push to `main`, the workflow:

1. Installs locked dependencies, checks that previous migrations were not edited, verifies migration hashes, builds and runs TypeScript, backend, UI and browser tests.
2. Creates isolated release configuration from the GitHub variables and checks the live native migration ledger is a prefix of this release's migration files.
3. Exports D1 to a native SQL recovery file, uploads it to `releases/` in the private R2 bucket, downloads it again and compares SHA-256. Failure stops deployment.
4. Applies pending migrations, deploys Pages, and deploys the daily backup Worker.

A failed migration prevents application deployment. A deployment failure after a successful migration does not automatically undo the migration. When the schema version changes, the old application fails closed until the matching application is deployed, so allow a brief maintenance window and retry a failed rollout promptly. Prefer backward-compatible additive migrations. The next push can retry. Deployments are serialized and never cancelled halfway through by a newer push. No credentials or database dump are uploaded as GitHub artifacts.

## Gandi subdomain

After the first successful Pages deployment:

1. In Cloudflare **Workers & Pages → your Pages project → Custom domains**, add `tuin.familiedejong.be` first.
2. In Gandi's DNS records for `familiedejong.be`, create:

   | Type | Name | Target | TTL |
   | --- | --- | --- | --- |
   | CNAME | `tuin` | the actual `<project>.pages.dev` hostname shown by Pages | 300 seconds (or Gandi's default) |

3. Remove any conflicting A/AAAA/CNAME record only at `tuin`, if one exists. Keep Gandi nameservers, the apex, mail and other records unchanged.
4. Wait for Cloudflare to show the custom domain as active and issue its TLS certificate. Open `https://tuin.familiedejong.be`, sign in and check the calendar PDF.

Use the actual assigned Pages hostname, not a guessed name or `workers.dev`. Registering the custom domain in Pages is required before creating the CNAME. Restrictive existing CAA records can prevent TLS issuance; follow Cloudflare's domain-status diagnostic if that happens. [Cloudflare's external subdomain instructions](https://developers.cloudflare.com/pages/configuration/custom-domains/).

## Backups and recovery

The scheduled Worker checks at **02:15 UTC daily** (03:15 Belgian winter time / 04:15 summer time). It creates a dump after garden changes, including updates and deletes, and creates no duplicate on unchanged days. Failed uploads remain eligible for the next scheduled retry; Settings reports failures and overdue checks. Check the scheduled invocation logs after first deployment. The next daily run is the first automatic backup unless a restore has already made a recovery point.

Settings shows successful application dumps in R2, their dates, counts and sizes. It provides downloads only: there is no restore form or restore API. Downloads are restricted SQL files with integrity framing.

Restore a downloaded application dump from a trusted checkout with Node 24 and Cloudflare credentials:

```sh
npm ci
npx wrangler login
./scripts/cloudflare-restore.sh /absolute/path/to/downloaded-backup.sql --config wrangler.jsonc --confirm-restore
```

At the terminal prompt type `RESTORE tuinapp`. The utility validates the file locally and generates canonical SQL; it never executes the supplied file directly. Before replacement, it exports the live D1 database, uploads a recovery copy to private R2 under `releases/manual-restore-...`, downloads it again and checks SHA-256. It verifies the released migration checksums and exact live migration ledger. The native D1 file import atomically guards the schema, generation and restore epoch, replaces garden rows and sequences, and revokes sessions. Concurrent edits invalidate the guard and abort the import. Sign in again after a successful restore. Stale browser drafts are invalidated by the changed restore epoch.

An interrupted import can have an uncertain outcome: inspect the database before retrying. The utility prints the recovery key if submission fails or verification cannot confirm completion. Keep the downloaded source file until you have checked the restored garden.

The newest 90 scheduled dumps are retained. Named recovery points are retained for manual review. Protected recovery points and deployment exports can accumulate; review R2 usage and remove obsolete release recovery exports deliberately after a tested replacement exists. Do not set a blanket bucket expiry that can remove the only backup of an unchanged garden.

`backups/` contains the application dumps shown in Settings. `releases/` contains native full D1 exports made by GitHub deployment, including infrastructure/auth tables. These are an administrative disaster-recovery format and are **not** accepted by the application-dump restore utility. For catastrophic recovery, create a fresh D1 database, import a verified native export using Wrangler, check its migration ledger and schema version, rotate the session secret, update both production bindings and redeploy. Keep the old database until the recovered one is verified. Never execute an untrusted SQL file as an administrative import.

Keep occasional downloaded dumps outside the Cloudflare account. R2 recovery protects against application data mistakes, but D1 and R2 in the same account share account-level risk.

## Future schema changes

Add a numbered migration; never edit a released one. Update `cloudflare/migration-checksums.json`, the expected application schema version and dump compatibility rules together. CI compares already-published SQL files against Git history. Test migration from representative previous schemas, rerunning the migration ledger, rollback on intentional failure, and restore of supported older dumps.

Use additive changes first, deploy code that handles both schemas, then remove obsolete fields in a later migration. D1 migration batches roll back on failure; that cannot prove every future SQL change is correct. The pre-deployment R2 dump and failed-migration tests provide a recovery path. Old dump versions must either have a tested upgrade path or be explicitly rejected before changing data. Cloudflare provides [D1 migration guidance](https://developers.cloudflare.com/d1/reference/migrations/).

## Free-tier capacity and remaining production checks

As checked on 12 October 2026, Workers Free permits 100,000 dynamic requests/day with 10ms CPU per HTTP request or cron invocation; assets served directly by Pages do not consume Function requests. D1 Free includes 5 million rows read/day, 100,000 rows written/day and 5GB total storage. Free D1 has 10 databases with a 500MB per-database limit. R2 Standard includes 10GB-month storage, 1 million Class A and 10 million Class B operations per month, with free egress. These allowances are shared across applications; R2 excess usage can be billed. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

This small garden should fit the storage and request allowances comfortably. Local tests cannot prove Cloudflare's production CPU accounting. Measured production HTTP requests for login, garden lists and PDF data used 2–7 ms CPU. PDF generation runs in the browser and restore runs through the operator utility. Scheduled backup CPU still needs its own production measurement; continue checking D1 and R2 usage as data grows. Use one D1 database and private bucket per application; the current Free account limit is five cron triggers, so several apps may eventually share a scheduler while keeping separate data bindings.

## Local use

```sh
npm ci
npm run build
npx wrangler d1 migrations apply DB --local
npm run cloudflare:password
# Put the two generated values in ignored .dev.vars, plus:
# TUINAPP_PUBLIC_ORIGIN=http://127.0.0.1:8788
npm run server
```

Use the URL printed by Wrangler (default port 8788). The real Cloudflare credentials are unnecessary for local D1/R2 emulation. The local scheduler does not automatically run with Pages; browser and backend tests explicitly exercise its code on disposable bindings.

```sh
npm run check
npm run test:e2e
```
