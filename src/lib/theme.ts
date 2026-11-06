import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "./api";

export type Theme = "dark" | "light";

/** Apply a theme to the document. Dark is the default,
 * so it needs no attribute; light is opt-in via `data-theme`. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

/** Keep secondary windows in sync with the theme committed by the main window. */
export async function initWindowTheme(): Promise<UnlistenFn> {
  let revision = 0;
  const unlisten = await listen<Theme>("theme-changed", ({ payload }) => {
    revision++;
    applyTheme(payload);
  }).catch((error) => { console.error(error); return () => {}; });
  const beforeRead = revision;
  const theme = await api.getSetting("theme").catch(() => null);
  if (revision === beforeRead) applyTheme(theme === "light" ? "light" : "dark");
  return unlisten;
}
