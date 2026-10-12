# Web migration verification

Verified locally on 12 October 2026. The application is implemented and the golden data is loaded into a separate working web database. It has not been deployed publicly. A local owner password is configured for the preview; choose the hosting password using the documented password tool.

## Completed checks

| Check | Result |
| --- | --- |
| Frontend production build and TypeScript checks | Passed |
| Frontend component/API-adapter tests | 116 passed |
| Real-browser workflow tests with golden data | 64 passed: 32 scenarios each in Chromium and Firefox |
| Public database/API/PDF tests | 26 passed |
| Private golden import/reopen/backup/restore test | 1 passed, deliberately excluded from public CI |
| Rust formatting and Clippy with warnings treated as errors | Passed |
| npm dependency security audit | 0 reported vulnerabilities at verification time |
| Git whitespace check | Passed |
| Original and both preserved copies | Identical SHA-256 before and after the work |

The complete browser suite passed with the compact PDF download. The new PDF tests cover the original page geometry, fonts, column positions, line spacing, long-list pagination, authentication, selected-month downloads, busy states and failure/retry behavior.

## Frontend coverage

Component tests cover all 24 period controls and boundary bits, field validation, editing without mutating source records, reset on reopening, Save & Add Another, duplicate-submit guards, unsaved-change cancellation, modal focus/Tab/Escape behavior, delete confirmation, trimmed/case-insensitive search, consistent sun symbols, empty/loading/error/retry states, failed-save preservation, completed saves followed by refresh errors, reorder updates, calendar categories and failed/stale requests, backup state/recovery/errors, login errors and API/session handling.

Real browser tests cover the private 177-plant/9-activity/17-reorder dataset; desktop creation, overview editing and deletion; keyboard validation and Enter-to-save; complete field/period round trips; order completion; search; failed reads and saves; session expiry without losing drafts; activity entry/reset/calendar display; absence of photo controls; absence of spreadsheet import and rejected legacy import endpoints; backup failure/retry, download and recovery; sign-out and reauthentication; 1280×800 and 1920×1080 layouts; and scrolling the annual overview without losing its headings or legend. One existing stale-edit regression remains; the focus is ordinary single-owner use.

Automated accessibility checks cover the five main views and the plant dialog against WCAG A/AA rule groups supported by axe. They are not a complete accessibility certification. Desktop screenshots were visually inspected for the list, overview, calendar, backups and plant form; review images remain local under `.local/visual-review/` and are ignored by Git.

## Sign-in and desktop refinements

Reproduced two failures before fixing them: a failed list read produced two error alerts, and an expired read remained at “Try again” after successful sign-in. The hidden workspace was preserved for drafts but never reloaded. Successful reauthentication now refreshes the active view without remounting forms or resubmitting changes, and restores keyboard focus to an open draft. Reads report errors inline instead of also leaving a global banner. Slow sign-in submissions are guarded against duplicates. Browser regressions verify recovery for Plants, Overview, Activities, Calendar, To Order and Settings, plus draft preservation and single-alert retry.

Removed plant photo columns, camera/upload/viewer controls, client APIs and server endpoints. Legacy attachment data and migration history remain intact for lossless imports and backups. App sun symbols use the same geometry as the print SVGs, with yellow suns and grey clouds; the PDF remains black and white. Tests compare the vector geometry, every sun-bit combination, form selection and actual browser image loading.

Plant Overview shades exactly one half-month column (days 1–15 or day 16 onwards), without replacing sowing/planting colors. It updates at local midnight. The optional active-month filter includes either half of the current month and either action, preserves name order and reports the visible count. Tests cover early/late boundaries, January/December, leap day, rollover, empty months and retained action colors. With the reference data, October shows 14 of 177 plants. Activities now lists scheduled months once per month; both halves collapse to one label, with “Every month” and “Not scheduled” for the full/empty cases. All 12 months and both half-month bits are tested, including an edit/save refresh.

The updated local preview was checked at 1280×800 with 177 plants and 9 activities, no visible errors or browser exceptions. Screenshots of the colored list/form, current-month filter and activity months are saved under ignored `.local/visual-review/`. All read/write browser regressions use a separate disposable database; the preview check did not save any changes.

## Data coverage

The importer is tested against unversioned schemas (with and without categories) and versions 1, 2 and 3. Synthetic fixtures include duplicate names, Unicode, multiline notes, photographs, missing categories, ID gaps and sequence state. Invalid/unknown/partially migrated input is rejected without publishing a destination or changing the source.

Migration tests inject SQL failures and history-write failures, verify rollback and retry, reject tampered/missing/future migration history and confirm repeat runs do not reapply completed changes. Backup tests include committed WAL writes, checksums, count checks, corruption rejection, no-overwrite restores, scheduled execution without a browser, retention, failure reporting and recovery from the actual downloaded ZIP. Removed photo endpoints reject read/upload/delete requests; historical image bytes remain preserved by imports and backups.

The golden regression compares every original column for every record, all period bits across all 12 months, and reorder counts after import, reopening and restoration. Results: 177 plants, 9 activities, 17 reorder flags, 0 photos. Original checksum:

`ad2e267df1ad06250204f3fd2a9a7f8c19bc5f531f4c7285c61f966bf3dd29a6`

