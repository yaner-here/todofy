import type {
  Event, EventPatch, JournalEntry, JournalPatch, Label, NewEvent,
  NewJournalEntry, NewTask, Subtask, Task, TaskPatch,
} from "../types";
import { t } from "../lib/i18n";
import type { CrudRepository } from "./crud";
import { op, tauriDatabase, type Database, type Operation, type SqlRow, type SqlValue } from "./database";
import { advanceReminder, tauriLocalTime, type LocalTime } from "./local-time";
import { advanceDue, localTimestamp, parseInstant } from "./recurrence";

const CONFLICT = "todofy:crud-conflict";
const now = () => localTimestamp(new Date());
const trimWhitespace = (text: string) => text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");

function newId(): string {
  // getRandomValues is available even in webviews without a secure context.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function only(rows: SqlRow[]): SqlRow {
  if (rows.length !== 1) throw new Error("Query returned no rows");
  return rows[0];
}

function parseSubtasks(text: SqlValue): Subtask[] {
  if (typeof text !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || !parsed.every((entry) => {
      if (entry === null || typeof entry !== "object") return false;
      const fields = entry as Record<string, unknown>;
      return Number.isInteger(fields.id) && typeof fields.text === "string" && typeof fields.done === "boolean";
    })) return [];
    return (parsed as Subtask[]).map(({ id, text, done }) => ({ id, text, done }));
  } catch {
    // The original backend treated malformed checklist JSON as an empty list.
    return [];
  }
}

function taskFromRow(row: SqlRow): Task {
  return {
    ...row as unknown as Task,
    pinned: row.pinned !== 0,
    labelIds: JSON.parse(row.labelIds as string) as string[],
    subtasks: parseSubtasks(row.subtasks),
  };
}

function eventFromRow(row: SqlRow): Event {
  return { ...row as unknown as Event, allDay: row.allDay !== 0 };
}

async function retry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await work();
    } catch (error) {
      const conflict = error === CONFLICT || (error instanceof Error && error.message === CONFLICT);
      if (!conflict || attempt === 9) throw error;
    }
  }
  throw new Error(CONFLICT);
}

function check(statement: Operation["statement"], expected: SqlRow[], ...params: SqlValue[]): Operation {
  return { statement, params, expected };
}

function validateEvent(allDay: boolean, start: string | null, end: string | null): void {
  if (allDay || start === null || end === null) return;
  const from = parseInstant(start);
  if (!from) throw new Error(t("validation.eventStart"));
  const to = parseInstant(end);
  if (!to) throw new Error(t("validation.eventEnd"));
  if (to.seconds < from.seconds || (to.seconds === from.seconds && to.nanoseconds <= from.nanoseconds)) {
    throw new Error(t("validation.eventOrder"));
  }
}

function labelOperations(taskId: string, labelIds: string[], timestamp: string): Operation[] {
  return labelIds.map((labelId) => op("task.upsertLabel", taskId, labelId, timestamp));
}

function crowded(values: number[]): boolean {
  return values.some((after, index) => {
    if (index === 0) return false;
    const before = values[index - 1];
    return after - before < Math.max(Math.abs(before), Math.abs(after), 1) * Number.EPSILON * 1024;
  });
}

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
type OrderRow = { id: string; status: string; orderIndex: number; createdAt: string; deletedAt: string | null; rowId: number };
type BoardRow = { id: string; status: string; stage: string | null; boardIndex: number; createdAt: string; deletedAt: string | null; rowId: number };
type ColumnRow = { id: string; deletedAt: string | null; replacementId: string | null };

function resolvedStage(stage: string | null, columns: ColumnRow[]): string {
  let id = stage ?? "todo";
  const seen = new Set<string>();
  while (!seen.has(id)) {
    seen.add(id);
    const column = columns.find((item) => item.id === id && item.id !== "done");
    if (!column) return "todo";
    if (column.deletedAt === null) return column.id;
    id = column.replacementId ?? "todo";
  }
  return "todo";
}

