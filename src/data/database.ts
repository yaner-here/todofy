import { invoke } from "@tauri-apps/api/core";
import type queries from "./crud-queries.json";

export type Statement = keyof typeof queries;
export type SqlValue = string | number | boolean | null;
export type SqlRow = Record<string, SqlValue>;
export interface Operation {
  statement: Statement;
  params?: SqlValue[];
  /** Abort the batch if another window or native worker changed these rows. */
  expected?: SqlRow[];
}

/** Every batch executes on the existing SQLite connection in one transaction. */
export interface Database {
  run(operations: Operation[]): Promise<SqlRow[][]>;
}

export const tauriDatabase: Database = {
  run: (operations) => invoke<SqlRow[][]>("run_crud", { operations }),
};

export const op = (statement: Statement, ...params: SqlValue[]): Operation => ({ statement, params });