Working data: `data/tuinapp.sqlite`. First verified working-data backup: `backups/tuinapp-20261012T075900Z-e338f116-6959-4062-bc43-5cb2f843d9c3.sqlite` with its JSON manifest. Both directories are ignored by Git. The original and preserved golden files remain outside this runtime path.

## Original PDF layout restored

The Calendar's **Printable PDF** button downloads a PDF generated by the ported original Rust renderer (`printpdf` 0.7). It preserves A4 portrait, Helvetica, 5.5-point plant text, 11-point section headings, 8-point period headings, 6.5-point category headings, column starts at 10/75/140 mm, 2.8 mm row spacing, and black text. At the user’s request, custom vector sun/partly-cloudy/cloud icons now replace the sunlight asterisks; numbered references replace `(N)`. The website's screen design is separate from this print layout. The previous expanded browser print output is superseded.

The original baseline was generated directly with the unchanged desktop PDF function and original frontend formatting. The full Tauri application was not launched. The corrected web PDFs were downloaded through the actual Calendar button from a disposable web server imported from the preserved golden copy. Neither path wrote to the golden source or used the user's working database.

| Reference month | Original PDF | Restored web PDF | Layout verification |
| --- | --- | --- | --- |
| October | 1 page | 1 page | Original planner geometry, new symbols, 9 distinct full plant notes |
| April | 2 pages | 2 pages | Same typography and column geometry, new symbols, 37 distinct full plant notes |

The initial layout restoration was pixel-for-pixel identical for October; the later requested symbols, legend and full notes deliberately change those details. Every revised page was rendered and visually inspected. April keeps the original design with pagination inside long lists, and uncategorized entries use a small `Other` label within the existing third column. Both current reference PDFs include every full normalized plant note and have no characters outside page bounds. Notes use the same 5.5-point Helvetica, with 2.2 mm leading and three columns in the remaining space after activities. Identical note text is printed once and reused across plants and periods. Newlines, tabs and repeated spaces collapse to a single space; long words wrap instead of clipping. The original activity abbreviation is unchanged.

The symbols are native PDF vector paths with black strokes and white cloud interiors, with no raster images or grey shading. Reusable SVGs are in `public/print-icons/`. All eight combinations of sunlight flags, distinct cloud/sun outlines, note normalization/deduplication, blank notes, Unicode encoding, long-note wrapping and multi-page flow have regressions. All 26 current public Rust tests and Clippy passed; the four PDF browser scenarios passed again in Chromium and Firefox after the update.

Private PDFs and machine-readable comparison results are in ignored `output/pdf/`. The original and both preserved database copies retain SHA-256 `ad2e267df1ad06250204f3fd2a9a7f8c19bc5f531f4c7285c61f966bf3dd29a6`. Physical printing remains untested.

To regenerate the web PDFs locally through the real browser download flow:

```sh
TUINAPP_GOLDEN_DB=/absolute/path/to/db.golden.sqlite \
TUINAPP_PDF_OUTPUT=output/pdf \
npm run test:e2e -- tests/browser/pdf.spec.ts
```

## Container verification and workspace cleanup

The Linux ARM64 image `tuinapp:local` was built successfully from the multi-stage Dockerfile in a dedicated local Colima environment. The same disposable runtime smoke test passed twice: once with an empty garden and once with a read-only copy of the golden legacy source. It checked non-root execution, a read-only root filesystem, HTTP health, private API access, login, compiled assets, plant creation, PDFs, backup creation/download, recovery verification and record persistence after restart. The golden run verified 177 baseline plants and 17 reorder flags, imported 9 activities, preserved every baseline plant through restart, and confirmed the source checksum stayed unchanged. Temporary containers and volumes were removed afterwards.

The container build context is an allowlist of application sources and manifests. Credentials, garden databases, snapshots, tests and private comparison files are excluded. Compose configuration was validated, with named data/backup volumes and a configurable loopback host port. GitHub Actions has a dedicated native AMD64/ARM64 build-and-smoke-test workflow using the same script; workflow run results are authoritative for each pushed commit. Images are built/tested, with no registry publishing configured.

The old desktop backend, installers/icons, starter logos, outdated desktop plans/screenshots and duplicate project notes were removed from the active workspace. Git history retains the original application. Machine-local assistant settings are now ignored and kept locally; the old spreadsheet is preserved in ignored `.local/legacy-reference/`. Spreadsheet preview/import routes, parsing/writing code, UI, client methods and obsolete tests were removed. Endpoint regressions confirm that attempts to use the removed routes cannot change garden data or backups. Historical migration checksums and import provenance remain intact; legacy database conversion and recovery tools remain available.

## Limits and hosting follow-up

- WebKit could not create a browser page on this macOS 14 workstation: the frozen browser build reports `Unknown setting: PushAPIEnabled`. Chromium and Firefox passed; Linux CI is configured to also test WebKit, and Linux CI passed the complete suite on commit `d89626f`.
- Container builds and runtime checks are tracked in the dedicated Build and test container workflow; see the container verification below.
- Real OS printing was not exercised. Actual PDF downloads were exercised in real browsers, and PDF layouts were rendered and compared separately.
- Independent encrypted backups, remote failure alerts, HTTPS and an off-site recovery drill require the selected hosting environment. Current snapshots and golden copies are on this computer.
- Tests cover normal workflows and deliberate failure cases; they cannot guarantee absence of all future defects. Add a regression when a real issue is found.
