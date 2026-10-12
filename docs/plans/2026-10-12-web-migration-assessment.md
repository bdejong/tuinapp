# TuinApp web migration assessment

TuinApp can become a private website while retaining most of its Vue interface and gardening logic. For one person using desktop browsers, the recommended first version is Vue plus a small Rust HTTP service, one SQLite database on persistent server storage, and verified backups stored separately. The hosting provider runs the service, so your own computer can be switched off.

The critical work is reliable data handling: replace the migration runner, provide a controlled import of the existing database, and make backup and recovery independent of opening or closing the application. This records the original assessment. The web service has since been implemented locally; see [verification](../web-verification.md) and [operations](../web-operations.md). Hosting remains to be selected. The owner subsequently specified desktop screens and ordinary single-user workflows. Source-line links below refer to the pre-migration audit and may have moved.

Assessed on 12 October 2026 against repository commit `ea57931`. Scope covers all application source files, configuration, dependency manifests, release workflow, historical schema changes, and the supplied database. The access requirement is one private account, confirmed by the owner.

## Preserved database and compatibility

The original [Downloads database](/Users/bram/Downloads/db) was left unchanged. A separate [golden preservation copy](/Users/bram/Documents/TuinApp-preserved-data/2026-10-12/db.golden.sqlite) and [inspection copy](/Users/bram/Documents/TuinApp-preserved-data/2026-10-12/db.inspection.sqlite) were created outside the repository and made read-only. All three files have the same SHA-256 checksum:

```text
ad2e267df1ad06250204f3fd2a9a7f8c19bc5f531f4c7285c61f966bf3dd29a6
```

The [preservation manifest](/Users/bram/Documents/TuinApp-preserved-data/2026-10-12/preservation-manifest.json) records the locations, checksum, size, and preservation time. Inspection used a read-only connection to the inspection copy. Migration and recovery experiments used disposable in-memory databases.

| Check | Result |
| --- | --- |
| Database size | 53,248 bytes, or 52 KiB |
| Application schema version | 3, matching the current application |
| SQLite integrity check | `ok` |
| Foreign key consistency check | No violations |
| Plants | 177 |
| Activities | 9 |
| Plants needing reorder | 17 |
| Photos | 0 |
| Plant categories | 109 vegetables/fruit, 50 flowers, 17 herbs, 1 uncategorized |
| Duplicate plant names | 3 name groups; preserve these as separate records |
| Sun and period values | In range, with no nulls in required numeric fields |

The SQLite `user_version` value is zero because this application tracks its version in the `schema_version` table. An importer must not mistake that zero for an empty or unmigrated database. Plant IDs have gaps and reach 251; preserve IDs and sequence state rather than renumbering records.

This database is suitable for reuse. It already has `sun_requirements` and `needs_reorder`, so it must not be sent through the old version 1 to 2 conversion again. A copy and restore rehearsal retained every record exactly. The zero photo count is an observation about this file; it does not establish whether photos existed in an earlier version.

**Remaining preservation step:** these copies are on the same computer. Before production import, keep an additional verified copy on an independent device or in private, versioned backup storage. The golden copy must remain outside normal backup expiration rules and must never be mounted as the working production database. No database was uploaded during this assessment.

## Application coverage and porting work

The application has a small, understandable structure: Vue 3 and TypeScript for the interface, 17 Tauri commands for backend operations, and three domain tables. Data entry and schedule filtering are local operations; there is no external plant-data feed in the code.

| Area | Current behavior | Web treatment |
| --- | --- | --- |
| Plant management | Name search, add/edit/delete, category, multiple sun requirements, notes, reorder flag | Retain components and behavior; add server validation, visible save errors, and conflict handling |
| Schedule entry | Two 24-bit masks for early/late sowing and planting | Preserve the encoding and existing values; make controls usable by touch and keyboard |
| Plant overview | Annual grid with sowing/planting colors | Retain the desktop grid with controlled horizontal scrolling |
| Activities | Add/edit/delete with a 24-bit active-period mask | Reuse forms and filtering |
| Calendar | Month selector that fetches data and generates a PDF | Add an actual on-screen monthly list, then print/download from that view |
| Seed ordering | List flagged plants and mark them ordered | Preserve; update the reorder field without overwriting unrelated edits |
| Photos | Browser camera capture, JPEG conversion, SQLite BLOBs, enlarge/delete | Keep camera logic; add file upload, rear-camera preference, size limits, and image endpoints |
| TSV import | Browser file selection; server parses `Z` and `P` into periods | Keep the file format; add preview, validation, transaction, and explicit duplicate policy |
| Database settings | Choose a local path and copy the database | Replace with backup status, download/export, and a controlled recovery workflow |
| Packaging | Tauri app, macOS entitlements, native dialogs and filesystem access | Replace with a hosted service build and deployment pipeline |

