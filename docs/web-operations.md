# Web operations and recovery

## Architecture and scope

This release is a single-owner, desktop-oriented Vue website served by Rust/Axum. SQLite remains appropriate for a small personal application: one process owns the database, writes are transactional, and database snapshots include the complete garden. Legacy attachments remain preserved during import and backup, but there are no photo features in the web application. No external database service is needed.

The process uses an exclusive server lock. Deploy one replica with one persistent local disk; do not use ephemeral storage, multiple replicas, or a shared network filesystem. Configure HTTPS through a reverse proxy when hosting. The server checks the configured public origin and uses private, HttpOnly sessions and CSRF protection. It does not enable cross-origin access. Password hashes use Argon2; plaintext passwords are never stored.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TUINAPP_DATABASE` | `data/tuinapp.sqlite` | Live web database; must already exist |
| `TUINAPP_BACKUP_DIR` | `backups` | Persistent snapshot directory |
| `TUINAPP_PASSWORD_HASH` | required | Owner's generated Argon2 hash |
| `TUINAPP_PUBLIC_ORIGIN` | `http://127.0.0.1:3000` | Exact browser origin, no trailing slash; HTTPS enables Secure cookies |
| `TUINAPP_PORT` | `3000` | Compose host port only; update public origin to match |
| `TUINAPP_BIND` | `127.0.0.1:3000` | Listener; container uses `0.0.0.0:3000` internally |
| `TUINAPP_STATIC_DIR` | `dist` | Compiled website only; never a directory containing data or credentials |
| `TUINAPP_BACKUP_INTERVAL_SECONDS` | `3600` | Automatic snapshot interval, minimum 60 seconds |

The default configuration has one-hour recovery points while the server runs. The Settings copy describes the default hourly schedule. If changing this interval, update the UI's schedule and overdue threshold as well.

## First container startup

1. Copy `.env.example` to `.env`. Generate a password hash with the local CLI (or `docker compose run --rm tuinapp hash-password` after building) and set the intended public origin. Keep hashes single-quoted in `.env`.
2. Build with `docker compose build`.
3. Import a **preserved copy** into the new named data volume. Mount only that copy, read-only:

   ```sh
   docker compose run --rm \
     -v /absolute/path/to/legacy-copy.sqlite:/import/legacy.sqlite:ro \
     tuinapp import --source /import/legacy.sqlite --database /app/data/tuinapp.sqlite
   ```

4. Run `docker compose up -d`. Compose exposes the app only on host loopback, ready for a reverse proxy on the same host. Set the proxy to the configured HTTPS origin.
5. Sign in, check plant/activity counts, create a manual backup, download it, and run Test recovery.
6. Configure independent encrypted off-site backups and failure notifications before relying on the hosted copy. Retain the original golden archive separately.

The container workflow builds and smoke-tests Linux AMD64 and ARM64 images. `npm run test:container` runs the same checks against `tuinapp:test` (or pass an image name after `--`). It creates uniquely named temporary volumes and removes them afterwards. The development preview, working garden and golden archive are never mounted by this test.

## Database upgrades

Each web schema migration has a version, name, SQL file and SHA-256 checksum recorded in `web_migrations`. Never edit a released migration; add the next numbered migration and a regression test. Each migration and its ledger entry commit together in one transaction. Failed SQL, invalid foreign keys or failed ledger updates roll back. Unknown, missing, future or edited history blocks startup.

The server opens and validates the database before migration, creates a verified pre-migration backup, then applies pending migrations. Backup failure blocks the upgrade. It refuses to initialize a missing database silently, which catches incorrect volume mounts early. Legacy databases must pass the explicit read-only importer first.

Before upgrading, run the tests, make an additional manual backup, stop the existing process, then start the new release. Keep the previous image/binary plus its pre-upgrade database snapshot until the new release is verified. Do not run an older binary against a newer schema. Roll back using a separate restored database with the matching old binary; never reverse a migration by hand.

## Recovery

Settings → Download backup returns a ZIP containing `tuinapp-backup.sqlite` and `tuinapp-backup.json`. Keep these together. The manifest records checksum, schema/app versions, counts, reason and time. Checksums detect accidental corruption; they are not signatures against malicious replacement.

After extracting, restore to a new path:

```sh
npm run server -- restore \
  --source /absolute/path/to/tuinapp-backup.sqlite \
  --destination data/recovered.sqlite
```

The command checks the manifest, checksum, migration history, database integrity and record counts. It refuses to overwrite a destination. Inspect the recovered copy using a separate server and backup directory before switching the production database path. Stop the old process before switching. Keep the previous database and its WAL/SHM files together until recovery is confirmed.

Settings → Test recovery takes a current snapshot, restores into a temporary database and reads the records. It does not replace live data. Schedule an additional full off-site restore drill once hosting is chosen; a local recovery test cannot prove the remote copy is usable.

Backups use SQLite's online backup API, including committed WAL data. Do not copy only the live `.sqlite` file while the server is running. Off-site jobs should upload completed snapshot/manifest pairs from the backup directory. Keep encryption credentials outside the server and monitor job failures and available disk space. Manual/pre-migration backups are intentionally retained until explicitly reviewed, so storage use needs monitoring.

## Golden archive

The user-provided original remains at `/Users/bram/Downloads/db`. A byte-identical, read-only preserved copy is at `/Users/bram/Documents/TuinApp-preserved-data/2026-10-12/db.golden.sqlite`, with a preservation manifest and audit results beside it. Expected SHA-256:

`ad2e267df1ad06250204f3fd2a9a7f8c19bc5f531f4c7285c61f966bf3dd29a6`

This archive contains 177 plants, 9 activities, 17 reorder flags and no photos. It is not a runtime database or a disposable test fixture. Never modify, migrate in place, replace, prune or commit it. Its local duplicate is on the same computer; arrange a separate physical/off-site copy as part of hosting setup.
