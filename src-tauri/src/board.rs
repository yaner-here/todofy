//! Persistent board definitions. Column identity is independent of its name
//! and display order. Deleted definitions retain their replacement so tasks
//! that still reference them can be displayed safely.
use crate::db::{new_uuid, Db};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::State;

pub const TODO: &str = "todo";
pub const DONE: &str = "done";
pub const SEED_TIME: &str = "1970-01-01T00:00:01Z";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardColumn {
    pub id: String,
    pub name: String,
    pub color: String,
    pub order_index: f64,
    pub wip_limit: Option<i64>,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub replacement_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInput {
    pub name: String,
    pub color: String,
    pub wip_limit: Option<i64>,
}

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
    for (id, name, color, position) in [
        (TODO, "To do", "#6c7cff", 0.0),
        ("doing", "In progress", "#38bdf8", 1.0),
        ("blocked", "Blocked", "#f2b155", 2.0),
        (DONE, "Done", "#4fd18b", 3.0),
    ] {
        conn.execute(
            "INSERT OR IGNORE INTO board_columns
             (id, name, color, order_index, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, color, position, SEED_TIME],
        )?;
    }
    Ok(())
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<BoardColumn>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, order_index, wip_limit, updated_at, deleted_at, replacement_id
         FROM board_columns ORDER BY (id = 'done'), order_index, id",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(BoardColumn {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                order_index: r.get(3)?,
                wip_limit: r.get(4)?,
                updated_at: r.get(5)?,
                deleted_at: r.get(6)?,
                replacement_id: r.get(7)?,
            })
        })?
        .collect();
    rows
}

pub fn resolve_stage<'a>(stage: Option<&str>, columns: &'a [BoardColumn]) -> &'a str {
    let mut id = stage.unwrap_or(TODO);
    let mut seen = HashSet::new();
    while seen.insert(id) {
        match columns.iter().find(|c| c.id == id && c.id != DONE) {
            Some(c) if c.deleted_at.is_none() => return &c.id,
            Some(c) => id = c.replacement_id.as_deref().unwrap_or(TODO),
            None => return TODO,
        }
    }
    TODO
}

fn invalid(message: &str) -> rusqlite::Error {
    rusqlite::Error::InvalidParameterName(message.into())
}

pub fn validate(input: &ColumnInput) -> rusqlite::Result<()> {
    if input.name.trim().is_empty() || input.name.trim().chars().count() > 60 {
        return Err(invalid(&rust_i18n::t!("validation.columnName").to_string()));
    }
    if input.color.len() != 7
        || !input.color.starts_with('#')
        || !input.color[1..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(invalid(&rust_i18n::t!("validation.color").to_string()));
    }
    if input.wip_limit.is_some_and(|n| !(1..=9999).contains(&n)) {
        return Err(invalid(&rust_i18n::t!("validation.wip").to_string()));
    }
    Ok(())
}

#[tauri::command]
pub fn list_board_columns(db: State<Db>) -> Result<Vec<BoardColumn>, String> {
    list(&db.conn()).map_err(|e| e.to_string())
}

pub fn create(conn: &Connection, input: &ColumnInput) -> rusqlite::Result<Vec<BoardColumn>> {
    validate(input)?;
    let position: f64 = conn.query_row(
        "SELECT coalesce(max(order_index), -1) + 1 FROM board_columns
         WHERE deleted_at IS NULL AND id != 'done'",
        [],
        |r| r.get(0),
    )?;
    conn.execute(
        "INSERT INTO board_columns (id, name, color, order_index, wip_limit, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            new_uuid(),
            input.name.trim(),
            input.color.to_lowercase(),
            position,
            input.wip_limit,
            chrono::Utc::now().to_rfc3339()
        ],
    )?;
    list(conn)
}

#[tauri::command]
pub fn create_board_column(db: State<Db>, input: ColumnInput) -> Result<Vec<BoardColumn>, String> {
    create(&db.conn(), &input).map_err(|e| e.to_string())
}

pub fn update(
    conn: &Connection,
    id: &str,
    input: &ColumnInput,
) -> rusqlite::Result<Vec<BoardColumn>> {
    validate(input)?;
    if id == DONE && input.wip_limit.is_some() {
        return Err(invalid(&rust_i18n::t!("validation.doneWip").to_string()));
    }
    let changed = conn.execute(
        "UPDATE board_columns SET name = ?1, color = ?2, wip_limit = ?3, updated_at = ?4
         WHERE id = ?5 AND deleted_at IS NULL",
        params![
            input.name.trim(),
            input.color.to_lowercase(),
            input.wip_limit,
            chrono::Utc::now().to_rfc3339(),
            id
        ],
    )?;
    if changed == 0 {
        return Err(invalid(&rust_i18n::t!("validation.missingColumn").to_string()));
    }
    list(conn)
}

#[tauri::command]
pub fn update_board_column(
    db: State<Db>,
    id: String,
    input: ColumnInput,
) -> Result<Vec<BoardColumn>, String> {
    update(&db.conn(), &id, &input).map_err(|e| e.to_string())
}

pub fn reorder(conn: &mut Connection, ids: &[String]) -> rusqlite::Result<Vec<BoardColumn>> {
    let tx = conn.transaction()?;
    let live: HashSet<String> = list(&tx)?
        .into_iter()
        .filter(|c| c.deleted_at.is_none())
        .map(|c| c.id)
        .collect();
    let requested: HashSet<String> = ids.iter().cloned().collect();
    if ids.len() != live.len() || requested != live || ids.last().map(String::as_str) != Some(DONE)
    {
        return Err(invalid(&rust_i18n::t!("validation.columnOrder").to_string(),
        ));
    }
    let now = chrono::Utc::now().to_rfc3339();
    for (position, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE board_columns SET order_index = ?1, updated_at = ?2 WHERE id = ?3",
            params![position as f64, now, id],
        )?;
    }
    let result = list(&tx)?;
    tx.commit()?;
    Ok(result)
}

