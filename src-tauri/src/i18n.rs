//! Native transport for language state and OS locale sources. Selection rules
//! live in TypeScript; the native cache supports the tray and background jobs.
use crate::{db::Db, settings};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const PREFERENCE: &str = "ui_language";
const EFFECTIVE: &str = "ui_language_resolved";

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LanguageSnapshot {
    preference: String,
    language: String,
    revision: u64,
}

pub struct LanguageState(Mutex<LanguageSnapshot>, Mutex<bool>, Condvar);

impl LanguageState {
    fn mark_ready(&self) {
        if let Ok(mut ready) = self.1.lock() {
            *ready = true;
            self.2.notify_all();
        }
    }

    /// A first launch may not yet have a cached effective language. Give the
    /// WebView time to resolve it before sending background notifications, but
    /// do not strand reminders if the frontend fails to start.
    pub fn wait_ready(&self) {
        if let Ok(ready) = self.1.lock() {
            drop(self.2.wait_timeout_while(ready, Duration::from_secs(5), |ready| !*ready));
        }
    }
}

#[derive(Serialize)]
pub struct LocaleSources {
    linux: bool,
    environment: HashMap<String, String>,
    locales: Vec<String>,
    configuration: Vec<String>,
}

#[tauri::command]
pub fn language_sources() -> LocaleSources {
    let environment = ["LC_ALL", "LC_MESSAGES", "LC_TIME", "LANG"]
        .into_iter()
        .filter_map(|key| std::env::var(key).ok().map(|value| (key.to_owned(), value)))
        .collect();
    #[cfg(target_os = "linux")]
    let configuration = ["/etc/locale.conf", "/etc/default/locale"]
        .into_iter().filter_map(|path| std::fs::read_to_string(path).ok()).collect();
    #[cfg(not(target_os = "linux"))]
    let configuration = Vec::new();
    LocaleSources {
        linux: cfg!(target_os = "linux"),
        environment,
        locales: sys_locale::get_locales().collect(),
        configuration,
    }
}

pub fn initialize(conn: &Connection) -> LanguageState {
    let preference = settings::read(conn, PREFERENCE).unwrap_or_else(|| "auto".into());
    // Before the first TypeScript resolution, an explicitly saved preference
    // can be used directly; an unresolved "auto" uses the catalog fallback.
    let language = settings::read(conn, EFFECTIVE).unwrap_or_else(|| preference.clone());
    rust_i18n::set_locale(&language);
    LanguageState(Mutex::new(LanguageSnapshot { preference, language, revision: 0 }), Mutex::new(false), Condvar::new())
}

/// A stale startup read cannot overwrite a newer choice from another window.
/// Explicit changes persist atomically; caching an automatic resolution is
/// best-effort so a read-only database does not prevent language detection.
fn persist(
    conn: &mut Connection,
    current: &mut LanguageSnapshot,
    expected: Option<u64>,
    preference: String,
    language: String,
) -> rusqlite::Result<(LanguageSnapshot, bool)> {
    if expected.is_some_and(|revision| revision != current.revision) ||
        (expected.is_some() && current.preference == preference && current.language == language) {
        return Ok((current.clone(), false));
    }
    if expected.is_some() {
        if let Err(error) = settings::write(conn, EFFECTIVE, &language) {
            eprintln!("[i18n] could not cache resolved language: {error}");
        }
    } else {
        let transaction = conn.transaction()?;
        settings::write(&transaction, PREFERENCE, &preference)?;
        settings::write(&transaction, EFFECTIVE, &language)?;
        transaction.commit()?;
    }
    *current = LanguageSnapshot { preference, language, revision: current.revision + 1 };
    rust_i18n::set_locale(&current.language);
    Ok((current.clone(), true))
}

#[tauri::command]
pub fn get_language(state: State<LanguageState>) -> Result<LanguageSnapshot, String> {
    state.0.lock().map(|snapshot| snapshot.clone()).map_err(|_| rust_i18n::t!("language.unavailable").to_string())
}

#[tauri::command]
pub fn language_ready(state: State<LanguageState>) {
    state.mark_ready();
}

fn notify_language(app: &AppHandle, snapshot: &LanguageSnapshot) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        update_window_titles(&handle);
        crate::tray::localize(&handle);
        crate::tray::refresh(&handle);
    }) { eprintln!("[i18n] could not refresh native labels: {error}"); }
    if let Err(error) = app.emit("language-changed", snapshot) {
        eprintln!("[i18n] could not broadcast the language: {error}");
    }
}

#[tauri::command]
pub fn sync_language(
    app: AppHandle, db: State<Db>, state: State<LanguageState>,
    revision: u64, preference: String, language: String,
) -> Result<LanguageSnapshot, String> {
    let (snapshot, changed) = {
        let mut current = state.0.lock().map_err(|_| rust_i18n::t!("language.unavailable").to_string())?;
        persist(&mut db.conn(), &mut current, Some(revision), preference, language)
            .map_err(|error| error.to_string())?
    };
    state.mark_ready();
    if changed { notify_language(&app, &snapshot); }
    Ok(snapshot)
}

