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

pub fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS plants (
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
        );
        "
    )?;
    Ok(())
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