function createTaskCrud(db: Database, localTime: LocalTime) {
  async function taskAfter(operations: Operation[], id: string): Promise<Task> {
    const result = await db.run([...operations, op("task.get", id)]);
    return taskFromRow(only(result[result.length - 1]));
  }

  async function tasksAfter(operations: Operation[], ids: string[]): Promise<Task[]> {
    const result = await db.run([...operations, ...ids.map((id) => op("task.get", id))]);
    return result.slice(operations.length).map((rows) => taskFromRow(only(rows)));
  }

  return {
    async listTasks() {
      const [rows] = await db.run([op("task.list")]);
      return rows.map(taskFromRow);
    },
    async createTask(task: NewTask) {
      const id = newId();
      const date = new Date();
      const timestamp = localTimestamp(date);
      return taskAfter([
        op("task.insert", id, trimWhitespace(task.title), task.notes ?? null, task.dueDate ?? null,
          task.remindAt ?? null, task.priority ?? 4, timestamp, date.getTime(), task.repeat ?? null,
          task.estimateMinutes && task.estimateMinutes > 0 ? task.estimateMinutes : null),
        ...labelOperations(id, task.labelIds ?? [], timestamp),
      ], id);
    },
    async updateTask(patch: TaskPatch) {
      const operations: Operation[] = [];
      if (patch.title !== undefined) operations.push(op("task.title", trimWhitespace(patch.title), patch.id));
      if (patch.notes !== undefined) operations.push(op("task.notes", patch.notes, patch.id));
      if (patch.dueDate !== undefined) operations.push(op("task.due", patch.dueDate, patch.id));
      if (patch.remindAt !== undefined) operations.push(op("task.remind", patch.remindAt, patch.id));
      if (patch.priority !== undefined) operations.push(op("task.priority", patch.priority, patch.id));
      if (patch.labelIds !== undefined) {
        const timestamp = now();
        operations.push(op("task.clearLabels", timestamp, patch.id), ...labelOperations(patch.id, patch.labelIds, timestamp));
      }
      if (patch.pinned !== undefined) operations.push(op("task.pinned", patch.pinned, patch.id));
      if (patch.repeat !== undefined) operations.push(op("task.repeat", patch.repeat, patch.id));
      if (patch.estimateMinutes !== undefined) operations.push(op("task.estimate", patch.estimateMinutes !== null && patch.estimateMinutes > 0 ? patch.estimateMinutes : null, patch.id));
      if (patch.subtasks !== undefined) operations.push(op("task.subtasks", JSON.stringify(patch.subtasks), patch.id));
      operations.push(op("task.touch", now(), patch.id));
      return taskAfter(operations, patch.id);
    },
    async reorderTask(id: string, orderIndex: number) {
      if (!Number.isFinite(orderIndex)) throw new Error(t("validation.boardPosition"));
      return retry(async () => {
        const [snapshot] = await db.run([op("task.orderSnapshot", id)]);
        const all = snapshot as unknown as OrderRow[];
        if (!all.some((row) => row.id === id)) throw new Error("Query returned no rows");
        const rows = all.filter((row) => row.deletedAt === null).map((row) => row.id === id ? { ...row, orderIndex } : row)
          .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") ||
            a.orderIndex - b.orderIndex || compareText(a.createdAt, b.createdAt) || a.rowId - b.rowId);
        const renumber = crowded(rows.map((row) => row.orderIndex));
        const timestamp = now();
        const operations = [check("task.orderSnapshot", snapshot, id), op("task.setOrder", orderIndex, timestamp, id)];
        if (renumber) rows.forEach((row, index) => operations.push(op("task.setOrder", index, timestamp, row.id)));
        return tasksAfter(operations, renumber ? rows.map((row) => row.id) : [id]);
      });
    },
    async moveTaskToStage(id: string, stage: string | null, boardIndex: number) {
      if (!Number.isFinite(boardIndex)) throw new Error(t("validation.boardPosition"));
      return retry(async () => {
        const [snapshot, columnSnapshot] = await db.run([op("task.boardSnapshot", id), op("task.boardColumns")]);
        const all = snapshot as unknown as BoardRow[];
        const columns = columnSnapshot as unknown as ColumnRow[];
        const target = stage ?? "todo";
        if (!columns.some((column) => column.id === target && column.id !== "done" && column.deletedAt === null)) {
          throw new Error(t("board.missingColumn"));
        }
        if (!all.some((row) => row.id === id)) throw new Error("Query returned no rows");
        const rows = all.filter((row) => row.deletedAt === null)
          .map((row) => row.id === id ? { ...row, stage, boardIndex, status: "active" } : row)
          .filter((row) => row.status !== "done" && resolvedStage(row.stage, columns) === target)
          .sort((a, b) => a.boardIndex - b.boardIndex || compareText(a.createdAt, b.createdAt) || compareText(a.id, b.id));
        const renumber = crowded(rows.map((row) => row.boardIndex));
        const timestamp = now();
        const operations = [check("task.boardSnapshot", snapshot, id), check("task.boardColumns", columnSnapshot),
          op("task.move", stage, boardIndex, timestamp, id)];
        if (renumber) rows.forEach((row, index) => operations.push(op("task.setBoardOrder", index, timestamp, row.id)));
        return tasksAfter(operations, renumber ? rows.map((row) => row.id) : [id]);
      });
    },
    async toggleTask(id: string, done: boolean) {
      return retry(async () => {
        const [snapshot] = await db.run([op("task.recurrence", id)]);
        const row = only(snapshot);
        const rule = typeof row.repeat === "string" && row.repeat ? row.repeat : null;
        const due = typeof row.dueDate === "string" ? row.dueDate : null;
        const nextDue = done && rule && due ? advanceDue(due, rule) : null;
        const timestamp = now();
        const operations: Operation[] = [check("task.recurrence", snapshot, id)];
        if (nextDue && rule) {
          const nextRemind = typeof row.remindAt === "string" ? await advanceReminder(localTime, row.remindAt, rule) : null;
          operations.push(op("task.advance", nextDue, nextRemind, id));
        } else {
          operations.push(op("task.status", done ? "done" : "active", done ? timestamp : null, id));
        }
        operations.push(op("task.touch", timestamp, id));
        return taskAfter(operations, id);
      });
    },
    async deleteTask(id: string) {
      const timestamp = now();
      await db.run([op("task.clearLabels", timestamp, id), op("task.deleteSessions", timestamp, id), op("task.delete", timestamp, id)]);
    },
  };
}