#[tauri::command]
pub fn set_language(
    app: AppHandle, db: State<Db>, state: State<LanguageState>, preference: String, language: String,
) -> Result<LanguageSnapshot, String> {
    let snapshot = {
        let mut current = state.0.lock().map_err(|_| rust_i18n::t!("language.unavailable").to_string())?;
        persist(&mut db.conn(), &mut current, None, preference, language)
            .map_err(|error| error.to_string())?.0
    };
    state.mark_ready();
    notify_language(&app, &snapshot);
    Ok(snapshot)
}

pub fn update_window_titles(app: &AppHandle) {
    for (label, title) in [("quickadd", rust_i18n::t!("windows.quickAdd")), ("notification", rust_i18n::t!("windows.notification"))] {
        if let Some(window) = app.get_webview_window(label) { let _ = window.set_title(title.as_ref()); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persistence_is_atomic_and_stale_startup_cannot_override_a_new_choice() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").unwrap();
        let mut current = LanguageSnapshot { preference: "auto".into(), language: "en".into(), revision: 0 };
        let (changed, _) = persist(&mut conn, &mut current, None, "zh-CN".into(), "zh-CN".into()).unwrap();
        assert_eq!(changed.revision, 1);
        let (stale, wrote) = persist(&mut conn, &mut current, Some(0), "auto".into(), "en".into()).unwrap();
        assert!(!wrote);
        assert_eq!(stale, changed);
        assert_eq!(settings::read(&conn, PREFERENCE).as_deref(), Some("zh-CN"));
        assert_eq!(settings::read(&conn, EFFECTIVE).as_deref(), Some("zh-CN"));
        conn.execute_batch("PRAGMA query_only = ON").unwrap();
        assert!(persist(&mut conn, &mut current, None, "en".into(), "en".into()).is_err());
        assert_eq!(current, changed);
        let (automatic, wrote) = persist(&mut conn, &mut current, Some(1), "auto".into(), "en".into()).unwrap();
        assert!(wrote);
        assert_eq!(automatic.preference, "auto");
        assert_eq!(automatic.language, "en");
    }

    #[test]
    fn native_resources_are_available_without_a_webview() {
        assert_eq!(rust_i18n::t!("windows.quickAdd", locale = "en"), "Add Todo");
        assert_eq!(rust_i18n::t!("windows.quickAdd", locale = "zh-CN"), "添加任务");
        assert_eq!(rust_i18n::t!("tray.quit", locale = "en"), "Quit");
        assert_eq!(rust_i18n::t!("tray.quit", locale = "zh-CN"), "退出");
        assert_eq!(rust_i18n::t!("tray.taskTooltip", locale = "en", state = "Tracking", title = "Task <>&", time = "01:30"), "Tracking: Task <>& (01:30)");
        assert_eq!(rust_i18n::t!("tray.taskTooltip", locale = "zh-CN", state = "正在计时", title = "任务 <>&", time = "01:30"), "正在计时：任务 <>&（01:30）");
        assert_eq!(rust_i18n::t!("tray.overEstimate", locale = "en", time = "01:30"), "01:30 over estimate");
        assert_eq!(rust_i18n::t!("tray.overEstimate", locale = "zh-CN", time = "01:30"), "超出预计 01:30");
        assert_eq!(rust_i18n::t!("tray.phaseTooltip", locale = "en", phase = "Focus", time = "01:30"), "Focus 01:30");
        assert_eq!(rust_i18n::t!("tray.phaseTooltip", locale = "zh-CN", phase = "专注", time = "01:30"), "专注 01:30");
        assert_eq!(rust_i18n::t!("notifications.testTitle", locale = "en"), "todofy test notification");
        assert_eq!(rust_i18n::t!("notifications.testTitle", locale = "zh-CN"), "todofy测试通知");
        assert_eq!(rust_i18n::t!("notifications.testBody", locale = "en"), "If you can see this, desktop notifications are working.");
        assert_eq!(rust_i18n::t!("notifications.testBody", locale = "zh-CN"), "如果你能看到此消息，说明桌面通知工作正常。");
        assert_eq!(rust_i18n::t!("common.priority", locale = "en", priority = 3), "Priority 3");
        assert_eq!(rust_i18n::t!("common.priority", locale = "zh-CN", priority = 3), "优先级 3");
        assert_eq!(rust_i18n::t!("timer.stillTrackingBody", locale = "en", title = "My task <>&", hours = 3), "“My task <>&” — 3h and counting · todofy");
        assert_eq!(rust_i18n::t!("timer.stillTrackingBody", locale = "zh-CN", title = "My task <>&", hours = 3), "“My task <>&”已计时 3 小时，仍在继续 · todofy");
        assert_eq!(rust_i18n::t!("updates.available", locale = "en", version = "2.0"), "todofy 2.0 is available");
        assert_eq!(rust_i18n::t!("updates.available", locale = "zh-CN", version = "2.0"), "todofy 2.0已发布");
    }

    #[test]
    fn language_readiness_releases_the_background_scheduler() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").unwrap();
        let state = std::sync::Arc::new(initialize(&conn));
        let worker = state.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || { worker.wait_ready(); tx.send(()).unwrap(); });
        state.mark_ready();
        assert!(rx.recv_timeout(Duration::from_secs(1)).is_ok());
    }
}
