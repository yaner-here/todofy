import { Database as SQLite } from "bun:sqlite";
import { readFileSync } from "node:fs";
import queries from "../src/data/crud-queries.json";
import defaults from "../src/data/defaults.json";
import type { Database, Operation, SqlRow } from "../src/data/database";
export { systemLocalTime as localTimeForTests } from "../src/data/local-time";

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
  readonly sqlite: SQLite;

  constructor(path = ":memory:") {
    this.sqlite = new SQLite(path);
    // Use the real current schema, including the two columns added by migrate().
    this.sqlite.exec(nativeSchema("db.rs"));
    this.sqlite.exec("ALTER TABLE tasks ADD COLUMN last_notified_at TEXT; ALTER TABLE tasks ADD COLUMN reminder_ack_at TEXT;");
    this.sqlite.exec(nativeSchema("board.rs"));
    this.sqlite.exec(nativeSchema("priority.rs"));
    const column = this.sqlite.query("INSERT INTO board_columns (id,name,color,order_index,updated_at) VALUES (?,?,?,?,?)");
    defaults.board.forEach((item, index) => column.run(item.id, item.name, item.color, index, defaults.seedTime));
    const priority = this.sqlite.query("INSERT INTO priority_profiles (priority,name,color,updated_at) VALUES (?,?,?,?)");
    defaults.priorities.forEach((item) => priority.run(item.priority, item.name, item.color, defaults.seedTime));
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
