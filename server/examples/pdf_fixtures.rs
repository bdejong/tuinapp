//! Local-only comparison fixtures. Optional golden data is read/imported into a tempdir.
use std::{fs, path::PathBuf};
use tuinapp_server::{
    db,
    models::{MonthData, Plant},
    pdf::{self, PrintData},
};
fn main() -> anyhow::Result<()> {
    let out = PathBuf::from(std::env::args().nth(1).expect("Output directory required"));
    fs::create_dir_all(&out)?;
    let save = |name: &str, data: PrintData| -> anyhow::Result<()> {
        fs::write(out.join(format!("{name}.json")), serde_json::to_vec(&data)?)?;
        fs::write(
            out.join(format!("{name}-native.pdf")),
            pdf::generate_pdf(data).map_err(anyhow::Error::msg)?,
        )?;
        Ok(())
    };
    let empty = || MonthData {
        sow_early: vec![],
        sow_late: vec![],
        plant_early: vec![],
        plant_late: vec![],
        activities: vec![],
    };
    save("empty", PrintData::from_month("January", empty()))?;
    let mut long = empty();
    for i in 0..240 {
        long.sow_early.push(Plant {
            id: Some(i),
            name: format!("Épinard {i} – été"),
            plant_type: Some(["vegetable_fruit", "flower", "herb"][(i % 3) as usize].into()),
            sun_requirements: (i % 8) as i32,
            sow_periods: 1,
            plant_periods: 0,
            notes: Some(format!(
                "Note {i}: First line\nsecond line. {}",
                "Long note with wrapping and spacing. ".repeat(8)
            )),
            needs_reorder: false,
            created_at: None,
            updated_at: None,
            revision: 1,
        });
    }
    save("overflow", PrintData::from_month("January", long))?;
    if let Ok(source) = std::env::var("TUINAPP_GOLDEN_DB") {
        let source = PathBuf::from(source);
        let before = db::file_digest(&source)?;
        let tmp = tempfile::tempdir()?;
        let imported = tmp.path().join("imported.sqlite");
        db::import_legacy(&source, &imported)?;
        let c = db::readonly(&imported)?;
        for month in 1..=12 {
            save(
                &format!("month-{month:02}"),
                PrintData::from_month(pdf::MONTHS[month - 1], {
                    let plants = db::plants(&c)?;
                    let early = 1 << ((month - 1) * 2);
                    let late = early << 1;
                    MonthData {
                        sow_early: plants
                            .iter()
                            .filter(|p| p.sow_periods & early != 0)
                            .cloned()
                            .collect(),
                        sow_late: plants
                            .iter()
                            .filter(|p| p.sow_periods & late != 0)
                            .cloned()
                            .collect(),
                        plant_early: plants
                            .iter()
                            .filter(|p| p.plant_periods & early != 0)
                            .cloned()
                            .collect(),
                        plant_late: plants
                            .iter()
                            .filter(|p| p.plant_periods & late != 0)
                            .cloned()
                            .collect(),
                        activities: db::activities(&c)?
                            .into_iter()
                            .filter(|a| a.active_periods & (early | late) != 0)
                            .collect(),
                    }
                }),
            )?;
        }
        anyhow::ensure!(before == db::file_digest(&source)?, "Golden source changed");
    }
    Ok(())
}
