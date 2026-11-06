import type {
  Event, EventPatch, JournalEntry, JournalPatch, Label, NewEvent,
  NewJournalEntry, NewTask, Task, TaskPatch,
} from "../types";

/** Storage contract used by the application, independent of Tauri and SQLite. */
export interface CrudRepository {
  listTasks(): Promise<Task[]>;
  createTask(task: NewTask): Promise<Task>;
  updateTask(patch: TaskPatch): Promise<Task>;
  reorderTask(id: string, orderIndex: number): Promise<Task[]>;
  moveTaskToStage(id: string, stage: string | null, boardIndex: number): Promise<Task[]>;
  toggleTask(id: string, done: boolean): Promise<Task>;
  deleteTask(id: string): Promise<void>;

  listLabels(): Promise<Label[]>;
  createLabel(name: string, color: string): Promise<Label>;
  updateLabel(id: string, name: string, color: string): Promise<Label>;
  deleteLabel(id: string): Promise<void>;

  listJournal(): Promise<JournalEntry[]>;
  createJournal(entry: NewJournalEntry): Promise<JournalEntry>;
  updateJournal(patch: JournalPatch): Promise<JournalEntry>;
  deleteJournal(id: string): Promise<void>;

  listEvents(): Promise<Event[]>;
  createEvent(event: NewEvent): Promise<Event>;
  updateEvent(patch: EventPatch): Promise<Event>;
  deleteEvent(id: string): Promise<void>;
}
