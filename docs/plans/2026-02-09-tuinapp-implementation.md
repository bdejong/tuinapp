# TuinApp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a desktop garden management app for tracking plants, sowing/planting schedules, and garden activities.

**Architecture:** Tauri app with Rust backend handling SQLite database operations, Vue.js frontend for UI. Single SQLite file stores all data including photos as BLOBs.

**Tech Stack:** Rust, Tauri 2.x, Vue 3 (Composition API), SQLite (rusqlite), Vite

---

## Phase 1: Environment Setup

### Task 1.1: Install Rust

**Step 1: Install Rust via rustup**

Run:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Follow prompts, select default installation.

**Step 2: Reload shell and verify**

Run:
```bash
source ~/.cargo/env
rustc --version
cargo --version
```

Expected: Version numbers displayed (rustc 1.7x.x, cargo 1.7x.x)

**Step 3: Commit note to docs**

No commit needed - system setup only.

---

### Task 1.2: Install Tauri CLI

**Step 1: Install Tauri CLI globally**

Run:
```bash
cargo install tauri-cli
```

**Step 2: Verify installation**

Run:
```bash
cargo tauri --version
```

Expected: `tauri-cli 2.x.x`

---

## Phase 2: Project Scaffolding

### Task 2.1: Create Tauri + Vue Project

**Step 1: Initialize project with create-tauri-app**

Run from project directory:
```bash
cd /Users/bram.dejong/Documents/dev/_sandbox/tuinapp
npm create tauri-app@latest . -- --template vue-ts
```

When prompted:
- Package manager: npm
- Template: Vue with TypeScript

**Step 2: Install dependencies**

Run:
```bash
npm install
```

**Step 3: Verify project runs**

Run:
```bash
npm run tauri dev
```

Expected: Window opens with Vite + Vue welcome page.

**Step 4: Commit scaffold**

```bash
git add -A
git commit -m "feat: scaffold Tauri + Vue project"
```

---

### Task 2.2: Add Rust Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

**Step 1: Add rusqlite and serde dependencies**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
rusqlite = { version = "0.31", features = ["bundled"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
base64 = "0.22"
```

**Step 2: Build to fetch dependencies**

Run:
```bash
cd src-tauri && cargo build
```

Expected: Build succeeds, dependencies downloaded.

**Step 3: Commit dependencies**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add rusqlite, serde, base64 dependencies"
```

---

## Phase 3: Database Layer

### Task 3.1: Create Database Module

**Files:**
- Create: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Create db.rs with connection helper**

Create `src-tauri/src/db.rs`:

```rust
use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &PathBuf) -> Result<Self> {
        let conn = Connection::open(path)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

pub fn get_db_path(app: &AppHandle) -> PathBuf {
    let app_dir = app.path().app_data_dir().expect("Failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    app_dir.join("tuinapp.db")
}
```

**Step 2: Add module to main.rs**

At top of `src-tauri/src/main.rs`, add:

```rust
mod db;
```

**Step 3: Build to verify**

Run:
```bash
cd src-tauri && cargo build
```

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src-tauri/src/db.rs src-tauri/src/main.rs
git commit -m "feat: add database module with connection helper"
```

---

### Task 3.2: Create Database Schema

**Files:**
- Modify: `src-tauri/src/db.rs`

**Step 1: Add migration function**

Add to `src-tauri/src/db.rs`:

```rust
pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS plants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            sun_requirement TEXT CHECK(sun_requirement IN ('full_sun', 'partial_shade', 'full_shade')),
            sow_periods INTEGER DEFAULT 0,
            plant_periods INTEGER DEFAULT 0,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS plant_photos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plant_id INTEGER NOT NULL,
            sort_order INTEGER DEFAULT 0,
            image_data BLOB,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            active_periods INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        "
    )?;
    Ok(())
}
```

**Step 2: Build to verify**

Run:
```bash
cd src-tauri && cargo build
```

Expected: Build succeeds.

**Step 3: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat: add database schema migrations"
```

---

### Task 3.3: Initialize Database on App Start

**Files:**
- Modify: `src-tauri/src/main.rs`

**Step 1: Update main.rs to init database**

Replace `src-tauri/src/main.rs` content with:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;

use db::{get_db_path, run_migrations, Database};
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = get_db_path(&app.handle());
            let database = Database::new(&db_path).expect("Failed to open database");

            {
                let conn = database.conn.lock().unwrap();
                run_migrations(&conn).expect("Failed to run migrations");
            }

            app.manage(database);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 2: Build and run to verify**

Run:
```bash
npm run tauri dev
```

Expected: App opens without errors. Database file created in app data directory.

**Step 3: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat: initialize database on app startup"
```

---

## Phase 4: Plant CRUD Backend

### Task 4.1: Create Plant Model

**Files:**
- Create: `src-tauri/src/models.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Create models.rs with Plant struct**

Create `src-tauri/src/models.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Plant {
    pub id: Option<i64>,
    pub name: String,
    pub sun_requirement: Option<String>,
    pub sow_periods: i32,
    pub plant_periods: i32,
    pub notes: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlantPhoto {
    pub id: Option<i64>,
    pub plant_id: i64,
    pub sort_order: i32,
    pub image_data: Option<String>, // base64 encoded
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Activity {
    pub id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub active_periods: i32,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}
```

**Step 2: Add module to main.rs**

Add after `mod db;`:

```rust
mod models;
```

**Step 3: Build to verify**

Run:
```bash
cd src-tauri && cargo build
```

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/main.rs
git commit -m "feat: add Plant, PlantPhoto, Activity models"
```

---

### Task 4.2: Create Plant Commands

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Create commands.rs with plant CRUD**

Create `src-tauri/src/commands.rs`:

```rust
use crate::db::Database;
use crate::models::Plant;
use tauri::State;

