# Cloudflare application status

Last reviewed 13 October 2026.

TuinApp runs on Cloudflare Pages with a TypeScript API, D1 garden database, private R2 backups and a daily scheduled backup Worker. Printable calendars are generated in the browser. Settings lists downloadable application dumps; the website has no restore feature. Operators restore a downloaded dump with `scripts/cloudflare-restore.sh`, which validates the restricted dump format, verifies a fresh private R2 recovery export and uses Cloudflare's native D1 import with schema, generation and migration-ledger guards.

Production Pages, D1, R2, the daily schedule, custom domain and GitHub deployment credentials are configured. The deployment workflow checks migration history, creates and verifies a private D1 recovery export, applies migrations and deploys the application. A remote restore rehearsal against a disposable D1 database verified preservation of IDs, revisions, ordering and sequences, session revocation, epoch/generation changes and rollback on late SQL failure.

The owner has requested removal of photo features and data. The schema migration, dump compatibility and cleanup are in progress; do not treat that work as complete until the matching checks and production rollout finish. The original private database and local evidence remain outside version control and are not imported by routine deployments.

See [Cloudflare operations](../cloudflare-operations.md) for setup, deployment, backup, restore and local verification instructions. See the [verification record](../cloudflare-verification.md) for checks and remaining limitations.
