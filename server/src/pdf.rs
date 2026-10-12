//! Desktop PDF layout, ported from src-tauri/src/commands.rs.
//! Intentionally use the same renderer and dimensions; this is not HTML printing.
use crate::models::{MonthData, Plant};
use printpdf::*;
use serde::Deserialize;

pub const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

#[path = "pdf_symbols.rs"]
mod symbols;
#[path = "pdf_text.rs"]
mod text;

#[derive(Debug, Deserialize)]
pub struct PrintPlant {
    pub name: String,
    #[serde(default)]
    pub sun_requirements: i32,
    #[serde(default)]
    pub note: Option<usize>,
}

fn categorize(plants: Vec<Plant>, notes: &mut Vec<String>) -> CategoryData {
    let mut data = CategoryData {
        vegetables: vec![],
        flowers: vec![],
        herbs: vec![],
        other: vec![],
    };
    // Number notes in the same order as the printed categories, then reuse each note.
    for category in [Some("vegetable_fruit"), Some("flower"), Some("herb"), None] {
        for plant in plants
            .iter()
            .filter(|p| p.plant_type.as_deref() == category)
        {
            let normalized = plant
                .notes
                .as_deref()
                .unwrap_or("")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            let note = if normalized.is_empty() {
                None
            } else {
                let index = notes
                    .iter()
                    .position(|n| n == &normalized)
                    .unwrap_or_else(|| {
                        notes.push(normalized);
                        notes.len() - 1
                    });
                Some(index + 1)
            };
            let entry = PrintPlant {
                name: plant.name.clone(),
                sun_requirements: plant.sun_requirements,
                note,
            };
            match category {
                Some("vegetable_fruit") => data.vegetables.push(entry),
                Some("flower") => data.flowers.push(entry),
                Some("herb") => data.herbs.push(entry),
                _ => data.other.push(entry),
            }
        }
    }
    data
}

