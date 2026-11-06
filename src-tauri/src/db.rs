use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

/// A fresh v4 UUID as a lowercase hyphenated string for a local record.
pub fn new_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Managed Tauri state: a single SQLite connection behind a mutex.
/// The notification scheduler and the command handlers share this.
pub struct Db(pub Mutex<Connection>);

impl Db {
    /// Borrow the connection. If a previous holder panicked while holding the
    /// lock the mutex is poisoned; we recover the guard anyway rather than
    /// cascading the panic to every later database call. Each command touches
    /// the connection only briefly and leaves it in a consistent state, so the
    /// data is safe to keep using.
    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Fold the write-ahead log back into `todofy.db` and truncate it. Nothing ever
/// closes the connection, so SQLite's own close-time checkpoint never runs and
/// the main file would otherwise stay empty while all data sits in the sidecar
/// `-wal` — making a copy of `todofy.db` alone worthless.
pub fn checkpoint(conn: &Connection) {
    if let Err(e) = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(())) {
        eprintln!("todofy: could not checkpoint the database: {e}");
    }
}

/// Create the schema if it does not yet exist, then bring older
/// databases up to date via `migrate`.
pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    if table_exists(conn, "tasks") && !column_exists(conn, "tasks", "pinned") {
        // Configure and add the old column before schema.sql creates its index.
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        conn.execute("ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0", [])?;
    }
    conn.execute_batch(include_str!("../sql/schema.sql"))?;
    migrate(conn)?;
    crate::board::seed(conn)?;
    crate::priority::seed(conn)?;
    Ok(())
}

/// True if a table named `table` exists.
fn table_exists(conn: &Connection, table: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        params![table],
        |_| Ok(()),
    )
    .is_ok()
}

/// True if `table` already has a column named `column`.
fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2",
        params![table, column],
        |_| Ok(()),
    )
    .is_ok()
}

