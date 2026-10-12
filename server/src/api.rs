use crate::{
    backup::{Backups, Status},
    db,
    models::{Activity, MonthData, Plant},
    pdf,
};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Request, State},
    http::{HeaderMap, StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use rusqlite::{Connection, params};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

pub struct Store {
    pub conn: Connection,
    pub backups: Backups,
}
struct Session {
    csrf: String,
    expires: Instant,
}
pub struct AppState {
    pub store: Mutex<Store>,
    sessions: Mutex<HashMap<String, Session>>,
    login_attempts: Mutex<VecDeque<Instant>>,
    password_hash: String,
    origin: String,
    secure_cookie: bool,
}

impl AppState {
    pub fn new(
        conn: Connection,
        backups: Backups,
        password_hash: String,
        origin: String,
    ) -> anyhow::Result<Arc<Self>> {
        PasswordHash::new(&password_hash)
            .map_err(|_| anyhow::anyhow!("Invalid TUINAPP_PASSWORD_HASH"))?;
        anyhow::ensure!(
            origin.starts_with("https://")
                || origin.starts_with("http://127.0.0.1:")
                || origin.starts_with("http://localhost:"),
            "PUBLIC_ORIGIN must use HTTPS except for localhost"
        );
        Ok(Arc::new(Self {
            store: Mutex::new(Store { conn, backups }),
            sessions: Mutex::new(HashMap::new()),
            login_attempts: Mutex::new(VecDeque::new()),
            password_hash,
            secure_cookie: origin.starts_with("https://"),
            origin,
        }))
    }
}

#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        eprintln!("Request failed: {e:#}");
        Self(StatusCode::INTERNAL_SERVER_ERROR,"The operation failed. Your changes may not have been saved; reload to check before retrying.".into())
    }
}
impl From<rusqlite::Error> for ApiError {
    fn from(e: rusqlite::Error) -> Self {
        anyhow::Error::from(e).into()
    }
}
type Result<T> = std::result::Result<T, ApiError>;
fn bad(s: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, s.into())
}
fn unauthorized() -> ApiError {
    ApiError(StatusCode::UNAUTHORIZED, "Please sign in.".into())
}

async fn work<T: Send + 'static>(
    state: Arc<AppState>,
    f: impl FnOnce(&mut Store) -> Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(move || {
        let mut store = state.store.lock().map_err(|_| {
            ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "Database unavailable".into(),
            )
        })?;
        f(&mut store)
    })
    .await
    .map_err(|e| ApiError::from(anyhow::Error::from(e)))?
}

fn cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|s| s.trim().strip_prefix("tuinapp_session=").map(str::to_owned))
}

async fn protections(State(state): State<Arc<AppState>>, request: Request, next: Next) -> Response {
    let mutating = !matches!(
        *request.method(),
        axum::http::Method::GET | axum::http::Method::HEAD | axum::http::Method::OPTIONS
    );
    if mutating {
        if request
            .headers()
            .get("x-tuinapp-request")
            .and_then(|v| v.to_str().ok())
            != Some("1")
        {
            return bad("Missing request protection").into_response();
        }
        if let Some(origin) = request.headers().get(header::ORIGIN)
            && origin.to_str().ok() != Some(state.origin.as_str())
        {
            return ApiError(StatusCode::FORBIDDEN, "Origin not allowed".into()).into_response();
        }
    }
    let mut response = next.run(request).await;
    let h = response.headers_mut();
    h.insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    h.insert("x-content-type-options", "nosniff".parse().unwrap());
    h.insert("referrer-policy", "same-origin".parse().unwrap());
    h.insert("x-frame-options", "DENY".parse().unwrap());
    h.insert("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'".parse().unwrap());
    response
}

async fn require_auth(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let valid = {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.retain(|_, s| s.expires > Instant::now());
        cookie(request.headers())
            .and_then(|token| sessions.get(&token))
            .is_some_and(|s| {
                matches!(
                    *request.method(),
                    axum::http::Method::GET | axum::http::Method::HEAD
                ) || request
                    .headers()
                    .get("x-csrf-token")
                    .and_then(|v| v.to_str().ok())
                    == Some(s.csrf.as_str())
            })
    };
    if !valid {
        return unauthorized().into_response();
    }
    next.run(request).await
}

