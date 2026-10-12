use lopdf::{Document, content::Content};
use serde_json::json;
use tuinapp_server::pdf::{PrintData, PrintPlant, generate_pdf};

#[derive(Debug)]
struct Text {
    page: u32,
    value: String,
    font: String,
    size: f32,
    x: f32,
    y: f32,
}
fn fixture() -> PrintData {
    let empty = json!({"vegetables":[],"flowers":[],"herbs":[],"other":[]});
    serde_json::from_value(json!({
        "monthName":"October",
        "sowEarly":{"vegetables":[{"name":"Carrot","sun_requirements":1,"note":1},{"name":"Pea","sun_requirements":2}],"flowers":[{"name":"Dahlia","sun_requirements":1}],"herbs":[{"name":"Basil","sun_requirements":1}],"other":[]},
        "sowLate":empty, "plantEarly":empty, "plantLate":empty,
        "activities":["Prune - After frost"], "notes":["Sow after the last frost."]
    })).unwrap()
}
fn inspect(data: PrintData) -> (Document, Vec<Text>) {
    let bytes = generate_pdf(data).unwrap();
    let doc = Document::load_mem(&bytes).unwrap();
    let mut texts = vec![];
    for (page, id) in doc.get_pages() {
        let content = Content::decode(&doc.get_page_content(id).unwrap()).unwrap();
        let (mut x, mut y, mut size, mut font) = (0., 0., 0., String::new());
        for op in content.operations {
            match op.operator.as_str() {
                "BT" => {
                    x = 0.;
                    y = 0.;
                }
                "Td" => {
                    x += op.operands[0].as_float().unwrap();
                    y += op.operands[1].as_float().unwrap();
                }
                "Tf" => {
                    font = String::from_utf8_lossy(op.operands[0].as_name().unwrap()).into();
                    size = op.operands[1].as_float().unwrap();
                }
                "Tj" => texts.push(Text {
                    page,
                    value: String::from_utf8_lossy(op.operands[0].as_str().unwrap()).into(),
                    font: font.clone(),
                    size,
                    x,
                    y,
                }),
                _ => {}
            }
        }
    }
    (doc, texts)
}
fn entry(name: String) -> PrintPlant {
    PrintPlant {
        name,
        sun_requirements: 0,
        note: None,
    }
}

fn near(actual: f32, expected: f32) {
    assert!((actual - expected).abs() < 0.01, "{actual} != {expected}");
}

#[test]
fn original_page_geometry_typography_columns_and_vertical_rhythm() {
    let (doc, texts) = inspect(fixture());
    assert_eq!(doc.get_pages().len(), 1);
    let page = doc
        .get_dictionary(*doc.get_pages().get(&1).unwrap())
        .unwrap();
    let bounds = page.get(b"MediaBox").unwrap().as_array().unwrap();
    near(bounds[2].as_float().unwrap(), 595.27563);
    near(bounds[3].as_float().unwrap(), 841.88983);
    // Reference coordinates measured from the original desktop generator, in PDF points.
    for (value, font, size, x, y) in [
        ("Sow This Month", "Helvetica-Bold", 11., 28.34646, 822.04736),
        ("Early October", "Helvetica-Bold", 8., 28.34646, 807.8741),
        ("Vegetables", "Helvetica-Bold", 6.5, 28.34646, 797.9528),
        ("Flowers", "Helvetica-Bold", 6.5, 212.59845, 797.9528),
        ("Herbs", "Helvetica-Bold", 6.5, 396.85043, 797.9528),
        ("\u{7f} Carrot", "Helvetica", 5.5, 28.34646, 789.44885),
        ("\u{7f} Dahlia", "Helvetica", 5.5, 212.59845, 789.44885),
        ("\u{7f} Basil", "Helvetica", 5.5, 396.85043, 789.44885),
        ("\u{7f} Pea", "Helvetica", 5.5, 28.34646, 781.5119),
        ("Late October", "Helvetica-Bold", 8., 28.34646, 765.0709),
    ] {
        let t = texts
            .iter()
            .find(|t| t.value == value)
            .unwrap_or_else(|| panic!("Missing {value}"));
        assert_eq!(t.page, 1);
        assert_eq!(t.font, font);
        near(t.size, size);
        near(t.x, x);
        near(t.y, y);
    }
}

