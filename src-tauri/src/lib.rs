mod commands;
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
        .invoke_handler(tauri::generate_handler![
            commands::get_all_plants,
            commands::create_plant,
            commands::update_plant,
            commands::delete_plant,
            commands::get_all_activities,
            commands::create_activity,
            commands::update_activity,
            commands::delete_activity,
            commands::get_month_data,
            commands::get_photos,
            commands::add_photo,
            commands::delete_photo,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
