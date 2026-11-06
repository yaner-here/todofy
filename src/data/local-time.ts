import { invoke } from "@tauri-apps/api/core";
import { advanceDue } from "./recurrence";

export interface LocalReminderTime {
  date: string;
  time: string;
}

/** The desktop scheduler and the CRUD adapter must use the same system timezone. */
export interface LocalTime {
  parts(timestamp: string): Promise<LocalReminderTime | null>;
  timestamp(date: string, time: string): Promise<string | null>;
}

export const tauriLocalTime: LocalTime = {
  parts: (timestamp) => invoke<LocalReminderTime | null>("local_reminder_parts", { timestamp }),
  timestamp: (date, time) => invoke<string | null>("local_reminder_timestamp", { date, time }),
};

export async function advanceReminder(localTime: LocalTime, timestamp: string, rule: string): Promise<string | null> {
  const local = await localTime.parts(timestamp);
  if (!local) return null;
  const nextDate = advanceDue(local.date, rule);
  return nextDate ? localTime.timestamp(nextDate, local.time) : null;
}
