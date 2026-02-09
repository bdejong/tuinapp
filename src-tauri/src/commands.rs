use crate::db::Database;
use crate::models::Plant;
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
