CREATE TABLE plants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 500),
  plant_type TEXT CHECK(plant_type IN ('vegetable_fruit','flower','herb')),
  sun_requirements INTEGER NOT NULL DEFAULT 0 CHECK(sun_requirements BETWEEN 0 AND 7),
  sow_periods INTEGER NOT NULL DEFAULT 0 CHECK(sow_periods BETWEEN 0 AND 16777215),
  plant_periods INTEGER NOT NULL DEFAULT 0 CHECK(plant_periods BETWEEN 0 AND 16777215),
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  needs_reorder INTEGER NOT NULL DEFAULT 0 CHECK(needs_reorder IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);
CREATE TABLE activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 500),
  description TEXT,
  active_periods INTEGER NOT NULL DEFAULT 0 CHECK(active_periods BETWEEN 0 AND 16777215),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);
CREATE TABLE plant_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  image_data BLOB,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX photos_by_plant ON plant_photos(plant_id, sort_order, id);
CREATE TABLE imports (
  fingerprint TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  row_count INTEGER NOT NULL CHECK(row_count >= 0)
);
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  restore_epoch INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE auth_attempts (
  bucket TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE TABLE app_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  schema_version INTEGER NOT NULL DEFAULT 1,
  generation INTEGER NOT NULL DEFAULT 0,
  restore_epoch INTEGER NOT NULL DEFAULT 0,
  backup_generation INTEGER NOT NULL DEFAULT -1,
  backup_last_success INTEGER,
  backup_last_error TEXT,
  backup_failed_at INTEGER,
  backup_last_checked_at INTEGER,
  backup_checked_unchanged INTEGER NOT NULL DEFAULT 0,
  restore_verified_at INTEGER,
  backup_lease_until INTEGER
);
INSERT INTO app_state(id) VALUES(1);
CREATE TABLE transaction_assertions (
  ok INTEGER NOT NULL CHECK(ok=1)
);
CREATE TABLE backup_manifests (
  file TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  generation INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  plants INTEGER NOT NULL,
  activities INTEGER NOT NULL,
  photos INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL
);
