//! A narrow, atomic transport for the TypeScript CRUD implementation.
//!
//! SQL comes from a compile-time allowlist shared with the frontend, never
//! from an IPC argument. The existing connection and mutex keep each batch
//! isolated from the scheduler, tray and the other windows.
use crate::db::Db;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::Deserialize;
use serde_json::{Map, Number, Value};
use std::collections::HashMap;
use std::sync::OnceLock;
use tauri::{Emitter, Manager, Runtime, State, WebviewWindow};

const CONFLICT: &str = "todofy:crud-conflict";
type Row = Map<String, Value>;

#[derive(Deserialize)]
struct QueryDefinition {
    read: bool,
    sql: String,
}

#[derive(Deserialize)]
pub struct Operation {
    statement: String,
    #[serde(default)]
    params: Vec<Value>,
    /// If present, abort and roll back unless this query still has these rows.
    expected: Option<Vec<Row>>,
}

fn query_definitions() -> &'static HashMap<String, QueryDefinition> {
    static QUERIES: OnceLock<HashMap<String, QueryDefinition>> = OnceLock::new();
    QUERIES.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/data/crud-queries.json"))
            .expect("invalid CRUD query allowlist")
    })
}

fn allowed(window: &str, name: &str) -> bool {
    match window {
        "main" => true,
        "quickadd" => matches!(name, "label.list" | "priority.list" | "task.insert" | "task.upsertLabel" | "task.get"),
        "notification" => matches!(name, "task.due" | "task.remind" | "task.touch" | "task.get"),
        _ => false,
    }
}

fn sql_parameter(input: &Value) -> Result<SqlValue, String> {
    match input {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(value) => Ok(SqlValue::Integer(if *value { 1 } else { 0 })),
        Value::Number(value) => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| value.as_f64().map(SqlValue::Real))
            .ok_or_else(|| "Invalid database number".to_string()),
        Value::String(value) => Ok(SqlValue::Text(value.clone())),
        _ => Err("Invalid database parameter".to_string()),
    }
}

fn sql_value_to_json(input: ValueRef<'_>) -> Result<Value, String> {
    match input {
        ValueRef::Null => Ok(Value::Null),
        ValueRef::Integer(value) => Ok(Value::Number(value.into())),
        ValueRef::Real(value) => Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| "Invalid database number".to_string()),
        ValueRef::Text(value) => std::str::from_utf8(value)
            .map(|s| Value::String(s.to_owned()))
            .map_err(|error| error.to_string()),
        ValueRef::Blob(_) => Err("Unexpected database blob".to_string()),
    }
}

fn rows_match(left: &[Row], right: &[Row]) -> bool {
    left.len() == right.len() && left.iter().zip(right).all(|(a, b)| {
        a.len() == b.len() && a.iter().all(|(key, value)| {
            b.get(key).is_some_and(|other| {
                value == other || matches!((value, other), (Value::Number(a), Value::Number(b)) if a.as_f64() == b.as_f64())
            })
        })
    })
}

fn query_rows(conn: &Connection, sql: &str, params: &[SqlValue]) -> Result<Vec<Row>, String> {
    let mut stmt = conn.prepare(sql).map_err(|error| error.to_string())?;
    let names = stmt.column_names().iter().map(|name| (*name).to_owned()).collect::<Vec<_>>();
    let mut cursor = stmt.query(params_from_iter(params.iter())).map_err(|error| error.to_string())?;
    let mut rows = Vec::new();
    while let Some(row) = cursor.next().map_err(|error| error.to_string())? {
        let mut fields = Row::new();
        for (index, name) in names.iter().enumerate() {
            fields.insert(name.clone(), sql_value_to_json(row.get_ref(index).map_err(|error| error.to_string())?)?);
        }
        rows.push(fields);
    }
    Ok(rows)
}

fn execute_operation(conn: &Connection, window: &str, operation: &Operation) -> Result<Vec<Row>, String> {
    if !allowed(window, &operation.statement) {
        return Err("CRUD operation is not allowed for this window".into());
    }
    let query = query_definitions().get(&operation.statement).ok_or("Unknown CRUD operation")?;
    let params = operation.params.iter().map(sql_parameter).collect::<Result<Vec<_>, _>>()?;
    if query.read {
        let rows = query_rows(conn, &query.sql, &params)?;
        if operation.expected.as_ref().is_some_and(|expected| !rows_match(&rows, expected)) {
            return Err(CONFLICT.into());
        }
        return Ok(rows);
    }
    if operation.expected.is_some() {
        return Err("A write cannot be used as a CRUD precondition".into());
    }
    conn.execute(&query.sql, params_from_iter(params.iter())).map_err(|error| error.to_string())?;
    Ok(Vec::new())
}

