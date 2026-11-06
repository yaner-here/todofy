mod board;
mod commands;
mod crud;
mod db;
mod i18n;
mod notify;
mod popup;
#[cfg(target_os = "windows")]
mod portable;
mod priority;
mod quickwin;
mod scheduler;
mod seeds;
mod settings;
mod timer;
mod timezone;
mod tray;
mod update;

#[cfg(test)]
mod crud_ipc_tests;

rust_i18n::i18n!("../src/locales", fallback = "en");

use db::Db;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// Flag added to the launch-on-login command so the app can tell a login
/// launch apart from the user opening it by hand.
const AUTOSTART_FLAG: &str = "--autostart";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut context = tauri::generate_context!();

    // On Windows, create the configured windows ourselves so their WebView2
    // profiles can live beside the executable along with the database.
    #[cfg(target_os = "windows")]
    let startup_windows: Vec<_> = context
        .config_mut()
        .app
        .windows
        .iter_mut()
        .filter(|window| window.create)
        .map(|window| {
            let config = window.clone();
            window.create = false;
            config
        })
        .collect();

    tauri::Builder::default()
        // Must be the FIRST plugin: if todofy is already running, a second
        // launch focuses the existing window instead of starting a new one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        // Signed self-update, checked from the frontend. `process` is what
        // restarts the app into the version that was just installed.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Launch-on-login. The registered command carries AUTOSTART_FLAG so the
        // setup hook below can decide between opening the window and staying in
        // the tray based on the user's `startup_mode` setting.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_FLAG]),
        ))
        // Global hotkey (Ctrl+Alt+A) to summon the quick-add window from anywhere.
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed
                        && shortcut == &quickwin::quick_shortcut()
                    {
                        quickwin::toggle(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            #[cfg(target_os = "windows")]
            let portable = portable::PortablePaths::current()?;
            #[cfg(target_os = "windows")]
            let database_path = &portable.database;

            #[cfg(not(target_os = "windows"))]
            let dir = app
                .path()
                .app_data_dir()?;
            #[cfg(not(target_os = "windows"))]
            std::fs::create_dir_all(&dir)?;
            #[cfg(not(target_os = "windows"))]
            let database_path = dir.join("todofy.db");

            let conn = Connection::open(&database_path).map_err(|error| {
                std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("failed to open database {}: {error}", database_path.display()),
                )
            })?;
            db::init(&conn).expect("failed to initialize schema");
            app.manage(i18n::initialize(&conn));
            app.manage(Db(Mutex::new(conn)));

            #[cfg(target_os = "windows")]
            for config in &startup_windows {
                tauri::WebviewWindowBuilder::from_config(app.handle(), config)?
                    .data_directory(portable.webview_data.clone())
                    .build()?;
            }
            i18n::update_window_titles(app.handle());

            // The main window starts hidden (visible:false in tauri.conf.json)
            // so a login launch can go straight to the tray without a flash.
            // Reveal it now unless this is an autostart launch configured to
            // start minimized to the tray.
            let launched_at_startup = std::env::args().any(|a| a == AUTOSTART_FLAG);
            let start_in_tray = {
                let db = app.state::<Db>();
                let conn = db.conn();
                settings::read(&conn, "startup_mode").as_deref() == Some("tray")
            };
            if let Some(win) = app.get_webview_window("main") {
                if !(launched_at_startup && start_in_tray) {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }

            // Register the global quick-add hotkey. If the desktop
            // environment has already claimed Ctrl+Alt+A, log and carry on.
            if let Err(e) = app.global_shortcut().register(quickwin::quick_shortcut()) {
                eprintln!("todofy: could not register Ctrl+Alt+A global shortcut: {e}");
            }

            // Start the reminder scheduler.
            scheduler::spawn(app.handle().clone());

            // System-tray icon with focus controls + live timer status.
            tray::init(app)?;
            tray::spawn_updater(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it to the tray instead of quitting.
            // Use the tray's "Quit" (or an explicit app.exit) to fully exit.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                    db::checkpoint(&window.state::<Db>().conn());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            i18n::get_language,
            i18n::language_ready,
            i18n::language_sources,
            i18n::sync_language,
            i18n::set_language,
            crud::run_crud,
            timezone::timezone_offsets,
            notify::send_test_notification,
            popup::notify_popup_dismiss,
            popup::notify_popup_open,
            popup::notify_popup_pending,
            popup::notify_popup_ack,
            settings::get_setting,
            settings::set_setting,
            settings::get_autostart,
            settings::set_autostart,
            commands::acknowledge_reminder,
            timer::start_timer,
            timer::pause_timer,
            timer::resume_timer,
            timer::stop_timer,
            timer::active_timer,
            timer::get_pomodoro,
            timer::pomodoro_start,
            timer::pomodoro_pause,
            timer::pomodoro_reset,
            timer::pomodoro_next,
            timer::set_pomodoro_config,
            update::can_self_update,
            update::notify_update,
            popup::notify_popup_open_update,
        ])
        .build(context)
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                db::checkpoint(&app.state::<Db>().conn());
            }
        });
}