impl PrintData {
    pub fn from_month(month_name: &str, data: MonthData) -> Self {
        let mut notes = vec![];
        Self {
            month_name: month_name.into(),
            sow_early: categorize(data.sow_early, &mut notes),
            sow_late: categorize(data.sow_late, &mut notes),
            plant_early: categorize(data.plant_early, &mut notes),
            plant_late: categorize(data.plant_late, &mut notes),
            activities: data
                .activities
                .into_iter()
                .map(|a| match a.description.filter(|s| !s.is_empty()) {
                    Some(description) => format!("{} - {}", a.name, description),
                    None => a.name,
                })
                .collect(),
            notes,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryData {
    pub vegetables: Vec<PrintPlant>,
    pub flowers: Vec<PrintPlant>,
    pub herbs: Vec<PrintPlant>,
    pub other: Vec<PrintPlant>,
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
    #[serde(default)]
    pub notes: Vec<String>,
}

fn draw_plant(layer: &PdfLayerReference, plant: &PrintPlant, x: Mm, y: Mm, font: &IndirectFontRef) {
    let name = format!("• {}", plant.name);
    layer.use_text(&name, 5.5, x, y, font);
    let mut cursor = x.0 + text::width(&name, 5.5) + 0.6;
    for bit in [1, 2, 4] {
        if plant.sun_requirements & bit != 0 {
            symbols::draw(layer, bit, Mm(cursor), y);
            cursor += symbols::ADVANCE;
        }
    }
    if let Some(number) = plant.note {
        layer.use_text(format!("[{number}]"), 5.5, Mm(cursor), y, font);
    }
}

// A note is flattened before wrapping. Break even a long unspaced word rather than clip it.
fn wrap_note(note: &str, width: f32) -> Vec<String> {
    let mut lines = vec![];
    let mut line = String::new();
    for word in note.split_whitespace() {
        if !line.is_empty() && text::width(&format!("{line} {word}"), 5.5) > width {
            lines.push(std::mem::take(&mut line));
        }
        if !line.is_empty() {
            line.push(' ');
        }
        for c in word.chars() {
            if !line.is_empty() && text::width(&format!("{line}{c}"), 5.5) > width {
                lines.push(std::mem::take(&mut line));
            }
            line.push(c);
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

enum ThirdRow<'a> {
    Plant(&'a PrintPlant),
    Heading,
    Gap,
}

pub fn generate_pdf(data: PrintData) -> Result<Vec<u8>, String> {
    // A4 size in mm
    let (doc, page1, layer1) = PdfDocument::new(
        format!("Garden Planner - {}", data.month_name),
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );

    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| e.to_string())?;
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| e.to_string())?;

    // Three-column layout (one per category)
    let col1_x = Mm(10.0); // Vegetables
    let col2_x = Mm(75.0); // Flowers
    let col3_x = Mm(140.0); // Herbs
    let line_height = Mm(2.8);
    let bottom_margin = Mm(12.0);
    let top_start = Mm(290.0);

    let mut y = top_start;
    let mut current_page = page1;
    let mut current_layer_idx = layer1;

    macro_rules! layer {
        () => {
            doc.get_page(current_page).get_layer(current_layer_idx)
        };
    }

    macro_rules! new_page {
        () => {{
            let (new_page, new_layer) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
            current_page = new_page;
            current_layer_idx = new_layer;
            y = top_start;
            symbols::legend(&layer!(), &font);
        }};
    }

    macro_rules! check_page {
        () => {
            if y < bottom_margin {
                new_page!();
            }
        };
    }

    // Helper to truncate string safely at character boundaries
    let truncate_str = |s: &str, max_chars: usize| -> String {
        if s.chars().count() > max_chars {
            format!("{}...", s.chars().take(max_chars - 3).collect::<String>())
        } else {
            s.to_string()
        }
    };

    // Keep the desktop app's exact column geometry, type sizes and line spacing.
    // Paginate inside a period so a busy month cannot disappear below the page.
    macro_rules! draw_period {
        ($period:expr, $label:expr) => {{
            let period = &$period;
            let mut third: Vec<ThirdRow<'_>> = period.herbs.iter().map(ThirdRow::Plant).collect();
            if !period.other.is_empty() {
                if !third.is_empty() {
                    third.push(ThirdRow::Gap);
                }
                third.push(ThirdRow::Heading);
                third.extend(period.other.iter().map(ThirdRow::Plant));
            }
            let rows = period
                .vegetables
                .len()
                .max(period.flowers.len())
                .max(third.len());
            for row in 0..rows {
                if y < bottom_margin {
                    new_page!();
                    layer!().use_text(
                        format!("{} {}", $label, data.month_name),
                        8.0,
                        col1_x,
                        y,
                        &font_bold,
                    );
                    y -= Mm(3.5);
                    layer!().use_text("Vegetables", 6.5, col1_x, y, &font_bold);
                    layer!().use_text("Flowers", 6.5, col2_x, y, &font_bold);
                    layer!().use_text("Herbs", 6.5, col3_x, y, &font_bold);
                    y -= Mm(3.0);
                }
                for (items, x) in [(&period.vegetables, col1_x), (&period.flowers, col2_x)] {
                    if let Some(item) = items.get(row) {
                        draw_plant(&layer!(), item, x, y, &font);
                    }
                }
                match third.get(row) {
                    Some(ThirdRow::Plant(plant)) => draw_plant(&layer!(), plant, col3_x, y, &font),
                    Some(ThirdRow::Heading) => {
                        layer!().use_text("Other", 6.5, col3_x, y, &font_bold)
                    }
                    _ => {}
                }
                y -= line_height;
            }
        }};
    }

    symbols::legend(&layer!(), &font);

    // === SOW THIS MONTH ===
    layer!().use_text("Sow This Month", 11.0, col1_x, y, &font_bold);
    y -= Mm(5.0);

    // Early sow
    layer!().use_text(
        format!("Early {}", data.month_name),
        8.0,
        col1_x,
        y,
        &font_bold,
    );
    y -= Mm(3.5);

    layer!().use_text("Vegetables", 6.5, col1_x, y, &font_bold);
    layer!().use_text("Flowers", 6.5, col2_x, y, &font_bold);
    layer!().use_text("Herbs", 6.5, col3_x, y, &font_bold);
    y -= Mm(3.0);

    draw_period!(data.sow_early, "Early");
    y -= Mm(3.0);
    check_page!();

    if y - Mm(6.5) < bottom_margin {
        new_page!();
    }

    // Late sow
    layer!().use_text(
        format!("Late {}", data.month_name),
        8.0,
        col1_x,
        y,
        &font_bold,
    );
    y -= Mm(3.5);

    layer!().use_text("Vegetables", 6.5, col1_x, y, &font_bold);
    layer!().use_text("Flowers", 6.5, col2_x, y, &font_bold);
    layer!().use_text("Herbs", 6.5, col3_x, y, &font_bold);
    y -= Mm(3.0);

    draw_period!(data.sow_late, "Late");
    y -= Mm(5.0);
    check_page!();

    if y - Mm(11.5) < bottom_margin {
        new_page!();
    }

    // === PLANT THIS MONTH ===
    layer!().use_text("Plant This Month", 11.0, col1_x, y, &font_bold);
    y -= Mm(5.0);

    // Early plant
    layer!().use_text(
        format!("Early {}", data.month_name),
        8.0,
        col1_x,
        y,
        &font_bold,
    );
    y -= Mm(3.5);

    layer!().use_text("Vegetables", 6.5, col1_x, y, &font_bold);
    layer!().use_text("Flowers", 6.5, col2_x, y, &font_bold);
    layer!().use_text("Herbs", 6.5, col3_x, y, &font_bold);
    y -= Mm(3.0);

    draw_period!(data.plant_early, "Early");
    y -= Mm(3.0);
    check_page!();

    if y - Mm(6.5) < bottom_margin {
        new_page!();
    }

    // Late plant
    layer!().use_text(
        format!("Late {}", data.month_name),
        8.0,
        col1_x,
        y,
        &font_bold,
    );
    y -= Mm(3.5);

    layer!().use_text("Vegetables", 6.5, col1_x, y, &font_bold);
    layer!().use_text("Flowers", 6.5, col2_x, y, &font_bold);
    layer!().use_text("Herbs", 6.5, col3_x, y, &font_bold);
    y -= Mm(3.0);

    draw_period!(data.plant_late, "Late");
    y -= Mm(5.0);
    check_page!();

    if y - Mm(4.0) < bottom_margin {
        new_page!();
    }

    // === ACTIVITIES ===
    layer!().use_text("Activities", 11.0, col1_x, y, &font_bold);
    y -= Mm(4.0);

    if data.activities.is_empty() {
        layer!().use_text("No activities this month", 5.5, col1_x, y, &font);
    } else {
        for activity in &data.activities {
            check_page!();
            let display = truncate_str(activity, 100);
            layer!().use_text(format!("• {}", display), 5.5, col1_x, y, &font);
            y -= line_height;
        }
    }

    // Print each distinct note once, using the space left on the final planner page.
    let note_lines: Vec<_> = data
        .notes
        .iter()
        .enumerate()
        .flat_map(|(index, note)| {
            wrap_note(note, 57.)
                .into_iter()
                .enumerate()
                .map(move |(line, text)| (index + 1, line == 0, text))
        })
        .collect();
    let mut offset = 0;
    while offset < note_lines.len() {
        y -= Mm(1.);
        if y - Mm(3.5) < bottom_margin {
            new_page!();
        }
        layer!().use_text("Plant notes", 8., col1_x, y, &font_bold);
        y -= Mm(3.5);
        let capacity = ((y.0 - bottom_margin.0) / 2.2).floor() as usize + 1;
        let count = (note_lines.len() - offset).min(capacity * 3);
        let rows = count.div_ceil(3);
        for (column, x) in [col1_x, col2_x, col3_x].into_iter().enumerate() {
            for row in 0..rows {
                let index = offset + column * rows + row;
                if index >= offset + count {
                    break;
                }
                let (number, first, body) = &note_lines[index];
                let baseline = Mm(y.0 - row as f32 * 2.2);
                if *first || row == 0 {
                    layer!().use_text(format!("[{number}]"), 5.5, x, baseline, &font);
                }
                layer!().use_text(body, 5.5, Mm(x.0 + 5.), baseline, &font);
            }
        }
        offset += count;
        if offset < note_lines.len() {
            new_page!();
        }
    }

    // Return bytes: the website serves a download, never a shared temp file.
    doc.save_to_bytes()
        .map_err(|e| format!("Failed to generate PDF: {}", e))
}