/// Additive schema changes for databases created before a given feature
/// shipped. The shared `CREATE TABLE IF NOT EXISTS` statements cover fresh installs;
/// each block here brings an existing database up to date. Keep every
/// block idempotent (guarded by a column/index check) and append new
/// ones at the bottom as the schema grows — never edit an old block.
fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    // Recurring tasks: completing one rolls its due date / reminder forward to
    // the next occurrence instead of marking it done (see `src/data/recurrence.ts`).
    if !column_exists(conn, "tasks", "repeat") {
        conn.execute("ALTER TABLE tasks ADD COLUMN repeat TEXT", [])?;
    }

    // Subtasks / checklist: a JSON array of {id,text,done} on each task, for
    // breaking a task into smaller steps.
    if !column_exists(conn, "tasks", "subtasks") {
        conn.execute("ALTER TABLE tasks ADD COLUMN subtasks TEXT", [])?;
    }

    // Convert old AUTOINCREMENT integer ids to UUIDs once; fresh installs use TEXT ids.
    // Must come after the column-adding blocks so it can carry every column.
    migrate_ids_to_uuid(conn)?;

    // Local queries and deletes still depend on these columns.
    ensure_record_columns(conn)?;

    // Journal: free-form entries with a per-day grouping key.
    if !table_exists(conn, "journal_entries") {
        conn.execute_batch(
            "
            CREATE TABLE journal_entries (
                id         TEXT PRIMARY KEY,
                title      TEXT,
                body       TEXT NOT NULL DEFAULT '',
                mood       INTEGER,
                entry_date TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT
            );
            CREATE INDEX idx_journal_date ON journal_entries(entry_date);
            ",
        )?;
    }

    // Standalone calendar events.
    if !table_exists(conn, "events") {
        conn.execute_batch(
            "
            CREATE TABLE events (
                id                 TEXT PRIMARY KEY,
                title              TEXT NOT NULL,
                description        TEXT,
                start_at           TEXT,
                end_at             TEXT,
                all_day            INTEGER NOT NULL DEFAULT 0,
                created_at         TEXT NOT NULL,
                updated_at         TEXT NOT NULL,
                deleted_at         TEXT
            );
            CREATE INDEX idx_events_start ON events(start_at);
            ",
        )?;
    }

    // Added after the UUID conversion, which rebuilds `tasks` from an explicit
    // column list and would otherwise drop the column.
    if !column_exists(conn, "tasks", "estimate_minutes") {
        conn.execute("ALTER TABLE tasks ADD COLUMN estimate_minutes INTEGER", [])?;
    }

    // Pause support: `start_at` still marks when the session began, while the
    // live clock is `accumulated` plus the segment started at `resumed_at`.
    // Ordered after the UUID conversion for the same reason as the estimate.
    if !column_exists(conn, "time_sessions", "accumulated") {
        conn.execute(
            "ALTER TABLE time_sessions ADD COLUMN accumulated INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    if !column_exists(conn, "time_sessions", "resumed_at") {
        conn.execute("ALTER TABLE time_sessions ADD COLUMN resumed_at TEXT", [])?;
        // A session left open by an older build is running, not paused.
        conn.execute(
            "UPDATE time_sessions SET resumed_at = start_at WHERE end_at IS NULL",
            [],
        )?;
    }

    // Repeating reminders. `tasks.notified` becomes a count of nudges rather
    // than a flag (0 still means "not yet"); `last_notified_at` paces the
    // repeats and `reminder_ack_at` stops them.
    // Ordered after the UUID conversion for the same reason as the estimate.
    if !column_exists(conn, "tasks", "last_notified_at") {
        conn.execute("ALTER TABLE tasks ADD COLUMN last_notified_at TEXT", [])?;
    }
    if !column_exists(conn, "tasks", "reminder_ack_at") {
        conn.execute("ALTER TABLE tasks ADD COLUMN reminder_ack_at TEXT", [])?;
        // Treat reminders that predate repeats as answered, so upgrading
        // doesn't reopen all of them at once.
        conn.execute(
            "UPDATE tasks SET reminder_ack_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE notified <> 0",
            [],
        )?;
    }

    // Repair child rows left live by older builds after a parent was deleted.
    conn.execute_batch(
        "
        UPDATE task_labels
           SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE deleted_at IS NULL
           AND (
             EXISTS (SELECT 1 FROM tasks t
                     WHERE t.id = task_labels.task_id AND t.deleted_at IS NOT NULL)
             OR EXISTS (SELECT 1 FROM labels l
                        WHERE l.id = task_labels.label_id AND l.deleted_at IS NOT NULL)
           );

        UPDATE time_sessions
           SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE deleted_at IS NULL
           AND EXISTS (SELECT 1 FROM tasks t
                       WHERE t.id = time_sessions.task_id AND t.deleted_at IS NOT NULL);
        ",
    )?;

    // Kanban board. `stage` is a slug rather than a foreign key so named
    // columns can be added later as a lookup without migrating task rows.
    // `board_index` is separate from `order_index` because the list groups by
    // date and the board by stage; sharing one order would jump both.
    // Ordered after the UUID conversion for the same reason as the estimate.
    if !column_exists(conn, "tasks", "stage") {
        conn.execute("ALTER TABLE tasks ADD COLUMN stage TEXT", [])?;
    }
    if !column_exists(conn, "tasks", "board_index") {
        conn.execute(
            "ALTER TABLE tasks ADD COLUMN board_index REAL NOT NULL DEFAULT 0",
            [],
        )?;
        // Inherit the existing manual order so the first board opens arranged.
        conn.execute("UPDATE tasks SET board_index = order_index", [])?;
    }

    Ok(())
}

/// Baseline `updated_at` for older rows without a creation timestamp.
const LEGACY_RECORD_BASELINE: &str = "'1970-01-01T00:00:01+00:00'";

/// Add columns required by local queries to older databases.
fn ensure_record_columns(conn: &Connection) -> rusqlite::Result<()> {
    for (table, backfill) in [
        ("tasks", "created_at"),
        ("labels", LEGACY_RECORD_BASELINE),
        ("time_sessions", "start_at"),
        ("task_labels", LEGACY_RECORD_BASELINE),
    ] {
        if !column_exists(conn, table, "updated_at") {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''"),
                [],
            )?;
            conn.execute(
                &format!("UPDATE {table} SET updated_at = {backfill} WHERE updated_at = ''"),
                [],
            )?;
        }
        if !column_exists(conn, table, "deleted_at") {
            conn.execute(
                &format!("ALTER TABLE {table} ADD COLUMN deleted_at TEXT"),
                [],
            )?;
        }
    }
    Ok(())
}

/// True while `tasks.id` is still declared `INTEGER` — i.e. this database was
/// created before the UUID switch and still needs converting.
fn ids_are_integer(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT type FROM pragma_table_info('tasks') WHERE name = 'id'",
        [],
        |r| r.get::<_, String>(0),
    )
    .map(|t| t.eq_ignore_ascii_case("integer"))
    .unwrap_or(false)
}

