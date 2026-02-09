use crate::db::Database;
use crate::models::{Activity, Plant, PlantPhoto};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub fn get_all_plants(db: State<Database>) -> Result<Vec<Plant>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, plant_type, sun_requirement, sow_periods, plant_periods, notes, created_at, updated_at FROM plants ORDER BY name")
        .map_err(|e| e.to_string())?;

    let plants = stmt
        .query_map([], |row| {
            Ok(Plant {
                id: row.get(0)?,
                name: row.get(1)?,
                plant_type: row.get(2)?,
                sun_requirement: row.get(3)?,
                sow_periods: row.get(4)?,
                plant_periods: row.get(5)?,
                notes: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
        "INSERT INTO plants (name, plant_type, sun_requirement, sow_periods, plant_periods, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (&plant.name, &plant.plant_type, &plant.sun_requirement, &plant.sow_periods, &plant.plant_periods, &plant.notes),
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
        "UPDATE plants SET name = ?1, plant_type = ?2, sun_requirement = ?3, sow_periods = ?4, plant_periods = ?5, notes = ?6, updated_at = CURRENT_TIMESTAMP WHERE id = ?7",
        (&plant.name, &plant.plant_type, &plant.sun_requirement, &plant.sow_periods, &plant.plant_periods, &plant.notes, &plant.id),
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
        let result = stmt.query_map([], |row| {
            Ok(Plant {
                id: row.get(0)?,
                name: row.get(1)?,
                plant_type: row.get(2)?,
                sun_requirement: row.get(3)?,
                sow_periods: row.get(4)?,
                plant_periods: row.get(5)?,
                notes: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string());
        result
    };

    let sow_early = get_plants(&format!(
        "SELECT id, name, plant_type, sun_requirement, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (sow_periods & {}) != 0 ORDER BY name",
        early_bit
    ))?;

    let sow_late = get_plants(&format!(
        "SELECT id, name, plant_type, sun_requirement, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (sow_periods & {}) != 0 ORDER BY name",
        late_bit
    ))?;

    let plant_early = get_plants(&format!(
        "SELECT id, name, plant_type, sun_requirement, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (plant_periods & {}) != 0 ORDER BY name",
        early_bit
    ))?;

    let plant_late = get_plants(&format!(
        "SELECT id, name, plant_type, sun_requirement, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (plant_periods & {}) != 0 ORDER BY name",
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