pub fn router(state: Arc<AppState>, static_dir: PathBuf) -> Router {
    let private = Router::new()
        .route("/session", get(session).delete(logout))
        .route("/plants", get(get_plants).post(create_plant))
        .route("/plants/{id}", put(update_plant).delete(delete_plant))
        .route("/plants/{id}/reorder", put(reorder))
        .route("/activities", get(get_activities).post(create_activity))
        .route(
            "/activities/{id}",
            put(update_activity).delete(delete_activity),
        )
        .route("/months/{month}", get(month))
        .route("/months/{month}/pdf", get(month_pdf))
        .route("/imports/preview", post(preview_tsv))
        .route("/imports/tsv", post(import_tsv))
        .route("/backups/status", get(backup_status))
        .route("/backups", post(make_backup))
        .route("/backups/verify", post(verify_backup))
        .route("/backups/download", get(download_backup))
        .route_layer(middleware::from_fn_with_state(state.clone(), require_auth));
    Router::new()
        .nest(
            "/api",
            private.route("/login", post(login)).fallback(|| async {
                (
                    StatusCode::NOT_FOUND,
                    Json(json!({"error":"Endpoint not found"})),
                )
            }),
        )
        .route("/health", get(|| async { Json(json!({"status":"ok"})) }))
        .fallback_service(
            ServeDir::new(&static_dir)
                .not_found_service(ServeFile::new(static_dir.join("index.html"))),
        )
        .layer(DefaultBodyLimit::max(12 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), protections))
        .with_state(state)
}

