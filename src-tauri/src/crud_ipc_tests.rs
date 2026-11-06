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
            crate::settings::get_setting,
            crate::settings::set_setting,
            crate::timezone::timezone_offsets,
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let main = WebviewWindowBuilder::new(&app, "main", Default::default()).build().unwrap();
    let quickadd = WebviewWindowBuilder::new(&app, "quickadd", Default::default()).build().unwrap();
    let notification = WebviewWindowBuilder::new(&app, "notification", Default::default()).build().unwrap();
    let (events, received) = mpsc::channel();
    app.listen("tasks-changed", move |_| { events.send(()).unwrap(); });

    let offsets = invoke(&main, "timezone_offsets", json!({"seconds": [0, 1793961600]})).unwrap();
    assert_eq!(offsets, json!(crate::timezone::timezone_offsets(vec![0, 1793961600]).unwrap()));
    let profiles = invoke(&quickadd, "run_crud", json!({"operations": [{"statement": "priority.list"}]})).unwrap();
    assert_eq!(profiles[0].as_array().unwrap().len(), 4);
    assert!(invoke(&quickadd, "run_crud", json!({"operations": [{"statement": "priority.update"}]})).is_err());

    // The main window imports old preferences into the same database that the
    // quick-add and notification windows use for their theme.
    invoke(&main, "set_setting", json!({"key": "theme", "value": "dark"})).unwrap();
    let preferences = invoke(&main, "run_crud", json!({"operations": [
        {"statement": "preference.import", "params": ["theme", "light"]},
        {"statement": "preference.import", "params": ["board_scope", "week"]},
        {"statement": "preference.get", "params": ["theme"]},
        {"statement": "preference.get", "params": ["board_scope"]}
    ]})).unwrap();
    assert_eq!(preferences[2][0]["value"], "dark");
    assert_eq!(preferences[3][0]["value"], "week");
    assert_eq!(invoke(&quickadd, "get_setting", json!({"key": "theme"})).unwrap(), "dark");
    assert_eq!(invoke(&notification, "get_setting", json!({"key": "theme"})).unwrap(), "dark");
    assert!(invoke(&notification, "run_crud", json!({"operations": [
        {"statement": "preference.import", "params": ["theme", "light"]}
    ]})).is_err());

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
