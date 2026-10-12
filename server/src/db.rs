use crate::models::{Activity, Plant};
use anyhow::{Context, Result, ensure};
use rusqlite::{Connection, OpenFlags, TransactionBehavior, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, fs, path::Path, time::Duration};

pub const APP_ID: i32 = 0x5455494e;
pub const MIGRATIONS: &[(i64, &str, &str)] = &[
    (
        1,
        "web_baseline",
        include_str!("../migrations/001_web_baseline.sql"),
    ),
    (
        2,
        "edit_revisions",
        include_str!("../migrations/002_edit_revisions.sql"),
    ),
];

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn file_digest(path: &Path) -> Result<String> {
    Ok(digest(&fs::read(path)?))
}

pub fn readonly(path: &Path) -> Result<Connection> {
    let c = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    c.busy_timeout(Duration::from_secs(5))?;
    c.pragma_update(None, "trusted_schema", false)?;
    c.pragma_update(None, "query_only", true)?;
    Ok(c)
}

pub fn integrity(c: &Connection) -> Result<()> {
    let messages = c
        .prepare("PRAGMA integrity_check")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ensure!(messages == ["ok"], "Database integrity check failed");
    ensure!(
        !c.prepare("PRAGMA foreign_key_check")?.exists([])?,
        "Database has orphaned records"
    );
    Ok(())
}

pub fn configure(c: &Connection) -> Result<()> {
    c.busy_timeout(Duration::from_secs(5))?;
    c.pragma_update(None, "foreign_keys", true)?;
    c.pragma_update(None, "trusted_schema", false)?;
    c.pragma_update(None, "synchronous", "FULL")?;
    Ok(())
}

pub fn verify_history(c: &Connection, migrations: &[(i64, &str, &str)]) -> Result<usize> {
    ensure!(
        c.pragma_query_value(None, "application_id", |r| r.get::<_, i32>(0))? == APP_ID,
        "This is not an initialized web database. Import a COPY with the import command first."
    );
    let rows = c
        .prepare("SELECT version,name,checksum FROM web_migrations ORDER BY version")?
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ensure!(
        !rows.is_empty() && rows.len() <= migrations.len(),
        "Unknown or missing migration history"
    );
    for (i, (version, name, checksum)) in rows.iter().enumerate() {
        let expected = migrations[i];
        ensure!(
            *version == expected.0
                && name == expected.1
                && *checksum == digest(expected.2.as_bytes()),
            "Migration history differs from this release; refusing to modify database"
        );
    }
    Ok(rows.len())
}

// One transaction covers both SQL and its history entry; BEGIN IMMEDIATE serializes runners.
pub fn migrate(c: &mut Connection, migrations: &[(i64, &str, &str)]) -> Result<()> {
    loop {
        let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let applied = verify_history(&tx, migrations)?;
        if applied == migrations.len() {
            return Ok(());
        }
        let (version, name, sql) = migrations[applied];
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO web_migrations(version,name,checksum) VALUES(?1,?2,?3)",
            params![version, name, digest(sql.as_bytes())],
        )?;
        integrity(&tx)?;
        tx.commit()?;
    }
}

pub fn open_existing(path: &Path) -> Result<Connection> {
    // Validate read-only before any pragma can write to an accidentally selected golden file.
    let ro = readonly(path).context("Database missing; explicit init or import is required")?;
    verify_history(&ro, MIGRATIONS)?;
    integrity(&ro)?;
    drop(ro);
    let c = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    configure(&c)?;
    Ok(c)
}

pub fn initialize(c: &mut Connection) -> Result<()> {
    configure(c)?;
    let tx = c.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.pragma_update(None, "application_id", APP_ID)?;
    tx.execute_batch("CREATE TABLE web_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);")?;
    let (version, name, sql) = MIGRATIONS[0];
    tx.execute_batch(sql)?;
    tx.execute(
        "INSERT INTO web_migrations(version,name,checksum) VALUES(?1,?2,?3)",
        params![version, name, digest(sql.as_bytes())],
    )?;
    tx.commit()?;
    migrate(c, MIGRATIONS)
}

pub fn create_new(path: &Path) -> Result<()> {
    create_target(path, initialize)
}

