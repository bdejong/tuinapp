use anyhow::{Result, ensure};
use argon2::{Argon2, PasswordHasher, password_hash::SaltString};
use clap::{Parser, Subcommand};
use std::{path::PathBuf, time::Duration};
use tuinapp_server::{
    api,
    backup::{self, Backups},
    db,
};

#[derive(Parser)]
#[command(
    version,
    about = "Private desktop garden website and safe database tools"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Init {
        #[arg(long)]
        database: PathBuf,
    },
    Import {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        database: PathBuf,
    },
    Restore {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        destination: PathBuf,
    },
    Backup {
        #[arg(long)]
        database: PathBuf,
        #[arg(long)]
        backup_dir: PathBuf,
    },
    HashPassword {
        #[arg(long)]
        stdin: bool,
    },
    Serve {
        #[arg(long, env = "TUINAPP_DATABASE", default_value = "data/tuinapp.sqlite")]
        database: PathBuf,
        #[arg(long, env = "TUINAPP_BACKUP_DIR", default_value = "backups")]
        backup_dir: PathBuf,
        #[arg(long, env = "TUINAPP_BIND", default_value = "127.0.0.1:3000")]
        bind: std::net::SocketAddr,
        #[arg(
            long,
            env = "TUINAPP_PUBLIC_ORIGIN",
            default_value = "http://127.0.0.1:3000"
        )]
        public_origin: String,
        #[arg(long, env = "TUINAPP_STATIC_DIR", default_value = "dist")]
        static_dir: PathBuf,
        #[arg(long, env = "TUINAPP_PASSWORD_HASH", hide_env_values = true)]
        password_hash: String,
        #[arg(long, env = "TUINAPP_BACKUP_INTERVAL_SECONDS", default_value = "300")]
        backup_interval_seconds: u64,
        #[arg(long, env = "TUINAPP_OFFSITE_STATUS")]
        offsite_status: Option<PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Init { database } => {
            db::create_new(&database)?;
            println!("Created {}", database.display());
        }
        Command::Import { source, database } => {
            println!(
                "{}",
                serde_json::to_string_pretty(&db::import_legacy(&source, &database)?)?
            );
        }
        Command::Restore {
            source,
            destination,
        } => {
            backup::restore(&source, &destination)?;
            println!(
                "Restored and verified {}. The existing database was not replaced.",
                destination.display()
            );
        }
        Command::Backup {
            database,
            backup_dir,
        } => {
            let c = db::readonly(&database)?;
            db::verify_history(&c, db::MIGRATIONS)?;
            let mut backups = Backups::new(backup_dir)?;
            println!("{}", backups.snapshot(&c, "manual")?.display());
        }
        Command::HashPassword { stdin } => {
            let password = if stdin {
                use std::io::Read;
                let mut input = String::new();
                std::io::stdin().read_to_string(&mut input)?;
                input.trim_end_matches(['\r', '\n']).to_owned()
            } else {
                rpassword::prompt_password("New owner password (at least 12 characters): ")?
            };
            ensure!(password.chars().count() >= 12, "Use at least 12 characters");
            if !stdin {
                let again = rpassword::prompt_password("Repeat password: ")?;
                ensure!(password == again, "Passwords do not match");
            }
            let salt = SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes())
                .map_err(|e| anyhow::anyhow!(e.to_string()))?;
            println!(
                "{}",
                Argon2::default()
                    .hash_password(password.as_bytes(), &salt)
                    .map_err(|e| anyhow::anyhow!(e.to_string()))?
            );
        }
        Command::Serve {
            database,
            backup_dir,
            bind,
            public_origin,
            static_dir,
            password_hash,
            backup_interval_seconds,
            offsite_status,
        } => {
            ensure!(
                backup_interval_seconds >= 60,
                "Backup interval must be at least 60 seconds"
            );
            ensure!(
                static_dir.join("index.html").is_file(),
                "Build the frontend first with npm run build"
            );
            // A process lock prevents a second server or deployment migrating a live database.
            let lock_path = database.with_extension("server.lock");
            let lock = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(lock_path)?;
            lock.try_lock()
                .map_err(|_| anyhow::anyhow!("Another server owns this database"))?;
            let mut c = db::open_existing(&database)?;
            let mut backups = Backups::new(backup_dir)?;
            backups.status.check_interval_seconds = backup_interval_seconds;
            backups.offsite_status_path = offsite_status;
            let applied = db::verify_history(&c, db::MIGRATIONS)?;
            // Snapshot failure blocks startup/migration, never silently skips recovery protection.
            backups.snapshot(
                &c,
                if applied < db::MIGRATIONS.len() {
                    "before-migration"
                } else {
                    "scheduled"
                },
            )?;
            db::migrate(&mut c, db::MIGRATIONS)?;
            c.pragma_update(None, "journal_mode", "WAL")?;
            let state = api::AppState::new(c, backups, password_hash, public_origin)?;
            let scheduler = api::start_backup_scheduler(
                state.clone(),
                Duration::from_secs(backup_interval_seconds),
            );
            let listener = tokio::net::TcpListener::bind(bind).await?;
            println!("TuinApp listening on http://{}", listener.local_addr()?);
            axum::serve(listener, api::router(state, static_dir))
                .with_graceful_shutdown(shutdown_signal())
                .await?;
            scheduler.abort();
            drop(lock);
        }
    }
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("register termination signal");
        tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
