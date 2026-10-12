use argon2::{Argon2, PasswordHasher, password_hash::SaltString};
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tower::ServiceExt;
use tuinapp_server::{
    api::{self, AppState},
    backup::Backups,
    db,
};

fn setup() -> (tempfile::TempDir, Arc<AppState>, Router) {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("web");
    db::create_new(&path).unwrap();
    let hash = Argon2::default()
        .hash_password(
            b"test-owner-password",
            &SaltString::encode_b64(b"test-salt-16-byte").unwrap(),
        )
        .unwrap()
        .to_string();
    let state = AppState::new(
        db::open_existing(&path).unwrap(),
        Backups::new(tmp.path().join("backups")).unwrap(),
        hash,
        "http://127.0.0.1:3000".into(),
    )
    .unwrap();
    let app = api::router(state.clone(), PathBuf::from("../dist"));
    (tmp, state, app)
}
async fn send(
    app: &Router,
    method: &str,
    path: &str,
    body: Value,
    auth: Option<&(String, String)>,
    origin: Option<&str>,
) -> (StatusCode, axum::http::HeaderMap, Value) {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json")
        .header("x-tuinapp-request", "1");
    if let Some((cookie, csrf)) = auth {
        request = request
            .header("cookie", cookie)
            .header("x-csrf-token", csrf);
    }
    if let Some(origin) = origin {
        request = request.header("origin", origin);
    }
    let response = app
        .clone()
        .oneshot(
            request
                .body(if body.is_null() {
                    Body::empty()
                } else {
                    Body::from(body.to_string())
                })
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 20 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        headers,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
async fn login(app: &Router) -> (String, String) {
    let (status, headers, body) = send(
        app,
        "POST",
        "/api/login",
        json!({"password":"test-owner-password"}),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let cookie = headers["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    (cookie, body["csrf_token"].as_str().unwrap().into())
}
fn plant() -> Value {
    json!({"name":"Desktop tomato","sun_requirements":3,"sow_periods":1,"plant_periods":8388608,"needs_reorder":true,"notes":"First note"})
}

#[tokio::test]
async fn private_routes_login_csrf_origin_and_logout() {
    let (_tmp, _state, app) = setup();
    for path in [
        "/api/plants",
        "/api/activities",
        "/api/backups/download",
        "/api/months/10/pdf",
    ] {
        assert_eq!(
            send(&app, "GET", path, Value::Null, None, None).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        send(
            &app,
            "POST",
            "/api/login",
            json!({"password":"wrong"}),
            None,
            None
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    let auth = login(&app).await;
    assert_eq!(
        send(&app, "GET", "/api/session", Value::Null, Some(&auth), None)
            .await
            .0,
        StatusCode::OK
    );
    let wrong = (auth.0.clone(), "wrong-csrf".into());
    assert_eq!(
        send(&app, "POST", "/api/plants", plant(), Some(&wrong), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        send(
            &app,
            "POST",
            "/api/plants",
            plant(),
            Some(&auth),
            Some("https://other.example")
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    let request = Request::builder()
        .method("POST")
        .uri("/api/login")
        .header("content-type", "application/json")
        .body(Body::from("{\"password\":\"test-owner-password\"}"))
        .unwrap();
    assert_eq!(
        app.clone().oneshot(request).await.unwrap().status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        send(
            &app,
            "DELETE",
            "/api/session",
            Value::Null,
            Some(&auth),
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        send(&app, "GET", "/api/plants", Value::Null, Some(&auth), None)
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn crud_conflicts_validation_and_calendar() {
    let (_tmp, _state, app) = setup();
    let auth = login(&app).await;
    let (status, _, original) = send(&app, "POST", "/api/plants", plant(), Some(&auth), None).await;
    assert_eq!(status, StatusCode::OK);
    let id = original["id"].as_i64().unwrap();
    let path = format!("/api/plants/{id}");
    let mut edited = original.clone();
    edited["notes"] = json!("Edited from screen A");
    let (status, _, updated) = send(&app, "PUT", &path, edited, Some(&auth), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["revision"], 2);
    assert_eq!(
        send(&app, "PUT", &path, original.clone(), Some(&auth), None)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        send(
            &app,
            "PUT",
            &format!("{path}/reorder"),
            json!({"needs_reorder":false,"revision":1}),
            Some(&auth),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (_, _, ordered) = send(
        &app,
        "PUT",
        &format!("{path}/reorder"),
        json!({"needs_reorder":false,"revision":2}),
        Some(&auth),
        None,
    )
    .await;
    assert_eq!(ordered["notes"], "Edited from screen A");
    assert_eq!(ordered["needs_reorder"], false);
    assert_eq!(
        send(&app, "GET", "/api/months/0", Value::Null, Some(&auth), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        send(
            &app,
            "GET",
            "/api/months/13",
            Value::Null,
            Some(&auth),
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        send(&app, "GET", "/api/months/1", Value::Null, Some(&auth), None)
            .await
            .2["sow_early"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        send(
            &app,
            "GET",
            "/api/months/12",
            Value::Null,
            Some(&auth),
            None
        )
        .await
        .2["plant_late"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut invalid = plant();
    invalid["name"] = json!("  ");
    assert_eq!(
        send(&app, "POST", "/api/plants", invalid, Some(&auth), None)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        send(
            &app,
            "DELETE",
            &path,
            json!({"revision":1}),
            Some(&auth),
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        send(
            &app,
            "DELETE",
            &path,
            json!({"revision":3}),
            Some(&auth),
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        send(
            &app,
            "DELETE",
            &path,
            json!({"revision":3}),
            Some(&auth),
            None
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    let (_, _, activity) = send(
        &app,
        "POST",
        "/api/activities",
        json!({"name":"Prune","active_periods":3}),
        Some(&auth),
        None,
    )
    .await;
    let path = format!("/api/activities/{}", activity["id"]);
    let mut edited = activity.clone();
    edited["description"] = json!("After frost");
    assert_eq!(
        send(&app, "PUT", &path, edited, Some(&auth), None).await.0,
        StatusCode::OK
    );
    assert_eq!(
        send(&app, "PUT", &path, activity, Some(&auth), None)
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        send(
            &app,
            "DELETE",
            &path,
            json!({"revision":2}),
            Some(&auth),
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn removed_photo_endpoints_cannot_read_add_or_delete_legacy_data() {
    let (_tmp, state, app) = setup();
    let auth = login(&app).await;
    let (_, _, p) = send(&app, "POST", "/api/plants", plant(), Some(&auth), None).await;
    let id = p["id"].as_i64().unwrap();
    state
        .store
        .lock()
        .unwrap()
        .conn
        .execute(
            "INSERT INTO plant_photos(id,plant_id,sort_order,image_data) VALUES(1,?1,1,?2)",
            rusqlite::params![id, b"legacy bytes".as_slice()],
        )
        .unwrap();
    for (method, path) in [
        ("GET", format!("/api/plants/{id}/photos")),
        ("POST", format!("/api/plants/{id}/photos")),
        ("GET", "/api/photos/1/image".into()),
        ("DELETE", "/api/photos/1".into()),
    ] {
        assert_eq!(
            send(
                &app,
                method,
                &path,
                json!({"image_data":"test"}),
                Some(&auth),
                None
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
    let bytes: Vec<u8> = state
        .store
        .lock()
        .unwrap()
        .conn
        .query_row("SELECT image_data FROM plant_photos WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(bytes, b"legacy bytes");
    let (_, _, plants) = send(&app, "GET", "/api/plants", Value::Null, Some(&auth), None).await;
    assert!(plants[0].get("photo_count").is_none());
}

#[tokio::test]
async fn removed_spreadsheet_endpoints_do_not_change_garden_or_backups() {
    let (_tmp, state, app) = setup();
    let auth = login(&app).await;
    send(&app, "POST", "/api/plants", plant(), Some(&auth), None).await;
    let before = db::plants(&state.store.lock().unwrap().conn).unwrap();
    for path in ["/api/imports/preview", "/api/imports/tsv"] {
        assert_eq!(
            send(
                &app,
                "POST",
                path,
                json!({"content":"name\tJanuary\nBasil\tZ"}),
                Some(&auth),
                None
            )
            .await
            .0,
            StatusCode::NOT_FOUND
        );
    }
    let store = state.store.lock().unwrap();
    assert_eq!(db::plants(&store.conn).unwrap(), before);
    assert!(store.backups.status.latest.is_none());
    assert_eq!(
        store
            .conn
            .query_row("SELECT count(*) FROM imports", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[tokio::test]
async fn recovery_checks_real_records_and_backup_failures_leave_them_intact() {
    let (tmp, state, app) = setup();
    let auth = login(&app).await;
    send(&app, "POST", "/api/plants", plant(), Some(&auth), None).await;
    let before = db::plants(&state.store.lock().unwrap().conn).unwrap();
    let (status, _, verified) = send(
        &app,
        "POST",
        "/api/backups/verify",
        Value::Null,
        Some(&auth),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(verified["last_restore_verified_at"].is_string());
    assert_eq!(verified["latest"]["plants"], 1);
    std::fs::rename(tmp.path().join("backups"), tmp.path().join("safe-backups")).unwrap();
    std::fs::write(tmp.path().join("backups"), "file").unwrap();
    assert_eq!(
        send(&app, "POST", "/api/backups", Value::Null, Some(&auth), None)
            .await
            .0,
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert_eq!(
        db::plants(&state.store.lock().unwrap().conn).unwrap(),
        before
    );
}

#[tokio::test]
async fn backups_run_without_a_browser_session() {
    let (_tmp, state, _app) = setup();
    let job = api::start_backup_scheduler(state.clone(), Duration::from_millis(20));
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if state.store.lock().unwrap().backups.status.latest.is_some() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    job.abort();
    assert_eq!(
        state
            .store
            .lock()
            .unwrap()
            .backups
            .status
            .latest
            .as_ref()
            .unwrap()
            .reason,
        "scheduled"
    );
}

#[tokio::test]
async fn downloaded_archive_contains_a_restorable_database_and_manifest() {
    use std::io::Read;
    let (tmp, _state, app) = setup();
    let auth = login(&app).await;
    send(&app, "POST", "/api/plants", plant(), Some(&auth), None).await;
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/backups/download")
                .header("cookie", &auth.0)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/zip");
    let bytes = to_bytes(response.into_body(), 20 * 1024 * 1024)
        .await
        .unwrap();
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
    assert_eq!(archive.len(), 2);
    for name in ["tuinapp-backup.sqlite", "tuinapp-backup.json"] {
        let mut data = Vec::new();
        archive
            .by_name(name)
            .unwrap()
            .read_to_end(&mut data)
            .unwrap();
        std::fs::write(tmp.path().join(name), data).unwrap();
    }
    let restored = tmp.path().join("restored.sqlite");
    tuinapp_server::backup::restore(&tmp.path().join("tuinapp-backup.sqlite"), &restored).unwrap();
    let plants = db::plants(&db::open_existing(&restored).unwrap()).unwrap();
    assert_eq!(plants.len(), 1);
    assert_eq!(plants[0].name, "Desktop tomato");
}

#[tokio::test]
async fn printable_pdf_download_is_private_validated_and_read_only() {
    let (_tmp, state, app) = setup();
    let auth = login(&app).await;
    send(&app, "POST", "/api/plants", plant(), Some(&auth), None).await;
    for number in [0, 13, -1] {
        assert_eq!(
            send(
                &app,
                "GET",
                &format!("/api/months/{number}/pdf"),
                Value::Null,
                Some(&auth),
                None
            )
            .await
            .0,
            StatusCode::BAD_REQUEST
        );
    }
    let before = db::plants(&state.store.lock().unwrap().conn).unwrap();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/months/1/pdf")
                .header("cookie", &auth.0)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["content-type"], "application/pdf");
    assert_eq!(
        response.headers()["content-disposition"],
        "attachment; filename=\"garden-planner-january.pdf\""
    );
    assert_eq!(response.headers()["cache-control"], "no-store");
    let bytes = to_bytes(response.into_body(), 20 * 1024 * 1024)
        .await
        .unwrap();
    let pdf = lopdf::Document::load_mem(&bytes).unwrap();
    assert_eq!(pdf.get_pages().len(), 1);
    let text = pdf.extract_text(&[1]).unwrap();
    assert!(text.contains("Early January"));
    assert!(text.contains("Desktop tomato"));
    assert!(text.contains("[1]"));
    assert!(text.contains("First note"));
    assert_eq!(
        before,
        db::plants(&state.store.lock().unwrap().conn).unwrap()
    );
}
