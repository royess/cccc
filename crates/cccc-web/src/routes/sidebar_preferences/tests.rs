use super::*;
use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use tower::ServiceExt;
fn fixture() -> (tempfile::TempDir, HomeLayout, axum::Router, String, String) {
    let temp = tempfile::tempdir().unwrap();
    let home = HomeLayout::from_path(temp.path().join("home")).unwrap();
    let tokens = cccc_core::access_tokens::AccessTokenStore::new(home.clone()).unwrap();
    let a = tokens
        .create("viewer-one", vec!["g_one".into()], false, None)
        .unwrap();
    let b = tokens
        .create("viewer-two", vec!["g_two".into()], false, None)
        .unwrap();
    (
        temp,
        home.clone(),
        crate::app_with_mode(home, crate::WebMode::Normal),
        a.token,
        b.token,
    )
}
async fn request(app: &axum::Router, token: &str, body: Option<Value>) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .uri("/api/v1/user/sidebar")
        .header(header::AUTHORIZATION, format!("Bearer {token}"));
    let bytes = if let Some(mut value) = body {
        value["userId"] = json!("viewer-one");
        req = req
            .method("PATCH")
            .header(header::CONTENT_TYPE, "application/json");
        Body::from(value.to_string())
    } else {
        Body::empty()
    };
    let response = app.clone().oneshot(req.body(bytes).unwrap()).await.unwrap();
    let status = response.status();
    let value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    (status, value)
}
#[tokio::test]
async fn account_preferences_persist_across_router_restarts_without_cross_account_reads() {
    let (_temp, home, app, a, b) = fixture();
    let (_, first) = request(&app, &a, None).await;
    assert_eq!(first["result"]["initialized"], false);
    let (status, saved) = request(&app,&a,Some(json!({"clientId":"create-1","operation":{"kind":"create_folder","id":"folder-one","name":"Research","groupIds":["g_one"]}}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        saved["result"]["preferences"]["folders"][0]["name"],
        "Research"
    );
    let (_, other) = request(&app, &b, None).await;
    assert_eq!(other["result"]["preferences"]["folders"], json!([]));
    let restarted = crate::app_with_mode(home, crate::WebMode::Normal);
    let (_, restored) = request(&restarted, &a, None).await;
    assert_eq!(
        restored["result"]["preferences"],
        saved["result"]["preferences"]
    );
}
#[tokio::test]
async fn independent_device_edits_merge_and_unknown_retry_does_not_repeat_a_move() {
    let (_temp, _home, app, a, _) = fixture();
    for (id, name) in [("a", "One"), ("b", "Two"), ("c", "Three")] {
        request(&app,&a,Some(json!({"clientId":format!("create-{id}"),"operation":{"kind":"create_folder","id":id,"name":name}}))).await;
    }
    // Two devices edit different fields; neither submits an old whole document.
    request(&app,&a,Some(json!({"clientId":"archive","operation":{"kind":"archive","groupId":"g_one","archived":true}}))).await;
    request(&app,&a,Some(json!({"clientId":"rename","operation":{"kind":"rename_folder","id":"a","name":"Renamed"}}))).await;
    let move_op =
        json!({"clientId":"move","operation":{"kind":"move_folder","id":"c","beforeId":"a"}});
    let (_, moved) = request(&app, &a, Some(move_op.clone())).await;
    let (_, repeated) = request(&app, &a, Some(move_op)).await;
    assert_eq!(moved["result"], repeated["result"]);
    assert_eq!(
        moved["result"]["preferences"]["archivedGroupIds"],
        json!(["g_one"])
    );
    assert_eq!(
        moved["result"]["preferences"]["folders"][1]["name"],
        "Renamed"
    );
}
#[tokio::test]
async fn concurrent_first_imports_do_not_overwrite_existing_state_and_reorder_preserves_archive_slots()
 {
    let (_temp, _home, app, a, _) = fixture();
    request(&app,&a,Some(json!({"clientId":"seed","operation":{"kind":"seed","preferences":{"groupOrder":["g_one","g_archived","g_two"],"archivedGroupIds":["g_archived"]}}}))).await;
    request(
        &app,
        &a,
        Some(json!({"clientId":"late-seed","operation":{"kind":"seed","preferences":{}}})),
    )
    .await;
    let (_, sorted) = request(&app,&a,Some(json!({"clientId":"reorder","operation":{"kind":"reorder","fromId":"g_one","toId":"g_two","after":true,"archived":false,"knownIds":["g_one","g_two"]}}))).await;
    assert_eq!(
        sorted["result"]["preferences"]["groupOrder"],
        json!(["g_two", "g_archived", "g_one"])
    );
    let (_, restored) = request(&app,&a,Some(json!({"clientId":"restore","operation":{"kind":"archive","groupId":"g_archived","archived":false}}))).await;
    assert_eq!(
        restored["result"]["preferences"]["archivedGroupIds"],
        json!([])
    );
}
#[tokio::test]
async fn new_endpoint_keeps_authentication_csrf_and_exhibit_write_guards() {
    let (_temp, home, app, a, _) = fixture();
    assert_eq!(
        request(&app, "invalid", None).await.0,
        StatusCode::UNAUTHORIZED
    );
    let body =
        json!({"clientId":"one","operation":{"kind":"archive","groupId":"g_one","archived":true}});
    let exhibit = crate::app_with_mode(home, crate::WebMode::Exhibit);
    assert_eq!(
        request(&exhibit, &a, Some(body)).await.0,
        StatusCode::FORBIDDEN
    );
    // Authentication/CSRF are inherited from the shared router, never a new public route.
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/v1/user/sidebar")
                .method("PATCH")
                .header(header::HOST, "localhost:8848")
                .header(header::COOKIE, format!("cccc_access_8848={a}"))
                .header(header::ORIGIN, "https://untrusted.invalid")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["error"]["code"], "csrf_origin_invalid");
}

#[tokio::test]
async fn an_inflight_edit_cannot_cross_to_a_different_authenticated_account() {
    let (_temp, _home, app, a, _) = fixture();
    let response = app.clone().oneshot(Request::builder().uri("/api/v1/user/sidebar").method("PATCH")
        .header(header::AUTHORIZATION, format!("Bearer {a}"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"clientId":"old-account-edit","userId":"viewer-two","operation":{"kind":"create_folder","id":"private","name":"Private"}}).to_string())).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        request(&app, &a, None).await.1["result"]["initialized"],
        false
    );
}