// Build beside the destination, validate, then publish without overwriting any existing file.
pub fn create_target(
    path: &Path,
    populate: impl FnOnce(&mut Connection) -> Result<()>,
) -> Result<()> {
    ensure!(
        !path.exists(),
        "Destination already exists; refusing to overwrite it"
    );
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = tempfile::NamedTempFile::new_in(parent)?;
    {
        let mut c = Connection::open(temporary.path())?;
        populate(&mut c)?;
        integrity(&c)?;
        c.close().map_err(|(_, e)| e)?;
    }
    temporary.as_file().sync_all()?;
    temporary.persist_noclobber(path).map_err(|e| e.error)?;
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

pub fn plants(c: &Connection) -> Result<Vec<Plant>> {
    Ok(c.prepare("SELECT p.id,p.name,p.plant_type,p.sun_requirements,p.sow_periods,p.plant_periods,p.notes,p.needs_reorder,p.created_at,p.updated_at,p.revision FROM plants p ORDER BY p.name,p.id")?
        .query_map([], |r| Ok(Plant{id:Some(r.get(0)?),name:r.get(1)?,plant_type:r.get(2)?,sun_requirements:r.get(3)?,sow_periods:r.get(4)?,plant_periods:r.get(5)?,notes:r.get(6)?,needs_reorder:r.get(7)?,created_at:r.get(8)?,updated_at:r.get(9)?,revision:r.get(10)?}))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}
pub fn activities(c: &Connection) -> Result<Vec<Activity>> {
    Ok(c.prepare("SELECT id,name,description,active_periods,created_at,updated_at,revision FROM activities ORDER BY name,id")?
        .query_map([], |r| Ok(Activity{id:Some(r.get(0)?),name:r.get(1)?,description:r.get(2)?,active_periods:r.get(3)?,created_at:r.get(4)?,updated_at:r.get(5)?,revision:r.get(6)?}))?
        .collect::<rusqlite::Result<Vec<_>>>()?)
}

fn columns(c: &Connection, name: &str) -> Result<BTreeSet<String>> {
    let sql: String = c.query_row(
        "SELECT sql FROM sqlite_master WHERE name=?1 AND type='table'",
        [name],
        |r| r.get(0),
    )?;
    ensure!(
        sql.to_uppercase().starts_with("CREATE TABLE"),
        "Unsupported table {name}"
    );
    // Names here are compile-time constants, never source file identifiers.
    Ok(c.prepare(&format!("PRAGMA table_info({name})"))?
        .query_map([], |r| r.get(1))?
        .collect::<rusqlite::Result<_>>()?)
}

#[derive(Debug, Serialize)]
pub struct ImportSummary {
    pub plants: usize,
    pub activities: usize,
    pub photos: usize,
    pub source_sha256: String,
}

pub fn import_legacy(source: &Path, destination: &Path) -> Result<ImportSummary> {
    ensure!(
        !destination.exists(),
        "Destination already exists; import never replaces a database"
    );
    for suffix in ["-wal", "-journal"] {
        let mut sidecar = source.as_os_str().to_os_string();
        sidecar.push(suffix);
        ensure!(
            !std::fs::metadata(Path::new(&sidecar)).is_ok_and(|m| m.len() > 0),
            "Source has a live journal. Close the legacy application and use a consistent standalone snapshot."
        );
    }
    let before = file_digest(source)?;
    let src = readonly(source)?;
    src.execute_batch("BEGIN")?; // Keep all source reads in one consistent snapshot.
    integrity(&src)?;
    let cols = columns(&src, "plants")?;
    let activity_cols = columns(&src, "activities")?;
    let photo_cols = columns(&src, "plant_photos")?;
    for name in [
        "id",
        "name",
        "sow_periods",
        "plant_periods",
        "notes",
        "created_at",
        "updated_at",
    ] {
        ensure!(cols.contains(name), "Unrecognized plant schema");
    }
    for name in [
        "id",
        "name",
        "description",
        "active_periods",
        "created_at",
        "updated_at",
    ] {
        ensure!(activity_cols.contains(name), "Unrecognized activity schema");
    }
    for name in ["id", "plant_id", "sort_order", "image_data", "created_at"] {
        ensure!(photo_cols.contains(name), "Unrecognized photo schema");
    }
    ensure!(
        activity_cols.len() == 6 && photo_cols.len() == 5,
        "Unknown columns would be lost during import"
    );
    let has_version = src
        .prepare("SELECT 1 FROM sqlite_master WHERE name='schema_version' AND type='table'")?
        .exists([])?;
    let version = if has_version {
        let versions = src
            .prepare("SELECT version FROM schema_version")?
            .query_map([], |r| r.get::<_, i64>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        ensure!(versions.len() == 1, "Ambiguous legacy version history");
        Some(versions[0])
    } else {
        None
    };
    let text_sun = cols.contains("sun_requirement");
    let bits_sun = cols.contains("sun_requirements");
    let reorder = cols.contains("needs_reorder");
    let typed = cols.contains("plant_type");
    ensure!(
        matches!(
            (version, text_sun, bits_sun, reorder, typed),
            (None, true, false, false, _)
                | (Some(1), true, false, false, true)
                | (Some(2), false, true, false, true)
                | (Some(3), false, true, true, true)
        ),
        "Unknown or contradictory legacy schema/version"
    );
    let allowed: BTreeSet<&str> = [
        "id",
        "name",
        "plant_type",
        "sun_requirement",
        "sun_requirements",
        "sow_periods",
        "plant_periods",
        "notes",
        "created_at",
        "updated_at",
        "needs_reorder",
    ]
    .into();
    ensure!(
        cols.iter().all(|s| allowed.contains(s.as_str())),
        "Unknown plant columns would be lost"
    );
    let names = src
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ensure!(
        names.iter().all(|n| matches!(
            n.as_str(),
            "plants" | "activities" | "plant_photos" | "schema_version"
        )),
        "Unexpected tables or partial migration; refusing import"
    );
    if text_sun {
        ensure!(!src.prepare("SELECT 1 FROM plants WHERE sun_requirement IS NOT NULL AND sun_requirement NOT IN ('full_sun','partial_shade','full_shade')")?.exists([])?,"Unknown sun requirement");
    }
    if reorder {
        ensure!(
            !src.prepare(
                "SELECT 1 FROM plants WHERE needs_reorder IS NULL OR needs_reorder NOT IN (0,1)"
            )?
            .exists([])?,
            "Invalid reorder flag"
        );
    }
    let category = if typed { "plant_type" } else { "NULL" };
    let sun = if text_sun {
        "CASE sun_requirement WHEN 'full_sun' THEN 1 WHEN 'partial_shade' THEN 2 WHEN 'full_shade' THEN 4 ELSE 0 END"
    } else {
        "sun_requirements"
    };
    let reorder_expr = if reorder { "needs_reorder" } else { "0" };
    let sql = format!(
        "SELECT id,name,{category},{sun},sow_periods,plant_periods,notes,{reorder_expr},created_at,updated_at FROM plants ORDER BY id"
    );
    let plants = src
        .prepare(&sql)?
        .query_map([], |r| {
            Ok(Plant {
                id: Some(r.get(0)?),
                name: r.get(1)?,
                plant_type: r.get(2)?,
                sun_requirements: r.get(3)?,
                sow_periods: r.get(4)?,
                plant_periods: r.get(5)?,
                notes: r.get(6)?,
                needs_reorder: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
                revision: 1,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let acts = src.prepare("SELECT id,name,description,active_periods,created_at,updated_at FROM activities ORDER BY id")?.query_map([],|r|Ok(Activity{id:Some(r.get(0)?),name:r.get(1)?,description:r.get(2)?,active_periods:r.get(3)?,created_at:r.get(4)?,updated_at:r.get(5)?,revision:1}))?.collect::<rusqlite::Result<Vec<_>>>()?;
    type ImageRow = (i64, i64, i32, Option<Vec<u8>>, Option<String>);
    let photos = src
        .prepare(
            "SELECT id,plant_id,sort_order,image_data,created_at FROM plant_photos ORDER BY id",
        )?
        .query_map([], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?
        .collect::<rusqlite::Result<Vec<ImageRow>>>()?;
    ensure!(
        plants.iter().all(Plant::valid) && acts.iter().all(Activity::valid),
        "Legacy data fails validation; source was not changed"
    );
    let sequences = src
        .prepare("SELECT name,seq FROM sqlite_sequence")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    create_target(destination, |target| {
        initialize(target)?;
        let tx = target.transaction()?;
        for p in &plants {
            tx.execute("INSERT INTO plants(id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,needs_reorder,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![p.id,p.name,p.plant_type,p.sun_requirements,p.sow_periods,p.plant_periods,p.notes,p.needs_reorder,p.created_at,p.updated_at])?;
        }
        for a in &acts {
            tx.execute("INSERT INTO activities(id,name,description,active_periods,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6)",params![a.id,a.name,a.description,a.active_periods,a.created_at,a.updated_at])?;
        }
        for (id, plant_id, sort_order, image_data, created_at) in &photos {
            tx.execute("INSERT INTO plant_photos(id,plant_id,sort_order,image_data,created_at) VALUES(?1,?2,?3,?4,?5)",params![id,plant_id,sort_order,image_data,created_at])?;
        }
        for (name, seq) in &sequences {
            if matches!(name.as_str(), "plants" | "activities" | "plant_photos") {
                tx.execute("INSERT INTO sqlite_sequence(name,seq) SELECT ?1,?2 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=?1)",params![name,seq])?;
                tx.execute(
                    "UPDATE sqlite_sequence SET seq=max(seq,?2) WHERE name=?1",
                    params![name, seq],
                )?;
            }
        }
        tx.execute(
            "INSERT INTO imports(fingerprint,kind,row_count) VALUES(?1,'legacy',?2)",
            params![before, (plants.len() + acts.len() + photos.len()) as i64],
        )?;
        integrity(&tx)?;
        // Catch a concurrent external writer before publishing this new target.
        ensure!(
            file_digest(source)? == before,
            "Source changed during import; retry from a closed snapshot"
        );
        tx.commit()?;
        Ok(())
    })?;
    Ok(ImportSummary {
        plants: plants.len(),
        activities: acts.len(),
        photos: photos.len(),
        source_sha256: before,
    })
}
