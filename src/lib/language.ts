import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { api } from "./api";
import { i18n } from "./i18n";
import { isLanguagePreference, resolveLanguage } from "./language-rules";
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
    if (active && snapshot.revision > useLanguageState.getState().revision) {
      const preference = isLanguagePreference(snapshot.preference) ? snapshot.preference : "auto";
      const language = preference === "auto"
        ? resolveLanguage(preference, await api.languageSources())
        : preference;
      const current = preference === snapshot.preference && language === snapshot.language
        ? snapshot
        : await api.syncLanguage(snapshot.revision, preference, language);
      if (active) {
        await applyLanguage(current);
        await api.languageReady();
      }
    }
  } catch (error) {
    reportError(error);
  }
  if (subscriptionError !== undefined) reportError(subscriptionError);
  return () => { active = false; unlisten(); };
}

export async function setLanguage(preference: LanguagePreference): Promise<void> {
  if (!isLanguagePreference(preference)) throw new Error(i18n.t("language.invalidPreference"));
  const language = preference === "auto"
    ? resolveLanguage(preference, await api.languageSources())
    : preference;
  await applyLanguage(await api.setLanguage(preference, language));
}
