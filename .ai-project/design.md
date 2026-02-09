# TuinApp Design Document

**Date:** 2026-02-09
**Status:** Finalized

## 1. Data Model

### Plants Table
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Unique identifier |
| name | TEXT NOT NULL | Plant name (e.g., "Tomato Roma") |
| plant_type | TEXT | vegetable_fruit / flower / herb |
| sun_requirement | TEXT | full_sun / partial_shade / full_shade |
| sow_periods | INTEGER | 24-bit bitmask for sowing periods |
| plant_periods | INTEGER | 24-bit bitmask for planting periods |
| notes | TEXT | Free text notes |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |

**Bitmask encoding:**
- Bit 0: January early
- Bit 1: January late
- Bit 2: February early
- Bit 3: February late
- ... (continues for all 12 months)
- Bit 22: December early
- Bit 23: December late

### Plant Photos Table
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Unique identifier |
| plant_id | INTEGER NOT NULL | Foreign key to plants |
| sort_order | INTEGER | Display order (1, 2, 3...) |
| image_data | BLOB | Binary image data |
| created_at | DATETIME | Creation timestamp |

### Activities Table
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Unique identifier |
| name | TEXT NOT NULL | Activity name |
| description | TEXT | Activity details |
| active_periods | INTEGER | 24-bit bitmask for active months |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |

## 2. Views

### 2.1 Plant Management View
- Form to add/edit plants (modal dialog)
- Name, plant type dropdown (vegetable/fruit, flower, herb), sun requirement dropdown, notes textarea
- 24-checkbox grid for sowing periods (visual month/period layout)
- 24-checkbox grid for planting periods
- Photo gallery with camera capture button
- Drag-to-reorder photos

### 2.2 Plant Overview Grid
- Rows: All plants (sorted alphabetically or custom)
- Columns: 12 months (subdivided into early/late)
- Cell colors:
  - Green for sowing periods
  - Brown/orange for planting periods
- Click plant row to open edit modal

### 2.3 Activity Management View
- List of all activities
- Form to add/edit activities (modal dialog)
- Name, description, 24-checkbox grid for active periods

### 2.4 Monthly Calendar View
- Dropdown or tabs to select month
- Cards/sections showing:
  - Plants to sow this month (early/late subdivisions)
  - Plants to plant this month (early/late subdivisions)
  - Activities for this month

## 3. Navigation & Layout

### Main Navigation
Sidebar or top navigation with four sections:
1. **Plants** - Plant management and overview grid
2. **Activities** - Activity management
3. **Calendar** - Monthly view
4. **Settings** - Database location, export/import

### Plant Section Tabs
- "Manage Plants" - list with add/edit/delete
- "Overview" - grid visualization

### Quick Add & Edit
- Persistent "+ Add Plant" / "+ Add Activity" buttons in header (visible from any view)
- Opens modal form for quick entry
- Same modal used for editing (pre-populated)
- "Save & Close" vs "Save & Add Another" buttons
- Delete button in edit modal (with confirmation)
- Keyboard shortcuts: Ctrl+N / Cmd+N for new, Enter/double-click to edit

## 4. Technical Architecture

### 4.1 Frontend (Vue.js)
- Vue 3 with Composition API
- Component structure:
  - `PeriodCheckboxGrid.vue` - reusable 24-checkbox month/period selector
  - `PhotoCapture.vue` - camera access and photo gallery
  - `PlantForm.vue` - add/edit plant modal
  - `PlantList.vue` - plant list view
  - `PlantGrid.vue` - plant overview grid
  - `ActivityForm.vue` - add/edit activity modal
  - `ActivityList.vue` - activity list view
  - `MonthlyView.vue` - calendar view
  - `AppHeader.vue` - navigation and quick-add buttons

### 4.2 Backend (Tauri/Rust)
- SQLite database using `rusqlite` crate
- Tauri commands exposed to frontend:
  - `create_plant`, `update_plant`, `delete_plant`, `get_all_plants`, `get_plant`
  - `add_photo`, `delete_photo`, `reorder_photos`, `get_photos`
  - `create_activity`, `update_activity`, `delete_activity`, `get_all_activities`
  - `get_month_data(month)` - returns plants/activities for a specific month
  - `get_database_path`, `set_database_path`

### 4.3 Camera Integration
- HTML5 `navigator.mediaDevices.getUserMedia()` in frontend
- Capture frame to canvas, convert to base64
- Send to Rust backend which stores as BLOB in SQLite

### 4.4 Database Location
- Stored in user-chosen location (or default app data folder)
- Single `.db` file for easy backup to Google Drive
- Settings view allows changing database location
