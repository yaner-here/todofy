import { expect, test } from "bun:test";
import { configurationLocales, isLanguagePreference, resolveLanguage, resolveTimeLocale, type LocaleSources } from "./language-rules";

const sources = (locales: string[]): LocaleSources => ({ linux: false, environment: {}, locales, configuration: [] });

test("language matching respects preference, script, region and order", () => {
  const cases: [string[], "en" | "zh-CN"][] = [
    [["zh_CN.UTF-8"], "zh-CN"], [["zh-SG"], "zh-CN"],
    [["zh-Hant-CN"], "en"], [["zh-Hans-HK"], "zh-CN"],
    [["zh-TW", "en-GB"], "en"], [["de-DE", "zh"], "zh-CN"],
    [["en-US", "zh-CN"], "en"], [["C", "POSIX"], "en"],
  ];
  for (const [locales, expected] of cases) {
    expect(resolveLanguage("auto", sources(locales))).toBe(expected);
    expect(resolveLanguage("en", sources(locales))).toBe("en");
    expect(resolveLanguage("zh-CN", sources(locales))).toBe("zh-CN");
  }
  expect(isLanguagePreference("auto")).toBe(true);
  expect(isLanguagePreference("zh-TW")).toBe(false);
});

test("Linux message locale precedence and config fallback match the native behavior", () => {
  expect(configurationLocales("LANG=en_US.UTF-8\nLC_TIME=zh_CN.UTF-8")).toEqual(["en_US.UTF-8"]);
  expect(configurationLocales("LANGUAGE=de:zh_CN\nLANG=en_US.UTF-8"))
    .toEqual(["de", "zh_CN", "en_US.UTF-8"]);
  expect(configurationLocales("LANGUAGE=zh_CN\nLC_ALL=C.UTF-8")).toEqual(["en"]);
  expect(configurationLocales("LC_MESSAGES='zh_CN.UTF-8'\nLANG=en_US.UTF-8")).toEqual(["zh_CN.UTF-8"]);
  expect(resolveLanguage("auto", {
    linux: true, environment: { LC_ALL: "C.UTF-8" }, locales: ["zh-CN"], configuration: [],
  })).toBe("en");
  expect(resolveLanguage("auto", {
    linux: true, environment: {}, locales: [], configuration: ["LANGUAGE=de:zh_CN\nLANG=en_US.UTF-8"],
  })).toBe("zh-CN");
});

test("clock locale honors LC_TIME precedence, skips C and falls back to session configuration", () => {
  const withEnvironment = (environment: Record<string, string>, configuration: string[] = []) =>
    resolveTimeLocale({ linux: true, environment, configuration, locales: [] });
  expect(withEnvironment({ LC_ALL: "", LANG: "de_DE.UTF-8" })).toBe("de-DE");
  expect(withEnvironment({ LC_ALL: "C", LANG: "de_DE.UTF-8" })).toBe("de-DE");
  expect(withEnvironment({ LC_TIME: "de_DE.UTF-8", LANG: "en_US.UTF-8" })).toBe("de-DE");
  expect(withEnvironment({ LANG: "en_GB.UTF-8@euro" })).toBe("en-GB");
  expect(withEnvironment({}, ["LANG=en_US.UTF-8\nLC_TIME=de_DE.UTF-8\n"])).toBe("de-DE");
  expect(withEnvironment({}, ["# note\nLANG=\"de_DE.UTF-8\"\nnoise\n"])).toBe("de-DE");
  expect(withEnvironment({}, ["LC_ALL=C\nLANG=de_DE.UTF-8\n"])).toBe("de-DE");
  expect(withEnvironment({ LC_ALL: "POSIX" }, ["LANG=\n"])).toBeNull();
});
