mod assets;
mod audio;

use crate::voice::audio::{Capture, Message};
use serde::Deserialize;
use std::{
    fs,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, State};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Downloading,
    Recording,
    Transcribing,
}

pub struct VoiceState {
    recorder: mpsc::Sender<Message>,
    operation: Mutex<Operation>,
    level: Arc<AtomicU32>,
}

struct Operation {
    id: u64,
    phase: Phase,
    cancelled: Arc<AtomicBool>,
}

impl VoiceState {
    pub fn new() -> Self {
        let level = Arc::new(AtomicU32::new(0));
        Self {
            recorder: audio::spawn_worker(level.clone()),
            level,
            operation: Mutex::new(Operation {
                id: 0,
                phase: Phase::Idle,
                cancelled: Arc::new(AtomicBool::new(false)),
            }),
        }
    }

    fn enter(&self, next: Phase) -> Result<(u64, Arc<AtomicBool>), String> {
        let mut op = self.operation.lock().map_err(|_| rust_i18n::t!("voice.stateFailed").to_string())?;
        if op.phase != Phase::Idle {
            return Err(rust_i18n::t!("voice.busy").to_string());
        }
        op.id = op.id.wrapping_add(1);
        op.cancelled = Arc::new(AtomicBool::new(false));
        op.phase = next;
        Ok((op.id, op.cancelled.clone()))
    }

    fn finish(&self, id: u64) {
        if let Ok(mut op) = self.operation.lock() {
            if op.id == id {
                op.phase = Phase::Idle;
            }
        }
    }
}

#[tauri::command]
pub async fn voice_status(app: AppHandle) -> Result<assets::VoiceStatus, String> {
    tauri::async_runtime::spawn_blocking(move || assets::status(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn voice_input_level(state: State<VoiceState>) -> f32 {
    f32::from_bits(state.level.load(Ordering::Relaxed))
}

#[tauri::command]
pub async fn voice_catalog_refresh(
    app: AppHandle,
    state: State<'_, VoiceState>,
) -> Result<assets::VoiceStatus, String> {
    let (id, _) = state.enter(Phase::Downloading)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        assets::refresh_catalog(&app)?;
        assets::status(&app)
    })
    .await
    .map_err(|e| e.to_string());
    state.finish(id);
    result?
}

#[tauri::command]
pub async fn voice_asset_download(
    app: AppHandle,
    state: State<'_, VoiceState>,
    kind: String,
    model: Option<String>,
) -> Result<assets::VoiceStatus, String> {
    let (id, cancelled) = state.enter(Phase::Downloading)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        assets::download(&app, &kind, model.as_deref(), || {
            cancelled.load(Ordering::SeqCst)
        })?;
        assets::status(&app)
    })
    .await
    .map_err(|e| e.to_string());
    state.finish(id);
    result?
}

#[tauri::command]
pub fn voice_asset_cancel(state: State<VoiceState>) {
    if let Ok(op) = state.operation.lock() {
        if op.phase == Phase::Downloading {
            op.cancelled.store(true, Ordering::SeqCst);
        }
    }
}

#[tauri::command]
pub async fn voice_asset_remove(
    app: AppHandle,
    state: State<'_, VoiceState>,
    kind: String,
    model: Option<String>,
) -> Result<assets::VoiceStatus, String> {
    let (id, _) = state.enter(Phase::Downloading)?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        assets::remove(&app, &kind, model.as_deref()).and_then(|_| assets::status(&app))
    })
    .await
    .map_err(|e| e.to_string());
    state.finish(id);
    result?
}

#[tauri::command]
pub async fn voice_mode_set(
    app: AppHandle,
    state: State<'_, VoiceState>,
    enabled: bool,
) -> Result<assets::VoiceStatus, String> {
    if !enabled {
        voice_record_cancel_inner(&state);
    }
    tauri::async_runtime::spawn_blocking(move || assets::set_mode(&app, enabled))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn voice_model_set(
    app: AppHandle,
    state: State<'_, VoiceState>,
    model: String,
) -> Result<assets::VoiceStatus, String> {
    if state
        .operation
        .lock()
        .map_err(|_| rust_i18n::t!("voice.stateFailed").to_string())?
        .phase
        != Phase::Idle
    {
        return Err(rust_i18n::t!("voice.stopBeforeModel").to_string());
    }
    tauri::async_runtime::spawn_blocking(move || assets::set_model(&app, &model))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn voice_record_start(
    app: AppHandle,
    state: State<'_, VoiceState>,
    kind: String,
) -> Result<(), String> {
    let seconds = match kind.as_str() {
        "task" => 45,
        "journal" => 180,
        _ => return Err(rust_i18n::t!("voice.target").to_string()),
    };
    let (id, cancelled) = state.enter(Phase::Recording)?;
    let sender = state.recorder.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        assets::checked_paths(&app)?;
        if cancelled.load(Ordering::SeqCst) {
            return Err(rust_i18n::t!("voice.cancelled").to_string());
        }
        let (reply, receiver) = mpsc::channel();
        sender
            .send(Message::Start { seconds, reply })
            .map_err(|_| rust_i18n::t!("voice.workerStopped").to_string())?;
        let started = receiver.recv().map_err(|_| rust_i18n::t!("voice.workerStopped").to_string())?;
        if cancelled.load(Ordering::SeqCst) {
            // Cancel may have reached the worker before Start while asset
            // verification was running. Send it again after Start completes.
            let _ = sender.send(Message::Cancel);
            return Err(rust_i18n::t!("voice.cancelled").to_string());
        }
        started
    })
    .await
    .map_err(|e| e.to_string());
    if !matches!(result, Ok(Ok(()))) {
        state.finish(id);
    }
    result?
}

