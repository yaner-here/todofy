//! Read UTC offsets from the same operating-system timezone as the scheduler.
//! Recurrence and ambiguous/nonexistent wall-time handling live in TypeScript.
use chrono::{DateTime, Local, Offset, TimeZone, Utc};

#[tauri::command]
pub fn timezone_offsets(seconds: Vec<i64>) -> Result<Vec<Option<i32>>, String> {
    if seconds.len() > 64 { return Err("Too many timezone queries".into()); }
    Ok(seconds.into_iter().map(|seconds| {
        let instant = DateTime::<Utc>::from_timestamp(seconds, 0)?;
        std::panic::catch_unwind(|| {
            Local.offset_from_utc_datetime(&instant.naive_utc()).fix().local_minus_utc()
        }).ok()
    }).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_the_scheduler_timezone_offset_for_each_instant() {
        let instant = 1_793_961_600;
        let expected = DateTime::<Utc>::from_timestamp(instant, 0).unwrap().with_timezone(&Local)
            .offset().local_minus_utc();
        assert_eq!(timezone_offsets(vec![instant]).unwrap(), vec![Some(expected)]);
        assert!(timezone_offsets(vec![0; 65]).is_err());
    }
}
