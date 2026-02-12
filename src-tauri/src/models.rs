use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Plant {
    pub id: Option<i64>,
    pub name: String,
    pub plant_type: Option<String>,
    pub sun_requirements: i32,
    pub sow_periods: i32,
    pub plant_periods: i32,
    pub notes: Option<String>,
    pub needs_reorder: bool,
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
