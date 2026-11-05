import { afterEach, expect, test } from "bun:test";
import en from "../locales/en.json";
import zh from "../locales/zh-CN.json";
import { i18n } from "./i18n";
import { columnName, DEFAULT_COLUMNS } from "./board";
import { defaultProfile, displayPriorityName, isCustomized } from "./priority";
import { formatDuration, formatMinutes, parseMinutes } from "./duration";

function messages(catalog: Record<string, unknown>, prefix = ""): Map<string, string> {
  const leaves = new Map<string, string>();
  for (const [name, value] of Object.entries(catalog)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof value === "string") leaves.set(key, value);
    else for (const [nested, text] of messages(value as Record<string, unknown>, key)) leaves.set(nested, text);
  }
  return leaves;
}

function messageContracts(catalog: Map<string, string>): Map<string, string[]> {
  const contracts = new Map<string, Set<string>>();
  for (const [key, text] of catalog) {
    const base = key.replace(/_(?:zero|one|two|few|many|other)$/, "");
    const parameters = contracts.get(base) ?? new Set<string>();
    for (const match of text.matchAll(/{{\s*([\w.]+)(?:,[^}]*)?\s*}}/g)) parameters.add(match[1]);
    contracts.set(base, parameters);
  }
  return new Map([...contracts].map(([key, parameters]) => [key, [...parameters].sort()]));
}

afterEach(async () => { await i18n.changeLanguage("en"); });

test("English and Chinese catalogs cover the same messages and interpolation parameters", () => {
  const english = messages(en);
  const chinese = messages(zh);
  const englishContracts = messageContracts(english);
  const chineseContracts = messageContracts(chinese);
  expect([...chineseContracts.keys()].sort()).toEqual([...englishContracts.keys()].sort());
  for (const [key, parameters] of englishContracts) {
    expect(chineseContracts.get(key)).toEqual(parameters);
    if (english.has(`${key}_other`)) {
      expect(english.has(`${key}_one`)).toBe(true);
      expect(chinese.has(`${key}_other`)).toBe(true);
    }
  }
});

test("default names localize even after color edits while custom names and stored defaults remain intact", async () => {
  await i18n.changeLanguage("zh-CN");
  const column = { ...DEFAULT_COLUMNS[0], color: "#123456", updatedAt: "2026-11-05T00:00:00Z" };
  expect(columnName(column)).toBe("待办");
  expect(column.name).toBe("To do");
  expect(columnName({ ...column, name: "My own column" })).toBe("My own column");
  expect(columnName({ ...column, id: "custom", name: "To do" })).toBe("To do");
  const profile = { ...defaultProfile(4), color: "#123456" };
  expect(displayPriorityName(profile)).toBe("优先级 4");
  expect(isCustomized(profile)).toBe(true);
  expect(displayPriorityName({ ...profile, name: "Personal priority" })).toBe("Personal priority");
  expect(profile.name).toBe("Priority 4");
});

test("localized duration output keeps the existing estimate input grammar", async () => {
  expect(formatDuration(3620)).toBe("1h");
  await i18n.changeLanguage("zh-CN");
  expect(formatDuration(4820)).toBe("1 小时 20 分钟");
  expect(formatMinutes(90)).toBe("1 小时 30 分钟");
  expect(parseMinutes("1h 30m")).toBe(90);
  expect(parseMinutes("90")).toBe(90);
  expect(parseMinutes("1 小时 30 分钟")).toBeNull();
});

test("the app configuration handles English plurals, Chinese counts and unavailable translations", async () => {
  expect(i18n.t("common.taskCount", { count: 1 })).toBe("1 task");
  expect(i18n.t("common.taskCount", { count: 2 })).toBe("2 tasks");
  await i18n.changeLanguage("zh-CN");
  expect(i18n.t("common.taskCount", { count: 0 })).toBe("0 个任务");
  i18n.removeResourceBundle("zh-CN", "translation");
  try {
    expect(i18n.t("common.save")).toBe("Save");
    expect(i18n.t("common.taskCount", { count: 2 })).toBe("2 tasks");
  } finally {
    i18n.addResourceBundle("zh-CN", "translation", zh);
  }
});