function createLabelCrud(db: Database) {
  return {
    async listLabels() {
      const [rows] = await db.run([op("label.list")]);
      return rows as unknown as Label[];
    },
    async createLabel(name: string, color: string) {
      const label = { id: newId(), name: trimWhitespace(name), color };
      await db.run([op("label.insert", label.id, label.name, color, now())]);
      return label;
    },
    async updateLabel(id: string, name: string, color: string) {
      const label = { id, name: trimWhitespace(name), color };
      await db.run([op("label.update", label.name, color, now(), id)]);
      return label;
    },
    async deleteLabel(id: string) {
      const timestamp = now();
      await db.run([op("label.deleteLinks", timestamp, id), op("label.delete", timestamp, id)]);
    },
  };
}

function createJournalCrud(db: Database) {
  async function journalAfter(operations: Operation[], id: string): Promise<JournalEntry> {
    const result = await db.run([...operations, op("journal.get", id)]);
    return only(result[result.length - 1]) as unknown as JournalEntry;
  }

  return {
    async listJournal() {
      const [rows] = await db.run([op("journal.list")]);
      return rows as unknown as JournalEntry[];
    },
    async createJournal(entry: NewJournalEntry) {
      const id = newId();
      return journalAfter([op("journal.insert", id, entry.title ?? null, entry.body ?? "", entry.mood ?? null, entry.entryDate, now())], id);
    },
    async updateJournal(patch: JournalPatch) {
      const operations: Operation[] = [];
      if (patch.title !== undefined) operations.push(op("journal.title", patch.title, patch.id));
      if (patch.body !== undefined) operations.push(op("journal.body", patch.body, patch.id));
      if (patch.mood !== undefined) operations.push(op("journal.mood", patch.mood, patch.id));
      if (patch.entryDate !== undefined) operations.push(op("journal.date", patch.entryDate, patch.id));
      operations.push(op("journal.touch", now(), patch.id));
      return journalAfter(operations, patch.id);
    },
    async deleteJournal(id: string) {
      await db.run([op("journal.delete", now(), id)]);
    },
  };
}

function createEventCrud(db: Database) {
  async function eventAfter(operations: Operation[], id: string): Promise<Event> {
    const result = await db.run([...operations, op("event.get", id)]);
    return eventFromRow(only(result[result.length - 1]));
  }

  return {
    async listEvents() {
      const [rows] = await db.run([op("event.list")]);
      return rows.map(eventFromRow);
    },
    async createEvent(event: NewEvent) {
      validateEvent(event.allDay ?? false, event.startAt ?? null, event.endAt ?? null);
      const id = newId();
      return eventAfter([op("event.insert", id, event.title, event.description ?? null, event.startAt ?? null,
        event.endAt ?? null, event.allDay ?? false, now())], id);
    },
    async updateEvent(patch: EventPatch) {
      return retry(async () => {
        const [snapshot] = await db.run([op("event.get", patch.id)]);
        const current = eventFromRow(only(snapshot));
        validateEvent(patch.allDay ?? current.allDay,
          patch.startAt === undefined ? current.startAt : patch.startAt,
          patch.endAt === undefined ? current.endAt : patch.endAt);
        const operations: Operation[] = [check("event.get", snapshot, patch.id)];
        if (patch.title !== undefined) operations.push(op("event.title", patch.title, patch.id));
        if (patch.description !== undefined) operations.push(op("event.description", patch.description, patch.id));
        if (patch.startAt !== undefined) operations.push(op("event.start", patch.startAt, patch.id));
        if (patch.endAt !== undefined) operations.push(op("event.end", patch.endAt, patch.id));
        if (patch.allDay !== undefined) operations.push(op("event.allDay", patch.allDay, patch.id));
        operations.push(op("event.touch", now(), patch.id));
        return eventAfter(operations, patch.id);
      });
    },
    async deleteEvent(id: string) {
      await db.run([op("event.delete", now(), id)]);
    },
  };
}

/** Tauri implementation of the app's storage contract. */
export function createTauriCrud(db: Database = tauriDatabase, localTime: LocalTime = tauriLocalTime): CrudRepository {
  return {
    ...createTaskCrud(db, localTime),
    ...createLabelCrud(db),
    ...createJournalCrud(db),
    ...createEventCrud(db),
  };
}
