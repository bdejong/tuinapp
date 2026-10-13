use crate::db;
use anyhow::{Context, Result, ensure};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, types::ValueRef};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub file: String,
    pub sha256: String,
    #[serde(default)]
    pub content_sha256: String,
    pub created_at: DateTime<Utc>,
    pub reason: String,
    pub schema_version: i64,
    pub app_version: String,
    pub plants: i64,
    pub activities: i64,
    pub photos: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Offsite {
    pub last_checked_at: Option<DateTime<Utc>>,
    pub last_success_at: Option<DateTime<Utc>>,
    pub last_restore_verified_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub uploaded: HashMap<String, Receipt>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Receipt {
    pub sha256: String,
    pub uploaded_at: DateTime<Utc>,
}
#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    #[serde(flatten)]
    pub manifest: Manifest,
    pub bytes: u64,
    pub uploaded_at: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Status {
    pub latest: Option<Manifest>,
    pub last_error: Option<String>,
    pub failed_at: Option<DateTime<Utc>>,
    pub last_checked_at: Option<DateTime<Utc>>,
    pub checked_unchanged: bool,
    pub last_restore_verified_at: Option<DateTime<Utc>>,
    pub check_interval_seconds: u64,
}
#[derive(Debug, Clone, Serialize)]
pub struct History {
    #[serde(flatten)]
    pub status: Status,
    pub backups: Vec<Entry>,
    pub offsite: Option<Offsite>,
}
pub struct Backups {
    pub directory: PathBuf,
    pub status: Status,
    pub offsite_status_path: Option<PathBuf>,
}

// Hash the schema and typed row contents, not SQLite pages: WAL checkpoints, VACUUM
// and process restarts must not look like edits. One read transaction is one view.
pub fn content_digest(c: &Connection) -> Result<String> {
    let tx = c.unchecked_transaction()?;
    let mut hash = Sha256::new();
    let mut schema = tx.prepare(
        "SELECT type,name,tbl_name,coalesce(sql,'') FROM sqlite_schema ORDER BY type,name",
    )?;
    let objects = schema
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (kind, name, table, sql) in objects {
        hash.update(serde_json::to_vec(&(&kind, &name, &table, &sql))?);
        if kind != "table" {
            continue;
        }
        let mut statement =
            tx.prepare(&format!("SELECT * FROM \"{}\"", name.replace('"', "\"\"")))?;
        let columns = statement.column_count();
        let mut rows = statement.query([])?;
        let mut row_hashes = Vec::new();
        while let Some(row) = rows.next()? {
            let mut row_hash = Sha256::new();
            for i in 0..columns {
                let (tag, value) = match row.get_ref(i)? {
                    ValueRef::Null => (0, vec![]),
                    ValueRef::Integer(n) => (1, n.to_le_bytes().to_vec()),
                    ValueRef::Real(n) => (2, n.to_bits().to_le_bytes().to_vec()),
                    ValueRef::Text(v) => (3, v.to_vec()),
                    ValueRef::Blob(v) => (4, v.to_vec()),
                };
                row_hash.update([tag]);
                row_hash.update((value.len() as u64).to_le_bytes());
                row_hash.update(value);
            }
            row_hashes.push(row_hash.finalize());
        }
        row_hashes.sort();
        hash.update((row_hashes.len() as u64).to_le_bytes());
        for row in row_hashes {
            hash.update(row);
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn safe_filename(name: &str) -> bool {
    name.ends_with(".sqlite")
        && name.len() < 200
        && name[..name.len() - 7]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        && name.len() > 7
}
fn regular(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file())
}

impl Backups {
    pub fn new(directory: PathBuf) -> Result<Self> {
        fs::create_dir_all(&directory)?;
        let mut status: Status = fs::read(directory.join("status.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        if status.check_interval_seconds == 0 {
            status.check_interval_seconds = 300;
        }
        Ok(Self {
            directory,
            status,
            offsite_status_path: None,
        })
    }

    fn manifests(&self) -> Result<Vec<Manifest>> {
        let mut manifests = Vec::new();
        for entry in fs::read_dir(&self.directory)? {
            let path = entry?.path();
            if path.extension().is_none_or(|s| s != "json")
                || !regular(&path)
                || path.file_name().is_some_and(|n| n == "status.json")
            {
                continue;
            }
            // A complete manifest is the publication marker; incomplete snapshots are never offered.
            let m: Manifest =
                serde_json::from_slice(&fs::read(&path)?).context("Unreadable backup manifest")?;
            ensure!(
                safe_filename(&m.file)
                    && path == self.directory.join(&m.file).with_extension("json"),
                "Invalid backup manifest filename"
            );
            if regular(&self.directory.join(&m.file)) {
                manifests.push(m);
            }
        }
        manifests.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.file.cmp(&a.file))
        });
        Ok(manifests)
    }

    fn offsite(&self) -> Option<Offsite> {
        self.offsite_status_path.as_ref().map(|path| {
            fs::read(path)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_else(|| Offsite {
                    last_error: Some("Off-site backup service has not reported its status.".into()),
                    ..Offsite::default()
                })
        })
    }
    pub fn history(&self) -> Result<History> {
        let offsite = self.offsite();
        let backups = self
            .manifests()?
            .into_iter()
            .map(|m| {
                let uploaded_at = offsite
                    .as_ref()
                    .and_then(|s| s.uploaded.get(&m.file))
                    .filter(|r| r.sha256 == m.sha256)
                    .map(|r| r.uploaded_at);
                Ok(Entry {
                    bytes: fs::metadata(self.directory.join(&m.file))?.len(),
                    manifest: m,
                    uploaded_at,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let mut status = self.status.clone();
        status.latest = backups.first().map(|b| b.manifest.clone());
        Ok(History {
            status,
            backups,
            offsite,
        })
    }
    pub fn existing(&self, filename: &str) -> Result<Option<PathBuf>> {
        if !safe_filename(filename) {
            return Ok(None);
        }
        Ok(self
            .manifests()?
            .into_iter()
            .find(|m| m.file == filename)
            .map(|m| self.directory.join(m.file)))
    }

    pub fn snapshot(&mut self, c: &Connection, reason: &str) -> Result<PathBuf> {
        let result = (|| {
            let digest = content_digest(c)?;
            let previous = self.manifests()?.into_iter().next();
            let reused = previous.and_then(|mut m| {
                let path = self.directory.join(&m.file);
                if verify(&path).is_err() {
                    return None;
                }
                if m.content_sha256.is_empty() {
                    m.content_sha256 = content_digest(&db::readonly(&path).ok()?).ok()?;
                }
                (m.content_sha256 == digest).then_some((path, m))
            });
            let unchanged = reused.is_some();
            let (path, mut manifest) = match reused {
                Some(pair) => pair,
                None => self.snapshot_inner(c, reason)?,
            };
            // An identical pre-migration recovery point is pinned, without another database copy.
            if reason == "before-migration" {
                manifest.reason = reason.into();
            }
            atomic_json(&path.with_extension("json"), &manifest)?;
            let restore_due = self
                .status
                .last_restore_verified_at
                .is_none_or(|t| Utc::now().signed_duration_since(t).num_hours() >= 24);
            if !unchanged || restore_due {
                let tmp = tempfile::tempdir()?;
                let target = tmp.path().join("restored.sqlite");
                restore(&path, &target)?;
                let restored = db::readonly(&target)?;
                db::plants(&restored)?;
                db::activities(&restored)?;
                ensure!(
                    content_digest(&restored)? == manifest.content_sha256,
                    "Restored contents differ"
                );
                self.status.last_restore_verified_at = Some(Utc::now());
            }
            self.status.latest = Some(manifest);
            self.status.last_checked_at = Some(Utc::now());
            self.status.checked_unchanged = unchanged;
            self.status.last_error = None;
            self.status.failed_at = None;
            self.prune()?;
            self.persist_status()?;
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
            content_sha256: content_digest(&restored)?,
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
        Ok((path, manifest))
    }

    pub fn persist_status(&self) -> Result<()> {
        atomic_json(&self.directory.join("status.json"), &self.status)
    }

    // Retain 50 recent changed versions + 30 daily + 12 monthly recovery points.
    // Migration/manual recovery points and files awaiting off-site upload stay pinned.
    fn prune(&self) -> Result<()> {
        let offsite = self.offsite();
        let snapshots: Vec<_> = self
            .manifests()?
            .into_iter()
            .filter(|m| m.reason == "scheduled")
            .collect();
        let (mut days, mut months) = (HashSet::new(), HashSet::new());
        for (index, m) in snapshots.iter().enumerate() {
            let daily = days.len() < 30 && days.insert(m.created_at.format("%Y-%m-%d").to_string());
            let monthly =
                months.len() < 12 && months.insert(m.created_at.format("%Y-%m").to_string());
            let awaiting_upload = offsite
                .as_ref()
                .is_some_and(|s| s.uploaded.get(&m.file).is_none_or(|r| r.sha256 != m.sha256));
            if index >= 50 && !daily && !monthly && !awaiting_upload {
                fs::remove_file(self.directory.join(&m.file).with_extension("json"))?;
                fs::remove_file(self.directory.join(&m.file))?;
            }
        }
        Ok(())
    }
}

fn atomic_json(path: &Path, value: &impl Serialize) -> Result<()> {
    use std::io::Write;
    let parent = path.parent().context("Missing parent")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(&serde_json::to_vec_pretty(value)?)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| e.error)?;
    fs::File::open(parent)?.sync_all()?;
    Ok(())
}

pub fn verify(source: &Path) -> Result<Manifest> {
    ensure!(
        regular(source) && regular(&source.with_extension("json")),
        "Backup files are missing"
    );
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
    if !manifest.content_sha256.is_empty() {
        ensure!(
            content_digest(&src)? == manifest.content_sha256,
            "Backup content checksum mismatch"
        );
    }
    Ok(manifest)
}

pub fn restore(source: &Path, destination: &Path) -> Result<()> {
    verify(source)?;
    let src = db::readonly(source)?;
    db::create_target(destination, |target| {
        rusqlite::backup::Backup::new(&src, target)?.run_to_completion(
            128,
            Duration::from_millis(10),
            None,
        )?;
        Ok(())
    })
}
