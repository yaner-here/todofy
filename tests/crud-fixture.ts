import { Database as SQLite } from "bun:sqlite";
import { readFileSync } from "node:fs";
import queries from "../src/data/crud-queries.json";
import type { Database, Operation, SqlRow } from "../src/data/database";
import type { LocalTime } from "../src/data/local-time";
import { localTimestamp } from "../src/data/recurrence";

function nativeSchema(file: string): string {
  const source = readFileSync(new URL(`../src-tauri/src/${file}`, import.meta.url), "utf8");
  const init = source.slice(source.indexOf("pub fn init("));
  const match = /conn\.execute_batch\(\s*"([\s\S]*?)",\s*\)\?;/.exec(init);
  if (!match) throw new Error(`Cannot find schema in ${file}`);
  return match[1];
}

function sameRows(a: SqlRow[], b: SqlRow[]): boolean {
  return a.length === b.length && a.every((row, index) => {
    const other = b[index];
    const keys = Object.keys(row);
    return keys.length === Object.keys(other).length && keys.every((key) => row[key] === other[key]);
  });
}

export class TestDatabase implements Database {
  readonly sqlite = new SQLite(":memory:");

  constructor() {
    // Use the real current schema, including the two columns added by migrate().
    this.sqlite.exec(nativeSchema("db.rs"));
    this.sqlite.exec("ALTER TABLE tasks ADD COLUMN last_notified_at TEXT; ALTER TABLE tasks ADD COLUMN reminder_ack_at TEXT;");
    this.sqlite.exec(nativeSchema("board.rs"));
    this.sqlite.exec(`INSERT INTO board_columns (id, name, color, order_index, updated_at) VALUES
      ('todo', 'To do', '#6c7cff', 0, 'seed'), ('doing', 'In progress', '#38bdf8', 1, 'seed'),
      ('blocked', 'Blocked', '#f2b155', 2, 'seed'), ('done', 'Done', '#4fd18b', 3, 'seed');`);
  }

  async run(operations: Operation[]): Promise<SqlRow[][]> {
    return this.sqlite.transaction(() => operations.map((operation) => {
      const definition = queries[operation.statement];
      const parameters = (operation.params ?? []).map((value) => typeof value === "boolean" ? Number(value) : value);
      if (!definition.read) {
        if (operation.expected) throw new Error("A write cannot be used as a CRUD precondition");
        this.sqlite.query(definition.sql).run(...parameters);
        return [];
      }
      const rows = this.sqlite.query(definition.sql).all(...parameters) as SqlRow[];
      if (operation.expected && !sameRows(rows, operation.expected)) throw new Error("todofy:crud-conflict");
      return rows;
    }))();
  }
}

export const localTimeForTests: LocalTime = {
  async parts(timestamp) {
    const leap = /:(60)(?=\.|[Zz+\-])/.test(timestamp);
    const normalized = timestamp.replace(" ", "T").replace(/:60(?=\.|[Zz+\-])/, ":59");
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return null;
    const rawFraction = /:(?:\d{2})(\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/.exec(timestamp)?.[1] ?? "";
    const nanos = Number(rawFraction.slice(1).slice(0, 9).padEnd(9, "0"));
    const digits = nanos % 1_000_000 === 0 ? 3 : nanos % 1_000 === 0 ? 6 : 9;
    const fraction = nanos === 0 ? "" : `.${String(nanos).padStart(9, "0").slice(0, digits)}`;
    const formatted = localTimestamp(date, fraction);
    const [localDate, rest] = formatted.split("T");
    const time = rest.replace(/[+-]\d{2}:\d{2}$/, "");
    return { date: localDate, time: leap ? time.replace(/:59(?=\.|$)/, ":60") : time };
  },
  async timestamp(date, time) {
    const leap = /:60(?:\.|$)/.test(time);
    const local = new Date(`${date}T${time.replace(/:60(?=\.|$)/, ":59")}`);
    if (Number.isNaN(local.getTime())) return null;
    const fraction = /\.\d+$/.exec(time)?.[0] ?? "";
    const formatted = localTimestamp(local, fraction);
    return leap ? formatted.replace(/(T\d{2}:\d{2}:)59/, (_match, prefix: string) => `${prefix}60`) : formatted;
  },
};

