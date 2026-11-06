import { expect, test } from "bun:test";
import defaults from "./defaults.json";
import { TestDatabase } from "../../tests/crud-fixture";

test("the shared schema fixture enforces foreign keys and loads the native defaults", () => {
  const db = new TestDatabase();
  try {
    expect(db.sqlite.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(() => db.sqlite.query(
      "INSERT INTO task_labels (task_id,label_id,updated_at) VALUES ('missing','missing','now')",
    ).run()).toThrow();
    expect(db.sqlite.query(
      "SELECT id,name,color,order_index AS position,updated_at AS updatedAt FROM board_columns ORDER BY order_index",
    ).all()).toEqual(defaults.board.map((column, position) => ({ ...column, position, updatedAt: defaults.seedTime })));
    expect(db.sqlite.query(
      "SELECT priority,name,color,updated_at AS updatedAt FROM priority_profiles ORDER BY priority",
    ).all()).toEqual(defaults.priorities.map((profile) => ({ ...profile, updatedAt: defaults.seedTime })));
    expect(db.sqlite.query("SELECT id,phase,running FROM pomodoro").get()).toEqual({ id: 1, phase: "focus", running: 0 });
  } finally { db.sqlite.close(); }
});