#[derive(Deserialize)]
struct Login {
    password: String,
}
async fn login(State(state): State<Arc<AppState>>, Json(body): Json<Login>) -> Result<Response> {
    if body.password.len() > 1024 {
        return Err(bad("Password too long"));
    }
    {
        let mut attempts = state.login_attempts.lock().unwrap();
        attempts.retain(|t| t.elapsed() < Duration::from_secs(60));
        if attempts.len() >= 10 {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many attempts. Try again in a minute.".into(),
            ));
        }
        attempts.push_back(Instant::now());
    }
    let hash = state.password_hash.clone();
    let valid = tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).ok().is_some_and(|h| {
            Argon2::default()
                .verify_password(body.password.as_bytes(), &h)
                .is_ok()
        })
    })
    .await
    .map_err(|e| ApiError::from(anyhow::Error::from(e)))?;
    if !valid {
        return Err(unauthorized());
    }
    state.login_attempts.lock().unwrap().clear();
    let token = Uuid::new_v4().to_string() + &Uuid::new_v4().to_string();
    let csrf = Uuid::new_v4().to_string();
    let mut sessions = state.sessions.lock().unwrap();
    sessions.retain(|_, s| s.expires > Instant::now());
    if sessions.len() >= 32 {
        sessions.clear();
    }
    sessions.insert(
        token.clone(),
        Session {
            csrf: csrf.clone(),
            expires: Instant::now() + Duration::from_secs(12 * 3600),
        },
    );
    let suffix = if state.secure_cookie { "; Secure" } else { "" };
    let cookie = format!(
        "tuinapp_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200{suffix}"
    );
    Ok((
        [(header::SET_COOKIE, cookie)],
        Json(json!({"csrf_token":csrf})),
    )
        .into_response())
}
async fn session(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Result<Json<Value>> {
    let token = cookie(&headers).ok_or_else(unauthorized)?;
    let sessions = state.sessions.lock().unwrap();
    let s = sessions.get(&token).ok_or_else(unauthorized)?;
    Ok(Json(json!({"csrf_token":s.csrf})))
}
async fn logout(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    if let Some(token) = cookie(&headers) {
        state.sessions.lock().unwrap().remove(&token);
    }
    (
        [(
            header::SET_COOKIE,
            "tuinapp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        )],
        StatusCode::NO_CONTENT,
    )
        .into_response()
}

async fn get_plants(State(s): State<Arc<AppState>>) -> Result<Json<Vec<Plant>>> {
    Ok(Json(work(s, |s| Ok(db::plants(&s.conn)?)).await?))
}
async fn get_activities(State(s): State<Arc<AppState>>) -> Result<Json<Vec<Activity>>> {
    Ok(Json(work(s, |s| Ok(db::activities(&s.conn)?)).await?))
}
fn one_plant(c: &Connection, id: i64) -> Result<Plant> {
    db::plants(c)?
        .into_iter()
        .find(|p| p.id == Some(id))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Plant not found".into()))
}
fn one_activity(c: &Connection, id: i64) -> Result<Activity> {
    db::activities(c)?
        .into_iter()
        .find(|p| p.id == Some(id))
        .ok_or(ApiError(StatusCode::NOT_FOUND, "Activity not found".into()))
}
fn changed(n: usize) -> Result<()> {
    if n == 0 {
        Err(ApiError(
            StatusCode::CONFLICT,
            "This record changed or was deleted on another screen. Reload it before saving.".into(),
        ))
    } else {
        Ok(())
    }
}

async fn create_plant(State(s): State<Arc<AppState>>, Json(p): Json<Plant>) -> Result<Json<Plant>> {
    if !p.valid() {
        return Err(bad("Enter a name and valid plant details"));
    }
    Ok(Json(work(s,move|s|{
        s.conn.execute("INSERT INTO plants(name,plant_type,sun_requirements,sow_periods,plant_periods,notes,needs_reorder) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![p.name,p.plant_type,p.sun_requirements,p.sow_periods,p.plant_periods,p.notes,p.needs_reorder])?;
        one_plant(&s.conn,s.conn.last_insert_rowid())
    }).await?))
}
async fn update_plant(
    State(s): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(p): Json<Plant>,
) -> Result<Json<Plant>> {
    if !p.valid() || p.id != Some(id) {
        return Err(bad("Invalid plant details"));
    }
    Ok(Json(work(s,move|s|{
        one_plant(&s.conn,id)?;
        changed(s.conn.execute("UPDATE plants SET name=?1,plant_type=?2,sun_requirements=?3,sow_periods=?4,plant_periods=?5,notes=?6,needs_reorder=?7,updated_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=?8 AND revision=?9",params![p.name,p.plant_type,p.sun_requirements,p.sow_periods,p.plant_periods,p.notes,p.needs_reorder,id,p.revision])?)?;
        one_plant(&s.conn,id)
    }).await?))
}
#[derive(Deserialize)]
struct Revision {
    revision: i64,
}
async fn delete_plant(
    State(s): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(r): Json<Revision>,
) -> Result<StatusCode> {
    work(s, move |s| {
        one_plant(&s.conn, id)?;
        changed(s.conn.execute(
            "DELETE FROM plants WHERE id=?1 AND revision=?2",
            params![id, r.revision],
        )?)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
#[derive(Deserialize)]
struct Reorder {
    needs_reorder: bool,
    revision: i64,
}
async fn reorder(
    State(s): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(r): Json<Reorder>,
) -> Result<Json<Plant>> {
    Ok(Json(work(s,move|s|{one_plant(&s.conn,id)?;changed(s.conn.execute("UPDATE plants SET needs_reorder=?1,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?2 AND revision=?3",params![r.needs_reorder,id,r.revision])?)?;one_plant(&s.conn,id)}).await?))
}
async fn create_activity(
    State(s): State<Arc<AppState>>,
    Json(a): Json<Activity>,
) -> Result<Json<Activity>> {
    if !a.valid() {
        return Err(bad("Enter a name and valid activity details"));
    }
    Ok(Json(
        work(s, move |s| {
            s.conn.execute(
                "INSERT INTO activities(name,description,active_periods) VALUES(?1,?2,?3)",
                params![a.name, a.description, a.active_periods],
            )?;
            one_activity(&s.conn, s.conn.last_insert_rowid())
        })
        .await?,
    ))
}
async fn update_activity(
    State(s): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(a): Json<Activity>,
) -> Result<Json<Activity>> {
    if !a.valid() || a.id != Some(id) {
        return Err(bad("Invalid activity details"));
    }
    Ok(Json(work(s,move|s|{one_activity(&s.conn,id)?;changed(s.conn.execute("UPDATE activities SET name=?1,description=?2,active_periods=?3,updated_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=?4 AND revision=?5",params![a.name,a.description,a.active_periods,id,a.revision])?)?;one_activity(&s.conn,id)}).await?))
}
async fn delete_activity(
    State(s): State<Arc<AppState>>,
    Path(id): Path<i64>,
    Json(r): Json<Revision>,
) -> Result<StatusCode> {
    work(s, move |s| {
        one_activity(&s.conn, id)?;
        changed(s.conn.execute(
            "DELETE FROM activities WHERE id=?1 AND revision=?2",
            params![id, r.revision],
        )?)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn month(State(s): State<Arc<AppState>>, Path(month): Path<i32>) -> Result<Json<MonthData>> {
    if !(1..=12).contains(&month) {
        return Err(bad("Month must be between 1 and 12"));
    }
    Ok(Json(
        work(s, move |s| {
            let plants = db::plants(&s.conn)?;
            let early = 1 << ((month - 1) * 2);
            let late = early << 1;
            Ok(MonthData {
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
                activities: db::activities(&s.conn)?
                    .into_iter()
                    .filter(|a| a.active_periods & (early | late) != 0)
                    .collect(),
            })
        })
        .await?,
    ))
}

async fn month_pdf(State(s): State<Arc<AppState>>, Path(number): Path<i32>) -> Result<Response> {
    let Json(data) = month(State(s), Path(number)).await?;
    let name = pdf::MONTHS[(number - 1) as usize];
    let bytes = tokio::task::spawn_blocking(move || {
        pdf::generate_pdf(pdf::PrintData::from_month(name, data))
    })
    .await
    .map_err(|e| ApiError::from(anyhow::Error::from(e)))?
    .map_err(|e| ApiError::from(anyhow::anyhow!(e)))?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/pdf".to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!(
                    "attachment; filename=\"garden-planner-{}.pdf\"",
                    name.to_lowercase()
                ),
            ),
        ],
        bytes,
    )
        .into_response())
}

#[derive(Deserialize)]
struct Tsv {
    content: String,
}
async fn preview_tsv(Json(input): Json<Tsv>) -> Result<Json<Value>> {
    let rows = db::parse_tsv(&input.content).map_err(|e| bad(e.to_string()))?;
    Ok(Json(
        json!({"count":rows.len(),"names":rows.iter().take(8).map(|r|&r.0).collect::<Vec<_>>()}),
    ))
}
async fn import_tsv(State(s): State<Arc<AppState>>, Json(input): Json<Tsv>) -> Result<Json<Value>> {
    db::parse_tsv(&input.content).map_err(|e| bad(e.to_string()))?;
    Ok(Json(
        work(s, move |s| {
            s.backups.snapshot(&s.conn, "before-import")?;
            let count =
                db::import_tsv(&mut s.conn, &input.content).map_err(|e| bad(e.to_string()))?;
            Ok(json!({"count":count}))
        })
        .await?,
    ))
}
async fn backup_status(State(s): State<Arc<AppState>>) -> Result<Json<Status>> {
    Ok(Json(work(s, |s| Ok(s.backups.status.clone())).await?))
}
async fn make_backup(State(s): State<Arc<AppState>>) -> Result<Json<Status>> {
    Ok(Json(
        work(s, |s| {
            s.backups.snapshot(&s.conn, "manual")?;
            Ok(s.backups.status.clone())
        })
        .await?,
    ))
}
async fn download_backup(State(s): State<Arc<AppState>>) -> Result<Response> {
    let data = work(s, |s| {
        use std::io::Write;
        let path = s.backups.snapshot(&s.conn, "download")?;
        let mut archive = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, file) in [
            ("tuinapp-backup.sqlite", path.clone()),
            ("tuinapp-backup.json", path.with_extension("json")),
        ] {
            archive
                .start_file(name, options)
                .map_err(anyhow::Error::from)?;
            archive
                .write_all(&std::fs::read(file).map_err(anyhow::Error::from)?)
                .map_err(anyhow::Error::from)?;
        }
        Ok(archive.finish().map_err(anyhow::Error::from)?.into_inner())
    })
    .await?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/zip"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=tuinapp-backup.zip",
            ),
        ],
        Body::from(data),
    )
        .into_response())
}
async fn verify_backup(State(s): State<Arc<AppState>>) -> Result<Json<Status>> {
    Ok(Json(
        work(s, |s| {
            let path = s.backups.snapshot(&s.conn, "restore-test")?;
            let tmp = tempfile::tempdir().map_err(anyhow::Error::from)?;
            let restored = tmp.path().join("restored.sqlite");
            crate::backup::restore(&path, &restored)?;
            let c = db::readonly(&restored)?;
            db::plants(&c)?;
            db::activities(&c)?;
            s.backups.status.last_restore_verified_at = Some(chrono::Utc::now());
            s.backups.persist_status()?;
            Ok(s.backups.status.clone())
        })
        .await?,
    ))
}

pub fn start_backup_scheduler(
    state: Arc<AppState>,
    period: Duration,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(period);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        interval.tick().await; // Startup already made a verified snapshot.
        loop {
            interval.tick().await;
            if let Err(e) = work(state.clone(), |s| {
                s.backups.snapshot(&s.conn, "scheduled")?;
                Ok(())
            })
            .await
            {
                eprintln!("Scheduled backup failed: {}", e.1);
            }
        }
    })
}
