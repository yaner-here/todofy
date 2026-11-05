use crate::{db::Db, settings};
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

const SETTING: &str = "ui_language";

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LanguageSnapshot {
    preference: String,
    language: &'static str,
    revision: u64,
}

pub struct LanguageState(Mutex<LanguageSnapshot>);

fn supported_preference(preference: &str) -> bool {
    matches!(preference, "auto" | "en" | "zh-CN")
}

fn resolve(preference: &str, locales: &[String]) -> &'static str {
    if preference == "en" { return "en"; }
    if preference == "zh-CN" { return "zh-CN"; }
    for raw in locales {
        let tag = raw.split(['.', '@']).next().unwrap_or_default().replace('_', "-").to_ascii_lowercase();
        let parts: Vec<_> = tag.split('-').collect();
        if parts[0] == "en" { return "en"; }
        if parts[0] != "zh" { continue; }
        let script = parts.iter().find(|part| part.len() == 4);
        match script.copied() {
            Some("hans") => return "zh-CN",
            Some(_) => continue,
            None if parts.iter().any(|part| matches!(*part, "tw" | "hk" | "mo")) => continue,
            None => return "zh-CN",
        }
    }
    "en"
}

fn preferred_locales() -> Vec<String> {
    #[cfg(target_os = "linux")]
    {
        let message_locale = ["LC_ALL", "LC_MESSAGES", "LANG"].iter()
            .find_map(|key| std::env::var(key).ok().filter(|value| !value.is_empty()));
        if message_locale.as_deref().is_some_and(is_c_locale) { return vec!["en".into()]; }
    }
    let locales: Vec<_> = sys_locale::get_locales().collect();
    if !locales.is_empty() { return locales; }
    #[cfg(target_os = "linux")]
    for path in ["/etc/locale.conf", "/etc/default/locale"] {
        if let Ok(text) = std::fs::read_to_string(path) {
            let locales = config_locales(&text);
            if !locales.is_empty() { return locales; }
        }
    }
    locales
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn is_c_locale(value: &str) -> bool {
    matches!(value.split(['.', '@']).next().unwrap_or_default(), "C" | "POSIX")
}

#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn config_locales(text: &str) -> Vec<String> {
    let values: std::collections::HashMap<_, _> = text.lines().filter_map(|line| {
        let line = line.trim();
        if line.starts_with('#') { return None; }
        let (key, value) = line.split_once('=')?;
        let value = value.trim().trim_matches(['"', '\'']);
        (!value.is_empty()).then_some((key.trim(), value))
    }).collect();
    let primary = ["LC_ALL", "LC_MESSAGES", "LANG"].iter().find_map(|key| values.get(key).copied());
    if primary.is_some_and(is_c_locale) { return vec!["en".into()]; }
    values.get("LANGUAGE").into_iter().flat_map(|value| value.split(':'))
        .chain(primary).filter(|value| !value.is_empty()).map(str::to_owned).collect()
}

pub fn initialize(conn: &Connection) -> LanguageState {
    let preference = settings::read(conn, SETTING).filter(|pref| supported_preference(pref)).unwrap_or_else(|| "auto".into());
    let language = resolve(&preference, &preferred_locales());
    rust_i18n::set_locale(language);
    LanguageState(Mutex::new(LanguageSnapshot { preference, language, revision: 0 }))
}

fn persist(conn: &Connection, current: &mut LanguageSnapshot, preference: &str, locales: &[String]) -> Result<LanguageSnapshot, String> {
    if !supported_preference(preference) { return Err(rust_i18n::t!("language.invalidPreference").to_string()); }
    settings::write(conn, SETTING, preference).map_err(|error| error.to_string())?;
    *current = LanguageSnapshot { preference: preference.into(), language: resolve(preference, locales), revision: current.revision + 1 };
    Ok(current.clone())
}

#[tauri::command]
pub fn get_language(state: State<LanguageState>) -> Result<LanguageSnapshot, String> {
    state.0.lock().map(|snapshot| snapshot.clone()).map_err(|_| rust_i18n::t!("language.unavailable").to_string())
}

