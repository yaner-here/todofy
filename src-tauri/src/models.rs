use serde::Serialize;

/// The open per-task stopwatch. Elapsed time is `accumulated` plus, while
/// running, the seconds since `resumed_at`; a null `resumed_at` means paused.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTimer {
    pub task_id: String,
    pub title: String,
    pub start_at: String,
    pub resumed_at: Option<String>,
    pub accumulated: i64,
    // Carried along so the tray can flag an overrun without a second query.
    pub estimate_minutes: Option<i64>,
}

/// A completed focus session, for the history view.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionLog {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub start_at: String,
    pub end_at: String,
    pub seconds: i64,
}

/// Standalone Pomodoro timer state. Elapsed time in the current phase is
/// `accumulated + (now - start_at)` while running; the frontend derives the
/// live countdown from `target` so it ticks smoothly without polling.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Pomodoro {
    pub phase: String,
    pub running: bool,
    pub start_at: Option<String>,
    pub accumulated: i64,
    pub completed_focus: i64,
    /// Seconds the current phase is meant to last.
    pub target: i64,
    pub focus_min: i64,
    pub short_min: i64,
    pub long_min: i64,
    pub long_every: i64,
}
