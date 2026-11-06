import type { BoardColumnDefinition } from "../types";

export const TODO_COLUMN = "todo";
export const DONE_COLUMN = "done";
type ColumnReference = Pick<BoardColumnDefinition, "id" | "deletedAt" | "replacementId">;

/** Follow tombstones safely, including missing columns and replacement cycles. */
export function resolveStage(stage: string | null, columns: ColumnReference[]): string {
  let id = stage ?? TODO_COLUMN;
  const seen = new Set<string>();
  while (!seen.has(id)) {
    seen.add(id);
    const column = columns.find((item) => item.id === id && item.id !== DONE_COLUMN);
    if (!column) return TODO_COLUMN;
    if (column.deletedAt === null) return column.id;
    id = column.replacementId ?? TODO_COLUMN;
  }
  return TODO_COLUMN;
}
