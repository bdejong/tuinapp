mod db;
mod models;

use db::{get_db_path, run_migrations, Database};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
