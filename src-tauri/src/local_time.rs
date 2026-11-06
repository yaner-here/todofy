//! Convert reminder wall times using the same system timezone as the scheduler.
use chrono::{DateTime, Local, LocalResult, NaiveDate, NaiveTime, TimeZone};
use serde::Serialize;

#[derive(Serialize)]
pub struct LocalReminderTime {
    date: String,
    time: String,
}

#[tauri::command]
pub fn local_reminder_parts(timestamp: String) -> Option<LocalReminderTime> {
    let local = DateTime::parse_from_rfc3339(&timestamp).ok()?.with_timezone(&Local);
    Some(LocalReminderTime {
        date: local.format("%Y-%m-%d").to_string(),
        time: local.format("%H:%M:%S%.f").to_string(),
    })
}

#[tauri::command]
pub fn local_reminder_timestamp(date: String, time: String) -> Option<String> {
    let date = NaiveDate::parse_from_str(&date, "%Y-%m-%d").ok()?;
    let time = NaiveTime::parse_from_str(&time, "%H:%M:%S%.f").ok()?;
    let local = date.and_time(time);
    earliest_local(Local.from_local_datetime(&local)).map(|timestamp| timestamp.to_rfc3339())
}

fn earliest_local<T>(candidate: LocalResult<T>) -> Option<T> {
    match candidate {
        LocalResult::Single(timestamp) | LocalResult::Ambiguous(timestamp, _) => Some(timestamp),
        LocalResult::None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_parts_preserve_subseconds_and_leap_seconds() {
        for timestamp in ["2026-11-06 08:30:00.123456789+08:00", "2016-12-31T23:59:60.1Z"] {
            let parts = local_reminder_parts(timestamp.into()).unwrap();
            let round_trip = local_reminder_timestamp(parts.date, parts.time).unwrap();
            assert_eq!(DateTime::parse_from_rfc3339(&round_trip).unwrap(), DateTime::parse_from_rfc3339(timestamp).unwrap());
        }
        assert!(local_reminder_parts("invalid".into()).is_none());
        assert!(local_reminder_timestamp("2026-02-30".into(), "12:00:00".into()).is_none());
    }

    #[test]
    fn local_resolution_rejects_skipped_times_and_picks_the_earlier_overlap() {
        assert_eq!(earliest_local(LocalResult::Single(3)), Some(3));
        assert_eq!(earliest_local(LocalResult::Ambiguous(1, 2)), Some(1));
        assert_eq!(earliest_local::<i32>(LocalResult::None), None);
    }
}
