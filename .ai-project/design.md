# TuinApp Design Document

**Date:** 2026-02-09
**Status:** In Progress

## 1. Data Model

### Plants Table
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PRIMARY KEY | Unique identifier |
| name | TEXT NOT NULL | Plant name (e.g., "Tomato Roma") |
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
- Form to add/edit plants
- Name, sun requirement dropdown, notes textarea
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
- Click plant row to edit

### 2.3 Activity Management View
- List of all activities
- Form to add/edit activities
- Name, description, 24-checkbox grid for active periods

### 2.4 Monthly Calendar View
- Dropdown or tabs to select month
- Cards/sections showing:
  - Plants to sow this month (early/late subdivisions)
  - Plants to plant this month (early/late subdivisions)
  - Activities for this month

## 3. Technical Architecture

### 3.1 Frontend (Vue.js)
- Vue 3 with Composition API
- Component structure:
  - PlantForm.vue
  - PlantGrid.vue
  - ActivityForm.vue
  - ActivityList.vue
  - MonthlyView.vue
  - PhotoCapture.vue
  - PeriodCheckboxGrid.vue (reusable 24-checkbox component)

### 3.2 Backend (Tauri/Rust)
- SQLite database using rusqlite
- Commands exposed to frontend:
  - Plant CRUD operations
  - Photo capture/storage
  - Activity CRUD operations
  - Query helpers for monthly view

### 3.3 Camera Integration
- Use HTML5 MediaDevices API in frontend
- Capture photo as base64
- Send to Rust backend for storage in SQLite

## 4. Open Questions

(To be filled in as design progresses)
