import { Database as SQLite } from "bun:sqlite";
import { readFileSync } from "node:fs";
import queries from "../src/data/crud-queries.json";
import defaults from "../src/data/defaults.json";
import type { Database, Operation, SqlRow } from "../src/data/database";
export { systemLocalTime as localTimeForTests } from "../src/data/local-time";

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
    // This initializes a fresh database; Rust tests cover legacy migrations.
    this.sqlite.exec(readFileSync(new URL("../src-tauri/sql/schema.sql", import.meta.url), "utf8"));
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
