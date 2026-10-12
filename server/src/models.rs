use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    #[serde(default = "one")]
    pub revision: i64,
}

fn one() -> i64 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Activity {
    pub id: Option<i64>,
    pub name: String,
    pub description: Option<String>,
    pub active_periods: i32,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    #[serde(default = "one")]
    pub revision: i64,
}

#[derive(Debug, Serialize)]
pub struct MonthData {
    pub sow_early: Vec<Plant>,
    pub sow_late: Vec<Plant>,
    pub plant_early: Vec<Plant>,
    pub plant_late: Vec<Plant>,
    pub activities: Vec<Activity>,
}

pub fn valid_name(s: &str) -> bool {
    !s.trim().is_empty() && s.chars().count() <= 500
}
pub fn valid_mask(n: i32) -> bool {
    (0..=0xffffff).contains(&n)
}

impl Plant {
    pub fn valid(&self) -> bool {
        valid_name(&self.name)
            && (0..=7).contains(&self.sun_requirements)
            && valid_mask(self.sow_periods)
            && valid_mask(self.plant_periods)
            && self
                .plant_type
                .as_deref()
                .is_none_or(|s| matches!(s, "vegetable_fruit" | "flower" | "herb"))
            && self.notes.as_ref().is_none_or(|s| s.len() <= 100_000)
    }
}
impl Activity {
    pub fn valid(&self) -> bool {
        valid_name(&self.name)
            && valid_mask(self.active_periods)
            && self.description.as_ref().is_none_or(|s| s.len() <= 100_000)
    }
}