#[tauri::command]
pub fn get_all_plants(db: State<Database>) -> Result<Vec<Plant>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, sun_requirement, sow_periods, plant_periods, notes, created_at, updated_at FROM plants ORDER BY name")
        .map_err(|e| e.to_string())?;

    let plants = stmt
        .query_map([], |row| {
            Ok(Plant {
                id: row.get(0)?,
                name: row.get(1)?,
                sun_requirement: row.get(2)?,
                sow_periods: row.get(3)?,
                plant_periods: row.get(4)?,
                notes: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(plants)
}

#[tauri::command]
pub fn create_plant(db: State<Database>, plant: Plant) -> Result<Plant, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO plants (name, sun_requirement, sow_periods, plant_periods, notes) VALUES (?1, ?2, ?3, ?4, ?5)",
        (&plant.name, &plant.sun_requirement, &plant.sow_periods, &plant.plant_periods, &plant.notes),
    ).map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(Plant {
        id: Some(id),
        ..plant
    })
}

#[tauri::command]
pub fn update_plant(db: State<Database>, plant: Plant) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE plants SET name = ?1, sun_requirement = ?2, sow_periods = ?3, plant_periods = ?4, notes = ?5, updated_at = CURRENT_TIMESTAMP WHERE id = ?6",
        (&plant.name, &plant.sun_requirement, &plant.sow_periods, &plant.plant_periods, &plant.notes, &plant.id),
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_plant(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM plants WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;

    Ok(())
}
```

**Step 2: Register commands in main.rs**

Update `src-tauri/src/main.rs` to add module and register commands:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod models;

use db::{get_db_path, run_migrations, Database};
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = get_db_path(&app.handle());
            let database = Database::new(&db_path).expect("Failed to open database");

            {
                let conn = database.conn.lock().unwrap();
                run_migrations(&conn).expect("Failed to run migrations");
            }

            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_all_plants,
            commands::create_plant,
            commands::update_plant,
            commands::delete_plant,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 3: Build to verify**

Run:
```bash
cd src-tauri && cargo build
```

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat: add plant CRUD commands"
```

---

## Phase 5: Plant Frontend

### Task 5.1: Create TypeScript Types

**Files:**
- Create: `src/types.ts`

**Step 1: Create types.ts**

Create `src/types.ts`:

```typescript
export interface Plant {
  id?: number;
  name: string;
  sun_requirement?: 'full_sun' | 'partial_shade' | 'full_shade';
  sow_periods: number;
  plant_periods: number;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PlantPhoto {
  id?: number;
  plant_id: number;
  sort_order: number;
  image_data?: string;
  created_at?: string;
}

export interface Activity {
  id?: number;
  name: string;
  description?: string;
  active_periods: number;
  created_at?: string;
  updated_at?: string;
}

export const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
] as const;

export const SUN_REQUIREMENTS = [
  { value: 'full_sun', label: 'Full Sun' },
  { value: 'partial_shade', label: 'Partial Shade' },
  { value: 'full_shade', label: 'Full Shade' },
] as const;
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add TypeScript types for Plant, Activity, Photo"
```

---

### Task 5.2: Create API Helper

**Files:**
- Create: `src/api.ts`

**Step 1: Create api.ts**

Create `src/api.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { Plant, Activity, PlantPhoto } from './types';

// Plants
export const getAllPlants = () => invoke<Plant[]>('get_all_plants');
export const createPlant = (plant: Plant) => invoke<Plant>('create_plant', { plant });
export const updatePlant = (plant: Plant) => invoke<void>('update_plant', { plant });
export const deletePlant = (id: number) => invoke<void>('delete_plant', { id });

// Activities (to be implemented)
export const getAllActivities = () => invoke<Activity[]>('get_all_activities');
export const createActivity = (activity: Activity) => invoke<Activity>('create_activity', { activity });
export const updateActivity = (activity: Activity) => invoke<void>('update_activity', { activity });
export const deleteActivity = (id: number) => invoke<void>('delete_activity', { id });

// Photos (to be implemented)
export const getPhotos = (plantId: number) => invoke<PlantPhoto[]>('get_photos', { plantId });
export const addPhoto = (photo: PlantPhoto) => invoke<PlantPhoto>('add_photo', { photo });
export const deletePhoto = (id: number) => invoke<void>('delete_photo', { id });
```

**Step 2: Commit**

```bash
git add src/api.ts
git commit -m "feat: add Tauri API helper functions"
```

---

### Task 5.3: Create PeriodCheckboxGrid Component

**Files:**
- Create: `src/components/PeriodCheckboxGrid.vue`

**Step 1: Create the reusable 24-checkbox component**

Create `src/components/PeriodCheckboxGrid.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue';
import { MONTHS } from '../types';

const props = defineProps<{
  modelValue: number;
  label: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: number];
}>();

const periods = computed(() => {
  const result: boolean[] = [];
  for (let i = 0; i < 24; i++) {
    result.push((props.modelValue & (1 << i)) !== 0);
  }
  return result;
});

const togglePeriod = (index: number) => {
  const newValue = props.modelValue ^ (1 << index);
  emit('update:modelValue', newValue);
};
</script>

<template>
  <div class="period-grid">
    <div class="period-label">{{ label }}</div>
    <div class="grid">
      <div class="header-row">
        <div class="corner"></div>
        <div v-for="month in MONTHS" :key="month" class="month-header">
          {{ month }}
        </div>
      </div>
      <div class="period-row">
        <div class="row-label">Early</div>
        <div
          v-for="(_, monthIndex) in MONTHS"
          :key="`early-${monthIndex}`"
          class="cell"
          :class="{ active: periods[monthIndex * 2] }"
          @click="togglePeriod(monthIndex * 2)"
        ></div>
      </div>
      <div class="period-row">
        <div class="row-label">Late</div>
        <div
          v-for="(_, monthIndex) in MONTHS"
          :key="`late-${monthIndex}`"
          class="cell"
          :class="{ active: periods[monthIndex * 2 + 1] }"
          @click="togglePeriod(monthIndex * 2 + 1)"
        ></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.period-grid {
  margin: 1rem 0;
}

.period-label {
  font-weight: bold;
  margin-bottom: 0.5rem;
}

.grid {
  display: inline-block;
  border: 1px solid #ccc;
}

.header-row, .period-row {
  display: flex;
}

.corner, .row-label {
  width: 50px;
  padding: 4px;
  font-size: 0.75rem;
  background: #f5f5f5;
  border-right: 1px solid #ccc;
}

.month-header {
  width: 40px;
  text-align: center;
  padding: 4px;
  font-size: 0.75rem;
  background: #f5f5f5;
  border-right: 1px solid #eee;
}

.cell {
  width: 40px;
  height: 24px;
  border: 1px solid #eee;
  cursor: pointer;
  background: white;
}

.cell:hover {
  background: #e8f5e9;
}

.cell.active {
  background: #4caf50;
}

.period-row {
  border-top: 1px solid #eee;
}
</style>
```

**Step 2: Commit**

```bash
git add src/components/PeriodCheckboxGrid.vue
git commit -m "feat: add PeriodCheckboxGrid component"
```

---

### Task 5.4: Create PlantForm Component

**Files:**
- Create: `src/components/PlantForm.vue`

**Step 1: Create the plant add/edit form**

Create `src/components/PlantForm.vue`:

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Plant } from '../types';
import { SUN_REQUIREMENTS } from '../types';
import PeriodCheckboxGrid from './PeriodCheckboxGrid.vue';

const props = defineProps<{
  plant?: Plant;
  visible: boolean;
}>();

const emit = defineEmits<{
  save: [plant: Plant];
  'save-and-add': [plant: Plant];
  delete: [id: number];
  close: [];
}>();

const form = ref<Plant>({
  name: '',
  sun_requirement: undefined,
  sow_periods: 0,
  plant_periods: 0,
  notes: '',
});

watch(() => props.visible, (visible) => {
  if (visible && props.plant) {
    form.value = { ...props.plant };
  } else if (visible) {
    form.value = {
      name: '',
      sun_requirement: undefined,
      sow_periods: 0,
      plant_periods: 0,
      notes: '',
    };
  }
}, { immediate: true });

const isEditing = () => props.plant?.id !== undefined;

const handleSave = () => {
  emit('save', { ...form.value });
};

const handleSaveAndAdd = () => {
  emit('save-and-add', { ...form.value });
};

