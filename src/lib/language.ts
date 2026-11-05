import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { api } from "./api";
import { i18n } from "./i18n";
import type { LanguagePreference, LanguageSnapshot } from "../types";

export const useLanguageState = create<LanguageSnapshot & { error: string | null }>(() => ({
  preference: "auto", language: "en", revision: -1, error: null,
}));

async function applyLanguage(snapshot: LanguageSnapshot) {
  // A startup read can resolve after a newer event from another window.
  if (snapshot.revision <= useLanguageState.getState().revision) return;
  useLanguageState.setState({ ...snapshot, error: null });
  await i18n.changeLanguage(snapshot.language);
}

function reportError(error: unknown) {
  useLanguageState.setState({ error: String(error) });
}

/** Keep startup usable in English if native IPC fails; Settings shows the error. */
export async function initLanguage(): Promise<UnlistenFn> {
  let active = true;
  let unlisten: UnlistenFn = () => {};
  let subscriptionError: unknown;
  try {
    unlisten = await listen<LanguageSnapshot>("language-changed", ({ payload }) => {
      if (active) void applyLanguage(payload).catch(reportError);
    });
  } catch (error) {
    subscriptionError = error;
  }
  try {
    const snapshot = await api.getLanguage();
    if (active) await applyLanguage(snapshot);
  } catch (error) {
    reportError(error);
  }
  if (subscriptionError !== undefined) reportError(subscriptionError);
  return () => { active = false; unlisten(); };
}

export async function setLanguage(preference: LanguagePreference): Promise<void> {
  await applyLanguage(await api.setLanguage(preference));
}
