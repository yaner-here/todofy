//! Seed board definitions. Board behavior lives in TypeScript.
use rusqlite::{params, Connection};

pub fn seed(conn: &Connection) -> rusqlite::Result<()> {
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
        crate::db::init(&conn).unwrap();
        conn.execute("UPDATE board_columns SET name = 'Review' WHERE id = 'todo'", []).unwrap();
        conn.execute("UPDATE board_columns SET deleted_at = 'now', replacement_id = 'todo' WHERE id = 'blocked'", []).unwrap();
        seed(&conn).unwrap();
        let name: String = conn.query_row("SELECT name FROM board_columns WHERE id = 'todo'", [], |row| row.get(0)).unwrap();
        let deleted: Option<String> = conn.query_row("SELECT deleted_at FROM board_columns WHERE id = 'blocked'", [], |row| row.get(0)).unwrap();
        assert_eq!(name, "Review");
        assert_eq!(deleted.as_deref(), Some("now"));
    }
}