const handleDelete = () => {
  if (props.plant?.id && confirm('Delete this plant?')) {
    emit('delete', props.plant.id);
  }
};
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <h2>{{ isEditing() ? 'Edit Plant' : 'Add Plant' }}</h2>

      <div class="form-group">
        <label>Name</label>
        <input v-model="form.name" type="text" placeholder="Plant name" />
      </div>

      <div class="form-group">
        <label>Sun Requirement</label>
        <select v-model="form.sun_requirement">
          <option :value="undefined">-- Select --</option>
          <option v-for="opt in SUN_REQUIREMENTS" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </select>
      </div>

      <PeriodCheckboxGrid v-model="form.sow_periods" label="Sowing Periods" />
      <PeriodCheckboxGrid v-model="form.plant_periods" label="Planting Periods" />

      <div class="form-group">
        <label>Notes</label>
        <textarea v-model="form.notes" rows="3" placeholder="Optional notes"></textarea>
      </div>

      <div class="button-row">
        <button v-if="isEditing()" class="delete-btn" @click="handleDelete">Delete</button>
        <div class="spacer"></div>
        <button class="secondary-btn" @click="emit('close')">Cancel</button>
        <button v-if="!isEditing()" class="secondary-btn" @click="handleSaveAndAdd">Save & Add Another</button>
        <button class="primary-btn" @click="handleSave">{{ isEditing() ? 'Save' : 'Save & Close' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  width: 100%;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.25rem;
  font-weight: 500;
}

.form-group input,
.form-group select,
.form-group textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.button-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 1.5rem;
}

.spacer {
  flex: 1;
}

button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.primary-btn {
  background: #4caf50;
  color: white;
}

.secondary-btn {
  background: #e0e0e0;
}

.delete-btn {
  background: #f44336;
  color: white;
}
</style>
```

**Step 2: Commit**

```bash
git add src/components/PlantForm.vue
git commit -m "feat: add PlantForm component with modal"
```

---

### Task 5.5: Create PlantList Component

**Files:**
- Create: `src/components/PlantList.vue`

**Step 1: Create the plant list view**

Create `src/components/PlantList.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Plant } from '../types';
import { getAllPlants, createPlant, updatePlant, deletePlant } from '../api';
import PlantForm from './PlantForm.vue';

const plants = ref<Plant[]>([]);
const showForm = ref(false);
const editingPlant = ref<Plant | undefined>();

const loadPlants = async () => {
  plants.value = await getAllPlants();
};

onMounted(loadPlants);

const openAddForm = () => {
  editingPlant.value = undefined;
  showForm.value = true;
};

const openEditForm = (plant: Plant) => {
  editingPlant.value = plant;
  showForm.value = true;
};

const handleSave = async (plant: Plant) => {
  if (plant.id) {
    await updatePlant(plant);
  } else {
    await createPlant(plant);
  }
  await loadPlants();
  showForm.value = false;
};

const handleSaveAndAdd = async (plant: Plant) => {
  await createPlant(plant);
  await loadPlants();
  editingPlant.value = undefined;
};

const handleDelete = async (id: number) => {
  await deletePlant(id);
  await loadPlants();
  showForm.value = false;
};

defineExpose({ openAddForm });
</script>

<template>
  <div class="plant-list">
    <div class="header">
      <h1>Plants</h1>
      <button class="add-btn" @click="openAddForm">+ Add Plant</button>
    </div>

    <table v-if="plants.length > 0">
      <thead>
        <tr>
          <th>Name</th>
          <th>Sun</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="plant in plants" :key="plant.id" @click="openEditForm(plant)">
          <td>{{ plant.name }}</td>
          <td>{{ plant.sun_requirement?.replace('_', ' ') || '-' }}</td>
          <td>{{ plant.notes || '-' }}</td>
        </tr>
      </tbody>
    </table>

    <p v-else class="empty">No plants yet. Add your first plant!</p>

    <PlantForm
      :visible="showForm"
      :plant="editingPlant"
      @save="handleSave"
      @save-and-add="handleSaveAndAdd"
      @delete="handleDelete"
      @close="showForm = false"
    />
  </div>
</template>

<style scoped>
.plant-list {
  padding: 1rem;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.add-btn {
  background: #4caf50;
  color: white;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  text-align: left;
  padding: 0.75rem;
  border-bottom: 1px solid #eee;
}

th {
  background: #f5f5f5;
}

tbody tr {
  cursor: pointer;
}

tbody tr:hover {
  background: #f9f9f9;
}

.empty {
  color: #666;
  text-align: center;
  padding: 2rem;
}
</style>
```

**Step 2: Commit**

```bash
git add src/components/PlantList.vue
git commit -m "feat: add PlantList component"
```

---

### Task 5.6: Update App.vue with Navigation

**Files:**
- Modify: `src/App.vue`

**Step 1: Replace App.vue with navigation shell**

Replace `src/App.vue` content:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import PlantList from './components/PlantList.vue';

type View = 'plants' | 'activities' | 'calendar' | 'settings';

const currentView = ref<View>('plants');
const plantListRef = ref<InstanceType<typeof PlantList> | null>(null);

const handleAddPlant = () => {
  if (currentView.value !== 'plants') {
    currentView.value = 'plants';
  }
  setTimeout(() => plantListRef.value?.openAddForm(), 0);
};
</script>

<template>
  <div class="app">
    <nav class="sidebar">
      <h2>TuinApp</h2>
      <ul>
        <li :class="{ active: currentView === 'plants' }" @click="currentView = 'plants'">
          Plants
        </li>
        <li :class="{ active: currentView === 'activities' }" @click="currentView = 'activities'">
          Activities
        </li>
        <li :class="{ active: currentView === 'calendar' }" @click="currentView = 'calendar'">
          Calendar
        </li>
        <li :class="{ active: currentView === 'settings' }" @click="currentView = 'settings'">
          Settings
        </li>
      </ul>
      <div class="quick-add">
        <button @click="handleAddPlant">+ Add Plant</button>
        <button>+ Add Activity</button>
      </div>
    </nav>

    <main class="content">
      <PlantList v-if="currentView === 'plants'" ref="plantListRef" />
      <div v-else-if="currentView === 'activities'" class="placeholder">Activities (coming soon)</div>
      <div v-else-if="currentView === 'calendar'" class="placeholder">Calendar (coming soon)</div>
      <div v-else-if="currentView === 'settings'" class="placeholder">Settings (coming soon)</div>
    </main>
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
</style>

<style scoped>
.app {
  display: flex;
  height: 100vh;
}

.sidebar {
  width: 200px;
  background: #2c3e50;
  color: white;
  padding: 1rem;
  display: flex;
  flex-direction: column;
}

.sidebar h2 {
  margin-bottom: 1.5rem;
}

.sidebar ul {
  list-style: none;
  flex: 1;
}

.sidebar li {
  padding: 0.75rem;
  cursor: pointer;
  border-radius: 4px;
  margin-bottom: 0.25rem;
}

.sidebar li:hover {
  background: rgba(255, 255, 255, 0.1);
}

.sidebar li.active {
  background: rgba(255, 255, 255, 0.2);
}

.quick-add {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.quick-add button {
  padding: 0.5rem;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.content {
  flex: 1;
  overflow-y: auto;
  background: #fafafa;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #666;
  font-size: 1.25rem;
}
</style>
```

**Step 2: Run to verify**

Run:
```bash
npm run tauri dev
```

Expected: App shows sidebar with navigation, Plants view with add/edit functionality.

**Step 3: Commit**

```bash
git add src/App.vue
git commit -m "feat: add navigation shell and integrate PlantList"
```

---

## Phase 6: Activity CRUD

### Task 6.1: Add Activity Commands to Backend

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Add activity commands to commands.rs**

Add to `src-tauri/src/commands.rs`:

```rust
use crate::models::{Activity, Plant};

// ... existing plant commands ...

#[tauri::command]
pub fn get_all_activities(db: State<Database>) -> Result<Vec<Activity>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, description, active_periods, created_at, updated_at FROM activities ORDER BY name")
        .map_err(|e| e.to_string())?;

    let activities = stmt
        .query_map([], |row| {
            Ok(Activity {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                active_periods: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(activities)
}

#[tauri::command]
pub fn create_activity(db: State<Database>, activity: Activity) -> Result<Activity, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO activities (name, description, active_periods) VALUES (?1, ?2, ?3)",
        (&activity.name, &activity.description, &activity.active_periods),
    ).map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(Activity {
        id: Some(id),
        ..activity
    })
}

#[tauri::command]
pub fn update_activity(db: State<Database>, activity: Activity) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE activities SET name = ?1, description = ?2, active_periods = ?3, updated_at = CURRENT_TIMESTAMP WHERE id = ?4",
        (&activity.name, &activity.description, &activity.active_periods, &activity.id),
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_activity(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM activities WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;

    Ok(())
}
```

**Step 2: Register activity commands in main.rs**

Update invoke_handler in `src-tauri/src/main.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::get_all_plants,
    commands::create_plant,
    commands::update_plant,
    commands::delete_plant,
    commands::get_all_activities,
    commands::create_activity,
    commands::update_activity,
    commands::delete_activity,
])
```

**Step 3: Build to verify**

Run:
```bash
cd src-tauri && cargo build
```

Expected: Build succeeds.

**Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat: add activity CRUD commands"
```

---

### Task 6.2: Create ActivityForm Component

**Files:**
- Create: `src/components/ActivityForm.vue`

**Step 1: Create activity form**

Create `src/components/ActivityForm.vue`:

```vue
<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Activity } from '../types';
import PeriodCheckboxGrid from './PeriodCheckboxGrid.vue';

