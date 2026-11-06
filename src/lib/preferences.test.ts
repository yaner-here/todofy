import { expect, spyOn, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
import { Window } from "happy-dom";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TestDatabase } from "../../tests/crud-fixture";
import { api } from "./api";
import { loadPreferences, savePreference } from "./preferences";

test("legacy preferences move into SQLite without overwriting existing data", async () => {
  const db = new TestDatabase();
  const storage = new Window({ url: "http://localhost" }).localStorage;
  storage.setItem("todofy-theme", "light");
  storage.setItem("todofy-celebrate", "off");
  storage.setItem("todofy-board-scope", "week");
  storage.setItem("todofy-calendar-view", "day");
  storage.setItem("unrelated", "keep");
  db.sqlite.exec(`INSERT INTO tasks (id,title,created_at,updated_at) VALUES ('t','Keep task','now','now');
    INSERT INTO settings (key,value) VALUES ('theme','dark'), ('time_format','24');`);
  try {
    const expected = { theme: "dark", celebrate: false, boardScope: "week", calendarView: "day" } as const;
    expect(await loadPreferences(db, storage)).toEqual(expected);
    expect(storage.length).toBe(1);
    expect(storage.getItem("unrelated")).toBe("keep");
    expect(db.sqlite.query("SELECT title FROM tasks WHERE id='t'").get()).toEqual({ title: "Keep task" });
    expect(db.sqlite.query("SELECT value FROM settings WHERE key='time_format'").get()).toEqual({ value: "24" });
    expect(await loadPreferences(db, storage)).toEqual(expected);
  } finally { db.sqlite.close(); }
});

test("a failed migration rolls back and retains every legacy value for retry", async () => {
  const db = new TestDatabase();
  const storage = new Window({ url: "http://localhost" }).localStorage;
  storage.setItem("todofy-theme", "light");
  storage.setItem("todofy-celebrate", "off");
  db.sqlite.exec(`CREATE TRIGGER fail_import BEFORE INSERT ON settings
    WHEN NEW.key = 'celebrate' BEGIN SELECT RAISE(ABORT, 'read only'); END;`);
  try {
    await expect(loadPreferences(db, storage)).rejects.toThrow("read only");
    expect(db.sqlite.query("SELECT key FROM settings WHERE key IN ('theme','celebrate')").all()).toEqual([]);
    expect(storage.getItem("todofy-theme")).toBe("light");
    expect(storage.getItem("todofy-celebrate")).toBe("off");
    db.sqlite.exec("DROP TRIGGER fail_import");
    expect(await loadPreferences(db, storage)).toEqual({
      theme: "light", celebrate: false, boardScope: "all", calendarView: "month",
    });
    expect(storage.length).toBe(0);
  } finally { db.sqlite.close(); }
});

test("a portable database reopens with migrated preferences and task data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "todofy-preferences-"));
  const path = join(dir, "todofy.db");
  const db = new TestDatabase(path);
  const storage = new Window({ url: "http://localhost" }).localStorage;
  storage.setItem("todofy-theme", "light");
  storage.setItem("todofy-celebrate", "off");
  storage.setItem("todofy-board-scope", "week");
  storage.setItem("todofy-calendar-view", "day");
  db.sqlite.exec("INSERT INTO tasks (id,title,created_at,updated_at) VALUES ('t','Keep task','now','now')");
  let closed = false;
  try {
    await loadPreferences(db, storage);
    db.sqlite.close();
    closed = true;
    const reopened = new SQLite(path, { readonly: true });
    try {
      expect(reopened.query("SELECT key,value FROM settings WHERE key IN ('theme','celebrate','board_scope','calendar_view') ORDER BY key").all()).toEqual([
        { key: "board_scope", value: "week" },
        { key: "calendar_view", value: "day" },
        { key: "celebrate", value: "off" },
        { key: "theme", value: "light" },
      ]);
      expect(reopened.query("SELECT title FROM tasks WHERE id='t'").get()).toEqual({ title: "Keep task" });
    } finally { reopened.close(); }
  } finally {
    if (!closed) db.sqlite.close();
    for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) unlinkSync(file);
    rmdirSync(dir);
  }
});

test("preference saves run in order even after a failed write", async () => {
  let finishFirst!: () => void;
  const started: string[] = [];
  const save = spyOn(api, "setSetting").mockImplementation(async (_key, value) => {
    started.push(value);
    if (value === "today") {
      await new Promise<void>((resolve) => { finishFirst = resolve; });
      throw new Error("failed");
    }
  });
  try {
    const first = savePreference("board_scope", "today");
    const second = savePreference("board_scope", "week");
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(["today"]);
    finishFirst();
    await expect(first).rejects.toThrow("failed");
    await second;
    expect(started).toEqual(["today", "week"]);
  } finally { save.mockRestore(); }
});
