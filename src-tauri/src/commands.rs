use crate::db::{save_config, AppConfig, Database};
use crate::models::{Activity, Plant, PlantPhoto};
use base64::{engine::general_purpose::STANDARD, Engine};
use printpdf::*;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::process::Command;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn get_all_plants(db: State<Database>) -> Result<Vec<Plant>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT id, name, plant_type, sun_requirements, sow_periods, plant_periods, notes, created_at, updated_at FROM plants ORDER BY name")
        .map_err(|e| e.to_string())?;

    let plants = stmt
        .query_map([], |row| {
            Ok(Plant {
                id: row.get(0)?,
                name: row.get(1)?,
                plant_type: row.get(2)?,
                sun_requirements: row.get(3)?,
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
        "INSERT INTO plants (name, plant_type, sun_requirements, sow_periods, plant_periods, notes) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (&plant.name, &plant.plant_type, &plant.sun_requirements, &plant.sow_periods, &plant.plant_periods, &plant.notes),
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
        "UPDATE plants SET name = ?1, plant_type = ?2, sun_requirements = ?3, sow_periods = ?4, plant_periods = ?5, notes = ?6, updated_at = CURRENT_TIMESTAMP WHERE id = ?7",
        (&plant.name, &plant.plant_type, &plant.sun_requirements, &plant.sow_periods, &plant.plant_periods, &plant.notes, &plant.id),
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
                sun_requirements: row.get(3)?,
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
        "SELECT id, name, plant_type, sun_requirements, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (sow_periods & {}) != 0 ORDER BY name",
        early_bit
    ))?;

    let sow_late = get_plants(&format!(
        "SELECT id, name, plant_type, sun_requirements, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (sow_periods & {}) != 0 ORDER BY name",
        late_bit
    ))?;

    let plant_early = get_plants(&format!(
        "SELECT id, name, plant_type, sun_requirements, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (plant_periods & {}) != 0 ORDER BY name",
        early_bit
    ))?;

    let plant_late = get_plants(&format!(
        "SELECT id, name, plant_type, sun_requirements, sow_periods, plant_periods, notes, created_at, updated_at FROM plants WHERE (plant_periods & {}) != 0 ORDER BY name",
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

#[tauri::command(rename_all = "camelCase")]
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

#[tauri::command(rename_all = "camelCase")]
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

#[tauri::command]
pub fn import_plants_tsv(db: State<Database>, tsv_content: String) -> Result<u32, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let lines: Vec<&str> = tsv_content.lines().collect();
    if lines.is_empty() {
        return Ok(0);
    }

    let mut imported = 0;

    // Skip header row (line 0)
    for line in lines.iter().skip(1) {
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.is_empty() || cols[0].trim().is_empty() {
            continue;
        }

        let name = cols[0].trim().to_string();

        let mut sow_periods: i32 = 0;
        let mut plant_periods: i32 = 0;

        for month_idx in 0..12 {
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

#[tauri::command]
pub fn get_database_path(db: State<Database>) -> String {
    db.get_path().to_string_lossy().to_string()
}

#[tauri::command(rename_all = "camelCase")]
pub fn move_database(
    app: AppHandle,
    db: State<Database>,
    new_path: String,
) -> Result<String, String> {
    let current_path = db.get_path();
    let new_path = PathBuf::from(&new_path);

    // Ensure parent directory exists
    if let Some(parent) = new_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Copy the database file
    std::fs::copy(&current_path, &new_path).map_err(|e| format!("Failed to copy database: {}", e))?;

    // Save new path to config
    let config = AppConfig {
        database_path: Some(new_path.to_string_lossy().to_string()),
    };
    save_config(&app, &config).map_err(|e| format!("Failed to save config: {}", e))?;

    Ok("Database moved. Please restart the app to use the new location.".to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryData {
    pub vegetables: Vec<String>,
    pub flowers: Vec<String>,
    pub herbs: Vec<String>,
    pub other: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintData {
    pub month_name: String,
    pub sow_early: CategoryData,
    pub sow_late: CategoryData,
    pub plant_early: CategoryData,
    pub plant_late: CategoryData,
    pub activities: Vec<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub fn generate_pdf(data: PrintData) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let pdf_path = temp_dir.join(format!("garden-planner-{}.pdf", data.month_name.to_lowercase()));

    // A4 size in mm
    let (doc, page1, layer1) = PdfDocument::new(
        &format!("Garden Planner - {}", data.month_name),
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );

    let font = doc.add_builtin_font(BuiltinFont::Helvetica).map_err(|e| e.to_string())?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold).map_err(|e| e.to_string())?;

    // Three-column layout (one per category)
    let col1_x = Mm(10.0);   // Vegetables
    let col2_x = Mm(75.0);   // Flowers
    let col3_x = Mm(140.0);  // Herbs
    let line_height = Mm(2.8);
    let bottom_margin = Mm(12.0);
    let top_start = Mm(290.0);

    let mut y = top_start;
    let mut current_page = page1;
    let mut current_layer_idx = layer1;

    macro_rules! layer {
        () => { doc.get_page(current_page).get_layer(current_layer_idx) };
    }

    macro_rules! new_page {
        () => {{
            let (new_page, new_layer) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
            current_page = new_page;
            current_layer_idx = new_layer;
            y = top_start;
        }};
    }

    macro_rules! check_page {
        () => { if y < bottom_margin { new_page!(); } };
    }

    // Helper to draw items in a column
    let draw_items = |layer: &PdfLayerReference, items: &[String], x: Mm, mut y: Mm| -> Mm {
        for item in items {
            let display = if item.len() > 28 { format!("{}...", &item[..25]) } else { item.clone() };
            layer.use_text(&format!("• {}", display), 5.5, x, y, &font);
            y = y - line_height;
        }
        y
    };

    // Helper to draw a time period (Early/Late) with 3 category columns
    let draw_period = |layer: &PdfLayerReference, veg: &[String], flow: &[String], herb: &[String], x1: Mm, x2: Mm, x3: Mm, mut y: Mm| -> Mm {
        let start_y = y;
        let y1 = if veg.is_empty() { y } else { draw_items(layer, veg, x1, y) };
        let y2 = if flow.is_empty() { start_y } else { draw_items(layer, flow, x2, start_y) };
        let y3 = if herb.is_empty() { start_y } else { draw_items(layer, herb, x3, start_y) };
        *[y1, y2, y3].iter().min_by(|a, b| a.0.partial_cmp(&b.0).unwrap()).unwrap()
    };

    // === SOW THIS MONTH ===
    layer!().use_text("Sow This Month", 11.0, col1_x, y, &font_bold);
    y = y - Mm(5.0);

    // Early sow
    layer!().use_text(&format!("Early {}", data.month_name), 8.0, col1_x, y, &font_bold);
    y = y - Mm(3.5);

    layer!().use_text("Vegetables", 6.5, col1_x, y, &font_bold);
    layer!().use_text("Flowers", 6.5, col2_x, y, &font_bold);
    layer!().use_text("Herbs", 6.5, col3_x, y, &font_bold);
    y = y - Mm(3.0);

    y = draw_period(&layer!(), &data.sow_early.vegetables, &data.sow_early.flowers, &data.sow_early.herbs, col1_x, col2_x, col3_x, y);
    y = y - Mm(3.0);
    check_page!();

    // Late sow
    layer!().use_text(&format!("Late {}", data.month_name), 8.0, col1_x, y, &font_bold);
    y = y - Mm(3.5);

    layer!().use_text("Vegetables", 6.5, col1_x, y, &font_bold);
    layer!().use_text("Flowers", 6.5, col2_x, y, &font_bold);
    layer!().use_text("Herbs", 6.5, col3_x, y, &font_bold);
    y = y - Mm(3.0);

    y = draw_period(&layer!(), &data.sow_late.vegetables, &data.sow_late.flowers, &data.sow_late.herbs, col1_x, col2_x, col3_x, y);
    y = y - Mm(5.0);
    check_page!();

    // === PLANT THIS MONTH ===
    layer!().use_text("Plant This Month", 11.0, col1_x, y, &font_bold);
    y = y - Mm(5.0);

    // Early plant
    layer!().use_text(&format!("Early {}", data.month_name), 8.0, col1_x, y, &font_bold);
    y = y - Mm(3.5);

    layer!().use_text("Vegetables", 6.5, col1_x, y, &font_bold);
    layer!().use_text("Flowers", 6.5, col2_x, y, &font_bold);
    layer!().use_text("Herbs", 6.5, col3_x, y, &font_bold);
    y = y - Mm(3.0);

    y = draw_period(&layer!(), &data.plant_early.vegetables, &data.plant_early.flowers, &data.plant_early.herbs, col1_x, col2_x, col3_x, y);
    y = y - Mm(3.0);
    check_page!();

    // Late plant
    layer!().use_text(&format!("Late {}", data.month_name), 8.0, col1_x, y, &font_bold);
    y = y - Mm(3.5);

    layer!().use_text("Vegetables", 6.5, col1_x, y, &font_bold);
    layer!().use_text("Flowers", 6.5, col2_x, y, &font_bold);
    layer!().use_text("Herbs", 6.5, col3_x, y, &font_bold);
    y = y - Mm(3.0);

    y = draw_period(&layer!(), &data.plant_late.vegetables, &data.plant_late.flowers, &data.plant_late.herbs, col1_x, col2_x, col3_x, y);
    y = y - Mm(5.0);
    check_page!();

    // === ACTIVITIES ===
    layer!().use_text("Activities", 11.0, col1_x, y, &font_bold);
    y = y - Mm(4.0);

    if data.activities.is_empty() {
        layer!().use_text("No activities this month", 5.5, col1_x, y, &font);
    } else {
        for activity in &data.activities {
            check_page!();
            let display = if activity.len() > 100 { format!("{}...", &activity[..97]) } else { activity.clone() };
            layer!().use_text(&format!("• {}", display), 5.5, col1_x, y, &font);
            y = y - line_height;
        }
    }

    // Save PDF
    let file = File::create(&pdf_path).map_err(|e| format!("Failed to create PDF file: {}", e))?;
    doc.save(&mut BufWriter::new(file)).map_err(|e| format!("Failed to save PDF: {}", e))?;

    // Open the PDF
    Command::new("open")
        .arg(pdf_path.to_str().unwrap())
        .spawn()
        .map_err(|e| format!("Failed to open PDF: {}", e))?;

    Ok(pdf_path.to_string_lossy().to_string())
}