Most Tauri calls are already isolated in [the API adapter](/Users/bram/Documents/dev/tuinapp/src/api.ts:1). Replace these with HTTP requests while preserving the component-facing methods. Two extra dependencies need direct attention: [MonthlyView](/Users/bram/Documents/dev/tuinapp/src/components/MonthlyView.vue:74) invokes PDF generation directly, and [SettingsView](/Users/bram/Documents/dev/tuinapp/src/components/SettingsView.vue:4) imports the native save dialog. The Rust commands in [commands.rs](/Users/bram/Documents/dev/tuinapp/src-tauri/src/commands.rs:1) contain reusable queries, but their Tauri state and application handles must be removed from the business logic.

The camera already uses a browser API. Production camera access needs HTTPS and browser permission; include a file picker fallback and test on desktop browsers. [MDN camera documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

The current PDF generator writes a temporary file and launches macOS `open`. A server cannot use that to display a document in the user's browser. Prefer a print-friendly monthly HTML view with browser print/save-to-PDF. If a dedicated PDF download remains necessary, return PDF bytes over HTTP with a fixed safe filename and no operating-system launch command.

## Migration and backup defects

### Historical databases are not all version 1

The original schema at commit `3bb8e8c` lacks `plant_type`. Commit `af28ef2` added that field only to `CREATE TABLE IF NOT EXISTS`, which does not alter an existing table. The later runner labels any existing `plants` table without a version as version 1, then assumes `plant_type` is present.

Using the historical schema and current migration SQL reproduced `no such column: plant_type`. The failed conversion leaves `plants_new` behind, so the next attempt fails with `table plants_new already exists`. This is a concrete compatibility defect that could explain some upgrade failures, although it does not prove which failure occurred on a particular installation. See [legacy detection](/Users/bram/Documents/dev/tuinapp/src-tauri/src/db.rs:201).

### Migration changes and version tracking can diverge

The runner executes each migration and then updates its version, with no transaction around both operations. A simulated failure saving version 3 left `needs_reorder` added while the recorded version remained 2. Retrying then failed with `duplicate column name: needs_reorder`. A failure partway through a table rebuild can likewise leave partial structural changes. See [migration execution](/Users/bram/Documents/dev/tuinapp/src-tauri/src/db.rs:212).

The version table also permits multiple rows, reads one with `LIMIT 1`, and has no history or checksums. Experiments confirmed that conflicting versions 3 and 99 were accepted, and that a database claiming future version 99 was not rejected.

### Table rebuilding can delete photos

Version 2 copies plants into a replacement table and drops the original. With foreign key enforcement enabled, dropping the parent table activates `ON DELETE CASCADE` and deletes its photos. A synthetic plant survived the migration while its synthetic photo disappeared.

This is relevant to the configured build: `rusqlite` 0.31 with bundled SQLite builds with `SQLITE_DEFAULT_FOREIGN_KEYS=1`. The application does not explicitly override that setting. A different build with enforcement disabled can instead leave orphan photos on normal plant deletion. Set and verify the intended setting explicitly for every connection. [Bundled build configuration](https://raw.githubusercontent.com/rusqlite/rusqlite/v0.31.0/libsqlite3-sys/build.rs), [SQLite foreign key behavior](https://www.sqlite.org/foreignkeys.html).

A safe table rebuild needs a dedicated migration connection, coordinated writes, correct foreign key handling outside the transaction, and relationship checks before committing. Simply wrapping the existing SQL in a transaction does not prevent a successful cascade from deleting photos. Follow SQLite's documented rebuild procedure. [SQLite schema changes](https://www.sqlite.org/lang_altertable.html#otheralter).

### Backups depend on startup and ordinary file copying

This checkout calls [backup_database during startup](/Users/bram/Documents/dev/tuinapp/src-tauri/src/lib.rs:17), before opening the database. There is no close-time backup hook in the checked source. Other installed versions may differ.

The [backup function](/Users/bram/Documents/dev/tuinapp/src-tauri/src/db.rs:225) copies the main file to the same computer, names it to the nearest second, and prints failures while allowing startup and migration to continue. It has no retention policy, independent storage, integrity validation, restore procedure, or user-visible status. Two launches in the same second can target the same backup filename.

A plain file copy can be adequate for a genuinely closed, consistent database, but it is unsuitable as the general online backup strategy. A web server may have active transactions or WAL data outside the main file. Use SQLite's Online Backup API to create a consistent snapshot. [SQLite backup documentation](https://www.sqlite.org/backup.html).

The desktop “move database” operation has another loss scenario: it copies the database and saves a new path, but the open connection keeps writing to the old file until restart. Edits made after the copy can appear lost on restart. A missing configured path can also lead to opening a new empty database or falling back to another location. Production should fail visibly when its expected database or volume is missing, rather than silently initialize a replacement.

## Other issues to address during the port

These findings come from source review; they should become focused regression cases during implementation.

| Finding | Effect and correction |
| --- | --- |
| [PlantList fetches photos in a loop](/Users/bram/Documents/dev/tuinapp/src/components/PlantList.vue:47) | With this dataset, a direct HTTP translation makes 1 plant request plus 177 sequential photo requests, even though there are no photos. Return photo counts with plants and load image content on demand. Clear obsolete cached entries when reloading. |
| [Updates replace whole plant records](/Users/bram/Documents/dev/tuinapp/src-tauri/src/commands.rs:60) | Two devices can overwrite each other's changes. Add a revision number and reject stale writes. The reorder action should patch only that flag. |
| [Backend validation is limited](/Users/bram/Documents/dev/tuinapp/src-tauri/src/commands.rs:187) | Validate month 1–12 before bit shifting, names, enums, masks, IDs, and upload limits. Return not-found for missing records and structured errors instead of raw SQL messages. |
| [TSV import inserts one row at a time](/Users/bram/Documents/dev/tuinapp/src-tauri/src/commands.rs:329) | Failure can leave a partial import; retry can duplicate earlier rows. Validate the entire file before one transaction and record an import fingerprint. Existing duplicate names must remain permitted. |
| [Calendar template only shows a print control](/Users/bram/Documents/dev/tuinapp/src/components/MonthlyView.vue:96) | The fetched monthly lists are not rendered on screen. Add readable desktop lists; the historical design describes more than the current implementation delivers. |
| [PDF accepts an Other category but does not draw it](/Users/bram/Documents/dev/tuinapp/src-tauri/src/commands.rs:408) | Uncategorized plants can be omitted. Preserve an Other section. Item drawing also lacks within-section page breaks and name wrapping; test long lists and names. |
| [Overview edit switches components before calling a ref](/Users/bram/Documents/dev/tuinapp/src/App.vue:86) | The list component is not mounted yet. Store the requested edit centrally or wait for mounting. Quick Add has a related problem when the overview is selected. |
| Save and Add Another does not reset either form | The visibility watcher does not rerun while the modal stays open. Explicitly reset the form after a successful create. |
| Desktop layout and weak error feedback | Replace tiny clickable cells with accessible controls, improve desktop navigation and modals, show loading/save states, and retain edits after a network error. |

Photo additions and deletions currently save immediately, even if the surrounding plant form is later cancelled. Make that behavior explicit or stage the changes. Photo sort order is stored, but the drag-to-reorder feature described in the old design is not implemented.

## Recommended web architecture

**Phone or computer → HTTPS and private login → Vue interface and Rust API → SQLite on persistent storage → separate encrypted backup storage.**

Keep one deployable service initially. Serve the compiled Vue assets and `/api` from the same origin. Extract the existing Rust data operations into a module independent of Tauri and expose them through an HTTP framework such as Axum. Run synchronous SQLite work on a dedicated worker or blocking pool rather than blocking the HTTP event loop. [Axum documentation](https://docs.rs/axum/latest/axum/).

Use one private account with no public registration. A maintained authentication integration can allowlist the owner's identity. Check authorization on every API, image, import, and backup endpoint; use secure session cookies and CSRF protection for writes. If an access proxy supplies authentication, validate its signed identity at the origin so a direct hosting URL cannot bypass login. Keep credentials in server secrets.

SQLite remains a reasonable fit for this small, single-owner dataset. Use one server instance and a local persistent volume, a bounded busy timeout, explicit foreign key enforcement, and short transactions. WAL can improve reader/writer coexistence, but it still permits one writer at a time and requires all database processes on the same host. Do not put the live database in a shared cloud-sync folder. [SQLite WAL documentation](https://www.sqlite.org/wal.html).

Keep photos inside SQLite initially, with validated uploads, bounded image dimensions/size, and separate binary download endpoints. This retains a single consistent backup unit. If photos later dominate storage, moving them to object storage is a separate project with an explicit database-and-media recovery design.

| Hosting approach | Fit |
| --- | --- |
| Managed application service with a persistent disk | Recommended for the first port. Reuses SQLite and most Rust queries. Requires maintaining the backup job and accepts brief deployment downtime. |
| Managed application service with managed PostgreSQL | An alternative if provider-managed database operation becomes the priority. Requires a deliberate SQLite-to-PostgreSQL import and adaptations for IDs, booleans, BLOBs, SQL, and recovery. It does not remove the need to test migrations and restores. |

A paid Render web service with a persistent disk is one concrete candidate. Its disk belongs to a single running instance and is unavailable to build commands, pre-deploy commands, separate jobs, or other services. Therefore migrations must run in the runtime startup sequence before accepting traffic, and backups must run within the service that owns the disk. Its disk-backed deployments have downtime. Budget for the service, storage, and separate backups; confirm the selected plans before purchasing. These are operational constraints, not a hosting commitment. [Render persistent disk documentation](https://render.com/docs/disks).

Static hosting alone cannot replace this application's persistent backend. A standalone browser database would also require a separate synchronization and backup design to work across devices. An installable home-screen shortcut can be added later; offline editing should wait until conflict resolution is designed.

## Safe adoption of the existing database

1. **Retain the golden copy permanently.** Verify the checksum and establish the independent backup before cutover. Only a fresh working copy can be migrated.
2. **Inspect the source read-only.** Check integrity, table definitions, columns, version consistency, masks, required values, relationships, counts, and photo hashes. Reject an unknown or contradictory schema without modifying it.
3. **Recognize known historical shapes explicitly.** Support the original schema without `plant_type`, the text-sun schema with that field, version 2 bitmasks, and version 3 reorder flags. Inspect the actual shape as well as the version number. Quarantine partially migrated databases for repair on copies; do not guess their state.
4. **For this version 3 file, adopt a copied database.** Validate it against the expected version 3 schema, then record a verified legacy baseline in the new web migration history. Do not pretend that a new migration tool executed old migrations, or replay their table-rebuild SQL.
5. **For older shapes, import into a new target database.** Map absent categories to null, known sun strings to bits, and absent reorder flags to false. Preserve every original ID, timestamp, note, photo byte sequence, and schedule bit. Report unexpected values instead of silently normalizing them.
6. **Validate the target before promotion.** Compare IDs and all original field values, counts, duplicate groups, sequences, and photo hashes. Compare all 12 months of derived sowing/planting/activity results. Additional web fields may have defaults, but legacy values must match the declared mapping.
7. **Make retries safe.** Record the source checksum and completed import in the same target transaction. A repeat of the same import must refuse or identify the already completed operation. Never merge automatically into a nonempty production database.
8. **Cut over once.** Freeze desktop edits, take the final source snapshot, validate the web copy, test it privately, then designate the web database as authoritative. Later desktop edits will not synchronize automatically. Keep the old file and recovery path.

Treat an uploaded SQLite file as untrusted input: enforce size limits, inspect it in an isolated importer, do not execute schema SQL copied from it, and do not install it at the production path before validation. For this one-time conversion, an operator import tool is sufficient; a general public upload feature is unnecessary.

## Migration contract for future releases

Store ordered, immutable migration files with IDs, names, checksums, application version, and application time in a constrained migration history table. Use a maintained migration runner that can enforce this contract. Pin the runtime dependencies and commit the Rust lockfile for the deployable application.

Every release must follow this sequence:

1. Confirm the expected persistent volume and database identity. Refuse unknown future versions, invalid histories, checksum mismatches, or unexpected schema shapes.
2. Stop accepting writes and ensure only one migration runner holds the migration lock. Take a verified backup of the current database and retain the prior application artifact.
3. Run each migration with its history update in one transaction. Recheck the current version after acquiring the lock. Failure rolls back that migration and prevents the new server from accepting traffic.
4. For table rebuilds, apply the documented SQLite foreign key procedure on an isolated connection; preserve indexes, triggers, and sequence values; run foreign key and data-preservation checks before committing. Re-enable and verify normal constraints afterwards.
5. Run schema and read/write health checks, then enable traffic. Subsequent startups must find no pending work.

Prefer additive changes so the prior application can tolerate the new schema during rollback. Do not run the existing destructive down migrations as an automatic recovery mechanism: reversing sun masks loses combinations, and removing the reorder column loses flags. If compatibility is broken, stop writes and restore a verified backup into a new database path with the matching application version. Preserve the failed/current database first. A restore after production writes resume can lose those later edits, so rehearse rollback before reopening access or reconcile them explicitly.

## Backup and recovery policy

For this personal application, start with a target of **at most one hour of lost edits** and **restoration within one hour**. These are operating targets to verify, not guarantees already supplied by the code or hosting provider.

| Trigger or policy | Proposed behavior |
| --- | --- |
| Normal operation | Create and upload an hourly SQLite snapshot; run a catch-up backup after an overdue restart |
| Before schema migration, bulk import, or restore | Require a verified recovery snapshot before proceeding |
| Manual export | Offer an authenticated Download Backup action using the same consistent snapshot mechanism |
| Retention | Keep 48 hourly, 30 daily, and 12 monthly recovery points; preserve the golden legacy copy permanently |
| Independent storage | Store encrypted backups outside the application server, using versioning or immutability and separate deletion privileges |
| Visibility | Show last successful remote backup, its age and schema version, latest failure, and last restore test |
| Failure detection | Record failed jobs and alert on failure or backup age over two hours; an external monitor must also detect a stopped server |
| Recovery rehearsal | Restore periodically, such as monthly, into a temporary environment and verify actual application reads |

The backup job should create a uniquely named temporary snapshot with SQLite's backup facility, validate it, calculate a checksum, upload it with a manifest, and confirm the remote object before marking success. The manifest should include schema/app versions, snapshot time, byte size, and record counts. Retention cleanup runs only after successful verification and must not touch protected golden or release-recovery copies. Backup credentials and decryption keys need their own recovery path.

The schedule must operate without any browser tab being open. On the recommended disk-backed host, the scheduler belongs inside the service that has access to SQLite; a separate restore checker can download backups independently. Whole-disk snapshots are supplementary, not the database recovery procedure. Render itself cautions against using disk restores to recover custom databases. [Render database restore guidance](https://render.com/docs/disks#restoring-a-custom-database).

To restore, stop writes, preserve the current database, download the selected backup, verify its checksum and integrity, restore into a new path, check schema compatibility and record counts, and run a smoke test before switching the service. Never overwrite the golden file. A successful upload alone is not evidence that recovery works.

## Implementation stages and acceptance criteria

| Stage | Deliverable | Required evidence |
| --- | --- | --- |
| 1 Data foundation | Safe importer, explicit schema baseline, new migration runner, backup/restore commands | Golden copy untouched; exact data comparison; historical upgrades and injected failures covered |
| 2 Hosted core | Rust HTTP service, Vue API adapter, private login, durable storage | Plant/activity/reorder operations work; unauthorized requests fail; records survive restart and redeploy |
| 3 Desktop browser experience | Desktop forms, efficient photo loading, camera/upload, on-screen calendar, printing, robust TSV import | Desktop workflows pass; all categories appear; slow-network and failed-save behavior preserve edits |
| 4 Recovery and cutover | Remote backup schedule, visible status, external monitoring, restore drill, documented release procedure | A downloaded backup restores successfully; controlled final import matches 177 plants and 9 activities if the source is unchanged |

The migration test matrix must cover fresh databases, every recognized legacy shape, this version 3 file via local disposable copies, missing or contradictory version metadata, unknown future versions, repeated startup, and interrupted schema/history writes. Photo-bearing synthetic fixtures are essential because this golden database has no photos. Also test simultaneous migration attempts, failed backup uploads, disk-full errors, duplicate import submissions, stale edits from two devices, and recovery after a deployment failure.

Keep private plant data out of Git, container images, public build artifacts, and routine CI logs. CI should use synthetic fixtures; the private golden-copy rehearsal belongs in a controlled local or private staging process. Add checks on pull requests before deployment. The current workflow only builds macOS releases on tags or manual invocation and deletes older releases; future releases must retain the artifacts needed for rollback.

## Verification completed

The TypeScript check and production Vue build passed with the repository's locked frontend dependencies. No application source was changed. There are no tracked application tests in this checkout, and the Rust toolchain is not installed in the execution environment, so native application compilation and interactive desktop behavior were not verified.

The database integrity, content checks, backup/restore rehearsal, and migration failure experiments completed successfully as an audit. The failure experiments used the exact migration SQL extracted from the source with its runner control flow reproduced in Python's SQLite 3.43.2; they are SQL-level reproductions, not execution of the Rust binary. Foreign key behavior was tested explicitly in both modes. [Database inspection results](/Users/bram/Documents/TuinApp-preserved-data/2026-10-12/database-inspection.json) and [migration audit results](/Users/bram/Documents/TuinApp-preserved-data/2026-10-12/migration-audit-results.json) retain the evidence.

The final hashes of the original, golden copy, and inspection copy remained identical to the recorded checksum. The only repository addition is this assessment; dependency installation and the frontend build produced ignored local files.
