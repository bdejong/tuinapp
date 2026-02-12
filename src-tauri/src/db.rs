use chrono::Local;
use rusqlite::{Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
    pub path: Mutex<PathBuf>,
}

impl Database {
    pub fn new(path: &PathBuf) -> Result<Self> {
        let conn = Connection::open(path)?;
        Ok(Self {
            conn: Mutex::new(conn),
            path: Mutex::new(path.clone()),
        })
    }

    pub fn get_path(&self) -> PathBuf {
        self.path.lock().unwrap().clone()
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AppConfig {
    pub database_path: Option<String>,
}

pub fn get_config_path(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    app_dir.join("config.json")
}

pub fn load_config(app: &tauri::AppHandle) -> AppConfig {
    let config_path = get_config_path(app);
    if config_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&config_path) {
            if let Ok(config) = serde_json::from_str(&content) {
                return config;
            }
        }
    }
    AppConfig::default()
}

pub fn save_config(app: &tauri::AppHandle, config: &AppConfig) -> std::io::Result<()> {
    let config_path = get_config_path(app);
    let content = serde_json::to_string_pretty(config).unwrap();
    std::fs::write(config_path, content)
}

/// Migration definitions: (version, up_sql, down_sql)
const MIGRATIONS: &[(i32, &str, &str)] = &[
    // Version 1: Base schema
    (1,
        "CREATE TABLE IF NOT EXISTS plants (
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
        );",
        "" // No down migration for base schema
    ),
    // Version 2: Convert sun_requirement TEXT to sun_requirements INTEGER bitmask
    (2,
        "CREATE TABLE plants_new (
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
        ALTER TABLE plants_new RENAME TO plants;",
        // Down migration (loses combination data)
        "CREATE TABLE plants_new (
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
        ALTER TABLE plants_new RENAME TO plants;"
    ),
    // Version 3: Add needs_reorder column for tracking seeds to buy
    (3,
        "ALTER TABLE plants ADD COLUMN needs_reorder INTEGER DEFAULT 0;",
        // Down migration: remove the column by recreating the table
        "CREATE TABLE plants_new (
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
            id, name, plant_type, sun_requirements, sow_periods, plant_periods, notes, created_at, updated_at
        FROM plants;
        DROP TABLE plants;
        ALTER TABLE plants_new RENAME TO plants;"
    ),
];

fn get_schema_version(conn: &Connection) -> Result<i32> {
    // Create schema_version table if needed
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0)",
        [],
    )?;

    // Ensure there's a row
    conn.execute(
        "INSERT INTO schema_version (version) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM schema_version)",
        [],
    )?;

    let version: i32 = conn.query_row(
        "SELECT version FROM schema_version LIMIT 1",
        [],
        |row| row.get(0),
    )?;

    Ok(version)
}

fn set_schema_version(conn: &Connection, version: i32) -> Result<()> {
    conn.execute("UPDATE schema_version SET version = ?1", [version])?;
    Ok(())
}

fn table_exists(conn: &Connection, table_name: &str) -> Result<bool> {
    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [table_name],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn run_migrations(conn: &Connection) -> Result<()> {
    let mut current_version = get_schema_version(conn)?;

    // Detect existing database (plants table exists but version is 0)
    if current_version == 0 && table_exists(conn, "plants")? {
        // Existing database from before migration system - treat as v1
        current_version = 1;
        set_schema_version(conn, 1)?;
        println!("Detected existing database, setting version to 1");
    }

    // Run pending up migrations sequentially
    for (version, up_sql, _down_sql) in MIGRATIONS {
        if *version > current_version {
            println!("Running migration to version {}", version);
            conn.execute_batch(up_sql)?;
            set_schema_version(conn, *version)?;
            println!("Migration to version {} complete", version);
        }
    }

    Ok(())
}

pub fn backup_database(app: &tauri::AppHandle, db_path: &PathBuf) {
    use tauri::Manager;

    // Only backup if the database file exists
    if !db_path.exists() {
        return;
    }

    // Create backups directory in app data folder
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    let backup_dir = app_dir.join("backups");
    if let Err(e) = std::fs::create_dir_all(&backup_dir) {
        eprintln!("Failed to create backup directory: {}", e);
        return;
    }

    // Generate backup filename with timestamp
    let timestamp = Local::now().format("%Y-%m-%d_%H-%M-%S");
    let backup_filename = format!("tuinapp_{}.db", timestamp);
    let backup_path = backup_dir.join(&backup_filename);

    // Copy database to backup location
    match std::fs::copy(db_path, &backup_path) {
        Ok(_) => println!("Database backed up to: {}", backup_path.display()),
        Err(e) => eprintln!("Failed to backup database: {}", e),
    }
}

pub fn get_default_db_path(app: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    std::fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    app_dir.join("tuinapp.db")
}

pub fn get_db_path(app: &tauri::AppHandle) -> PathBuf {
    let config = load_config(app);
    if let Some(custom_path) = config.database_path {
        let path = PathBuf::from(&custom_path);
        if path.exists() || path.parent().map(|p| p.exists()).unwrap_or(false) {
            return path;
        }
    }
    get_default_db_path(app)
}
