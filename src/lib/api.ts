import { invoke } from "@tauri-apps/api/core";
import { createTauriCrud } from "../data/tauri-crud";
import { createBoardRepository } from "../data/tauri-board";
import { createTimerRepository } from "../data/tauri-timer";
import { createPriorityRepository } from "../data/tauri-priority";
import { resolveTimeLocale, type LocaleSources } from "./language-rules";
import type {
  AppLanguage,
  LanguagePreference,
  LanguageSnapshot,
} from "../types";

export const api = {
  ...createTauriCrud(),
  ...createBoardRepository(),
  ...createTimerRepository(),
  ...createPriorityRepository(),

  systemLocale: async () => resolveTimeLocale(await invoke<LocaleSources>("language_sources")),
  languageSources: () => invoke<LocaleSources>("language_sources"),
  languageReady: () => invoke<void>("language_ready"),
  getLanguage: () => invoke<LanguageSnapshot>("get_language"),
  syncLanguage: (revision: number, preference: LanguagePreference, language: AppLanguage) =>
    invoke<LanguageSnapshot>("sync_language", { revision, preference, language }),
  setLanguage: (preference: LanguagePreference, language: AppLanguage) =>
    invoke<LanguageSnapshot>("set_language", { preference, language }),
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

};