fn run_operations(conn: &mut Connection, window: &str, operations: &[Operation]) -> Result<Vec<Vec<Row>>, String> {
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let responses = operations.iter().map(|operation| execute_operation(&tx, window, operation)).collect::<Result<Vec<_>, _>>()?;
    tx.commit().map_err(|error| error.to_string())?;
    Ok(responses)
}

#[tauri::command]
pub fn run_crud<R: Runtime>(window: WebviewWindow<R>, db: State<Db>, operations: Vec<Operation>) -> Result<Vec<Vec<Row>>, String> {
    let rows = run_operations(&mut db.conn(), window.label(), &operations)?;
    // The notification webview hides immediately after snoozing and may stop
    // running before a JavaScript promise can notify the main window.
    if window.label() == "notification" && operations.iter().any(|operation| operation.statement == "task.remind") {
        if let Err(error) = window.app_handle().emit("tasks-changed", ()) {
            eprintln!("[crud] could not broadcast snoozed task: {error}");
        }
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use serde_json::json;

    fn op(statement: &str, params: Vec<Value>) -> Operation {
        Operation { statement: statement.into(), params, expected: None }
    }

    #[test]
    fn failed_batch_rolls_back_and_only_allows_named_statements() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let insert = op("label.insert", vec![json!("l1"), json!("Home"), json!("#fff"), json!("2026-01-01T00:00:00Z")]);
        let unknown = op("DROP TABLE labels", vec![]);
        assert!(run_operations(&mut conn, "main", &[insert, unknown]).is_err());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM labels", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
        assert!(run_operations(&mut conn, "notification", &[op("label.list", vec![])]).is_err());
        assert!(run_operations(&mut conn, "quickadd", &[op("label.delete", vec![json!("now"), json!("l1")])]).is_err());
        assert_eq!(run_operations(&mut conn, "quickadd", &[op("priority.list", vec![])]).unwrap()[0].len(), 4);
        assert!(run_operations(&mut conn, "quickadd", &[op("priority.update", vec![])]).is_err());
    }

    #[test]
    fn stale_precondition_rolls_back_the_entire_batch() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        let insert = op("label.insert", vec![json!("l1"), json!("Home"), json!("#fff"), json!("2026-01-01T00:00:00Z")]);
        let check = Operation { statement: "label.list".into(), params: vec![], expected: Some(vec![]) };
        assert_eq!(run_operations(&mut conn, "main", &[insert, check]).unwrap_err(), CONFLICT);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM labels", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn every_allowed_statement_prepares_against_the_current_schema() {
        let conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        for (name, query) in query_definitions() {
            let stmt = conn.prepare(&query.sql).unwrap_or_else(|error| panic!("{name}: {error}"));
            assert_eq!(stmt.readonly(), query.read, "{name} has the wrong read/write designation");
        }
    }

    #[test]
    fn quick_add_and_notification_use_the_same_database() {
        let mut conn = Connection::open_in_memory().unwrap();
        db::init(&conn).unwrap();
        run_operations(&mut conn, "main", &[op("label.insert", vec![json!("label"), json!("Home"), json!("#fff"), json!("now")])]).unwrap();
        let result = run_operations(&mut conn, "quickadd", &[
            op("task.insert", vec![json!("task"), json!("Read"), Value::Null, Value::Null, Value::Null, json!(4), json!("now"), json!(0), Value::Null, Value::Null]),
            op("task.upsertLabel", vec![json!("task"), json!("label"), json!("now")]),
            op("task.get", vec![json!("task")]),
        ]).unwrap();
        assert_eq!(result[2][0]["labelIds"], json!("[\"label\"]"));
        conn.execute("UPDATE tasks SET notified = 2, reminder_ack_at = 'old' WHERE id = 'task'", []).unwrap();
        run_operations(&mut conn, "notification", &[
            op("task.due", vec![json!("2026-11-06"), json!("task")]),
            op("task.remind", vec![json!("2026-11-06T09:00:00Z"), json!("task")]),
            op("task.touch", vec![json!("now"), json!("task")]),
            op("task.get", vec![json!("task")]),
        ]).unwrap();
        let state: (i64, Option<String>) = conn.query_row(
            "SELECT notified, reminder_ack_at FROM tasks WHERE id = 'task'", [], |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(state, (0, None));
    }
}
