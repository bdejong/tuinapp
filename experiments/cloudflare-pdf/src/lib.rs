// Compile the exact production renderer; no fork of its layout or icon geometry.
#[allow(dead_code)]
#[path = "../../../server/src/models.rs"]
mod models;
#[allow(dead_code)]
#[path = "../../../server/src/pdf.rs"]
mod pdf;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn render_calendar(json: &str) -> Result<Vec<u8>, JsValue> {
    let data: pdf::PrintData = serde_json::from_str(json)
        .map_err(|e| JsValue::from_str(&format!("Invalid calendar: {e}")))?;
    pdf::generate_pdf(data).map_err(|e| JsValue::from_str(&e))
}
