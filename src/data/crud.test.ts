import { afterEach, expect, test } from "bun:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { Window } from "happy-dom";
import type { Database, Operation } from "./database";
import { advanceReminder, type LocalTime } from "./local-time";
import { advanceDue, localTimestamp } from "./recurrence";
import { createTauriCrud } from "./tauri-crud";
import { localTimeForTests, TestDatabase } from "../../tests/crud-fixture";

const databases: TestDatabase[] = [];
function setup() {
  const db = new TestDatabase();
  databases.push(db);
  return { db, repository: createTauriCrud(db, localTimeForTests) };
}
afterEach(() => { for (const db of databases.splice(0)) db.sqlite.close(); });

test("task and label CRUD preserves patches, reminder state, associations, and soft-delete cascades", async () => {
  const { db, repository } = setup();
  const label = await repository.createLabel("  Home  ", "#123456");
  const task = await repository.createTask({ title: "  Read  ", notes: "notes", dueDate: "2026-11-06",
    remindAt: "2026-11-06T09:00:00+08:00", labelIds: [label.id], estimateMinutes: 20 });
  expect(task).toMatchObject({ title: "Read", notes: "notes", status: "active", priority: 4, labelIds: [label.id] });
  expect((await repository.listLabels())[0].name).toBe("Home");
  db.sqlite.query("UPDATE tasks SET notified=2, last_notified_at='old', reminder_ack_at='old' WHERE id=?").run(task.id);
  const changed = await repository.updateTask({ id: task.id, notes: null, remindAt: null, pinned: true, subtasks: [{ id: 1, text: "part", done: false }] });
  expect(changed).toMatchObject({ notes: null, dueDate: "2026-11-06", remindAt: null, pinned: true, labelIds: [label.id] });
  expect(changed.subtasks).toEqual([{ id: 1, text: "part", done: false }]);
  expect(db.sqlite.query("SELECT notified, last_notified_at, reminder_ack_at FROM tasks WHERE id=?").get(task.id))
    .toEqual({ notified: 0, last_notified_at: null, reminder_ack_at: null });
  await repository.updateLabel(label.id, "  Renamed  ", "#abcdef");
  expect(await repository.listLabels()).toMatchObject([{ name: "Renamed", color: "#abcdef" }]);
  db.sqlite.query("INSERT INTO time_sessions (id, task_id, start_at, updated_at) VALUES ('s', ?, 'start', 'start')").run(task.id);
  await repository.deleteTask(task.id);
  expect(await repository.listTasks()).toEqual([]);
  expect(db.sqlite.query("SELECT deleted_at FROM task_labels WHERE task_id=?").get(task.id)).toMatchObject({ deleted_at: expect.any(String) });
  expect(db.sqlite.query("SELECT deleted_at FROM time_sessions WHERE task_id=?").get(task.id)).toMatchObject({ deleted_at: expect.any(String) });
  await repository.deleteLabel(label.id);
  expect(await repository.listLabels()).toEqual([]);
  const nextLabel = await repository.createLabel("Work", "#112233");
  const nextTask = await repository.createTask({ title: "Still live", labelIds: [nextLabel.id] });
  await repository.deleteLabel(nextLabel.id);
  expect((await repository.listTasks()).find((item) => item.id === nextTask.id)?.labelIds).toEqual([]);
  expect(db.sqlite.query("SELECT deleted_at FROM task_labels WHERE task_id=? AND label_id=?").get(nextTask.id, nextLabel.id))
    .toMatchObject({ deleted_at: expect.any(String) });
});

test("failed task and label writes roll back the whole transaction", async () => {
  const { db, repository } = setup();
  await expect(repository.createTask({ title: "bad", labelIds: ["missing"] })).rejects.toThrow();
  expect(db.sqlite.query("SELECT COUNT(*) AS n FROM tasks").get()).toEqual({ n: 0 });
  const label = await repository.createLabel("Home", "#000000");
  const task = await repository.createTask({ title: "keep", labelIds: [label.id] });
  await expect(repository.updateTask({ id: task.id, title: "must roll back", labelIds: ["missing"] })).rejects.toThrow();
  expect((await repository.listTasks())[0]).toMatchObject({ title: "keep", labelIds: [label.id] });
});

