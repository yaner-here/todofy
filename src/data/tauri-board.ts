import type { BoardColumnDefinition, BoardColumnInput } from "../types";
import { t } from "../lib/i18n";
import { DONE_COLUMN, resolveStage, TODO_COLUMN } from "./board-rules";
import { op, tauriDatabase, type Database, type Operation, type SqlRow } from "./database";
import { check, compareText, newId, retry, trimWhitespace } from "./operations";

type BoardTask = { id: string; stage: string | null; boardIndex: number };

function columnsFromRows(rows: SqlRow[]): BoardColumnDefinition[] {
  return (rows as unknown as BoardColumnDefinition[]).slice().sort((a, b) =>
    Number(a.id === DONE_COLUMN) - Number(b.id === DONE_COLUMN) ||
    a.orderIndex - b.orderIndex || compareText(a.id, b.id));
}

function validateColumn(input: BoardColumnInput): void {
  const name = trimWhitespace(input.name);
  if (!name || [...name].length > 60) throw new Error(t("validation.columnName"));
  if (!/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error(t("validation.color"));
  if (input.wipLimit !== null &&
      (!Number.isInteger(input.wipLimit) || input.wipLimit < 1 || input.wipLimit > 9999)) {
    throw new Error(t("validation.wip"));
  }
}

export function createBoardRepository(db: Database = tauriDatabase) {
  async function after(operations: Operation[]): Promise<BoardColumnDefinition[]> {
    const rows = await db.run([...operations, op("board.columns")]);
    return columnsFromRows(rows[rows.length - 1]);
  }

  return {
    async listBoardColumns(): Promise<BoardColumnDefinition[]> {
      const [rows] = await db.run([op("board.columns")]);
      return columnsFromRows(rows);
    },

    async createBoardColumn(input: BoardColumnInput): Promise<BoardColumnDefinition[]> {
      validateColumn(input);
      return retry(async () => {
        const [snapshot] = await db.run([op("board.columns")]);
        const columns = snapshot as unknown as BoardColumnDefinition[];
        const livePositions = columns.filter((column) => column.deletedAt === null && column.id !== DONE_COLUMN)
          .map((column) => column.orderIndex);
        const position = livePositions.length ? livePositions.reduce((a, b) => Math.max(a, b)) + 1 : 0;
        return after([
          check("board.columns", snapshot),
          op("board.insert", newId(), trimWhitespace(input.name), input.color.toLowerCase(), position,
            input.wipLimit, new Date().toISOString()),
        ]);
      });
    },

    async updateBoardColumn(id: string, input: BoardColumnInput): Promise<BoardColumnDefinition[]> {
      validateColumn(input);
      if (id === DONE_COLUMN && input.wipLimit !== null) throw new Error(t("validation.doneWip"));
      return retry(async () => {
        const [snapshot] = await db.run([op("board.columns")]);
        const columns = snapshot as unknown as BoardColumnDefinition[];
        if (!columns.some((column) => column.id === id && column.deletedAt === null)) {
          throw new Error(t("validation.missingColumn"));
        }
        return after([
          check("board.columns", snapshot),
          op("board.update", trimWhitespace(input.name), input.color.toLowerCase(), input.wipLimit,
            new Date().toISOString(), id),
        ]);
      });
    },

    async reorderBoardColumns(ids: string[]): Promise<BoardColumnDefinition[]> {
      return retry(async () => {
        const [snapshot] = await db.run([op("board.columns")]);
        const live = new Set((snapshot as unknown as BoardColumnDefinition[])
          .filter((column) => column.deletedAt === null).map((column) => column.id));
        const requested = new Set(ids);
        if (ids.length !== live.size || requested.size !== live.size ||
            ids[ids.length - 1] !== DONE_COLUMN || [...requested].some((id) => !live.has(id))) {
          throw new Error(t("validation.columnOrder"));
        }
        const timestamp = new Date().toISOString();
        return after([check("board.columns", snapshot),
          ...ids.map((id, index) => op("board.order", index, timestamp, id))]);
      });
    },

    async deleteBoardColumn(id: string, replacementId: string): Promise<BoardColumnDefinition[]> {
      if (id === TODO_COLUMN || id === DONE_COLUMN) throw new Error(t("validation.protectedColumns"));
      return retry(async () => {
        const [columnSnapshot, taskSnapshot] = await db.run([op("board.columns"), op("board.tasks")]);
        const columns = columnSnapshot as unknown as BoardColumnDefinition[];
        if (!columns.some((column) => column.id === id && column.deletedAt === null) ||
            !columns.some((column) => column.id === replacementId && column.id !== DONE_COLUMN &&
              column.id !== id && column.deletedAt === null)) {
          throw new Error(t("validation.columnDestination"));
        }
        const tasks = (taskSnapshot as unknown as BoardTask[]).slice()
          .sort((a, b) => a.boardIndex - b.boardIndex || compareText(a.id, b.id));
        let last = tasks.filter((task) => resolveStage(task.stage, columns) === replacementId)
          .reduce((maximum, task) => Math.max(maximum, task.boardIndex), -1);
        const timestamp = new Date().toISOString();
        const operations: Operation[] = [check("board.columns", columnSnapshot), check("board.tasks", taskSnapshot)];
        for (const task of tasks) {
          if (resolveStage(task.stage, columns) === id) {
            operations.push(op("board.moveTask", replacementId, ++last, timestamp, task.id));
          }
        }
        operations.push(op("board.delete", timestamp, replacementId, id));
        return after(operations);
      });
    },
  };
}