#[tauri::command]
pub async fn voice_record_stop(
    app: AppHandle,
    state: State<'_, VoiceState>,
) -> Result<String, String> {
    let (id, cancelled) = {
        let mut op = state.operation.lock().map_err(|_| rust_i18n::t!("voice.stateFailed").to_string())?;
        if op.phase != Phase::Recording {
            return Err(rust_i18n::t!("voice.noRecording").to_string());
        }
        op.phase = Phase::Transcribing;
        (op.id, op.cancelled.clone())
    };
    let sender = state.recorder.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (reply, receiver) = mpsc::channel();
        sender
            .send(Message::Stop { reply })
            .map_err(|_| rust_i18n::t!("voice.workerStopped").to_string())?;
        let capture = receiver.recv().map_err(|_| rust_i18n::t!("voice.workerStopped").to_string())??;
        if cancelled.load(Ordering::SeqCst) {
            return Err(rust_i18n::t!("voice.cancelled").to_string());
        }
        transcribe(&app, capture, &cancelled)
    })
    .await
    .map_err(|e| e.to_string());
    state.finish(id);
    result?
}

fn voice_record_cancel_inner(state: &VoiceState) {
    if let Ok(mut op) = state.operation.lock() {
        if op.phase == Phase::Recording || op.phase == Phase::Transcribing {
            op.cancelled.store(true, Ordering::SeqCst);
            if op.phase == Phase::Recording {
                op.phase = Phase::Idle;
                op.id = op.id.wrapping_add(1);
            }
        }
    }
    let _ = state.recorder.send(Message::Cancel);
}

#[tauri::command]
pub fn voice_record_cancel(state: State<VoiceState>) {
    voice_record_cancel_inner(&state);
}

pub fn cleanup_temp(app: &AppHandle) {
    let Ok(dir) = app.path().app_cache_dir() else {
        return;
    };
    let Ok(entries) = fs::read_dir(dir.join("voice-temp")) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && matches!(
                path.extension().and_then(|s| s.to_str()),
                Some("wav" | "json")
            )
        {
            let _ = fs::remove_file(path);
        }
    }
}

struct TempAudio {
    wav: std::path::PathBuf,
    json: std::path::PathBuf,
}
impl Drop for TempAudio {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.wav);
        let _ = fs::remove_file(&self.json);
    }
}

#[derive(Deserialize)]
struct WhisperResult {
    transcription: Vec<WhisperSegment>,
}
#[derive(Deserialize)]
struct WhisperSegment {
    text: String,
}

fn transcribe(app: &AppHandle, capture: Capture, cancelled: &AtomicBool) -> Result<String, String> {
    let (engine, model) = assets::checked_paths(app)?;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("voice-temp");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let stem = uuid::Uuid::new_v4().to_string();
    let temp = TempAudio {
        wav: dir.join(format!("{stem}.wav")),
        json: dir.join(format!("{stem}.json")),
    };
    let prefix = dir.join(&stem);
    audio::write_wav(&temp.wav, &audio::pcm_16k(&capture))?;
    let mut child = Command::new(engine)
        .args([
            "-m",
            model.to_str().ok_or(rust_i18n::t!("voice.modelPath").to_string())?,
            "-f",
            temp.wav.to_str().ok_or(rust_i18n::t!("voice.audioPath").to_string())?,
            "-l",
            "auto",
            "-oj",
            "-of",
            prefix.to_str().ok_or(rust_i18n::t!("voice.outputPath").to_string())?,
            "-np",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| rust_i18n::t!("voice.launchFailed", error = e).to_string())?;
    let started = Instant::now();
    loop {
        if cancelled.load(Ordering::SeqCst) || started.elapsed() > Duration::from_secs(5 * 60) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(if cancelled.load(Ordering::SeqCst) {
                rust_i18n::t!("voice.cancelled").to_string()
            } else {
                rust_i18n::t!("voice.timeout").to_string()
            }
            .into());
        }
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(exit) if exit.success() => break,
            Some(_) => return Err(rust_i18n::t!("voice.cannotTranscribe").to_string()),
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    }
    let bytes = fs::read(&temp.json).map_err(|_| rust_i18n::t!("voice.noTranscript").to_string())?;
    let output: WhisperResult = serde_json::from_slice(&bytes)
        .map_err(|_| rust_i18n::t!("voice.invalidTranscript").to_string())?;
    let text = output
        .transcription
        .into_iter()
        .map(|segment| segment.text.trim().to_string())
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        Err(rust_i18n::t!("voice.noSpeech").to_string())
    } else {
        Ok(text)
    }
}
