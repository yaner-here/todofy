//! Schema bootstrap for board definitions. Board behavior lives in TypeScript.
use rusqlite::{params, Connection};

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS board_columns (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
            order_index REAL NOT NULL, wip_limit INTEGER CHECK(wip_limit > 0 AND wip_limit <= 9999),
            updated_at TEXT NOT NULL, deleted_at TEXT, replacement_id TEXT,
            CHECK(id NOT IN ('todo', 'done') OR deleted_at IS NULL),
            CHECK(id != 'done' OR wip_limit IS NULL)
        );",
    )?;
    let defaults = crate::seeds::data();
    let time = defaults["seedTime"].as_str().expect("missing seed time");
    for (position, column) in defaults["board"].as_array().expect("missing board defaults").iter().enumerate() {
        let id = column["id"].as_str().expect("missing board id");
        let name = column["name"].as_str().expect("missing board name");
        let color = column["color"].as_str().expect("missing board color");
        conn.execute(
            "INSERT OR IGNORE INTO board_columns
             (id, name, color, order_index, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, color, position as f64, time],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializing_again_preserves_edits_and_tombstones() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn.execute("UPDATE board_columns SET name = 'Review' WHERE id = 'todo'", []).unwrap();
        conn.execute("UPDATE board_columns SET deleted_at = 'now', replacement_id = 'todo' WHERE id = 'blocked'", []).unwrap();
        init(&conn).unwrap();
        let name: String = conn.query_row("SELECT name FROM board_columns WHERE id = 'todo'", [], |row| row.get(0)).unwrap();
        let deleted: Option<String> = conn.query_row("SELECT deleted_at FROM board_columns WHERE id = 'blocked'", [], |row| row.get(0)).unwrap();
        assert_eq!(name, "Review");
        assert_eq!(deleted.as_deref(), Some("now"));
    }
}