#[tauri::command]
pub fn reorder_board_columns(db: State<Db>, ids: Vec<String>) -> Result<Vec<BoardColumn>, String> {
    reorder(&mut db.conn(), &ids).map_err(|e| e.to_string())
}

pub fn delete(
    conn: &mut Connection,
    id: &str,
    replacement: &str,
) -> rusqlite::Result<Vec<BoardColumn>> {
    if id == TODO || id == DONE {
        return Err(invalid(&rust_i18n::t!("validation.protectedColumns").to_string()));
    }
    let tx = conn.transaction()?;
    let columns = list(&tx)?;
    if !columns.iter().any(|c| c.id == id && c.deleted_at.is_none())
        || !columns
            .iter()
            .any(|c| c.id == replacement && c.id != DONE && c.id != id && c.deleted_at.is_none())
    {
        return Err(invalid(&rust_i18n::t!("validation.columnDestination").to_string(),
        ));
    }
    // Both active and completed tasks retain a valid remembered stage. Append
    // the moved tasks after destination cards without touching list ordering.
    let mut tasks = tx.prepare("SELECT id, stage, board_index FROM tasks WHERE deleted_at IS NULL ORDER BY board_index, id")?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, f64>(2)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut last = tasks
        .iter()
        .filter(|(_, s, _)| resolve_stage(s.as_deref(), &columns) == replacement)
        .map(|(_, _, n)| *n)
        .fold(-1.0_f64, f64::max);
    let now = chrono::Utc::now().to_rfc3339();
    for (task_id, stage, _) in tasks.drain(..) {
        if resolve_stage(stage.as_deref(), &columns) == id {
            last += 1.0;
            tx.execute(
                "UPDATE tasks SET stage = ?1, board_index = ?2, updated_at = ?3 WHERE id = ?4",
                params![replacement, last, now, task_id],
            )?;
        }
    }
    tx.execute("UPDATE board_columns SET deleted_at = ?1, updated_at = ?1, replacement_id = ?2 WHERE id = ?3",
        params![now, replacement, id])?;
    let result = list(&tx)?;
    tx.commit()?;
    Ok(result)
}

#[tauri::command]
pub fn delete_board_column(
    db: State<Db>,
    id: String,
    replacement_id: String,
) -> Result<Vec<BoardColumn>, String> {
    delete(&mut db.conn(), &id, &replacement_id).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::init(&c).unwrap();
        c
    }
    fn input() -> ColumnInput {
        ColumnInput {
            name: "Review".into(),
            color: "#38bdf8".into(),
            wip_limit: Some(3),
        }
    }
    #[test]
    fn migration_preserves_customizations_and_deleted_defaults() {
        let mut c = setup();
        update(&c, TODO, &input()).unwrap();
        delete(&mut c, "blocked", TODO).unwrap();
        crate::db::init(&c).unwrap();
        let rows = list(&c).unwrap();
        assert_eq!(rows.iter().find(|x| x.id == TODO).unwrap().name, "Review");
        assert!(rows
            .iter()
            .find(|x| x.id == "blocked")
            .unwrap()
            .deleted_at
            .is_some());
    }
    #[test]
    fn renaming_preserves_identity_and_reordering_keeps_fallback_fixed() {
        let mut c = setup();
        create(&c, &input()).unwrap();
        let custom = list(&c)
            .unwrap()
            .into_iter()
            .find(|x| x.name == "Review")
            .unwrap();
        update(
            &c,
            &custom.id,
            &ColumnInput {
                name: "QA".into(),
                ..input()
            },
        )
        .unwrap();
        let ids = vec![
            custom.id.clone(),
            "doing".into(),
            "blocked".into(),
            TODO.into(),
            DONE.into(),
        ];
        reorder(&mut c, &ids).unwrap();
        assert_eq!(resolve_stage(None, &list(&c).unwrap()), TODO);
        assert!(reorder(&mut c, &[TODO.into(), DONE.into()]).is_err());
    }
    #[test]
    fn deleting_moves_active_and_completed_tasks_and_preserves_list_order() {
        let mut c = setup();
        for (id, status, index) in [("a", "active", 2.0), ("b", "done", 4.0)] {
            c.execute("INSERT INTO tasks(id,title,status,stage,order_index,created_at,updated_at) VALUES(?1,?1,?2,'blocked',?3,'2026-01-01Z','2026-01-01Z')", params![id,status,index]).unwrap();
        }
        delete(&mut c, "blocked", "doing").unwrap();
        let tasks: Vec<(String, f64)> = c
            .prepare("SELECT stage,order_index FROM tasks ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(tasks, vec![("doing".into(), 2.0), ("doing".into(), 4.0)]);
        assert_eq!(resolve_stage(Some("blocked"), &list(&c).unwrap()), "doing");
        assert!(delete(&mut c, TODO, "doing").is_err());
        assert!(delete(&mut c, DONE, "doing").is_err());
    }
    #[test]
    fn validation_rejects_invalid_columns_and_done_limits() {
        let c = setup();
        assert!(create(
            &c,
            &ColumnInput {
                wip_limit: Some(0),
                ..input()
            }
        )
        .is_err());
        assert!(create(
            &c,
            &ColumnInput {
                color: "red".into(),
                ..input()
            }
        )
        .is_err());
        assert!(update(&c, DONE, &input()).is_err());
    }
}
