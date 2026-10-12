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
    needs_reorder INTEGER NOT NULL DEFAULT 0 CHECK(needs_reorder IN (0,1))
);
CREATE TABLE activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 500),
    description TEXT,
    active_periods INTEGER NOT NULL DEFAULT 0 CHECK(active_periods BETWEEN 0 AND 16777215),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    row_count INTEGER NOT NULL
);
