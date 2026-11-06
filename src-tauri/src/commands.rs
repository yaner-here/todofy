use crate::db::Db;
use chrono::Local;
use rusqlite::{params, Connection};
use tauri::State;

type CmdResult<T> = Result<T, String>;

fn now_iso() -> String {
    Local::now().to_rfc3339()
}

/// Stop a reminder repeating. Called when a notification is opened, dismissed
/// by hand or snoozed, and when a timer is started on the task.
///
/// Deliberately not called when a popup times out unseen — counting that as an
/// answer would defeat the feature.
pub fn acknowledge_reminder_inner(conn: &Connection, id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE tasks SET reminder_ack_at = ?1 WHERE id = ?2 AND reminder_ack_at IS NULL",
        params![now_iso(), id],
    )?;
    Ok(())
}

#[tauri::command]
pub fn acknowledge_reminder(db: State<Db>, id: String) -> CmdResult<()> {
    acknowledge_reminder_inner(&db.conn(), &id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod command_tests {
    use super::acknowledge_reminder_inner;
    use crate::db;
    use rusqlite::Connection;

    /// A second answer must not move the timestamp.
    #[test]
    fn acknowledging_a_reminder_records_it_once() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, title, created_at, updated_at, notified)
             VALUES ('t1', 'call the bank', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 2)",
            [],
        )
        .unwrap();

        let ack = |c: &Connection| -> Option<String> {
            c.query_row(
                "SELECT reminder_ack_at FROM tasks WHERE id = 't1'",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(ack(&conn), None, "not answered yet");

        acknowledge_reminder_inner(&conn, "t1").unwrap();
        let first = ack(&conn).expect("answering must be recorded");

        acknowledge_reminder_inner(&conn, "t1").unwrap();
        assert_eq!(ack(&conn), Some(first), "answering twice changes nothing");
    }

    /// Upgrading must not turn every reminder ever fired into an unanswered one.
    #[test]
    fn existing_reminders_are_treated_as_already_answered() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        // The pre-repeat table shape, with one task in each state.
        conn.execute_batch(
            "
            DROP TABLE tasks;
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
                subtasks     TEXT,
                updated_at   TEXT NOT NULL,
                deleted_at   TEXT
            );
            INSERT INTO tasks (id, title, created_at, updated_at, notified)
                 VALUES ('fired', 'old reminder', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1),
                        ('waiting', 'not yet', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0);
            ",
        )
        .unwrap();

        db::init(&conn).unwrap();

        let ack = |id: &str| -> Option<String> {
            conn.query_row(
                "SELECT reminder_ack_at FROM tasks WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert!(ack("fired").is_some(), "already-fired reminders stay quiet");
        assert_eq!(ack("waiting"), None, "a pending reminder can still fire");
    }
}