test("task decoding and title trimming retain the original Rust behavior", async () => {
  const { db, repository } = setup();
  const label = await repository.createLabel("\u0085Home\u0085", "#000000");
  const task = await repository.createTask({ title: "\uFEFFKeep\uFEFF", labelIds: [label.id] });
  expect(label.name).toBe("Home");
  expect(task.title).toBe("\uFEFFKeep\uFEFF");
  db.sqlite.query("UPDATE tasks SET subtasks=? WHERE id=?").run('[{"id":1,"text":"part","done":false,"extra":"ignored"}]', task.id);
  expect((await repository.listTasks())[0].subtasks).toEqual([{ id: 1, text: "part", done: false }]);
  db.sqlite.query("UPDATE tasks SET subtasks=? WHERE id=?").run('[{"id":1,"text":"part","done":"no"}]', task.id);
  expect((await repository.listTasks())[0].subtasks).toEqual([]);
});

test("the Tauri adapter sends named batches through IPC and reads their results", async () => {
  const { db } = setup();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: new Window({ url: "http://localhost" }) });
  try {
    mockIPC((command, args) => {
      if (command === "local_reminder_parts") return localTimeForTests.parts((args as { timestamp: string }).timestamp);
      if (command === "local_reminder_timestamp") {
        const { date, time } = args as { date: string; time: string };
        return localTimeForTests.timestamp(date, time);
      }
      if (command !== "run_crud") throw new Error(`Unexpected IPC command: ${command}`);
      const operations = (args as { operations: Operation[] }).operations;
      return db.run(operations);
    });
    const repository = createTauriCrud();
    const label = await repository.createLabel("Home", "#123456");
    const task = await repository.createTask({ title: "From quick add", labelIds: [label.id] });
    expect((await repository.listTasks())[0]).toMatchObject({ id: task.id, labelIds: [label.id] });
    const recurring = await repository.createTask({ title: "Repeat", dueDate: "2024-01-31",
      remindAt: localTimestamp(new Date(2024, 0, 31, 9, 30), ""), repeat: "monthly" });
    expect((await repository.toggleTask(recurring.id, true)).dueDate).toBe("2024-02-29");
  } finally {
    clearMocks();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("journal and event CRUD retains nullable patch semantics and rejects invalid ranges", async () => {
  const { repository } = setup();
  const entry = await repository.createJournal({ entryDate: "2026-11-06", title: "first", body: "body", mood: 3 });
  expect(await repository.updateJournal({ id: entry.id, title: null, mood: null })).toMatchObject({ title: null, mood: null, body: "body" });
  expect(await repository.listJournal()).toHaveLength(1);
  await repository.deleteJournal(entry.id);
  expect(await repository.listJournal()).toEqual([]);

  const event = await repository.createEvent({ title: "Meeting", startAt: "2026-11-06T09:00:00Z", endAt: "2026-11-06T10:00:00Z", description: "Agenda" });
  expect(await repository.updateEvent({ id: event.id, description: null })).toMatchObject({ description: null, allDay: false });
  await expect(repository.updateEvent({ id: event.id, title: "bad", endAt: "2026-11-06T08:00:00Z" })).rejects.toThrow("later than");
  await expect(repository.createEvent({ title: "bad date", startAt: "2026-02-30T09:00:00Z", endAt: "2026-03-01T10:00:00Z" })).rejects.toThrow("valid ISO");
  expect((await repository.listEvents())[0].title).toBe("Meeting");
  expect(await repository.updateEvent({ id: event.id, allDay: true, endAt: null })).toMatchObject({ allDay: true, endAt: null });
  await repository.deleteEvent(event.id);
  expect(await repository.listEvents()).toEqual([]);
  const precise = await repository.createEvent({ title: "Precise", startAt: "2026-11-06T09:00:00.000001Z", endAt: "2026-11-06T09:00:00.000002Z" });
  expect(precise.title).toBe("Precise");
  const leap = await repository.createEvent({ title: "Leap", startAt: "2016-12-31T23:59:60Z", endAt: "2017-01-01T00:00:00Z" });
  expect(leap.title).toBe("Leap");
  await expect(repository.updateEvent({ id: leap.id, startAt: "2017-01-01T00:00:00Z", endAt: "2016-12-31T23:59:60Z" })).rejects.toThrow("later than");
});

test("an event update retries when another window changes the range", async () => {
  const { db, repository } = setup();
  const event = await repository.createEvent({ title: "Meeting", startAt: "2026-11-06T09:00:00Z", endAt: "2026-11-06T12:00:00Z" });
  let injected = false;
  const concurrent: Database = { async run(operations) {
    const result = await db.run(operations);
    if (!injected && operations.length === 1 && operations[0].statement === "event.get") {
      injected = true;
      db.sqlite.query("UPDATE events SET end_at=? WHERE id=?").run("2026-11-06T10:30:00Z", event.id);
    }
    return result;
  } };
  await expect(createTauriCrud(concurrent).updateEvent({ id: event.id, startAt: "2026-11-06T11:00:00Z" })).rejects.toThrow("later than");
  expect((await repository.listEvents())[0]).toMatchObject({ startAt: "2026-11-06T09:00:00Z", endAt: "2026-11-06T10:30:00Z" });
});

test("recurring completion retries if another window reschedules the task", async () => {
  const { db, repository } = setup();
  const originalReminder = localTimestamp(new Date(2024, 0, 31, 9, 30), "");
  const updatedReminder = localTimestamp(new Date(2024, 1, 10, 10, 30), "");
  const task = await repository.createTask({ title: "monthly", dueDate: "2024-01-31", remindAt: originalReminder, repeat: "monthly" });
  let injected = false;
  const concurrent: Database = { async run(operations) {
    const rows = await db.run(operations);
    if (!injected && operations.length === 1 && operations[0].statement === "task.recurrence") {
      injected = true;
      db.sqlite.query("UPDATE tasks SET due_date=?, remind_at=? WHERE id=?").run("2024-02-10", updatedReminder, task.id);
    }
    return rows;
  } };
  const completed = await createTauriCrud(concurrent, localTimeForTests).toggleTask(task.id, true);
  expect(completed).toMatchObject({ dueDate: "2024-03-10", status: "active" });
  const reminder = new Date(completed.remindAt!);
  expect([reminder.getMonth() + 1, reminder.getDate(), reminder.getHours()]).toEqual([3, 10, 10]);
});

test("recurring completion advances dates, rearms reminders, and leaves the task active", async () => {
  const { db, repository } = setup();
  const remindAt = localTimestamp(new Date(2024, 0, 31, 9, 30), "");
  const task = await repository.createTask({ title: "monthly", dueDate: "2024-01-31", remindAt, repeat: "monthly" });
  db.sqlite.query("UPDATE tasks SET notified=2, last_notified_at='old', reminder_ack_at='old' WHERE id=?").run(task.id);
  const result = await repository.toggleTask(task.id, true);
  expect(result).toMatchObject({ status: "active", dueDate: "2024-02-29", completedAt: null });
  const reminder = new Date(result.remindAt!);
  expect([reminder.getFullYear(), reminder.getMonth() + 1, reminder.getDate(), reminder.getHours(), reminder.getMinutes()]).toEqual([2024, 2, 29, 9, 30]);
  expect(db.sqlite.query("SELECT notified, last_notified_at, reminder_ack_at FROM tasks WHERE id=?").get(task.id))
    .toEqual({ notified: 0, last_notified_at: null, reminder_ack_at: null });
  expect(advanceDue("2025-01-31", "monthly")).toBe("2025-02-28");
  expect(advanceDue("2024-02-29", "yearly")).toBe("2025-02-28");
  expect(advanceDue("2026-11-06", "weekdays")).toBe("2026-11-09");
  expect(advanceDue("2026-1-2", "daily")).toBe("2026-01-03");
  expect(advanceDue("9999-12-31", "daily")).toBe("+10000-01-01");
  expect(advanceDue("+10000-01-01", "daily")).toBe("+10000-01-02");
  expect(advanceDue("-1-1-1", "daily")).toBe("-0001-01-02");
  expect(advanceDue("+262142-12-31", "daily")).toBeNull();
  expect(await advanceReminder(localTimeForTests, "invalid", "daily")).toBeNull();
});

test("a valid legacy leap-second reminder survives recurring completion", async () => {
  const previous = process.env.TZ;
  process.env.TZ = "Etc/UTC";
  try {
    const { repository } = setup();
    const task = await repository.createTask({ title: "legacy", dueDate: "2016-12-31", remindAt: "2016-12-31 23:59:60.1Z", repeat: "daily" });
    const result = await repository.toggleTask(task.id, true);
    expect(result).toMatchObject({ status: "active", dueDate: "2017-01-01", remindAt: "2017-01-01T23:59:60.100+00:00" });
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("recurrence delegates nonexistent local times to the platform", async () => {
  const calls: string[] = [];
  const skippedTime: LocalTime = {
    async parts() { return { date: "2026-03-07", time: "02:30:00" }; },
    async timestamp(date, time) { calls.push(`${date} ${time}`); return null; },
  };
  expect(await advanceReminder(skippedTime, "2026-03-07T02:30:00-05:00", "daily")).toBeNull();
  expect(calls).toEqual(["2026-03-08 02:30:00"]);
});

test("list and board moves renumber crowded indices without changing other columns", async () => {
  const { db, repository } = setup();
  db.sqlite.exec(`INSERT INTO tasks (id, title, created_at, updated_at, order_index, board_index, stage) VALUES
    ('a','a','2026-01-01T00:00:00Z','t',0,0,'doing'),
    ('b','b','2026-01-01T00:00:00Z','t',1,1,'doing'),
    ('c','c','2026-01-01T00:00:00Z','t',2,2,'doing'),
    ('z','z','2026-01-01T00:00:00Z','t',9,7.5,'blocked');`);
  const moved = await repository.moveTaskToStage("c", "doing", 0);
  expect(moved.map((task) => task.id)).toEqual(["a", "c", "b"]);
  expect(moved.map((task) => task.boardIndex)).toEqual([0, 1, 2]);
  expect(db.sqlite.query("SELECT board_index FROM tasks WHERE id='z'").get()).toEqual({ board_index: 7.5 });
  const reordered = await repository.reorderTask("c", Number.MIN_VALUE);
  expect(reordered.map((task) => task.id)).toEqual(["a", "c", "b", "z"]);
  expect(reordered.map((task) => task.orderIndex)).toEqual([0, 1, 2, 3]);
  await repository.toggleTask("a", true);
  expect((await repository.moveTaskToStage("a", "blocked", 4))[0]).toMatchObject({ status: "active", completedAt: null, stage: "blocked" });
  await expect(repository.moveTaskToStage("a", "done", 0)).rejects.toThrow();
});

test("board renumbering combines default, missing and replaced stages", async () => {
  const { db, repository } = setup();
  db.sqlite.exec(`INSERT INTO board_columns (id, name, color, order_index, updated_at, deleted_at, replacement_id)
      VALUES ('old', 'Old', '#abcdef', 4, 't', 'deleted', 'todo');
    INSERT INTO tasks (id, title, created_at, updated_at, board_index, stage) VALUES
      ('a','a','2026-01-01T00:00:00Z','t',0,NULL),
      ('b','b','2026-01-01T00:00:00Z','t',0,'todo'),
      ('c','c','2026-01-01T00:00:00Z','t',0,'missing'),
      ('d','d','2026-01-01T00:00:00Z','t',0,'old');`);
  const moved = await repository.moveTaskToStage("a", "todo", 0);
  expect(moved.map((task) => task.id)).toEqual(["a", "b", "c", "d"]);
  expect(moved.map((task) => task.boardIndex)).toEqual([0, 1, 2, 3]);
});

test("list renumbering detects exhausted gaps at timestamp-sized indices", async () => {
  const { db, repository } = setup();
  db.sqlite.exec(`INSERT INTO tasks (id, title, created_at, updated_at, order_index) VALUES
    ('a','a','2026-01-01T00:00:00Z','t',1700000000000),
    ('b','b','2026-01-01T00:00:00Z','t',1700000000001),
    ('c','c','2026-01-01T00:00:00Z','t',1700000000002);`);
  expect(await repository.reorderTask("c", 1700000000000.5)).toHaveLength(1);
  const moved = await repository.reorderTask("c", 1700000000000.25);
  expect(moved.map((task) => task.id)).toEqual(["a", "c", "b"]);
  expect(moved.map((task) => task.orderIndex)).toEqual([0, 1, 2]);
});

test("repeated board drops retain their visible order through renumbering", async () => {
  const { db, repository } = setup();
  db.sqlite.exec(`INSERT INTO tasks (id, title, created_at, updated_at, order_index, board_index, stage) VALUES
    ('a','a','2026-01-01T00:00:00Z','t',0,0,'doing'),
    ('b','b','2026-01-01T00:00:00Z','t',1,1,'doing'),
    ('c','c','2026-01-01T00:00:00Z','t',2,2,'doing');`);
  for (let i = 0; i < 80; i++) {
    const rows = db.sqlite.query("SELECT id, board_index FROM tasks ORDER BY board_index, created_at, id").all() as { id: string; board_index: number }[];
    expect(rows[1].board_index).toBeGreaterThan(rows[0].board_index);
    await repository.moveTaskToStage("c", "doing", (rows[0].board_index + rows[1].board_index) / 2);
  }
  expect((db.sqlite.query("SELECT id FROM tasks ORDER BY board_index, created_at, id").all() as { id: string }[]).map((row) => row.id))
    .toEqual(["a", "c", "b"]);
});
