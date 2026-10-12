use crate::db;
use anyhow::{Context, Result, ensure};
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub file: String,
    pub sha256: String,
    pub created_at: DateTime<Utc>,
    pub reason: String,
    pub schema_version: i64,
    pub app_version: String,
    pub plants: i64,
    pub activities: i64,
    pub photos: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Status {
    pub latest: Option<Manifest>,
    pub last_error: Option<String>,
    pub failed_at: Option<DateTime<Utc>>,
    pub last_restore_verified_at: Option<DateTime<Utc>>,
    pub storage: String,
}

pub struct Backups {
    pub directory: PathBuf,
    pub status: Status,
}

impl Backups {
    pub fn new(directory: PathBuf) -> Result<Self> {
        fs::create_dir_all(&directory)?;
        let mut status: Status = fs::read(directory.join("status.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        status.storage = "server-local; independent off-site backup not configured".into();
        Ok(Self { directory, status })
    }

    pub fn snapshot(&mut self, c: &Connection, reason: &str) -> Result<PathBuf> {
        let result = (|| {
            let (path, manifest) = self.snapshot_inner(c, reason)?;
            self.status.latest = Some(manifest);
            self.status.last_error = None;
            self.status.failed_at = None;
            self.persist_status()?;
            self.prune()?;
            Ok(path)
        })();
        if let Err(ref error) = result {
            self.status.last_error = Some(format!("{error}"));
            self.status.failed_at = Some(Utc::now());
            let _ = self.persist_status();
        }
        result
    }

    fn snapshot_inner(&self, c: &Connection, reason: &str) -> Result<(PathBuf, Manifest)> {
        let filename = format!(
            "tuinapp-{}-{}.sqlite",
            Utc::now().format("%Y%m%dT%H%M%SZ"),
            Uuid::new_v4()
        );
        let path = self.directory.join(&filename);
        db::create_target(&path, |target| {
            rusqlite::backup::Backup::new(c, target)?.run_to_completion(
                128,
                Duration::from_millis(10),
                None,
            )?;
            db::verify_history(target, db::MIGRATIONS)?;
            Ok(())
        })?;
        let restored = db::readonly(&path)?;
        db::integrity(&restored)?;
        let manifest = Manifest {
            file: filename,
            sha256: db::file_digest(&path)?,
            created_at: Utc::now(),
            reason: reason.into(),
            schema_version: restored.query_row(
                "SELECT max(version) FROM web_migrations",
                [],
                |r| r.get(0),
            )?,
            app_version: env!("CARGO_PKG_VERSION").into(),
            plants: restored.query_row("SELECT count(*) FROM plants", [], |r| r.get(0))?,
            activities: restored.query_row("SELECT count(*) FROM activities", [], |r| r.get(0))?,
            photos: restored.query_row("SELECT count(*) FROM plant_photos", [], |r| r.get(0))?,
        };
        atomic_json(&path.with_extension("json"), &manifest)?;
        Ok((path, manifest))
    }

    pub fn persist_status(&self) -> Result<()> {
        atomic_json(&self.directory.join("status.json"), &self.status)
    }

    // Keep 48 recent hourly snapshots, 30 daily points, and 12 monthly points.
    // Manual, migration and pre-import snapshots are intentionally never auto-pruned.
    fn prune(&self) -> Result<()> {
        let mut snapshots = Vec::new();
        for entry in fs::read_dir(&self.directory)? {
            let path = entry?.path();
            if path.extension().is_none_or(|s| s != "json") {
                continue;
            }
            if let Ok(m) = serde_json::from_slice::<Manifest>(&fs::read(&path)?)
                && m.reason == "scheduled"
                && Path::new(&m.file)
                    .file_name()
                    .is_some_and(|n| n == m.file.as_str())
            {
                snapshots.push((path, m));
            }
        }
        snapshots.sort_by_key(|a| std::cmp::Reverse(a.1.created_at));
        let (mut days, mut months) = (HashSet::new(), HashSet::new());
        for (index, (path, m)) in snapshots.iter().enumerate() {
            let day = m.created_at.format("%Y-%m-%d").to_string();
            let month = m.created_at.format("%Y-%m").to_string();
            let daily = days.len() < 30 && days.insert(day);
            let monthly = months.len() < 12 && months.insert(month);
            if index >= 48 && !daily && !monthly {
                fs::remove_file(self.directory.join(&m.file))?;
                fs::remove_file(path)?;
            }
        }
        Ok(())
    }
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    use std::io::Write;
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().context("Missing parent")?)?;
    temp.write_all(&serde_json::to_vec_pretty(value)?)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| e.error)?;
    Ok(())
}

pub fn restore(source: &Path, destination: &Path) -> Result<()> {
    let manifest: Manifest = serde_json::from_slice(
        &fs::read(source.with_extension("json"))
            .context("Restore requires its JSON backup manifest")?,
    )?;
    ensure!(
        db::file_digest(source)? == manifest.sha256,
        "Backup checksum mismatch"
    );
    let src = db::readonly(source)?;
    db::verify_history(&src, db::MIGRATIONS)?;
    db::integrity(&src)?;
    for (table, count) in [
        ("plants", manifest.plants),
        ("activities", manifest.activities),
        ("plant_photos", manifest.photos),
    ] {
        let actual: i64 =
            src.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?;
        ensure!(actual == count, "Backup record count differs from manifest");
    }
    db::create_target(destination, |target| {
        rusqlite::backup::Backup::new(&src, target)?.run_to_completion(
            128,
            Duration::from_millis(10),
            None,
        )?;
        Ok(())
    })
}
