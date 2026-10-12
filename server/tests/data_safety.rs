use rusqlite::{Connection, params};
use std::{
    path::Path,
    sync::{Arc, Barrier},
};
use tuinapp_server::{
    backup::{Backups, restore},
    db,
};

fn legacy(path: &Path, version: Option<i64>, typed: bool) {
    let c = Connection::open(path).unwrap();
    let category = if typed { "plant_type TEXT," } else { "" };
    let sun = if version.unwrap_or(1) >= 2 {
        "sun_requirements INTEGER DEFAULT 0,"
    } else {
        "sun_requirement TEXT,"
    };
    let reorder = if version == Some(3) {
        ",needs_reorder INTEGER DEFAULT 0"
    } else {
        ""
    };
    c.execute_batch(&format!("CREATE TABLE plants(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,{category}{sun}sow_periods INTEGER DEFAULT 0,plant_periods INTEGER DEFAULT 0,notes TEXT,created_at TEXT,updated_at TEXT{reorder});
        CREATE TABLE activities(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT,description TEXT,active_periods INTEGER,created_at TEXT,updated_at TEXT);
        CREATE TABLE plant_photos(id INTEGER PRIMARY KEY AUTOINCREMENT,plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,sort_order INTEGER,image_data BLOB,created_at TEXT);")).unwrap();
    if let Some(v) = version {
        c.execute_batch("CREATE TABLE schema_version(version INTEGER)")
            .unwrap();
        c.execute("INSERT INTO schema_version VALUES(?1)", [v])
            .unwrap();
    }
    c.execute("INSERT INTO plants(id,name,sow_periods,plant_periods,notes,created_at,updated_at) VALUES(7,'Épinard été',8388611,12,'A note\nwith two lines','2020-01-01 10:00:00','2021-01-01 11:00:00')",[]).unwrap();
    c.execute(
        "INSERT INTO plants(id,name,sow_periods,plant_periods) VALUES(8,'Épinard été',0,0)",
        [],
    )
    .unwrap();
    c.execute("UPDATE sqlite_sequence SET seq=99 WHERE name='plants'", [])
        .unwrap();
    if version.unwrap_or(1) >= 2 {
        c.execute("UPDATE plants SET sun_requirements=7 WHERE id=7", [])
            .unwrap();
    } else {
        c.execute(
            "UPDATE plants SET sun_requirement='partial_shade' WHERE id=7",
            [],
        )
        .unwrap();
    }
    if version == Some(3) {
        c.execute("UPDATE plants SET needs_reorder=1 WHERE id=7", [])
            .unwrap();
    }
    c.execute(
        "INSERT INTO activities VALUES(4,'Prune','Gently',8388609,'2020-02-01','2021-03-01')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO plant_photos VALUES(3,7,2,?1,'2021-04-01')",
        params![vec![0u8, 255, 22, 99, 2]],
    )
    .unwrap();
}

#[test]
fn all_historical_shapes_preserve_values_and_photos() {
    for (v, typed) in [
        (None, false),
        (None, true),
        (Some(1), true),
        (Some(2), true),
        (Some(3), true),
    ] {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("legacy");
        let dest = tmp.path().join("web.sqlite");
        legacy(&source, v, typed);
        let before = db::file_digest(&source).unwrap();
        let result = db::import_legacy(&source, &dest).unwrap();
        assert_eq!((result.plants, result.activities, result.photos), (2, 1, 1));
        assert_eq!(before, db::file_digest(&source).unwrap());
        let c = db::open_existing(&dest).unwrap();
        let p = db::plants(&c).unwrap();
        assert_eq!(p[0].id, Some(7));
        assert_eq!(p[0].name, "Épinard été");
        assert_eq!(p[1].name, p[0].name);
        assert_eq!(p[0].sow_periods, 8388611);
        assert_eq!(p[0].plant_periods, 12);
        assert_eq!(p[0].notes.as_deref(), Some("A note\nwith two lines"));
        assert_eq!(p[0].created_at.as_deref(), Some("2020-01-01 10:00:00"));
        assert_eq!(p[0].updated_at.as_deref(), Some("2021-01-01 11:00:00"));
        assert_eq!(
            p[0].sun_requirements,
            if v.unwrap_or(1) >= 2 { 7 } else { 2 }
        );
        assert_eq!(p[0].needs_reorder, v == Some(3));
        assert_eq!(
            c.query_row("SELECT image_data FROM plant_photos", [], |r| r
                .get::<_, Vec<u8>>(0))
                .unwrap(),
            vec![0, 255, 22, 99, 2]
        );
        assert_eq!(
            c.query_row(
                "SELECT seq FROM sqlite_sequence WHERE name='plants'",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            99
        );
        assert_eq!(db::activities(&c).unwrap()[0].active_periods, 8388609);
        c.execute("DELETE FROM plants WHERE id=7", []).unwrap();
        assert_eq!(
            c.query_row("SELECT count(*) FROM plant_photos", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}

#[test]
fn raw_legacy_cannot_be_opened_as_production_and_destinations_never_overwrite() {
    let tmp = tempfile::tempdir().unwrap();
    let source = tmp.path().join("golden");
    legacy(&source, Some(3), true);
    let hash = db::file_digest(&source).unwrap();
    assert!(db::open_existing(&source).is_err());
    assert!(db::import_legacy(&source, &source).is_err());
    assert!(db::create_new(&source).is_err());
    assert!(db::open_existing(&tmp.path().join("absent")).is_err());
    assert!(!tmp.path().join("absent").exists());
    assert_eq!(hash, db::file_digest(&source).unwrap());
    #[cfg(unix)]
    {
        std::fs::hard_link(&source, tmp.path().join("alias")).unwrap();
        assert!(db::import_legacy(&source, &tmp.path().join("alias")).is_err());
    }
}

#[test]
fn invalid_or_partial_sources_fail_without_publishing_a_destination() {
    for sql in [
        "UPDATE schema_version SET version=99",
        "INSERT INTO schema_version VALUES(2)",
        "CREATE TABLE plants_new(id INTEGER)",
        "ALTER TABLE plants ADD COLUMN surprise TEXT",
        "UPDATE plants SET sun_requirements=8",
        "UPDATE plants SET needs_reorder=3",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("source");
        legacy(&source, Some(3), true);
        Connection::open(&source)
            .unwrap()
            .execute_batch(sql)
            .unwrap();
        let before = db::file_digest(&source).unwrap();
        let target = tmp.path().join("target");
        assert!(db::import_legacy(&source, &target).is_err(), "{sql}");
        assert!(!target.exists());
        assert_eq!(before, db::file_digest(&source).unwrap());
    }
}

#[test]
fn migration_failure_rolls_back_schema_and_history_and_can_retry() {
    let mut c = Connection::open_in_memory().unwrap();
    db::initialize(&mut c).unwrap();
    let mut migrations = db::MIGRATIONS.to_vec();
    migrations.push((
        3,
        "failure",
        "ALTER TABLE plants ADD COLUMN extra TEXT; SELECT missing FROM plants;",
    ));
    assert!(db::migrate(&mut c, &migrations).is_err());
    assert_eq!(db::verify_history(&c, db::MIGRATIONS).unwrap(), 2);
    assert!(c.prepare("SELECT extra FROM plants").is_err());
    migrations[2] = (3, "working", "ALTER TABLE plants ADD COLUMN extra TEXT;");
    c.execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON web_migrations WHEN new.version=3 BEGIN SELECT RAISE(ABORT,'injected history failure'); END;").unwrap();
    assert!(db::migrate(&mut c, &migrations).is_err());
    assert!(c.prepare("SELECT extra FROM plants").is_err());
    c.execute_batch("DROP TRIGGER fail_history;").unwrap();
    db::migrate(&mut c, &migrations).unwrap();
    db::migrate(&mut c, &migrations).unwrap();
    assert_eq!(db::verify_history(&c, &migrations).unwrap(), 3);
}

#[test]
fn unknown_or_tampered_migration_history_is_rejected_without_writes() {
    for sql in [
        "UPDATE web_migrations SET checksum='changed' WHERE version=1",
        "UPDATE web_migrations SET version=99 WHERE version=2",
        "DELETE FROM web_migrations WHERE version=1",
    ] {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("web");
        db::create_new(&path).unwrap();
        Connection::open(&path).unwrap().execute_batch(sql).unwrap();
        let before = db::file_digest(&path).unwrap();
        assert!(db::open_existing(&path).is_err());
        assert_eq!(before, db::file_digest(&path).unwrap());
    }
}

#[test]
fn concurrent_migration_runners_apply_once() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("web");
    db::create_new(&path).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let mut threads = vec![];
    for _ in 0..2 {
        let path = path.clone();
        let barrier = barrier.clone();
        threads.push(std::thread::spawn(move || {
            let mut c = db::open_existing(&path).unwrap();
            let mut migrations = db::MIGRATIONS.to_vec();
            migrations.push((
                3,
                "concurrent",
                "CREATE TABLE once_only(value INTEGER); INSERT INTO once_only VALUES(1);",
            ));
            barrier.wait();
            db::migrate(&mut c, &migrations).unwrap();
        }));
    }
    for t in threads {
        t.join().unwrap();
    }
    let c = Connection::open(path).unwrap();
    assert_eq!(
        c.query_row("SELECT count(*) FROM once_only", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn online_backup_includes_wal_changes_and_restore_is_verified_and_non_destructive() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("web");
    db::create_new(&db_path).unwrap();
    let c = db::open_existing(&db_path).unwrap();
    c.pragma_update(None, "journal_mode", "WAL").unwrap();
    c.execute("INSERT INTO plants(name) VALUES('New WAL plant')", [])
        .unwrap();
    let mut backups = Backups::new(tmp.path().join("backups")).unwrap();
    let file = backups.snapshot(&c, "manual").unwrap();
    let restored = tmp.path().join("restored");
    restore(&file, &restored).unwrap();
    assert_eq!(
        db::plants(&db::readonly(&restored).unwrap()).unwrap(),
        db::plants(&c).unwrap()
    );
    let before = db::file_digest(&restored).unwrap();
    assert!(restore(&file, &restored).is_err());
    assert_eq!(before, db::file_digest(&restored).unwrap());
    std::fs::write(&file, b"corrupt").unwrap();
    assert!(restore(&file, &tmp.path().join("corrupt-restore")).is_err());
    assert!(!tmp.path().join("corrupt-restore").exists());
}

#[test]
fn backup_failure_is_visible_and_does_not_prune_existing_backups() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("web");
    db::create_new(&path).unwrap();
    let c = db::open_existing(&path).unwrap();
    let dir = tmp.path().join("backups");
    let mut backups = Backups::new(dir.clone()).unwrap();
    let saved = backups.snapshot(&c, "manual").unwrap();
    let moved = tmp.path().join("saved-backups");
    std::fs::rename(&dir, &moved).unwrap();
    std::fs::write(&dir, "not a directory").unwrap();
    assert!(backups.snapshot(&c, "scheduled").is_err());
    assert!(backups.status.last_error.is_some());
    assert!(moved.join(saved.file_name().unwrap()).exists());
}

fn compare_golden(source: &Connection, target: &Connection) {
    let columns = [
        (
            "plants",
            "id,name,plant_type,sun_requirements,sow_periods,plant_periods,notes,needs_reorder,created_at,updated_at",
        ),
        (
            "activities",
            "id,name,description,active_periods,created_at,updated_at",
        ),
        (
            "plant_photos",
            "id,plant_id,sort_order,image_data,created_at",
        ),
    ];
    for (table, columns) in columns {
        let count = columns.split(',').count();
        let sql = format!("SELECT {columns} FROM {table} ORDER BY id");
        let read = |c: &Connection| {
            c.prepare(&sql)
                .unwrap()
                .query_map([], |r| {
                    (0..count)
                        .map(|i| r.get::<_, rusqlite::types::Value>(i))
                        .collect::<rusqlite::Result<Vec<_>>>()
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap()
        };
        assert_eq!(
            read(source),
            read(target),
            "Every field must match for {table}"
        );
    }
    for month in 0..12 {
        for (table, field) in [
            ("plants", "sow_periods"),
            ("plants", "plant_periods"),
            ("activities", "active_periods"),
        ] {
            for bit in [1 << (month * 2), 1 << (month * 2 + 1)] {
                let sql = format!("SELECT id FROM {table} WHERE {field} & {bit} != 0 ORDER BY id");
                let read = |c: &Connection| {
                    c.prepare(&sql)
                        .unwrap()
                        .query_map([], |r| r.get::<_, i64>(0))
                        .unwrap()
                        .collect::<rusqlite::Result<Vec<_>>>()
                        .unwrap()
                };
                assert_eq!(read(source), read(target));
            }
        }
    }
}

#[test]
#[ignore = "Requires TUINAPP_GOLDEN_DB; the private golden database is never committed"]
fn golden_database_import_restart_backup_restore_preserve_every_field() {
    let path = std::env::var("TUINAPP_GOLDEN_DB")
        .expect("Set TUINAPP_GOLDEN_DB to the preserved database");
    let source = Path::new(&path);
    let expected = "ad2e267df1ad06250204f3fd2a9a7f8c19bc5f531f4c7285c61f966bf3dd29a6";
    assert_eq!(db::file_digest(source).unwrap(), expected);
    let tmp = tempfile::tempdir().unwrap();
    let target = tmp.path().join("imported");
    let result = db::import_legacy(source, &target).unwrap();
    assert_eq!(
        (result.plants, result.activities, result.photos),
        (177, 9, 0)
    );
    let original = db::readonly(source).unwrap();
    let mut working = db::open_existing(&target).unwrap();
    db::migrate(&mut working, db::MIGRATIONS).unwrap();
    compare_golden(&original, &working);
    assert_eq!(
        db::plants(&working)
            .unwrap()
            .iter()
            .filter(|p| p.needs_reorder)
            .count(),
        17
    );
    drop(working);
    let working = db::open_existing(&target).unwrap();
    compare_golden(&original, &working);
    let mut backups = Backups::new(tmp.path().join("backups")).unwrap();
    let file = backups.snapshot(&working, "golden-test").unwrap();
    let restored = tmp.path().join("restored");
    restore(&file, &restored).unwrap();
    compare_golden(&original, &db::open_existing(&restored).unwrap());
    assert!(db::import_legacy(source, &target).is_err());
    assert_eq!(db::file_digest(source).unwrap(), expected);
    println!(
        "Verified all 177 plants, 9 activities, 17 reorder flags, all fields and all 12 months through import, restart, backup and restore. Golden SHA-256 unchanged."
    );
}

#[test]
fn retention_preserves_recent_daily_monthly_and_manual_recovery_points() {
    use chrono::{Duration, Utc};
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("web");
    db::create_new(&path).unwrap();
    let c = db::open_existing(&path).unwrap();
    let dir = tmp.path().join("backups");
    let mut backups = Backups::new(dir.clone()).unwrap();
    let manual = backups.snapshot(&c, "manual").unwrap();
    let template = backups.status.latest.clone().unwrap();
    // Distinct historical hours/days exercise the three overlapping retention windows.
    for i in 1..=400 {
        let mut manifest = template.clone();
        manifest.file = format!("history-{i}.sqlite");
        manifest.reason = "scheduled".into();
        manifest.created_at = Utc::now() - Duration::hours(i * 6);
        std::fs::copy(&manual, dir.join(&manifest.file)).unwrap();
        std::fs::write(
            dir.join(format!("history-{i}.json")),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
    }
    backups.snapshot(&c, "scheduled").unwrap();
    assert!(manual.exists());
    assert!(manual.with_extension("json").exists());
    for i in 1..=47 {
        assert!(dir.join(format!("history-{i}.sqlite")).exists());
    }
    assert!(!dir.join("history-399.sqlite").exists());
    let remaining: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "sqlite"))
        .collect();
    assert!(remaining.len() >= 48 && remaining.len() <= 91);
    for path in remaining {
        assert!(path.with_extension("json").exists());
    }
}

#[test]
fn failure_to_publish_backup_status_is_reported() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("web");
    db::create_new(&path).unwrap();
    let c = db::open_existing(&path).unwrap();
    let dir = tmp.path().join("backups");
    let mut backups = Backups::new(dir.clone()).unwrap();
    std::fs::create_dir(dir.join("status.json")).unwrap();
    assert!(backups.snapshot(&c, "scheduled").is_err());
    assert!(backups.status.last_error.is_some());
    assert!(backups.status.failed_at.is_some());
}