#[tauri::command]
pub fn set_language(app: AppHandle, db: State<Db>, state: State<LanguageState>, preference: String) -> Result<LanguageSnapshot, String> {
    let snapshot = {
        let mut current = state.0.lock().map_err(|_| rust_i18n::t!("language.unavailable").to_string())?;
        let snapshot = persist(&db.conn(), &mut current, &preference, &preferred_locales())?;
        rust_i18n::set_locale(snapshot.language);
        snapshot
    };
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        update_window_titles(&handle);
        crate::tray::localize(&handle);
        crate::tray::refresh(&handle);
    }) { eprintln!("[i18n] could not refresh native labels: {error}"); }
    // Persistence already succeeded; return the committed value even if a window is closing.
    if let Err(error) = app.emit("language-changed", &snapshot) {
        eprintln!("[i18n] could not broadcast the language: {error}");
    }
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
    fn language_matching_respects_script_and_preference_order() {
        for (locales, expected) in [
            (vec!["zh_CN.UTF-8"], "zh-CN"), (vec!["zh-SG"], "zh-CN"),
            (vec!["zh-Hant-CN"], "en"), (vec!["zh-Hans-HK"], "zh-CN"),
            (vec!["zh-TW", "en-GB"], "en"), (vec!["de-DE", "zh"], "zh-CN"),
            (vec!["en-US", "zh-CN"], "en"), (vec!["C", "POSIX"], "en"),
        ] {
            let locales = locales.into_iter().map(str::to_owned).collect::<Vec<_>>();
            assert_eq!(resolve("auto", &locales), expected);
            assert_eq!(resolve("en", &locales), "en");
            assert_eq!(resolve("zh-CN", &locales), "zh-CN");
        }
    }

    #[test]
    fn message_locale_fallback_does_not_use_lc_time() {
        assert_eq!(config_locales("LANG=en_US.UTF-8\nLC_TIME=zh_CN.UTF-8"), vec!["en_US.UTF-8"]);
        assert_eq!(config_locales("LANGUAGE=de:zh_CN\nLANG=en_US.UTF-8"), vec!["de", "zh_CN", "en_US.UTF-8"]);
        assert_eq!(config_locales("LANGUAGE=zh_CN\nLC_ALL=C.UTF-8"), vec!["en"]);
        assert_eq!(config_locales("LC_MESSAGES='zh_CN.UTF-8'\nLANG=en_US.UTF-8"), vec!["zh_CN.UTF-8"]);
    }

    #[test]
    fn failed_or_invalid_preference_does_not_change_saved_state() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").unwrap();
        let mut current = LanguageSnapshot { preference: "auto".into(), language: "en", revision: 0 };
        let changed = persist(&conn, &mut current, "zh-CN", &[]).unwrap();
        assert_eq!(changed.revision, 1);
        assert_eq!(settings::read(&conn, SETTING).as_deref(), Some("zh-CN"));
        assert!(persist(&conn, &mut current, "invalid", &[]).is_err());
        assert_eq!(current, changed);
        conn.execute_batch("PRAGMA query_only = ON").unwrap();
        assert!(persist(&conn, &mut current, "en", &[]).is_err());
        assert_eq!(current, changed);
        assert_eq!(settings::read(&conn, SETTING).as_deref(), Some("zh-CN"));
    }

    #[test]
    fn native_resources_are_available_without_a_webview() {
        assert_eq!(rust_i18n::t!("windows.quickAdd", locale = "en"), "Add Todo");
        assert_eq!(rust_i18n::t!("windows.quickAdd", locale = "zh-CN"), "添加任务");
        assert_eq!(rust_i18n::t!("timer.stillTrackingBody", locale = "zh-CN", title = "My task <>&", hours = 3), "“My task <>&”已计时 3 小时，仍在继续 · todofy");
    }

    #[test]
    fn native_catalogs_cover_the_same_messages_and_parameters() {
        use std::collections::{BTreeMap, BTreeSet};
        fn flatten(value: &serde_json::Value, prefix: &str, output: &mut BTreeMap<String, String>) {
            if let Some(text) = value.as_str() {
                output.insert(prefix.into(), text.into());
            } else if let Some(object) = value.as_object() {
                for (name, value) in object {
                    let key = if prefix.is_empty() { name.clone() } else { format!("{prefix}.{name}") };
                    flatten(value, &key, output);
                }
            }
        }
        fn parameters(text: &str) -> BTreeSet<&str> {
            text.split("%{").skip(1).filter_map(|part| part.split_once('}').map(|(name, _)| name)).collect()
        }
        let mut english = BTreeMap::new();
        let mut chinese = BTreeMap::new();
        flatten(&serde_json::from_str(include_str!("../locales/en.json")).unwrap(), "", &mut english);
        flatten(&serde_json::from_str(include_str!("../locales/zh-CN.json")).unwrap(), "", &mut chinese);
        assert_eq!(english.keys().collect::<Vec<_>>(), chinese.keys().collect::<Vec<_>>());
        for (key, text) in english {
            assert_eq!(parameters(&text), parameters(&chinese[&key]), "{key}");
        }
    }
}
