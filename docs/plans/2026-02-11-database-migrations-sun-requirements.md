# Database Migrations & Sun Requirements Design

## Overview

Add a proper database migration system with version tracking, and change `sun_requirement` from a single TEXT value to a bitmask INTEGER supporting multiple selections.

## Schema Version Table

```sql
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO schema_version (version) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM schema_version);
```

## Migration Structure

Migrations defined as `(version, up_sql, down_sql)` tuples in Rust:

- **Version 1**: Base schema (plants, plant_photos, activities) - existing databases treated as v1
- **Version 2**: Convert `sun_requirement` TEXT to `sun_requirements` INTEGER bitmask

### Migration Runner Logic

1. Create `schema_version` table if needed
2. Get current version (default 0)
3. Detect existing databases (if `plants` table exists but no `schema_version`, set to v1)
4. Run pending up migrations sequentially
5. Update version after each successful migration

## Version 2 Migration: Sun Requirements

### Bitmask Values

| Value | Bit | Decimal |
|-------|-----|---------|
| Full Sun | 001 | 1 |
| Partial Shade | 010 | 2 |
| Full Shade | 100 | 4 |

Combinations: Full Sun + Partial Shade = 3, All three = 7, etc.

### Up Migration (v1 → v2)

```sql
CREATE TABLE plants_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    plant_type TEXT CHECK(plant_type IN ('vegetable_fruit', 'flower', 'herb')),
    sun_requirements INTEGER DEFAULT 0,
    sow_periods INTEGER DEFAULT 0,
    plant_periods INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO plants_new SELECT
    id, name, plant_type,
    CASE sun_requirement
        WHEN 'full_sun' THEN 1
        WHEN 'partial_shade' THEN 2
        WHEN 'full_shade' THEN 4
        ELSE 0
    END,
    sow_periods, plant_periods, notes, created_at, updated_at
FROM plants;

DROP TABLE plants;
ALTER TABLE plants_new RENAME TO plants;
```

### Down Migration (v2 → v1)

```sql
CREATE TABLE plants_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    plant_type TEXT CHECK(plant_type IN ('vegetable_fruit', 'flower', 'herb')),
    sun_requirement TEXT CHECK(sun_requirement IN ('full_sun', 'partial_shade', 'full_shade')),
    sow_periods INTEGER DEFAULT 0,
    plant_periods INTEGER DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO plants_new SELECT
    id, name, plant_type,
    CASE
        WHEN (sun_requirements & 1) != 0 THEN 'full_sun'
        WHEN (sun_requirements & 2) != 0 THEN 'partial_shade'
        WHEN (sun_requirements & 4) != 0 THEN 'full_shade'
        ELSE NULL
    END,
    sow_periods, plant_periods, notes, created_at, updated_at
FROM plants;

DROP TABLE plants;
ALTER TABLE plants_new RENAME TO plants;
```

Note: Down migration loses combination data (picks first matching value).

## Files to Modify

1. `src-tauri/src/db.rs` - Migration system with version tracking
2. `src-tauri/src/models.rs` - `sun_requirement: Option<String>` → `sun_requirements: i32`
3. `src-tauri/src/commands.rs` - Update plant queries
4. `src/types.ts` - Update Plant type
5. `src/components/PlantForm.vue` - Checkboxes instead of dropdown
6. `src/components/PlantList.vue` - Display multiple sun icons

## Frontend Changes

### PlantForm

Replace dropdown with checkboxes:

```vue
<div class="checkbox-group">
  <label><input type="checkbox" :checked="hasSun(1)" @change="toggleSun(1)"> Full Sun</label>
  <label><input type="checkbox" :checked="hasSun(2)" @change="toggleSun(2)"> Partial Shade</label>
  <label><input type="checkbox" :checked="hasSun(4)" @change="toggleSun(4)"> Full Shade</label>
</div>
```

Helper functions:
- `hasSun(bit)`: `(form.sun_requirements & bit) !== 0`
- `toggleSun(bit)`: XOR to flip bit

### PlantList

Display concatenated icons for combinations (e.g., "☀️⛅" for sun + partial shade).
