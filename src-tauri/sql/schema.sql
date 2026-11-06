PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS labels (
    id         TEXT PRIMARY KEY,   -- UUID, generated on-device
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#6c7cff',
    updated_at TEXT NOT NULL,      -- RFC3339, bumped on every write
    deleted_at TEXT                -- soft-delete tombstone; NULL while live
);

CREATE TABLE IF NOT EXISTS tasks (
    id           TEXT PRIMARY KEY,   -- UUID, generated on-device
    title        TEXT NOT NULL,
    notes        TEXT,
    due_date     TEXT,               -- ISO date  (YYYY-MM-DD)
    remind_at    TEXT,               -- ISO datetime (local)
    status       TEXT NOT NULL DEFAULT 'active',  -- active | done
    priority     INTEGER NOT NULL DEFAULT 4,      -- 1 (high) .. 4 (none)
    created_at   TEXT NOT NULL,
    completed_at TEXT,
    order_index  REAL NOT NULL DEFAULT 0,
    notified     INTEGER NOT NULL DEFAULT 0,
    pinned       INTEGER NOT NULL DEFAULT 0,
    repeat       TEXT,               -- daily|weekdays|weekly|monthly|yearly
    subtasks     TEXT,               -- JSON array of {id,text,done}
    estimate_minutes INTEGER,        -- expected effort; NULL = no estimate
    stage        TEXT,               -- board column slug; NULL = first column
    board_index  REAL NOT NULL DEFAULT 0,  -- manual order within a board column
    updated_at   TEXT NOT NULL,      -- RFC3339, bumped on every write
    deleted_at   TEXT,               -- soft-delete tombstone; NULL while live
    -- Old databases receive these columns after the integer-ID migration.
    last_notified_at TEXT,            -- last reminder delivery
    reminder_ack_at  TEXT             -- explicit reminder acknowledgement
);

CREATE TABLE IF NOT EXISTS task_labels (
    task_id    TEXT NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
    label_id   TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL,   -- RFC3339, bumped on every write
    deleted_at TEXT,            -- soft-delete tombstone; NULL while live
    PRIMARY KEY (task_id, label_id)
);

-- Simple key/value app settings (e.g. startup_mode). Read by the
-- backend at launch and by the Settings screen at runtime.
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Per-task focus stopwatch sessions. A row with a NULL end_at is the
-- open one (at most one at a time); it is running while `resumed_at` is
-- set and paused while it is NULL. `seconds` is filled in on stop;
-- `notified` counts the 'still tracking' nudges already sent.
CREATE TABLE IF NOT EXISTS time_sessions (
    id          TEXT PRIMARY KEY,   -- UUID, generated on-device
    task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    start_at    TEXT NOT NULL,   -- RFC3339, when the session began
    end_at      TEXT,            -- NULL until stopped
    seconds     INTEGER,         -- duration, set on stop
    accumulated INTEGER NOT NULL DEFAULT 0,  -- secs banked before this segment
    resumed_at  TEXT,            -- start of the running segment; NULL while paused
    notified    INTEGER NOT NULL DEFAULT 0,
    updated_at  TEXT NOT NULL,   -- RFC3339, bumped on every write
    deleted_at  TEXT             -- soft-delete tombstone; NULL while live
);
CREATE INDEX IF NOT EXISTS idx_sessions_task ON time_sessions(task_id);

-- Standalone Pomodoro timer state (single row, id = 1). Persisted so
-- the timer survives restarts and keeps ticking while in the tray.
CREATE TABLE IF NOT EXISTS pomodoro (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    phase          TEXT NOT NULL DEFAULT 'focus',  -- focus|short|long
    running        INTEGER NOT NULL DEFAULT 0,
    start_at       TEXT,                            -- when the running segment began
    accumulated    INTEGER NOT NULL DEFAULT 0,      -- secs elapsed before this segment
    completed_focus INTEGER NOT NULL DEFAULT 0,     -- focus phases done in the set
    notified       INTEGER NOT NULL DEFAULT 0,      -- phase-complete nudge sent?
    focus_min      INTEGER NOT NULL DEFAULT 25,
    short_min      INTEGER NOT NULL DEFAULT 5,
    long_min       INTEGER NOT NULL DEFAULT 15,
    long_every     INTEGER NOT NULL DEFAULT 4
);
INSERT OR IGNORE INTO pomodoro (id) VALUES (1);

-- Free-form journal entries. Multiple per day; `entry_date` groups them
-- for the calendar rail and the day summary.
CREATE TABLE IF NOT EXISTS journal_entries (
    id         TEXT PRIMARY KEY,   -- UUID, generated on-device
    title      TEXT,
    body       TEXT NOT NULL DEFAULT '',
    mood       INTEGER,            -- 1..5, optional
    entry_date TEXT NOT NULL,      -- ISO date (YYYY-MM-DD)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,      -- RFC3339, bumped on every write
    deleted_at TEXT                -- soft-delete tombstone; NULL while live
);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(entry_date);

-- Standalone local calendar events, shown alongside tasks.
CREATE TABLE IF NOT EXISTS events (
    id                 TEXT PRIMARY KEY,   -- UUID, generated on-device
    title              TEXT NOT NULL,
    description        TEXT,
    start_at           TEXT,               -- ISO datetime, or YYYY-MM-DD when all_day
    end_at             TEXT,
    all_day            INTEGER NOT NULL DEFAULT 0,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL,       -- RFC3339, bumped on every write
    deleted_at         TEXT                 -- soft-delete tombstone; NULL while live
);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at);

CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due      ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_remind   ON tasks(remind_at);

CREATE INDEX IF NOT EXISTS idx_tasks_pinned ON tasks(pinned);

CREATE TABLE IF NOT EXISTS board_columns (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
    order_index REAL NOT NULL, wip_limit INTEGER CHECK(wip_limit > 0 AND wip_limit <= 9999),
    updated_at TEXT NOT NULL, deleted_at TEXT, replacement_id TEXT,
    CHECK(id NOT IN ('todo', 'done') OR deleted_at IS NULL),
    CHECK(id != 'done' OR wip_limit IS NULL)
);

CREATE TABLE IF NOT EXISTS priority_profiles (
    priority           INTEGER PRIMARY KEY CHECK (priority BETWEEN 1 AND 4),
    name               TEXT NOT NULL,
    color              TEXT NOT NULL,
    sound              TEXT,
    volume             INTEGER CHECK (volume IS NULL OR volume BETWEEN 0 AND 100),
    ramp               INTEGER,
    notification_style TEXT CHECK (notification_style IS NULL
                           OR notification_style IN ('custom', 'native')),
    repeat_minutes     INTEGER CHECK (repeat_minutes IS NULL
                           OR repeat_minutes BETWEEN 0 AND 1440),
    updated_at         TEXT NOT NULL
);