const props = defineProps<{
  activity?: Activity;
  visible: boolean;
}>();

const emit = defineEmits<{
  save: [activity: Activity];
  'save-and-add': [activity: Activity];
  delete: [id: number];
  close: [];
}>();

const form = ref<Activity>({
  name: '',
  description: '',
  active_periods: 0,
});

watch(() => props.visible, (visible) => {
  if (visible && props.activity) {
    form.value = { ...props.activity };
  } else if (visible) {
    form.value = {
      name: '',
      description: '',
      active_periods: 0,
    };
  }
}, { immediate: true });

const isEditing = () => props.activity?.id !== undefined;

const handleSave = () => emit('save', { ...form.value });
const handleSaveAndAdd = () => emit('save-and-add', { ...form.value });

const handleDelete = () => {
  if (props.activity?.id && confirm('Delete this activity?')) {
    emit('delete', props.activity.id);
  }
};
</script>

<template>
  <div v-if="visible" class="modal-overlay" @click.self="emit('close')">
    <div class="modal">
      <h2>{{ isEditing() ? 'Edit Activity' : 'Add Activity' }}</h2>

      <div class="form-group">
        <label>Name</label>
        <input v-model="form.name" type="text" placeholder="Activity name" />
      </div>

      <div class="form-group">
        <label>Description</label>
        <textarea v-model="form.description" rows="3" placeholder="Activity description"></textarea>
      </div>

      <PeriodCheckboxGrid v-model="form.active_periods" label="Active Periods" />

      <div class="button-row">
        <button v-if="isEditing()" class="delete-btn" @click="handleDelete">Delete</button>
        <div class="spacer"></div>
        <button class="secondary-btn" @click="emit('close')">Cancel</button>
        <button v-if="!isEditing()" class="secondary-btn" @click="handleSaveAndAdd">Save & Add Another</button>
        <button class="primary-btn" @click="handleSave">{{ isEditing() ? 'Save' : 'Save & Close' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal {
  background: white;
  padding: 2rem;
  border-radius: 8px;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  width: 100%;
}

.form-group {
  margin-bottom: 1rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.25rem;
  font-weight: 500;
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.button-row {
  display: flex;
  gap: 0.5rem;
  margin-top: 1.5rem;
}

.spacer { flex: 1; }

button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.primary-btn { background: #4caf50; color: white; }
.secondary-btn { background: #e0e0e0; }
.delete-btn { background: #f44336; color: white; }
</style>
```

**Step 2: Commit**

```bash
git add src/components/ActivityForm.vue
git commit -m "feat: add ActivityForm component"
```

---

### Task 6.3: Create ActivityList Component

**Files:**
- Create: `src/components/ActivityList.vue`

**Step 1: Create activity list**

Create `src/components/ActivityList.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import type { Activity } from '../types';
import { getAllActivities, createActivity, updateActivity, deleteActivity } from '../api';
import ActivityForm from './ActivityForm.vue';

const activities = ref<Activity[]>([]);
const showForm = ref(false);
const editingActivity = ref<Activity | undefined>();

const loadActivities = async () => {
  activities.value = await getAllActivities();
};

onMounted(loadActivities);

const openAddForm = () => {
  editingActivity.value = undefined;
  showForm.value = true;
};

const openEditForm = (activity: Activity) => {
  editingActivity.value = activity;
  showForm.value = true;
};

const handleSave = async (activity: Activity) => {
  if (activity.id) {
    await updateActivity(activity);
  } else {
    await createActivity(activity);
  }
  await loadActivities();
  showForm.value = false;
};

const handleSaveAndAdd = async (activity: Activity) => {
  await createActivity(activity);
  await loadActivities();
  editingActivity.value = undefined;
};

const handleDelete = async (id: number) => {
  await deleteActivity(id);
  await loadActivities();
  showForm.value = false;
};

defineExpose({ openAddForm });
</script>

<template>
  <div class="activity-list">
    <div class="header">
      <h1>Activities</h1>
      <button class="add-btn" @click="openAddForm">+ Add Activity</button>
    </div>

    <table v-if="activities.length > 0">
      <thead>
        <tr>
          <th>Name</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="activity in activities" :key="activity.id" @click="openEditForm(activity)">
          <td>{{ activity.name }}</td>
          <td>{{ activity.description || '-' }}</td>
        </tr>
      </tbody>
    </table>

    <p v-else class="empty">No activities yet. Add your first activity!</p>

    <ActivityForm
      :visible="showForm"
      :activity="editingActivity"
      @save="handleSave"
      @save-and-add="handleSaveAndAdd"
      @delete="handleDelete"
      @close="showForm = false"
    />
  </div>
</template>

<style scoped>
.activity-list { padding: 1rem; }
.header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
.add-btn { background: #4caf50; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #eee; }
th { background: #f5f5f5; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: #f9f9f9; }
.empty { color: #666; text-align: center; padding: 2rem; }
</style>
```

**Step 2: Commit**

```bash
git add src/components/ActivityList.vue
git commit -m "feat: add ActivityList component"
```

---

### Task 6.4: Integrate Activities into App

**Files:**
- Modify: `src/App.vue`

**Step 1: Update App.vue to include ActivityList**

Add import and wire up the Activities view. Update the script section:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import PlantList from './components/PlantList.vue';
import ActivityList from './components/ActivityList.vue';

type View = 'plants' | 'activities' | 'calendar' | 'settings';

const currentView = ref<View>('plants');
const plantListRef = ref<InstanceType<typeof PlantList> | null>(null);
const activityListRef = ref<InstanceType<typeof ActivityList> | null>(null);

const handleAddPlant = () => {
  if (currentView.value !== 'plants') {
    currentView.value = 'plants';
  }
  setTimeout(() => plantListRef.value?.openAddForm(), 0);
};

const handleAddActivity = () => {
  if (currentView.value !== 'activities') {
    currentView.value = 'activities';
  }
  setTimeout(() => activityListRef.value?.openAddForm(), 0);
};
</script>
```

Update the template to show ActivityList and wire the button:

```vue
<template>
  <div class="app">
    <nav class="sidebar">
      <h2>TuinApp</h2>
      <ul>
        <li :class="{ active: currentView === 'plants' }" @click="currentView = 'plants'">
          Plants
        </li>
        <li :class="{ active: currentView === 'activities' }" @click="currentView = 'activities'">
          Activities
        </li>
        <li :class="{ active: currentView === 'calendar' }" @click="currentView = 'calendar'">
          Calendar
        </li>
        <li :class="{ active: currentView === 'settings' }" @click="currentView = 'settings'">
          Settings
        </li>
      </ul>
      <div class="quick-add">
        <button @click="handleAddPlant">+ Add Plant</button>
        <button @click="handleAddActivity">+ Add Activity</button>
      </div>
    </nav>

    <main class="content">
      <PlantList v-if="currentView === 'plants'" ref="plantListRef" />
      <ActivityList v-else-if="currentView === 'activities'" ref="activityListRef" />
      <div v-else-if="currentView === 'calendar'" class="placeholder">Calendar (coming soon)</div>
      <div v-else-if="currentView === 'settings'" class="placeholder">Settings (coming soon)</div>
    </main>
  </div>
</template>
```

**Step 2: Run to verify**

Run:
```bash
npm run tauri dev
```

Expected: Activities view works with add/edit/delete.

**Step 3: Commit**

```bash
git add src/App.vue
git commit -m "feat: integrate ActivityList into navigation"
```

---

## Phase 7: Plant Overview Grid

### Task 7.1: Create PlantGrid Component

**Files:**
- Create: `src/components/PlantGrid.vue`

**Step 1: Create the overview grid**

Create `src/components/PlantGrid.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import type { Plant } from '../types';
import { MONTHS } from '../types';
import { getAllPlants } from '../api';

const plants = ref<Plant[]>([]);

onMounted(async () => {
  plants.value = await getAllPlants();
});

const emit = defineEmits<{
  edit: [plant: Plant];
}>();

const isPeriodActive = (periods: number, monthIndex: number, isLate: boolean): boolean => {
  const bitIndex = monthIndex * 2 + (isLate ? 1 : 0);
  return (periods & (1 << bitIndex)) !== 0;
};
</script>

<template>
  <div class="plant-grid">
    <h1>Plant Overview</h1>

    <div class="grid-container" v-if="plants.length > 0">
      <table>
        <thead>
          <tr>
            <th class="plant-name-header">Plant</th>
            <th v-for="month in MONTHS" :key="month" colspan="2" class="month-header">
              {{ month }}
            </th>
          </tr>
          <tr>
            <th></th>
            <template v-for="month in MONTHS" :key="month + '-sub'">
              <th class="sub-header">E</th>
              <th class="sub-header">L</th>
            </template>
          </tr>
        </thead>
        <tbody>
          <tr v-for="plant in plants" :key="plant.id" @click="emit('edit', plant)">
            <td class="plant-name">{{ plant.name }}</td>
            <template v-for="(_, monthIndex) in MONTHS" :key="monthIndex">
              <td
                class="period-cell"
                :class="{
                  'sow': isPeriodActive(plant.sow_periods, monthIndex, false),
                  'plant': isPeriodActive(plant.plant_periods, monthIndex, false),
                  'both': isPeriodActive(plant.sow_periods, monthIndex, false) && isPeriodActive(plant.plant_periods, monthIndex, false),
                }"
              ></td>
              <td
                class="period-cell"
                :class="{
                  'sow': isPeriodActive(plant.sow_periods, monthIndex, true),
                  'plant': isPeriodActive(plant.plant_periods, monthIndex, true),
                  'both': isPeriodActive(plant.sow_periods, monthIndex, true) && isPeriodActive(plant.plant_periods, monthIndex, true),
                }"
              ></td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-else class="empty">No plants yet. Add plants to see the overview.</p>

    <div class="legend">
      <span class="legend-item"><span class="swatch sow"></span> Sow</span>
      <span class="legend-item"><span class="swatch plant"></span> Plant</span>
      <span class="legend-item"><span class="swatch both"></span> Both</span>
    </div>
  </div>
</template>

<style scoped>
.plant-grid {
  padding: 1rem;
}

.grid-container {
  overflow-x: auto;
  margin: 1rem 0;
}

table {
  border-collapse: collapse;
  font-size: 0.875rem;
}

th, td {
  border: 1px solid #ddd;
  padding: 0.25rem;
  text-align: center;
}

.plant-name-header {
  min-width: 150px;
  text-align: left;
  padding-left: 0.5rem;
}

.month-header {
  background: #f5f5f5;
}

.sub-header {
  font-size: 0.7rem;
  color: #666;
  background: #fafafa;
}

.plant-name {
  text-align: left;
  padding-left: 0.5rem;
  cursor: pointer;
}

.period-cell {
  width: 20px;
  height: 20px;
}

.period-cell.sow {
  background: #81c784;
}

.period-cell.plant {
  background: #ffb74d;
}

.period-cell.both {
  background: linear-gradient(135deg, #81c784 50%, #ffb74d 50%);
}

tbody tr:hover {
  background: #f5f5f5;
}

.legend {
  display: flex;
  gap: 1.5rem;
  margin-top: 1rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.swatch {
  width: 16px;
  height: 16px;
  border: 1px solid #ccc;
}

.swatch.sow { background: #81c784; }
.swatch.plant { background: #ffb74d; }
.swatch.both { background: linear-gradient(135deg, #81c784 50%, #ffb74d 50%); }

.empty {
  color: #666;
  text-align: center;
  padding: 2rem;
}
</style>
```

**Step 2: Commit**

```bash
git add src/components/PlantGrid.vue
git commit -m "feat: add PlantGrid overview component"
```

---

### Task 7.2: Add Tabs to Plants View

**Files:**
- Modify: `src/App.vue`

**Step 1: Update App.vue to add plant sub-views**

Update the script and template to support plant tabs (List vs Grid):

Add to script:
```typescript
import PlantGrid from './components/PlantGrid.vue';

type PlantSubView = 'list' | 'grid';
const plantSubView = ref<PlantSubView>('list');
```

Update template plants section:
```vue
<div v-if="currentView === 'plants'" class="plants-container">
  <div class="tabs">
    <button :class="{ active: plantSubView === 'list' }" @click="plantSubView = 'list'">Manage</button>
    <button :class="{ active: plantSubView === 'grid' }" @click="plantSubView = 'grid'">Overview</button>
  </div>
  <PlantList v-if="plantSubView === 'list'" ref="plantListRef" />
  <PlantGrid v-else @edit="(plant) => { plantSubView = 'list'; plantListRef?.openEditForm(plant); }" />
</div>
```

Add styles for tabs:
```css
.plants-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.tabs {
  display: flex;
  padding: 0.5rem 1rem;
  gap: 0.5rem;
  background: white;
  border-bottom: 1px solid #eee;
}

.tabs button {
  padding: 0.5rem 1rem;
  border: none;
  background: #e0e0e0;
  border-radius: 4px;
  cursor: pointer;
}

.tabs button.active {
  background: #4caf50;
  color: white;
}
```

**Step 2: Expose openEditForm in PlantList**

Update `src/components/PlantList.vue` defineExpose:

```typescript
defineExpose({ openAddForm, openEditForm });
```

**Step 3: Run to verify**

Run:
```bash
npm run tauri dev
```

Expected: Plants section has tabs to switch between Manage and Overview.

**Step 4: Commit**

```bash
git add src/App.vue src/components/PlantList.vue
git commit -m "feat: add plant sub-views with tabs (list/grid)"
```

---

## Phase 8: Monthly Calendar View

### Task 8.1: Add get_month_data Command

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Add month data query**

Add to `src-tauri/src/commands.rs`:

```rust
#[derive(Debug, Serialize)]
pub struct MonthData {
    pub sow_early: Vec<Plant>,
    pub sow_late: Vec<Plant>,
    pub plant_early: Vec<Plant>,
    pub plant_late: Vec<Plant>,
    pub activities: Vec<Activity>,
}

#[tauri::command]
pub fn get_month_data(db: State<Database>, month: u32) -> Result<MonthData, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let early_bit = 1 << ((month - 1) * 2);
    let late_bit = 1 << ((month - 1) * 2 + 1);

    let get_plants = |sql: &str| -> Result<Vec<Plant>, String> {
        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        stmt.query_map([], |row| {
            Ok(Plant {
                id: row.get(0)?,
                name: row.get(1)?,
                sun_requirement: row.get(2)?,
                sow_periods: row.get(3)?,
                plant_periods: row.get(4)?,
                notes: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
    };

    let sow_early = get_plants(&format!(
        "SELECT id, name, sun_requirement, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (sow_periods & {}) != 0 ORDER BY name",
        early_bit
    ))?;

    let sow_late = get_plants(&format!(
        "SELECT id, name, sun_requirement, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (sow_periods & {}) != 0 ORDER BY name",
        late_bit
    ))?;

    let plant_early = get_plants(&format!(
        "SELECT id, name, sun_requirement, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (plant_periods & {}) != 0 ORDER BY name",
        early_bit
    ))?;

    let plant_late = get_plants(&format!(
        "SELECT id, name, sun_requirement, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (plant_periods & {}) != 0 ORDER BY name",
        late_bit
    ))?;

    let month_bits = early_bit | late_bit;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, name, description, active_periods, created_at, updated_at FROM activities WHERE (active_periods & {}) != 0 ORDER BY name",
            month_bits
        ))
        .map_err(|e| e.to_string())?;

    let activities = stmt
        .query_map([], |row| {
            Ok(Activity {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                active_periods: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(MonthData {
        sow_early,
        sow_late,
        plant_early,
        plant_late,
        activities,
    })
}
```

Add Serialize derive to MonthData (at top, add use):
```rust
use serde::Serialize;
```

**Step 2: Register in main.rs**

Add to invoke_handler:
```rust
commands::get_month_data,
```

**Step 3: Build to verify**

Run:
```bash
cd src-tauri && cargo build
```

**Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat: add get_month_data command for calendar view"
```

---

### Task 8.2: Create MonthlyView Component

**Files:**
- Create: `src/components/MonthlyView.vue`
- Modify: `src/api.ts`

**Step 1: Add API function**

Add to `src/api.ts`:

```typescript
export interface MonthData {
  sow_early: Plant[];
  sow_late: Plant[];
  plant_early: Plant[];
  plant_late: Plant[];
  activities: Activity[];
}

export const getMonthData = (month: number) => invoke<MonthData>('get_month_data', { month });
```

**Step 2: Create MonthlyView component**

Create `src/components/MonthlyView.vue`:

```vue
<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { MONTHS } from '../types';
import { getMonthData, type MonthData } from '../api';

const currentMonth = ref(new Date().getMonth() + 1);
const data = ref<MonthData | null>(null);

const loadData = async () => {
  data.value = await getMonthData(currentMonth.value);
};

onMounted(loadData);
watch(currentMonth, loadData);
</script>

<template>
  <div class="monthly-view">
    <div class="header">
      <h1>Calendar</h1>
      <select v-model="currentMonth">
        <option v-for="(month, index) in MONTHS" :key="index" :value="index + 1">
          {{ month }}
        </option>
      </select>
    </div>

    <div v-if="data" class="content">
      <div class="section">
        <h2>Sow This Month</h2>
        <div class="subsection">
          <h3>Early {{ MONTHS[currentMonth - 1] }}</h3>
          <ul v-if="data.sow_early.length">
            <li v-for="plant in data.sow_early" :key="plant.id">{{ plant.name }}</li>
          </ul>
          <p v-else class="empty">Nothing to sow</p>
        </div>
        <div class="subsection">
          <h3>Late {{ MONTHS[currentMonth - 1] }}</h3>
          <ul v-if="data.sow_late.length">
            <li v-for="plant in data.sow_late" :key="plant.id">{{ plant.name }}</li>
          </ul>
          <p v-else class="empty">Nothing to sow</p>
        </div>
      </div>

      <div class="section">
        <h2>Plant This Month</h2>
        <div class="subsection">
          <h3>Early {{ MONTHS[currentMonth - 1] }}</h3>
          <ul v-if="data.plant_early.length">
            <li v-for="plant in data.plant_early" :key="plant.id">{{ plant.name }}</li>
          </ul>
          <p v-else class="empty">Nothing to plant</p>
        </div>
        <div class="subsection">
          <h3>Late {{ MONTHS[currentMonth - 1] }}</h3>
          <ul v-if="data.plant_late.length">
            <li v-for="plant in data.plant_late" :key="plant.id">{{ plant.name }}</li>
          </ul>
          <p v-else class="empty">Nothing to plant</p>
        </div>
      </div>

      <div class="section">
        <h2>Activities</h2>
        <ul v-if="data.activities.length">
          <li v-for="activity in data.activities" :key="activity.id">
            <strong>{{ activity.name }}</strong>
            <span v-if="activity.description"> - {{ activity.description }}</span>
          </li>
        </ul>
        <p v-else class="empty">No activities this month</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.monthly-view {
  padding: 1rem;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.header select {
  padding: 0.5rem;
  font-size: 1rem;
  border-radius: 4px;
}

.content {
  display: grid;
  gap: 1.5rem;
}

.section {
  background: white;
  padding: 1rem;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.section h2 {
  margin-bottom: 1rem;
  color: #333;
}

.subsection {
  margin-bottom: 1rem;
}

.subsection h3 {
  font-size: 0.9rem;
  color: #666;
  margin-bottom: 0.5rem;
}

ul {
  list-style: none;
  padding: 0;
}

li {
  padding: 0.5rem;
  border-bottom: 1px solid #eee;
}

li:last-child {
  border-bottom: none;
}

.empty {
  color: #999;
  font-style: italic;
}
</style>
```

**Step 3: Commit**

```bash
git add src/api.ts src/components/MonthlyView.vue
git commit -m "feat: add MonthlyView calendar component"
```

---

### Task 8.3: Integrate MonthlyView into App

**Files:**
- Modify: `src/App.vue`

**Step 1: Import and add MonthlyView**

Add import:
```typescript
import MonthlyView from './components/MonthlyView.vue';
```

Replace calendar placeholder:
```vue
<MonthlyView v-else-if="currentView === 'calendar'" />
```

**Step 2: Run to verify**

Run:
```bash
npm run tauri dev
```

Expected: Calendar view shows sow/plant/activities for selected month.

**Step 3: Commit**

```bash
git add src/App.vue
git commit -m "feat: integrate MonthlyView into app navigation"
```

---

## Phase 9: Photo Handling

### Task 9.1: Add Photo Commands

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Add photo commands**

Add to `src-tauri/src/commands.rs`:

```rust
use crate::models::{Activity, Plant, PlantPhoto};
use base64::{engine::general_purpose::STANDARD, Engine};

#[tauri::command]
pub fn get_photos(db: State<Database>, plant_id: i64) -> Result<Vec<PlantPhoto>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, plant_id, sort_order, image_data, created_at FROM plant_photos WHERE plant_id = ?1 ORDER BY sort_order")
        .map_err(|e| e.to_string())?;

    let photos = stmt
        .query_map([plant_id], |row| {
            let image_blob: Option<Vec<u8>> = row.get(3)?;
            let image_data = image_blob.map(|b| STANDARD.encode(&b));

            Ok(PlantPhoto {
                id: row.get(0)?,
                plant_id: row.get(1)?,
                sort_order: row.get(2)?,
                image_data,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(photos)
}

#[tauri::command]
pub fn add_photo(db: State<Database>, plant_id: i64, image_data: String, sort_order: i32) -> Result<PlantPhoto, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let image_bytes = STANDARD.decode(&image_data).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO plant_photos (plant_id, sort_order, image_data) VALUES (?1, ?2, ?3)",
        rusqlite::params![plant_id, sort_order, image_bytes],
    ).map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(PlantPhoto {
        id: Some(id),
        plant_id,
        sort_order,
        image_data: Some(image_data),
        created_at: None,
    })
}

#[tauri::command]
pub fn delete_photo(db: State<Database>, id: i64) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM plant_photos WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;

    Ok(())
}
```

**Step 2: Register in main.rs**

Add to invoke_handler:
```rust
commands::get_photos,
commands::add_photo,
commands::delete_photo,
```

**Step 3: Build to verify**

Run:
```bash
cd src-tauri && cargo build
```

**Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat: add photo CRUD commands"
```

---

### Task 9.2: Create PhotoCapture Component

**Files:**
- Create: `src/components/PhotoCapture.vue`
- Modify: `src/api.ts`

**Step 1: Update api.ts**

Update photo functions in `src/api.ts`:

```typescript
export const getPhotos = (plantId: number) => invoke<PlantPhoto[]>('get_photos', { plantId });
export const addPhoto = (plantId: number, imageData: string, sortOrder: number) =>
  invoke<PlantPhoto>('add_photo', { plantId, imageData, sortOrder });
export const deletePhoto = (id: number) => invoke<void>('delete_photo', { id });
```

**Step 2: Create PhotoCapture component**

Create `src/components/PhotoCapture.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import type { PlantPhoto } from '../types';
import { getPhotos, addPhoto, deletePhoto } from '../api';

const props = defineProps<{
  plantId?: number;
}>();

const photos = ref<PlantPhoto[]>([]);
const videoRef = ref<HTMLVideoElement | null>(null);
const stream = ref<MediaStream | null>(null);
const showCamera = ref(false);

const loadPhotos = async () => {
  if (props.plantId) {
    photos.value = await getPhotos(props.plantId);
  } else {
    photos.value = [];
  }
};

watch(() => props.plantId, loadPhotos, { immediate: true });

const startCamera = async () => {
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    if (videoRef.value) {
      videoRef.value.srcObject = stream.value;
    }
    showCamera.value = true;
  } catch (err) {
    alert('Could not access camera: ' + err);
  }
};

const stopCamera = () => {
  if (stream.value) {
    stream.value.getTracks().forEach(track => track.stop());
    stream.value = null;
  }
  showCamera.value = false;
};

const capturePhoto = async () => {
  if (!videoRef.value || !props.plantId) return;

  const canvas = document.createElement('canvas');
  canvas.width = videoRef.value.videoWidth;
  canvas.height = videoRef.value.videoHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.drawImage(videoRef.value, 0, 0);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  const base64 = dataUrl.split(',')[1];

  const sortOrder = photos.value.length + 1;
  await addPhoto(props.plantId, base64, sortOrder);
  await loadPhotos();
};

const handleDeletePhoto = async (id: number) => {
  if (confirm('Delete this photo?')) {
    await deletePhoto(id);
    await loadPhotos();
  }
};

onUnmounted(stopCamera);
</script>

<template>
  <div class="photo-capture">
    <div class="photos-grid">
      <div v-for="photo in photos" :key="photo.id" class="photo-item">
        <img :src="'data:image/jpeg;base64,' + photo.image_data" alt="Plant photo" />
        <button class="delete-btn" @click="handleDeletePhoto(photo.id!)">×</button>
      </div>

      <div v-if="!showCamera" class="add-photo" @click="startCamera">
        <span>+ Add Photo</span>
      </div>
    </div>

    <div v-if="showCamera" class="camera-container">
      <video ref="videoRef" autoplay playsinline></video>
      <div class="camera-controls">
        <button @click="capturePhoto">Capture</button>
        <button @click="stopCamera">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.photo-capture {
  margin: 1rem 0;
}

.photos-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.photo-item {
  position: relative;
  width: 100px;
  height: 100px;
}

.photo-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}

.photo-item .delete-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 20px;
  height: 20px;
  border: none;
  background: rgba(255, 0, 0, 0.8);
  color: white;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.add-photo {
  width: 100px;
  height: 100px;
  border: 2px dashed #ccc;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #666;
}

.add-photo:hover {
  border-color: #4caf50;
  color: #4caf50;
}

.camera-container {
  margin-top: 1rem;
}

.camera-container video {
  width: 100%;
  max-width: 400px;
  border-radius: 4px;
}

.camera-controls {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.camera-controls button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.camera-controls button:first-child {
  background: #4caf50;
  color: white;
}

.camera-controls button:last-child {
  background: #e0e0e0;
}
</style>
```

**Step 3: Commit**

```bash
git add src/api.ts src/components/PhotoCapture.vue
git commit -m "feat: add PhotoCapture component with camera support"
```

---

### Task 9.3: Integrate Photos into PlantForm

**Files:**
- Modify: `src/components/PlantForm.vue`

**Step 1: Add PhotoCapture to PlantForm**

Add import:
```typescript
import PhotoCapture from './PhotoCapture.vue';
```

Add after notes textarea in template:
```vue
<div v-if="isEditing()" class="form-group">
  <label>Photos</label>
  <PhotoCapture :plant-id="plant?.id" />
</div>
```

**Step 2: Run to verify**

Run:
```bash
npm run tauri dev
```

Expected: When editing a plant, photos section appears with camera capture.

**Step 3: Commit**

```bash
git add src/components/PlantForm.vue
git commit -m "feat: integrate PhotoCapture into PlantForm"
```

---

## Phase 10: Final Polish

### Task 10.1: Add Keyboard Shortcuts

**Files:**
- Modify: `src/App.vue`

**Step 1: Add keyboard event listener**

Add to script:
```typescript
import { onMounted, onUnmounted } from 'vue';

const handleKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
    e.preventDefault();
    if (currentView.value === 'activities') {
      handleAddActivity();
    } else {
      handleAddPlant();
    }
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
```

**Step 2: Commit**

```bash
git add src/App.vue
git commit -m "feat: add Ctrl+N keyboard shortcut for quick add"
```

---

### Task 10.2: Final Testing & Cleanup

**Step 1: Run full application**

Run:
```bash
npm run tauri dev
```

**Step 2: Test all features**
- Add a plant with sowing/planting periods
- Add photos to the plant
- View plant in overview grid
- Add an activity
- Check calendar view for the month
- Use Ctrl+N shortcut

**Step 3: Build production version**

Run:
```bash
npm run tauri build
```

Expected: Production build completes. App bundle in `src-tauri/target/release/bundle/`

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: production-ready TuinApp"
```

---

## Phase 11: Seed Data Import

### Task 11.1: Create Import Command

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Add import_plants_tsv command**

Add to `src-tauri/src/commands.rs`:

```rust
#[tauri::command]
pub fn import_plants_tsv(db: State<Database>, tsv_content: String) -> Result<u32, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let lines: Vec<&str> = tsv_content.lines().collect();
    if lines.is_empty() {
        return Ok(0);
    }

    let mut imported = 0;

    for line in lines.iter().skip(1) {
        // Skip header row
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.is_empty() || cols[0].trim().is_empty() {
            continue;
        }

        let name = cols[0].trim().to_string();

        // Parse 24 period columns (months I-XII, each with early/late)
        let mut sow_periods: i32 = 0;
        let mut plant_periods: i32 = 0;

        for month_idx in 0..12 {
            // Each month has 2 columns: early and late
            let early_col = 1 + month_idx * 2;
            let late_col = 2 + month_idx * 2;

            if early_col < cols.len() {
                let val = cols[early_col].trim();
                if val.contains('Z') {
                    sow_periods |= 1 << (month_idx * 2);
                }
                if val.contains('P') {
                    plant_periods |= 1 << (month_idx * 2);
                }
            }

            if late_col < cols.len() {
                let val = cols[late_col].trim();
                if val.contains('Z') {
                    sow_periods |= 1 << (month_idx * 2 + 1);
                }
                if val.contains('P') {
                    plant_periods |= 1 << (month_idx * 2 + 1);
                }
            }
        }

        conn.execute(
            "INSERT INTO plants (name, sow_periods, plant_periods) VALUES (?1, ?2, ?3)",
            (&name, &sow_periods, &plant_periods),
        ).map_err(|e| e.to_string())?;

        imported += 1;
    }

    Ok(imported)
}
```

**Step 2: Register command in main.rs**

Add to invoke_handler:
```rust
commands::import_plants_tsv,
```

**Step 3: Build to verify**

Run:
```bash
cd src-tauri && cargo build
```

**Step 4: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/main.rs
git commit -m "feat: add TSV import command for plant data"
```

---

### Task 11.2: Add Import Button to Settings

**Files:**
- Create: `src/components/SettingsView.vue`
- Modify: `src/api.ts`
- Modify: `src/App.vue`

**Step 1: Add API function**

Add to `src/api.ts`:

```typescript
export const importPlantsTsv = (tsvContent: string) =>
  invoke<number>('import_plants_tsv', { tsvContent });
```

**Step 2: Create SettingsView component**

Create `src/components/SettingsView.vue`:

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { importPlantsTsv } from '../api';

const importing = ref(false);
const message = ref('');

const handleFileSelect = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files?.length) return;

  const file = input.files[0];
  const content = await file.text();

  importing.value = true;
  message.value = '';

  try {
    const count = await importPlantsTsv(content);
    message.value = `Successfully imported ${count} plants!`;
  } catch (err) {
    message.value = `Error: ${err}`;
  } finally {
    importing.value = false;
    input.value = '';
  }
};
</script>

<template>
  <div class="settings-view">
    <h1>Settings</h1>

    <div class="section">
      <h2>Import Data</h2>
      <p>Import plants from a TSV file (Tab-separated values)</p>
      <input
        type="file"
        accept=".tsv,.txt"
        @change="handleFileSelect"
        :disabled="importing"
      />
      <p v-if="message" :class="{ error: message.startsWith('Error') }">
        {{ message }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  padding: 1rem;
}

.section {
  background: white;
  padding: 1.5rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

.section h2 {
  margin-bottom: 0.5rem;
}

.section p {
  color: #666;
  margin-bottom: 1rem;
}

.error {
  color: #f44336;
}
</style>
```

**Step 3: Import in App.vue**

Add import:
```typescript
import SettingsView from './components/SettingsView.vue';
```

Replace settings placeholder:
```vue
<SettingsView v-else-if="currentView === 'settings'" />
```

**Step 4: Run and test import**

Run:
```bash
npm run tauri dev
```

Go to Settings, import the `Zaaischema - Planten.tsv` file.

Expected: ~113 plants imported.

**Step 5: Commit**

```bash
git add src/api.ts src/components/SettingsView.vue src/App.vue
git commit -m "feat: add TSV import functionality in settings"
```

---

### Task 11.3: Commit Seed Data File

**Step 1: Add TSV file to repo**

```bash
git add "Zaaischema - Planten.tsv"
git commit -m "data: add Dutch planting schedule seed data"
```

---

## Summary

This plan builds TuinApp in 11 phases:

1. **Environment Setup** - Install Rust and Tauri CLI
2. **Project Scaffolding** - Create Tauri + Vue project
3. **Database Layer** - SQLite with rusqlite
4. **Plant CRUD Backend** - Rust commands for plants
5. **Plant Frontend** - Vue components for plant management
6. **Activity CRUD** - Backend and frontend for activities
7. **Plant Overview Grid** - Visualization of sowing/planting periods
8. **Monthly Calendar** - Per-month view of tasks
9. **Photo Handling** - Camera capture and storage
10. **Final Polish** - Keyboard shortcuts and testing
11. **Seed Data Import** - Import Dutch planting schedule from TSV

Each task is designed to be completed in 2-5 minutes with clear verification steps.

**Seed Data:** The repository includes `Zaaischema - Planten.tsv` with ~113 Dutch vegetable/flower names and their sowing (Z) and planting (P) schedules.
