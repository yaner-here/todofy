import { invoke } from "@tauri-apps/api/core";
import { createTauriCrud } from "../data/tauri-crud";
import type { PriorityProfile, PriorityProfileInput } from "./priority";
import type {
  ActiveTimer,
  BoardColumnDefinition,
  BoardColumnInput,
  LanguagePreference,
  LanguageSnapshot,
  Pomodoro,
  SessionLog,
} from "../types";

export const api = {
  ...createTauriCrud(),
  listBoardColumns: () => invoke<BoardColumnDefinition[]>("list_board_columns"),
  createBoardColumn: (input: BoardColumnInput) => invoke<BoardColumnDefinition[]>("create_board_column", { input }),
  updateBoardColumn: (id: string, input: BoardColumnInput) => invoke<BoardColumnDefinition[]>("update_board_column", { id, input }),
  reorderBoardColumns: (ids: string[]) => invoke<BoardColumnDefinition[]>("reorder_board_columns", { ids }),
  deleteBoardColumn: (id: string, replacementId: string) => invoke<BoardColumnDefinition[]>("delete_board_column", { id, replacementId }),

  listPriorityProfiles: () =>
    invoke<PriorityProfile[]>("list_priority_profiles"),
  updatePriorityProfile: (priority: number, input: PriorityProfileInput) =>
    invoke<PriorityProfile[]>("update_priority_profile", { priority, input }),
  resetPriorityProfile: (priority: number) =>
    invoke<PriorityProfile[]>("reset_priority_profile", { priority }),

  systemLocale: () => invoke<string | null>("system_locale"),
  getLanguage: () => invoke<LanguageSnapshot>("get_language"),
  setLanguage: (preference: LanguagePreference) =>
    invoke<LanguageSnapshot>("set_language", { preference }),
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),
  getAutostart: () => invoke<boolean>("get_autostart"),
  setAutostart: (enabled: boolean) =>
    invoke<void>("set_autostart", { enabled }),
  // Fires a test notification through the same portal path reminders use.
  // Resolves to the delivery route ("portal" or "fallback").
  sendTestNotification: () => invoke<string>("send_test_notification"),

  // Stops a reminder repeating (see settings::reminder_repeat_minutes).
  acknowledgeReminder: (id: string) =>
    invoke<void>("acknowledge_reminder", { id }),

  // Per-task stopwatch
  startTimer: (id: string) => invoke<ActiveTimer | null>("start_timer", { id }),
  pauseTimer: () => invoke<ActiveTimer | null>("pause_timer"),
  resumeTimer: () => invoke<ActiveTimer | null>("resume_timer"),
  stopTimer: () => invoke<void>("stop_timer"),
  activeTimer: () => invoke<ActiveTimer | null>("active_timer"),
  focusHistory: (limit = 200) =>
    invoke<SessionLog[]>("focus_history", { limit }),

  // Standalone Pomodoro
  getPomodoro: () => invoke<Pomodoro>("get_pomodoro"),
  pomodoroStart: () => invoke<Pomodoro>("pomodoro_start"),
  pomodoroPause: () => invoke<Pomodoro>("pomodoro_pause"),
  pomodoroReset: () => invoke<Pomodoro>("pomodoro_reset"),
  pomodoroNext: () => invoke<Pomodoro>("pomodoro_next"),
  setPomodoroConfig: (
    focusMin: number,
    shortMin: number,
    longMin: number,
    longEvery: number,
  ) =>
    invoke<Pomodoro>("set_pomodoro_config", {
      focusMin,
      shortMin,
      longMin,
      longEvery,
    }),
};