#[test]
fn long_columns_continue_without_losing_rows_or_running_off_the_page() {
    let mut data = fixture();
    data.sow_early.vegetables = (0..210)
        .map(|i| entry(format!("Vegetable {i:03}")))
        .collect();
    data.sow_early.flowers = (0..105).map(|i| entry(format!("Flower {i:03}"))).collect();
    data.sow_early.herbs = (0..110).map(|i| entry(format!("Herb {i:03}"))).collect();
    let (doc, texts) = inspect(data);
    assert_eq!(doc.get_pages().len(), 3);
    for (prefix, count, x) in [
        ("Vegetable", 210, 28.34646),
        ("Flower", 105, 212.59845),
        ("Herb", 110, 396.85043),
    ] {
        for i in 0..count {
            let value = format!("\u{7f} {prefix} {i:03}");
            let rows: Vec<_> = texts.iter().filter(|t| t.value == value).collect();
            assert_eq!(rows.len(), 1, "Missing or repeated {value}");
            near(rows[0].x, x);
            near(rows[0].size, 5.5);
        }
    }
    for t in &texts {
        assert!(t.y >= 34.015 && t.y <= 822.05, "Out of bounds: {t:?}");
    }
    for page in 2..=3 {
        assert!(
            texts
                .iter()
                .any(|t| t.page == page && t.value == "Early October")
        );
        assert!(
            texts
                .iter()
                .any(|t| t.page == page && t.value == "Vegetables")
        );
    }
}

#[test]
fn uncategorized_entries_use_the_existing_third_column() {
    let mut data = fixture();
    data.sow_early
        .other
        .push(entry("Uncategorized plant".into()));
    let (_, texts) = inspect(data);
    let heading = texts.iter().find(|t| t.value == "Other").unwrap();
    let plant = texts
        .iter()
        .find(|t| t.value.contains("Uncategorized plant"))
        .unwrap();
    near(heading.x, 396.85043);
    near(heading.size, 6.5);
    near(plant.x, 396.85043);
    near(plant.size, 5.5);
    assert!(plant.y < heading.y);
}

#[test]
fn empty_calendar_and_long_activity_keep_the_original_minimal_style() {
    let mut data = fixture();
    data.sow_early.vegetables.clear();
    data.sow_early.flowers.clear();
    data.sow_early.herbs.clear();
    data.activities.clear();
    let (doc, texts) = inspect(data);
    assert_eq!(doc.get_pages().len(), 1);
    assert!(
        texts
            .iter()
            .any(|t| t.value == "No activities this month" && t.size == 5.5)
    );
    let mut data = fixture();
    data.activities = vec!["x".repeat(120)];
    let (_, texts) = inspect(data);
    assert!(
        texts
            .iter()
            .any(|t| t.value == format!("\u{7f} {}...", "x".repeat(97)) && t.size == 5.5)
    );
}

#[test]
fn repeated_plant_notes_share_one_reference_and_newlines_are_flattened() {
    use tuinapp_server::models::{MonthData, Plant};
    let plant: Plant=serde_json::from_value(json!({"id":1,"name":"Carrot","plant_type":"vegetable_fruit","sun_requirements":7,"sow_periods":3,"plant_periods":3,"notes":"  First line\r\n\n  Second\t line.  ","needs_reorder":false})).unwrap();
    let mut second = plant.clone();
    second.id = Some(2);
    second.name = "Pea".into();
    second.notes = Some("First line Second line.".into());
    let data = PrintData::from_month(
        "January",
        MonthData {
            sow_early: vec![plant.clone(), second],
            sow_late: vec![plant.clone()],
            plant_early: vec![plant.clone()],
            plant_late: vec![plant],
            activities: vec![],
        },
    );
    assert_eq!(data.notes, vec!["First line Second line."]);
    assert_eq!(data.sow_early.vegetables[0].note, Some(1));
    assert_eq!(data.sow_late.vegetables[0].note, Some(1));
    assert_eq!(data.plant_late.vegetables[0].note, Some(1));
    let (_, texts) = inspect(data);
    assert_eq!(
        texts
            .iter()
            .filter(|t| t.value == "First line Second line.")
            .count(),
        1
    );
    assert!(
        !texts
            .iter()
            .any(|t| t.value.contains("(N)") || t.value.contains("***"))
    );
    assert!(texts.iter().any(|t| t.value == "Plant notes"));
}

