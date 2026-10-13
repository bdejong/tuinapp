use std::fs;
use tuinapp_server::{
    backup::{Backups, content_digest, verify},
    db,
};

#[test]
fn unchanged_checks_survive_wal_checkpoint_restart_and_lost_status() {
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("garden.sqlite");
    db::create_new(&path).unwrap();
    let c = db::open_existing(&path).unwrap();
    c.pragma_update(None, "journal_mode", "WAL").unwrap();
    c.execute("INSERT INTO plants(name) VALUES('Tomato')", [])
        .unwrap();
    let directory = t.path().join("backups");
    let mut b = Backups::new(directory.clone()).unwrap();
    let first = b.snapshot(&c, "scheduled").unwrap();
    let original_manifest = b.status.latest.clone().unwrap();
    c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
        .unwrap();
    drop(b);
    fs::remove_file(directory.join("status.json")).unwrap();
    let mut b = Backups::new(directory).unwrap();
    assert_eq!(b.snapshot(&c, "scheduled").unwrap(), first);
    assert_eq!(
        b.status.latest.as_ref().unwrap().created_at,
        original_manifest.created_at
    );
    assert!(b.status.checked_unchanged);
    assert!(b.status.last_checked_at.is_some());
    assert!(b.status.last_restore_verified_at.is_some());
    assert_eq!(b.history().unwrap().backups.len(), 1);
    // Reuse and pin before an upgrade, including after a restart.
    assert_eq!(b.snapshot(&c, "before-migration").unwrap(), first);
    assert_eq!(verify(&first).unwrap().reason, "before-migration");
}

#[test]
fn committed_edits_deletes_and_legacy_bytes_change_fingerprint_but_rollback_does_not() {
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("garden.sqlite");
    db::create_new(&path).unwrap();
    let c = db::open_existing(&path).unwrap();
    let mut b = Backups::new(t.path().join("backups")).unwrap();
    let mut previous = b.snapshot(&c, "scheduled").unwrap();
    for sql in [
        "INSERT INTO plants(name) VALUES('Tomato')",
        "UPDATE plants SET notes='line 1\nline 2'",
        "UPDATE plants SET needs_reorder=1",
        "INSERT INTO activities(name) VALUES('Prune')",
        "INSERT INTO plant_photos(plant_id,sort_order,image_data) VALUES(1,0,x'00FF')",
        "DELETE FROM plants",
        "DELETE FROM activities",
    ] {
        c.execute_batch(sql).unwrap();
        let next = b.snapshot(&c, "scheduled").unwrap();
        assert_ne!(next, previous, "{sql}");
        previous = next;
    }
    let fingerprint = content_digest(&c).unwrap();
    c.execute_batch("BEGIN; INSERT INTO plants(name) VALUES('Rollback'); ROLLBACK;")
        .unwrap();
    assert_eq!(content_digest(&c).unwrap(), fingerprint);
    assert_eq!(b.snapshot(&c, "scheduled").unwrap(), previous);
    assert_eq!(b.history().unwrap().backups.len(), 8);
}

#[test]
fn legacy_manifests_are_upgraded_without_duplicate_and_corrupt_or_missing_latest_is_replaced() {
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("garden.sqlite");
    db::create_new(&path).unwrap();
    let c = db::open_existing(&path).unwrap();
    let mut b = Backups::new(t.path().join("backups")).unwrap();
    let first = b.snapshot(&c, "scheduled").unwrap();
    let mut json: serde_json::Value =
        serde_json::from_slice(&fs::read(first.with_extension("json")).unwrap()).unwrap();
    json.as_object_mut().unwrap().remove("content_sha256");
    fs::write(
        first.with_extension("json"),
        serde_json::to_vec(&json).unwrap(),
    )
    .unwrap();
    assert_eq!(b.snapshot(&c, "scheduled").unwrap(), first);
    assert!(!verify(&first).unwrap().content_sha256.is_empty());
    fs::write(&first, b"corrupt").unwrap();
    let replacement = b.snapshot(&c, "scheduled").unwrap();
    assert_ne!(replacement, first);
    verify(&replacement).unwrap();
    fs::remove_file(&replacement).unwrap();
    let repaired = b.snapshot(&c, "scheduled").unwrap();
    verify(&repaired).unwrap();
    assert_ne!(repaired, replacement);
}

#[test]
fn history_rejects_paths_symlinks_and_incomplete_pairs_and_matches_receipt_checksums() {
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("garden.sqlite");
    db::create_new(&path).unwrap();
    let c = db::open_existing(&path).unwrap();
    let dir = t.path().join("backups");
    let mut b = Backups::new(dir.clone()).unwrap();
    let saved = b.snapshot(&c, "scheduled").unwrap();
    let m = b.status.latest.clone().unwrap();
    fs::write(dir.join("incomplete.sqlite"), b"not ready").unwrap();
    assert_eq!(b.history().unwrap().backups.len(), 1);
    for name in [
        "../garden.sqlite",
        "/garden.sqlite",
        "x%2fy.sqlite",
        "status.json",
        "absent.sqlite",
    ] {
        assert!(b.existing(name).unwrap().is_none());
    }
    let status_path = t.path().join("offsite.json");
    b.offsite_status_path = Some(status_path.clone());
    assert!(b.history().unwrap().offsite.unwrap().last_error.is_some());
    for (checksum, confirmed) in [("wrong", false), (m.sha256.as_str(), true)] {
        fs::write(&status_path,serde_json::to_vec(&serde_json::json!({"uploaded":{&m.file:{"sha256":checksum,"uploaded_at":m.created_at}}})).unwrap()).unwrap();
        assert_eq!(
            b.history().unwrap().backups[0].uploaded_at.is_some(),
            confirmed
        );
    }
    #[cfg(unix)]
    {
        fs::remove_file(&saved).unwrap();
        std::os::unix::fs::symlink(&path, &saved).unwrap();
        assert!(b.history().unwrap().backups.is_empty());
        assert!(b.existing(&m.file).unwrap().is_none());
    }
}

#[test]
fn daily_restore_verification_reuses_the_existing_backup() {
    let t = tempfile::tempdir().unwrap();
    let path = t.path().join("garden.sqlite");
    db::create_new(&path).unwrap();
    let c = db::open_existing(&path).unwrap();
    let mut b = Backups::new(t.path().join("backups")).unwrap();
    let file = b.snapshot(&c, "scheduled").unwrap();
    b.status.last_restore_verified_at = Some(chrono::Utc::now() - chrono::Duration::days(2));
    assert_eq!(b.snapshot(&c, "scheduled").unwrap(), file);
    assert!(
        b.status.last_restore_verified_at.unwrap()
            > chrono::Utc::now() - chrono::Duration::seconds(10)
    );
    assert_eq!(b.history().unwrap().backups.len(), 1);
}
