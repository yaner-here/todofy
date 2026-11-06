import type { AppLanguage, LanguagePreference } from "../types";

/** Raw locale information from the platform, before applying app-language rules. */
export interface LocaleSources {
  linux: boolean;
  environment: Record<string, string>;
  locales: string[];
  configuration: string[];
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === "auto" || value === "en" || value === "zh-CN";
}

function cLocale(value: string): boolean {
  return ["C", "POSIX"].includes(value.split(/[.@]/)[0]);
}

/** Preserve POSIX precedence and LANGUAGE ordering when a session has no environment. */
export function configurationLocales(text: string): string[] {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const equals = line.indexOf("=");
    if (!line || line.startsWith("#") || equals < 0) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim().replace(/^["']+|["']+$/g, "");
    if (value) values[key] = value;
  }
  const primary = [values.LC_ALL, values.LC_MESSAGES, values.LANG].find(Boolean);
  if (primary && cLocale(primary)) return ["en"];
  return [...(values.LANGUAGE?.split(":") ?? []), ...(primary ? [primary] : [])].filter(Boolean);
}

export function resolveLanguage(preference: LanguagePreference, sources: LocaleSources): AppLanguage {
  if (preference !== "auto") return preference;
  if (sources.linux) {
    const primary = [sources.environment.LC_ALL, sources.environment.LC_MESSAGES, sources.environment.LANG]
      .find(Boolean);
    if (primary && cLocale(primary)) return "en";
  }
  const locales = sources.locales.length
    ? sources.locales
    : sources.configuration.map(configurationLocales).find((items) => items.length > 0) ?? [];
  for (const raw of locales) {
    const parts = raw.split(/[.@]/)[0].replace(/_/g, "-").toLowerCase().split("-");
    if (parts[0] === "en") return "en";
    if (parts[0] !== "zh") continue;
    const script = parts.find((part) => part.length === 4);
    if (script === "hans") return "zh-CN";
    if (script || parts.some((part) => ["tw", "hk", "mo"].includes(part))) continue;
    return "zh-CN";
  }
  return "en";
}

function normalizeTimeLocale(raw: string | undefined): string | null {
  const base = raw?.split(/[.@]/)[0].replace(/_/g, "-") ?? "";
  return !base || ["c", "posix"].includes(base.toLowerCase()) ? null : base;
}

/** Resolve LC_TIME independently from the UI language. */
export function resolveTimeLocale(sources: LocaleSources): string | null {
  const keys = ["LC_ALL", "LC_TIME", "LANG"];
  for (const key of keys) {
    const locale = normalizeTimeLocale(sources.environment[key]);
    if (locale) return locale;
  }
  for (const text of sources.configuration) {
    const values: Record<string, string> = {};
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const equals = line.indexOf("=");
      if (!line || line.startsWith("#") || equals < 0) continue;
      const key = line.slice(0, equals).trim();
      const value = line.slice(equals + 1).trim().replace(/^["']+|["']+$/g, "");
      if (keys.includes(key) && value && values[key] === undefined) values[key] = value;
    }
    for (const key of keys) {
      const locale = normalizeTimeLocale(values[key]);
      if (locale) return locale;
    }
  }
  return null;
}