#[test]
fn whitespace_only_notes_do_not_create_references() {
    use tuinapp_server::models::{MonthData, Plant};
    let plant: Plant=serde_json::from_value(json!({"name":"Basil","plant_type":"herb","sun_requirements":0,"sow_periods":1,"plant_periods":0,"notes":" \r\n\t ","needs_reorder":false})).unwrap();
    let data = PrintData::from_month(
        "January",
        MonthData {
            sow_early: vec![plant],
            sow_late: vec![],
            plant_early: vec![],
            plant_late: vec![],
            activities: vec![],
        },
    );
    assert!(data.notes.is_empty());
    assert_eq!(data.sow_early.herbs[0].note, None);
    let (_, texts) = inspect(data);
    assert!(!texts.iter().any(|t| t.value == "Plant notes"));
}

#[test]
fn long_notes_wrap_into_three_columns_and_continue_without_truncation() {
    let mut data = fixture();
    data.notes = (1..=120)
        .map(|n| format!("Note{n:03} {} Last{n:03}", "cultivation advice ".repeat(15)))
        .collect();
    // Include a word too long to fit, and accented text.
    data.notes
        .push(format!("{} café après l'été", "X".repeat(500)));
    let (doc, texts) = inspect(data);
    assert!(doc.get_pages().len() > 1);
    let extracted = doc
        .extract_text(&doc.get_pages().keys().copied().collect::<Vec<_>>())
        .unwrap();
    for n in 1..=120 {
        assert_eq!(extracted.matches(&format!("Note{n:03}")).count(), 1);
        assert_eq!(extracted.matches(&format!("Last{n:03}")).count(), 1);
    }
    assert_eq!(extracted.matches('X').count(), 500);
    // lopdf 0.31's extractor misdecodes these WinAnsi bytes; inspect the encoded
    // glyphs and declared encoding instead (PDF readers render them correctly).
    let all_bytes: Vec<_> = doc
        .get_pages()
        .values()
        .flat_map(|id| {
            Content::decode(&doc.get_page_content(*id).unwrap())
                .unwrap()
                .operations
                .into_iter()
                .filter(|op| op.operator == "Tj")
                .flat_map(|op| op.operands[0].as_str().unwrap().to_vec())
                .collect::<Vec<_>>()
        })
        .collect();
    for word in [
        b"caf\xe9".as_slice(),
        b"apr\xe8s".as_slice(),
        b"l'\xe9t\xe9".as_slice(),
    ] {
        assert!(all_bytes.windows(word.len()).any(|w| w == word));
    }
    for id in doc.get_pages().values() {
        for font in doc.get_page_fonts(*id).values() {
            assert_eq!(
                font.get(b"Encoding").unwrap().as_name().unwrap(),
                b"WinAnsiEncoding"
            );
        }
    }
    for t in &texts {
        assert!(t.y >= 34.015 && t.y <= 822.05, "Out of bounds: {t:?}");
    }
    assert!(
        texts
            .iter()
            .any(|t| t.value.contains("cultivation") && (t.x - 42.51969).abs() < 0.01)
    );
    assert!(
        texts
            .iter()
            .any(|t| t.value.contains("cultivation") && (t.x - 226.77167).abs() < 0.01)
    );
    assert!(
        texts
            .iter()
            .any(|t| t.value.contains("cultivation") && (t.x - 411.02365).abs() < 0.01)
    );
}

#[test]
fn sun_partly_cloudy_and_cloud_are_distinct_black_and_white_vector_paths() {
    let mut counts = vec![];
    for bit in 0..8 {
        let mut data = fixture();
        data.sow_early.vegetables[0].sun_requirements = bit;
        let (doc, _) = inspect(data);
        let content = Content::decode(
            &doc.get_page_content(*doc.get_pages().get(&1).unwrap())
                .unwrap(),
        )
        .unwrap();
        let clouds = content
            .operations
            .iter()
            .filter(|op| op.operator == "b" || op.operator == "B")
            .count();
        let rays = content
            .operations
            .iter()
            .filter(|op| op.operator == "S")
            .count();
        for op in &content.operations {
            assert!(!matches!(
                op.operator.as_str(),
                "rg" | "RG" | "k" | "K" | "Do"
            ));
            if matches!(op.operator.as_str(), "g" | "G") {
                assert!(matches!(op.operands[0].as_float().unwrap(), 0.0 | 1.0));
            }
        }
        counts.push((clouds, rays));
    }
    for bit in 0..8 {
        let clouds = usize::from(bit & 2 != 0) + usize::from(bit & 4 != 0);
        let suns = usize::from(bit & 1 != 0) + usize::from(bit & 2 != 0);
        assert_eq!(counts[bit].0, counts[0].0 + clouds);
        assert_eq!(counts[bit].1, counts[0].1 + 8 * suns);
    }
}
