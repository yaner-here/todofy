import { emit } from "@tauri-apps/api/event";
import { op, tauriDatabase, type Database } from "../data/database";
import { api } from "./api";
import type { BoardScope } from "./board";
import type { CalendarViewMode } from "./calendarLayout";
import type { Theme } from "./theme";

const keys = [
  ["todofy-theme", "theme"],
  ["todofy-celebrate", "celebrate"],
  ["todofy-board-scope", "board_scope"],
  ["todofy-calendar-view", "calendar_view"],
] as const;

type PreferenceKey = (typeof keys)[number][1];

export interface Preferences {
  theme: Theme;
  celebrate: boolean;
  boardScope: BoardScope;
  calendarView: CalendarViewMode;
}

/** Import old WebView preferences without overwriting values already in SQLite. */
export async function loadPreferences(db: Database = tauriDatabase, storage?: Storage): Promise<Preferences> {
  let legacy: [string, PreferenceKey, string][] = [];
  try {
    storage ??= window.localStorage;
    legacy = keys.flatMap(([oldKey, key]) => {
      const value = storage!.getItem(oldKey);
      return value === null ? [] : [[oldKey, key, value]];
    });
  } catch {
    // An unavailable WebView store must not prevent reading SQLite.
  }

  const rows = await db.run([
    ...legacy.map(([, key, value]) => op("preference.import", key, value)),
    ...keys.map(([, key]) => op("preference.get", key)),
  ]);
  for (const [oldKey, , value] of legacy) {
    try {
      if (storage?.getItem(oldKey) === value) storage.removeItem(oldKey);
    } catch {
      // The database is already committed; the next launch can retry cleanup.
    }
  }
  const [theme, celebrate, boardScope, calendarView] = rows.slice(legacy.length).map((row) => row[0]?.value);
  return {
    theme: theme === "light" ? "light" : "dark",
    celebrate: celebrate !== "off",
    boardScope: boardScope === "today" || boardScope === "week" ? boardScope : "all",
    calendarView: calendarView === "day" || calendarView === "week" ? calendarView : "month",
  };
}

const writes = new Map<PreferenceKey, Promise<void>>();

/** Serialize changes to the same preference so the last choice wins. */
export function savePreference(key: PreferenceKey, value: string): Promise<void> {
  const previous = writes.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await api.setSetting(key, value);
    if (key === "theme") await emit("theme-changed", value).catch(console.error);
  });
  writes.set(key, next);
  void next.finally(() => { if (writes.get(key) === next) writes.delete(key); }).catch(() => {});
  return next;
}