/// One integer-keyed task row, read into memory before the tables are rewritten.
struct TaskRow {
    id: String, // freshly assigned UUID
    title: String,
    notes: Option<String>,
    due_date: Option<String>,
    remind_at: Option<String>,
    status: String,
    priority: i64,
    created_at: String,
    completed_at: Option<String>,
    order_index: f64,
    notified: i64,
    pinned: i64,
    repeat: Option<String>,
    subtasks: Option<String>,
}

/// One integer-keyed focus session, read into memory before the rewrite.
struct SessionRow {
    id: String, // freshly assigned UUID
    task_id: String,
    start_at: String,
    end_at: Option<String>,
    seconds: Option<i64>,
    notified: i64,
}

/// Convert the record tables (`labels`, `tasks`, `task_labels`,
/// `time_sessions`) from integer AUTOINCREMENT ids to on-device UUIDs.
///
/// Everything is read into memory first so old integer ids can be remapped to
/// their new UUIDs consistently across foreign keys, then the tables are
/// dropped and recreated with TEXT keys and the remapped rows re-inserted. The
/// recreate DDL is the historical schema; later migrations add newer columns.
/// `pomodoro` and `settings` are untouched.
fn migrate_ids_to_uuid(conn: &Connection) -> rusqlite::Result<()> {
    if !ids_are_integer(conn) {
        return Ok(());
    }

    // 1. Read labels, assigning a UUID to each old id.
    let mut label_map: HashMap<i64, String> = HashMap::new();
    let labels: Vec<(String, String, String)> = {
        let mut stmt = conn.prepare("SELECT id, name, color FROM labels")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|(old, name, color)| {
                let nid = new_uuid();
                label_map.insert(old, nid.clone());
                (nid, name, color)
            })
            .collect()
    };

    // 2. Read tasks, assigning a UUID to each old id.
    let mut task_map: HashMap<i64, String> = HashMap::new();
    let tasks: Vec<TaskRow> = {
        let mut stmt = conn.prepare(
            "SELECT id, title, notes, due_date, remind_at, status, priority,
                    created_at, completed_at, order_index, notified, pinned,
                    repeat, subtasks
             FROM tasks",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let old: i64 = r.get(0)?;
                Ok((
                    old,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, Option<String>>(8)?,
                    r.get::<_, f64>(9)?,
                    r.get::<_, i64>(10)?,
                    r.get::<_, i64>(11)?,
                    r.get::<_, Option<String>>(12)?,
                    r.get::<_, Option<String>>(13)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .map(|t| {
                let nid = new_uuid();
                task_map.insert(t.0, nid.clone());
                TaskRow {
                    id: nid,
                    title: t.1,
                    notes: t.2,
                    due_date: t.3,
                    remind_at: t.4,
                    status: t.5,
                    priority: t.6,
                    created_at: t.7,
                    completed_at: t.8,
                    order_index: t.9,
                    notified: t.10,
                    pinned: t.11,
                    repeat: t.12,
                    subtasks: t.13,
                }
            })
            .collect()
    };

    // 3. Read the join rows and sessions, remapping their foreign keys. Rows
    //    whose parent is missing (shouldn't happen with FKs on) are dropped.
    let task_labels: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT task_id, label_id FROM task_labels")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .filter_map(|(t, l)| Some((task_map.get(&t)?.clone(), label_map.get(&l)?.clone())))
            .collect()
    };
    let sessions: Vec<SessionRow> = {
        let mut stmt = conn.prepare(
            "SELECT id, task_id, start_at, end_at, seconds, notified FROM time_sessions",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<i64>>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows.into_iter()
            .filter_map(|(task, start_at, end_at, seconds, notified)| {
                Some(SessionRow {
                    id: new_uuid(),
                    task_id: task_map.get(&task)?.clone(),
                    start_at,
                    end_at,
                    seconds,
                    notified,
                })
            })
            .collect()
    };

    // 4. Rewrite. Disable FK enforcement so dropping/recreating the tables in
    //    dependency order doesn't cascade-delete children mid-swap.
    conn.execute_batch(
        "
        PRAGMA foreign_keys = OFF;
        DROP TABLE task_labels;
        DROP TABLE time_sessions;
        DROP TABLE tasks;
        DROP TABLE labels;

        CREATE TABLE labels (
            id    TEXT PRIMARY KEY,
            name  TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#6c7cff'
        );
        CREATE TABLE tasks (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL,
            notes        TEXT,
            due_date     TEXT,
            remind_at    TEXT,
            status       TEXT NOT NULL DEFAULT 'active',
            priority     INTEGER NOT NULL DEFAULT 4,
            created_at   TEXT NOT NULL,
            completed_at TEXT,
            order_index  REAL NOT NULL DEFAULT 0,
            notified     INTEGER NOT NULL DEFAULT 0,
            pinned       INTEGER NOT NULL DEFAULT 0,
            repeat       TEXT,
            subtasks     TEXT
        );
        CREATE TABLE task_labels (
            task_id  TEXT NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
            label_id TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, label_id)
        );
        CREATE TABLE time_sessions (
            id       TEXT PRIMARY KEY,
            task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            start_at TEXT NOT NULL,
            end_at   TEXT,
            seconds  INTEGER,
            notified INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX idx_sessions_task ON time_sessions(task_id);
        CREATE INDEX idx_tasks_status  ON tasks(status);
        CREATE INDEX idx_tasks_due     ON tasks(due_date);
        CREATE INDEX idx_tasks_remind  ON tasks(remind_at);
        CREATE INDEX idx_tasks_pinned  ON tasks(pinned);
        ",
    )?;

    for (id, name, color) in &labels {
        conn.execute(
            "INSERT INTO labels (id, name, color) VALUES (?1, ?2, ?3)",
            params![id, name, color],
        )?;
    }
    for t in &tasks {
        conn.execute(
            "INSERT INTO tasks (id, title, notes, due_date, remind_at, status,
                                priority, created_at, completed_at, order_index,
                                notified, pinned, repeat, subtasks)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                t.id,
                t.title,
                t.notes,
                t.due_date,
                t.remind_at,
                t.status,
                t.priority,
                t.created_at,
                t.completed_at,
                t.order_index,
                t.notified,
                t.pinned,
                t.repeat,
                t.subtasks,
            ],
        )?;
    }
    for (task_id, label_id) in &task_labels {
        conn.execute(
            "INSERT INTO task_labels (task_id, label_id) VALUES (?1, ?2)",
            params![task_id, label_id],
        )?;
    }
    for s in &sessions {
        conn.execute(
            "INSERT INTO time_sessions (id, task_id, start_at, end_at, seconds, notified)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![s.id, s.task_id, s.start_at, s.end_at, s.seconds, s.notified],
        )?;
    }

    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_fixture_schema_matches_a_fresh_native_database() {
        let native = Connection::open_in_memory().unwrap();
        init(&native).unwrap();

        let fixture = Connection::open_in_memory().unwrap();
        fixture.execute_batch(include_str!("../sql/schema.sql")).unwrap();

        let schema = |conn: &Connection| -> Vec<(String, String, String, Option<String>)> {
            conn.prepare(
                "SELECT type, name, tbl_name, sql FROM sqlite_master
                 WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
        };
        assert_eq!(schema(&fixture), schema(&native));
        let foreign_keys = |conn: &Connection| -> i64 {
            conn.query_row("PRAGMA foreign_keys", [], |row| row.get(0)).unwrap()
        };
        assert_eq!((foreign_keys(&fixture), foreign_keys(&native)), (1, 1));

        let defaults = crate::seeds::data();
        let time = defaults["seedTime"].as_str().unwrap();
        let board = defaults["board"].as_array().unwrap();
        let priorities = defaults["priorities"].as_array().unwrap();
        let count = |table: &str| -> i64 {
            native.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0)).unwrap()
        };
        assert_eq!(count("board_columns"), board.len() as i64);
        assert_eq!(count("priority_profiles"), priorities.len() as i64);
        for (position, column) in board.iter().enumerate() {
            let actual: (String, String, f64, String) = native.query_row(
                "SELECT name, color, order_index, updated_at FROM board_columns WHERE id = ?1",
                [column["id"].as_str().unwrap()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            ).unwrap();
            assert_eq!((actual.0.as_str(), actual.1.as_str(), actual.2, actual.3.as_str()),
                (column["name"].as_str().unwrap(), column["color"].as_str().unwrap(), position as f64, time));
        }
        for profile in priorities {
            let actual: (String, String, String) = native.query_row(
                "SELECT name, color, updated_at FROM priority_profiles WHERE priority = ?1",
                [profile["priority"].as_i64().unwrap()],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            ).unwrap();
            assert_eq!((actual.0.as_str(), actual.1.as_str(), actual.2.as_str()),
                (profile["name"].as_str().unwrap(), profile["color"].as_str().unwrap(), time));
        }
    }

    /// Build a database on the pre-UUID schema (integer AUTOINCREMENT ids) with
    /// a few interlinked rows, exactly as an older install would have on disk.
    fn seed_legacy(conn: &Connection) {
        conn.execute_batch(
            "
            CREATE TABLE labels (
                id    INTEGER PRIMARY KEY AUTOINCREMENT,
                name  TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#6c7cff'
            );
            CREATE TABLE tasks (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                title        TEXT NOT NULL,
                notes        TEXT,
                due_date     TEXT,
                remind_at    TEXT,
                status       TEXT NOT NULL DEFAULT 'active',
                priority     INTEGER NOT NULL DEFAULT 4,
                created_at   TEXT NOT NULL,
                completed_at TEXT,
                order_index  REAL NOT NULL DEFAULT 0,
                notified     INTEGER NOT NULL DEFAULT 0,
                pinned       INTEGER NOT NULL DEFAULT 0,
                repeat       TEXT,
                subtasks     TEXT
            );
            CREATE TABLE task_labels (
                task_id  INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
                label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
                PRIMARY KEY (task_id, label_id)
            );
            CREATE TABLE time_sessions (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                start_at TEXT NOT NULL,
                end_at   TEXT,
                seconds  INTEGER,
                notified INTEGER NOT NULL DEFAULT 0
            );

            INSERT INTO labels (id, name, color) VALUES
                (1, 'home', '#111111'), (2, 'work', '#222222');
            INSERT INTO tasks (id, title, created_at, order_index) VALUES
                (10, 'buy milk', '2026-01-01T00:00:00+00:00', 1.0),
                (11, 'ship it',  '2026-01-02T00:00:00+00:00', 2.0);
            INSERT INTO task_labels (task_id, label_id) VALUES
                (10, 1), (11, 1), (11, 2);
            INSERT INTO time_sessions (id, task_id, start_at, end_at, seconds) VALUES
                (100, 11, '2026-01-02T09:00:00+00:00', '2026-01-02T09:30:00+00:00', 1800);
            ",
        )
        .unwrap();
    }

    #[test]
    fn integer_id_upgrade_preserves_reminders_and_running_sessions() {
        let dir = std::env::temp_dir().join(format!("todofy-legacy-schema-{}", new_uuid()));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("todofy.db");
        {
            let old = Connection::open(&path).unwrap();
            seed_legacy(&old);
            old.execute_batch(
                "ALTER TABLE tasks DROP COLUMN pinned;
                 ALTER TABLE tasks DROP COLUMN repeat;
                 ALTER TABLE tasks DROP COLUMN subtasks;",
            ).unwrap();
            old.execute("UPDATE tasks SET notified = 1 WHERE id = 11", []).unwrap();
            old.execute("UPDATE time_sessions SET end_at = NULL, seconds = NULL WHERE id = 100", []).unwrap();
        }

        let conn = Connection::open(&path).unwrap();
        init(&conn).unwrap();
        let (id, board_index, notified, last_notified, acknowledged):
            (String, f64, i64, Option<String>, Option<String>) = conn.query_row(
                "SELECT id, board_index, notified, last_notified_at, reminder_ack_at
                 FROM tasks WHERE title = 'ship it'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            ).unwrap();
        assert_eq!(id.len(), 36);
        assert_eq!((board_index, notified, last_notified), (2.0, 1, None));
        assert!(acknowledged.is_some(), "previously fired reminders must stay acknowledged");
        let (task_id, started, resumed): (String, String, Option<String>) = conn.query_row(
            "SELECT task_id, start_at, resumed_at FROM time_sessions WHERE end_at IS NULL",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(task_id, id);
        assert_eq!(resumed.as_deref(), Some(started.as_str()));
        let labels: i64 = conn.query_row("SELECT COUNT(*) FROM task_labels WHERE task_id = ?1", [&id], |row| row.get(0)).unwrap();
        assert_eq!(labels, 2);
        let violations: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| row.get(0)).unwrap();
        assert_eq!(violations, 0);
        let pinned_index: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_index_list('tasks') WHERE name = 'idx_tasks_pinned'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(pinned_index, 1);

        drop(conn);
        let reopened = Connection::open(&path).unwrap();
        init(&reopened).unwrap();
        let after: (String, Option<String>) = reopened.query_row(
            "SELECT id, reminder_ack_at FROM tasks WHERE title = 'ship it'",
            [], |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(after, (id, acknowledged));
        let reopened_session: (String, String, Option<String>) = reopened.query_row(
            "SELECT task_id, start_at, resumed_at FROM time_sessions WHERE end_at IS NULL",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(reopened_session, (task_id, started, resumed));
        drop(reopened);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn uuid_upgrade_without_pinned_preserves_existing_data() {
        let conn = Connection::open_in_memory().unwrap();
        seed_legacy(&conn);
        init(&conn).unwrap();
        let task_id: String = conn.query_row(
            "SELECT id FROM tasks WHERE title = 'ship it'", [], |row| row.get(0),
        ).unwrap();
        conn.execute_batch(
            "DROP INDEX idx_tasks_pinned;
             ALTER TABLE tasks DROP COLUMN pinned;
             ALTER TABLE tasks DROP COLUMN repeat;
             ALTER TABLE tasks DROP COLUMN subtasks;
             ALTER TABLE tasks DROP COLUMN last_notified_at;
             ALTER TABLE tasks DROP COLUMN reminder_ack_at;
             UPDATE tasks SET notified = 1 WHERE title = 'ship it';
             UPDATE time_sessions SET end_at = NULL, seconds = NULL, resumed_at = start_at;
             UPDATE board_columns SET name = 'Custom backlog' WHERE id = 'todo';
             UPDATE priority_profiles SET name = 'Urgent' WHERE priority = 1;
             INSERT INTO settings (key, value) VALUES ('old-setting', 'kept');
             INSERT INTO journal_entries (id, body, entry_date, created_at, updated_at)
                 VALUES ('journal', 'kept', '2026-01-01', 'now', 'now');",
        ).unwrap();

        init(&conn).unwrap();
        let task: (String, i64, Option<String>) = conn.query_row(
            "SELECT id, pinned, reminder_ack_at FROM tasks WHERE title = 'ship it'",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(task.0, task_id);
        assert_eq!(task.1, 0);
        assert!(task.2.is_some());
        let linked: i64 = conn.query_row(
            "SELECT COUNT(*) FROM task_labels WHERE task_id = ?1", [&task_id], |row| row.get(0),
        ).unwrap();
        assert_eq!(linked, 2);
        let session: (String, String, Option<String>) = conn.query_row(
            "SELECT task_id, start_at, resumed_at FROM time_sessions WHERE end_at IS NULL",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(session.0, task_id);
        assert_eq!(session.2.as_deref(), Some(session.1.as_str()));
        for (sql, expected) in [
            ("SELECT name FROM board_columns WHERE id = 'todo'", "Custom backlog"),
            ("SELECT name FROM priority_profiles WHERE priority = 1", "Urgent"),
            ("SELECT value FROM settings WHERE key = 'old-setting'", "kept"),
            ("SELECT body FROM journal_entries WHERE id = 'journal'", "kept"),
        ] {
            let actual: String = conn.query_row(sql, [], |row| row.get(0)).unwrap();
            assert_eq!(actual, expected);
        }
        init(&conn).unwrap();
        let acknowledged: Option<String> = conn.query_row(
            "SELECT reminder_ack_at FROM tasks WHERE id = ?1", [&task_id], |row| row.get(0),
        ).unwrap();
        assert_eq!(acknowledged, task.2);
    }

    /// Adding the column before `migrate_ids_to_uuid` would silently drop it
    /// on any database still using legacy integer ids.
    #[test]
    fn estimate_column_survives_the_uuid_rebuild() {
        let conn = Connection::open_in_memory().unwrap();
        seed_legacy(&conn);
        init(&conn).unwrap();

        assert!(
            column_exists(&conn, "tasks", "estimate_minutes"),
            "estimate_minutes must exist after migrating a legacy database"
        );
        // Usable, not merely present in the schema.
        conn.execute(
            "UPDATE tasks SET estimate_minutes = 45 WHERE title = 'ship it'",
            [],
        )
        .unwrap();
        let stored: Option<i64> = conn
            .query_row(
                "SELECT estimate_minutes FROM tasks WHERE title = 'ship it'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stored, Some(45));
    }

    /// Same hazard as the estimate: added after the UUID rebuild, which would
    /// otherwise drop them. `board_index` must also inherit the list order
    /// rather than collapsing every task to 0.
    #[test]
    fn board_columns_survive_the_uuid_rebuild_and_inherit_the_list_order() {
        let conn = Connection::open_in_memory().unwrap();
        seed_legacy(&conn);
        init(&conn).unwrap();

        assert!(column_exists(&conn, "tasks", "stage"));
        assert!(column_exists(&conn, "tasks", "board_index"));

        let seeded: Vec<(String, f64)> = conn
            .prepare("SELECT title, board_index FROM tasks ORDER BY board_index")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            seeded,
            vec![("buy milk".to_string(), 1.0), ("ship it".to_string(), 2.0)],
            "board_index must be backfilled from order_index, not left at 0"
        );
    }

    /// Running the migration twice must not fail on the already-added column.
    #[test]
    fn migration_is_idempotent_for_the_estimate_column() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        init(&conn).expect("re-running init must be a no-op");
        assert!(column_exists(&conn, "tasks", "estimate_minutes"));
    }

    #[test]
    fn migrates_integer_ids_to_uuids() {
        let conn = Connection::open_in_memory().unwrap();
        seed_legacy(&conn);
        init(&conn).unwrap();

        let id_type: String = conn
            .query_row(
                "SELECT type FROM pragma_table_info('tasks') WHERE name = 'id'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(id_type, "TEXT");

        let tasks: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        let labels: i64 = conn
            .query_row("SELECT COUNT(*) FROM labels", [], |r| r.get(0))
            .unwrap();
        let links: i64 = conn
            .query_row("SELECT COUNT(*) FROM task_labels", [], |r| r.get(0))
            .unwrap();
        let sessions: i64 = conn
            .query_row("SELECT COUNT(*) FROM time_sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!((tasks, labels, links, sessions), (2, 2, 3, 1));

        let task_id: String = conn
            .query_row("SELECT id FROM tasks WHERE title = 'ship it'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(task_id.len(), 36);

        let ship_labels: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_labels tl
                 JOIN tasks t ON t.id = tl.task_id
                 WHERE t.title = 'ship it'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ship_labels, 2);

        let session_task: String = conn
            .query_row(
                "SELECT t.title FROM time_sessions s JOIN tasks t ON t.id = s.task_id",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(session_task, "ship it");

        init(&conn).unwrap();
        let same: String = conn
            .query_row("SELECT id FROM tasks WHERE title = 'ship it'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(same, task_id);
    }

    #[test]
    fn adds_record_columns_and_backfills() {
        let conn = Connection::open_in_memory().unwrap();
        seed_legacy(&conn);
        init(&conn).unwrap();

        let (updated, deleted): (String, Option<String>) = conn
            .query_row(
                "SELECT updated_at, deleted_at FROM tasks WHERE title = 'buy milk'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(updated, "2026-01-01T00:00:00+00:00");
        assert_eq!(deleted, None);

        for table in ["labels", "time_sessions"] {
            let n: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE updated_at = ''"),
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 0, "{table} has un-backfilled updated_at");
        }
    }

    #[test]
    fn init_creates_journal_table_on_legacy_db() {
        let conn = Connection::open_in_memory().unwrap();
        seed_legacy(&conn);
        init(&conn).unwrap();

        assert!(table_exists(&conn, "journal_entries"));
        conn.execute(
            "INSERT INTO journal_entries (id, body, entry_date, created_at, updated_at)
             VALUES ('j1', 'hello', '2026-05-01', 'c', 'c')",
            [],
        )
        .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM journal_entries", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn standalone_upgrade_preserves_existing_local_data() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        assert!(!table_exists(&conn, "calendar_links"));
        conn.execute_batch(
            "CREATE TABLE calendar_links (
                 task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
                 external_event_id TEXT NOT NULL,
                 external_calendar_id TEXT NOT NULL,
                 pushed_updated_at TEXT NOT NULL,
                 deleted_at TEXT
             );
             INSERT INTO tasks (id, title, created_at, updated_at)
                 VALUES ('t1', 'Task', '2026-01-01', '2026-01-01');
             INSERT INTO calendar_links (task_id, external_event_id, external_calendar_id, pushed_updated_at)
                 VALUES ('t1', 'old-event', 'old-calendar', '2026-01-01');
             INSERT INTO labels (id, name, updated_at) VALUES ('l1', 'Label', '2026-01-01');
             INSERT INTO task_labels (task_id, label_id, updated_at)
                 VALUES ('t1', 'l1', '2026-01-01');
             INSERT INTO time_sessions (id, task_id, start_at, updated_at)
                 VALUES ('s1', 't1', '2026-01-01', '2026-01-01');
             INSERT INTO journal_entries (id, body, entry_date, created_at, updated_at)
                 VALUES ('j1', 'Journal', '2026-01-01', '2026-01-01', '2026-01-01');
             ALTER TABLE events ADD COLUMN source TEXT;
             INSERT INTO events (id, title, created_at, updated_at, source)
                 VALUES ('e1', 'Calendar event', '2026-01-01', '2026-01-01', 'google');
             UPDATE priority_profiles SET name = 'Important' WHERE priority = 1;
             INSERT INTO settings (key, value) VALUES ('reminder_sound_data_p1', 'sound-bytes');",
        )
        .unwrap();

        init(&conn).unwrap();

        for table in [
            "tasks", "labels", "task_labels", "time_sessions", "journal_entries", "events",
        ] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 1, "{table} should retain its local record");
        }
        let preserved: (String, String, String, String, String, String) = conn
            .query_row(
                "SELECT t.title, l.name, j.body, e.title, p.name, s.value
                 FROM tasks t JOIN task_labels tl ON tl.task_id = t.id
                 JOIN labels l ON l.id = tl.label_id
                 JOIN time_sessions ts ON ts.task_id = t.id
                 CROSS JOIN journal_entries j CROSS JOIN events e
                 CROSS JOIN priority_profiles p CROSS JOIN settings s
                 WHERE p.priority = 1 AND s.key = 'reminder_sound_data_p1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .unwrap();
        assert_eq!(preserved, (
            "Task".into(), "Label".into(), "Journal".into(), "Calendar event".into(),
            "Important".into(), "sound-bytes".into(),
        ));
    }

    #[test]
    fn delete_is_a_tombstone() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at) VALUES ('t1', 'x', 'c', 'c')",
            [],
        )
        .unwrap();

        conn.execute(
            "UPDATE tasks SET deleted_at = 'now', updated_at = 'now' WHERE id = 't1'",
            [],
        )
        .unwrap();

        let live: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!((live, total), (0, 1));
    }

    #[test]
    fn init_repairs_live_children_of_deleted_parents() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO labels (id, name, color, updated_at)
                 VALUES ('l1', 'home', '#fff', '2026-01-01T00:00:00Z');
             INSERT INTO tasks (id, title, created_at, updated_at, deleted_at)
                 VALUES ('t1', 'gone', '2026-01-01T00:00:00Z',
                         '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z');
             INSERT INTO task_labels (task_id, label_id, updated_at)
                 VALUES ('t1', 'l1', '2026-01-01T00:00:00Z');
             INSERT INTO time_sessions (id, task_id, start_at, updated_at)
                 VALUES ('s1', 't1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');",
        )
        .unwrap();

        init(&conn).unwrap();

        for table in ["task_labels", "time_sessions"] {
            let repaired: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE deleted_at IS NOT NULL"),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(repaired, 1, "{table} was not repaired");
        }
    }

    /// A checkpointed `todofy.db` must stand on its own: users (and we, in bug
    /// reports) copy that single file and expect their tasks to be in it.
    #[test]
    fn checkpoint_leaves_a_self_contained_main_file() {
        // Per-run, not per-pid: pids recycle, and a leaked dir from an earlier
        // failed run would fail the INSERT below on a duplicate id.
        let dir = std::env::temp_dir().join(format!("todofy-ckpt-{}", new_uuid()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("todofy.db");

        let conn = Connection::open(&path).unwrap();
        init(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at)
             VALUES ('t1', 'buy milk', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        checkpoint(&conn);

        // Copy only the main file, the way someone grabbing "the database" would.
        let copy = dir.join("copy.db");
        std::fs::copy(&path, &copy).unwrap();
        let copied = Connection::open(&copy).unwrap();
        let title: String = copied
            .query_row("SELECT title FROM tasks WHERE id = 't1'", [], |row| {
                row.get(0)
            })
            .expect("main file is missing data still held in the WAL");
        assert_eq!(title, "buy milk");

        drop(copied);
        drop(conn);
        std::fs::remove_dir_all(&dir).ok();
    }
}
