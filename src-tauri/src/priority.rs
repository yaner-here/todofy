//! Native reminder support and schema bootstrap. Profile editing and public
//! profile models are owned by TypeScript.
use rusqlite::{params, Connection, OptionalExtension};

fn defaults() -> &'static [serde_json::Value] {
    crate::seeds::data()["priorities"].as_array().expect("missing priority defaults")
}

fn default_profile(priority: i64) -> Option<(&'static str, &'static str)> {
    let profile = defaults().iter().find(|profile| profile["priority"].as_i64() == Some(priority))?;
    Some((profile["name"].as_str()?, profile["color"].as_str()?))
}

pub struct NativePriority {
    pub priority: i64,
    name: String,
    color: String,
}

pub fn init(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS priority_profiles (
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
        );",
    )?;
    let time = crate::seeds::data()["seedTime"].as_str().expect("missing seed time");
    for profile in defaults() {
        let priority = profile["priority"].as_i64().expect("missing priority");
        let (name, color) = default_profile(priority).expect("invalid priority defaults");
        conn.execute(
            "INSERT OR IGNORE INTO priority_profiles (priority, name, color, updated_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![priority, name, color, time],
        )?;
    }
    Ok(())
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<NativePriority>> {
    let mut stmt = conn.prepare("SELECT priority, name, color FROM priority_profiles ORDER BY priority")?;
    let rows = stmt.query_map([], |row| Ok(NativePriority {
        priority: row.get(0)?, name: row.get(1)?, color: row.get(2)?,
    }))?.collect();
    rows
}

fn is_customized(profile: &NativePriority) -> bool {
    default_profile(profile.priority)
        .is_none_or(|(name, color)| profile.name != name || !profile.color.eq_ignore_ascii_case(color))
}

pub fn reminder_label(profile: Option<&NativePriority>) -> String {
    match profile {
        Some(p) if is_customized(p) => {
            if default_profile(p.priority).is_some_and(|(name, _)| name == p.name) {
                rust_i18n::t!("common.priority", priority = p.priority).to_string()
            } else {
                p.name.clone()
            }
        }
        _ => rust_i18n::t!("notifications.reminder").to_string(),
    }
}

pub fn reminder_accent(profile: Option<&NativePriority>) -> String {
    match profile {
        Some(p) if is_customized(p) => p.color.clone(),
        _ => String::new(),
    }
}

#[derive(Debug, PartialEq)]
pub struct Resolved {
    pub style: String,
    pub repeat_minutes: Option<i64>,
}

/// Background reminders continue even with the main window hidden.
pub fn resolve(conn: &Connection, priority: i64) -> Resolved {
    let global = Resolved {
        style: crate::settings::notification_style(conn),
        repeat_minutes: crate::settings::reminder_repeat_minutes(conn),
    };
    let row: Option<(Option<String>, Option<i64>)> = conn
        .query_row(
            "SELECT notification_style, repeat_minutes FROM priority_profiles WHERE priority = ?1",
            [priority], |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional().ok().flatten();
    let Some((style, repeat_minutes)) = row else { return global };
    Resolved {
        style: style.unwrap_or(global.style),
        repeat_minutes: match repeat_minutes {
            Some(0) => None,
            Some(minutes) => Some(minutes),
            None => global.repeat_minutes,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_reminders_keep_global_and_per_priority_overrides() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init(&conn).unwrap();
        crate::settings::write(&conn, "notification_style", "native").unwrap();
        crate::settings::write(&conn, "reminder_repeat_minutes", "10").unwrap();
        assert_eq!(resolve(&conn, 2), Resolved { style: "native".into(), repeat_minutes: Some(10) });
        assert_eq!(resolve(&conn, 9).style, "native");
        conn.execute("UPDATE priority_profiles SET notification_style='custom', repeat_minutes=0 WHERE priority=1", []).unwrap();
        assert_eq!(resolve(&conn, 1), Resolved { style: "custom".into(), repeat_minutes: None });
        conn.execute("UPDATE priority_profiles SET name='Urgent', color='#123456' WHERE priority=1", []).unwrap();
        let profiles = list(&conn).unwrap();
        let first = profiles.iter().find(|profile| profile.priority == 1).unwrap();
        assert_eq!(reminder_label(Some(first)), "Urgent");
        assert_eq!(reminder_accent(Some(first)), "#123456");
        init(&conn).unwrap();
        assert_eq!(list(&conn).unwrap()[0].name, "Urgent");
    }
}
