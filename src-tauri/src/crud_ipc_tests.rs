use crate::db::{self, Db};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::{mpsc, Mutex};
use std::time::Duration;
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY},
    webview::InvokeRequest,
    Listener, WebviewWindow, WebviewWindowBuilder,
};

fn invoke(window: &WebviewWindow<MockRuntime>, command: &str, body: Value) -> Result<Value, Value> {
    let request = InvokeRequest {
        cmd: command.into(),
        callback: CallbackFn(0),
        error: CallbackFn(1),
        url: if cfg!(any(windows, target_os = "android")) {
            "http://tauri.localhost"
        } else {
            "tauri://localhost"
        }.parse().unwrap(),
        body: InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: INVOKE_KEY.into(),
    };
    get_ipc_response(window, request).map(|response| response.deserialize().unwrap())
}

#[test]
fn ipc_shares_committed_data_and_notifies_main_after_snooze() {
    let conn = Connection::open_in_memory().unwrap();
    db::init(&conn).unwrap();
    let app = mock_builder()
        .manage(Db(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            crate::crud::run_crud,
            crate::local_time::local_reminder_parts,
            crate::local_time::local_reminder_timestamp,
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let main = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    let quickadd = WebviewWindowBuilder::new(&app, "quickadd", Default::default()).build().unwrap();
    let notification = WebviewWindowBuilder::new(&app, "notification", Default::default()).build().unwrap();
    let (events, received) = mpsc::channel();
    app.listen("tasks-changed", move |_| { events.send(()).unwrap(); });

    invoke(&main, "run_crud", json!({"operations": [
        {"statement": "label.insert", "params": ["label", "Home", "#fff", "now"]}
    ]})).unwrap();
    let created = invoke(&quickadd, "run_crud", json!({"operations": [
        {"statement": "task.insert", "params": ["task", "Read", null, null, null, 4, "now", 0, null, null]},
        {"statement": "task.upsertLabel", "params": ["task", "label", "now"]},
        {"statement": "task.get", "params": ["task"]}
    ]})).unwrap();
    assert_eq!(created[2][0]["labelIds"], "[\"label\"]");

    let snapshot = invoke(&main, "run_crud", json!({"operations": [
        {"statement": "task.orderSnapshot", "params": ["task"]}
    ]})).unwrap();
    let mut expected = snapshot[0].clone();
    // JavaScript serializes a whole-valued SQLite REAL as an integer.
    expected[0]["orderIndex"] = json!(0);
    let reordered = invoke(&main, "run_crud", json!({"operations": [
        {"statement": "task.orderSnapshot", "params": ["task"], "expected": expected},
        {"statement": "task.setOrder", "params": [0.5, "now", "task"]},
        {"statement": "task.get", "params": ["task"]}
    ]})).unwrap();
    assert_eq!(reordered[2][0]["orderIndex"], 0.5);

    invoke(&notification, "run_crud", json!({"operations": [
        {"statement": "task.due", "params": ["2026-11-06", "task"]},
        {"statement": "task.remind", "params": ["2026-11-06T09:00:00Z", "task"]},
        {"statement": "task.touch", "params": ["now", "task"]},
        {"statement": "task.get", "params": ["task"]}
    ]})).unwrap();
    assert!(received.recv_timeout(Duration::from_secs(1)).is_ok());
    let listed = invoke(&main, "run_crud", json!({"operations": [{"statement": "task.list"}]})).unwrap();
    assert_eq!(listed[0][0]["dueDate"], "2026-11-06");
    assert_eq!(listed[0][0]["remindAt"], "2026-11-06T09:00:00Z");
    assert!(invoke(&quickadd, "run_crud", json!({"operations": [
        {"statement": "label.delete", "params": ["now", "label"]}
    ]})).is_err());
}

#[test]
fn ipc_round_trips_local_reminder_time() {
    let app = mock_builder()
        .invoke_handler(tauri::generate_handler![
            crate::local_time::local_reminder_parts,
            crate::local_time::local_reminder_timestamp,
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let main = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    let original = "2026-11-06T09:00:00.123456789Z";
    let parts = invoke(&main, "local_reminder_parts", json!({"timestamp": original})).unwrap();
    let result = invoke(&main, "local_reminder_timestamp", parts).unwrap();
    assert_eq!(
        chrono::DateTime::parse_from_rfc3339(result.as_str().unwrap()).unwrap(),
        chrono::DateTime::parse_from_rfc3339(original).unwrap()
    );
}
