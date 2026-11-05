import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement as h, Fragment, useState } from "react";
import type { Root } from "react-dom/client";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { LanguageSnapshot, NewJournalEntry, NewTask, Task, TaskPatch } from "../types";

const dom = new Window({ url: "http://localhost" });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.navigator });
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  window: dom,
  MouseEvent: dom.MouseEvent,
  document: dom.document,
  HTMLElement: dom.HTMLElement,
  Element: dom.Element,
  HTMLInputElement: dom.HTMLInputElement,
  HTMLTextAreaElement: dom.HTMLTextAreaElement,
  KeyboardEvent: dom.KeyboardEvent,
  Event: dom.Event,
  PointerEvent: dom.PointerEvent,
  DOMRect: dom.DOMRect,
  localStorage: dom.localStorage,
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
});

const { createRoot } = await import("react-dom/client");
const { useStore } = await import("../store");
const { useKeyboard } = await import("./useKeyboard");
const { BoardView } = await import("../components/BoardView");
const { ConfirmDialog } = await import("../components/ConfirmDialog");
const { TaskDetail } = await import("../components/TaskDetail");
const { api } = await import("./api");
const { DEFAULT_COLUMNS } = await import("./board");
const { TaskList } = await import("../components/TaskList");
const { visibleTaskIds } = await import("../store");
const { EstimatePicker } = await import("../components/EstimatePicker");
const { ContextMenu } = await import("../components/ContextMenu");
const { QuickCapture } = await import("../components/QuickCapture");
const { QuickAdd } = await import("../components/QuickAdd");
const { JournalView } = await import("../components/JournalView");
const { NotificationPopup } = await import("../components/NotificationPopup");
const { SettingsView } = await import("../components/SettingsView");
const { FocusWidget } = await import("../components/FocusWidget");
const { DEFAULT_PROFILES, clampPriority } = await import("./priority");
const { i18n } = await import("./i18n");
const { initLanguage, setLanguage, useLanguageState } = await import("./language");

const initialState = useStore.getState();
let root: HTMLDivElement;
let reactRoot: Root;
const toggleTask = mock(async () => {});

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task", title: "Task", notes: null, dueDate: null, remindAt: null,
    status: "active", priority: 4, createdAt: "2026-01-01T00:00:00Z",
    completedAt: null, orderIndex: 0, pinned: false, repeat: null,
    estimateMinutes: null, stage: null, boardIndex: 0, trackedSeconds: 0,
    labelIds: [], subtasks: [], ...overrides,
  };
}

function KeyboardBoard() {
  useKeyboard();
  return h(BoardView, {});
}

function KeyboardConfirmation() {
  useKeyboard();
  return h(ConfirmDialog, {});
}

function KeyboardList() {
  useKeyboard();
  return h(TaskList, {});
}

function element<T extends HTMLElement>(selector: string): T {
  const found = root.querySelector(selector);
  if (!found) throw new Error(`Missing element: ${selector}`);
  return found as T;
}

function key(target: EventTarget, key: string, repeat = false) {
  target.dispatchEvent(new KeyboardEvent("keydown", {
    key, repeat, bubbles: true, cancelable: true,
  }));
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useLanguageState.setState({ preference: "auto", language: "en", revision: -1, error: null });
  dom.localStorage.clear();
  toggleTask.mockClear();
  useStore.setState({ ...initialState, view: { kind: "board" }, loading: false, tasks: [task()], toggleTask }, true);
  root = document.createElement("div");
  document.body.append(root);
  reactRoot = createRoot(root);
});

afterEach(async () => {
  await act(async () => reactRoot.unmount());
  root.remove();
  useStore.setState(initialState, true);
  clearMocks();
  await i18n.changeLanguage("en");
});

test("Enter opens a recurring board card without completing or advancing it", async () => {
  useStore.setState({ tasks: [task({ repeat: "daily" })] });
  await act(() => reactRoot.render(h(KeyboardBoard, {})));
  await act(() => key(element(".board-card"), "Enter"));
  expect(root.querySelector("[data-task-dialog]")).not.toBeNull();
  expect(useStore.getState().selectedId).toBe("task");
  expect(toggleTask).not.toHaveBeenCalled();
});

test("Enter on a nested completion button is owned by that button", async () => {
  useStore.setState({ selectedId: "task" });
  await act(() => reactRoot.render(h(KeyboardBoard, {})));
  const button = element<HTMLButtonElement>(".board-card .task-complete");
  await act(() => {
    key(button, "Enter");
    // Browsers synthesize this click for Enter on a native button.
    button.click();
  });
  expect(toggleTask).toHaveBeenCalledTimes(1);
});

test("confirmation Enter runs the confirmation without completing the background task", async () => {
  const confirm = mock(async () => {});
  useStore.setState({ selectedId: "task", confirm: { title: "Delete?", onConfirm: confirm } });
  await act(async () => reactRoot.render(h(KeyboardConfirmation, {})));
  await act(async () => key(document.body, "Enter"));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(toggleTask).not.toHaveBeenCalled();
});

test("Enter on Cancel does not run the confirmation", async () => {
  const confirm = mock(async () => {});
  useStore.setState({ selectedId: "task", confirm: { title: "Delete?", onConfirm: confirm } });
  await act(() => reactRoot.render(h(KeyboardConfirmation, {})));
  const cancel = element<HTMLButtonElement>("button");
  await act(() => { key(cancel, "Enter"); cancel.click(); });
  expect(confirm).not.toHaveBeenCalled();
  expect(toggleTask).not.toHaveBeenCalled();
  expect(useStore.getState().confirm).toBeNull();
});

test("holding a completion shortcut does not advance a recurring task repeatedly", async () => {
  useStore.setState({ selectedId: "task" });
  await act(() => reactRoot.render(h(KeyboardBoard, {})));
  await act(() => { key(document.body, "c"); key(document.body, "c", true); });
  expect(toggleTask).toHaveBeenCalledTimes(1);
});

function input(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function blur(field: HTMLInputElement) {
  field.dispatchEvent(new Event("focusout", { bubbles: true }));
}

test("synced title and notes refresh untouched fields without writing stale text back", async () => {
  const patchTask = mock(async (_patch: TaskPatch) => {});
  useStore.setState({ patchTask });
  await act(async () => reactRoot.render(h(TaskDetail, { taskId: "task" })));
  await act(async () => useStore.setState({ tasks: [task({ title: "Remote title", notes: "Remote notes" })] }));
  const title = element<HTMLInputElement>('[aria-label="Task title"]');
  const notes = element<HTMLInputElement>('[aria-label="Task notes"]');
  expect(title.value).toBe("Remote title");
  expect(notes.value).toBe("Remote notes");
  await act(async () => { blur(title); blur(notes); });
  expect(patchTask).not.toHaveBeenCalled();
});

test("sync preserves an unsaved title while refreshing untouched notes", async () => {
  const patchTask = mock(async (_patch: TaskPatch) => {});
  useStore.setState({ patchTask });
  await act(async () => reactRoot.render(h(TaskDetail, { taskId: "task" })));
  const title = element<HTMLInputElement>('[aria-label="Task title"]');
  await act(async () => input(title, "My unsaved title"));
  await act(async () => useStore.setState({ tasks: [task({ title: "Remote title", notes: "Remote notes" })] }));
  expect(title.value).toBe("My unsaved title");
  expect(element<HTMLInputElement>('[aria-label="Task notes"]').value).toBe("Remote notes");
  await act(async () => blur(title));
  expect(patchTask).toHaveBeenCalledWith({ id: "task", title: "My unsaved title" });
});

test("a save response preserves newer text typed while the save is pending", async () => {
  let finish!: () => void;
  useStore.setState({ patchTask: async (patch) => {
    await new Promise<void>((resolve) => { finish = resolve; });
    useStore.setState({ tasks: [task({ title: patch.title })] });
  } });
  await act(() => reactRoot.render(h(TaskDetail, { taskId: "task" })));
  const title = element<HTMLInputElement>('[aria-label="Task title"]');
  await act(() => input(title, "First edit"));
  await act(() => blur(title));
  await act(() => input(title, "Newer draft"));
  await act(async () => { finish(); await Promise.resolve(); });
  expect(title.value).toBe("Newer draft");
});

test("switching tasks resets drafts and cannot leak text into the next task", async () => {
  useStore.setState({ selectedId: "task", tasks: [task(), task({ id: "second", title: "Second task" })] });
  await act(() => reactRoot.render(h(TaskDetail, { taskId: undefined })));
  await act(() => input(element('[aria-label="Task title"]'), "Unsaved first task"));
  await act(() => useStore.getState().select("second"));
  expect(element<HTMLInputElement>('[aria-label="Task title"]').value).toBe("Second task");
});

test("a failed save preserves the draft and shows an actionable error", async () => {
  useStore.setState({ patchTask: async () => { throw new Error("Database unavailable"); } });
  await act(() => reactRoot.render(h(TaskDetail, { taskId: "task" })));
  const title = element<HTMLInputElement>('[aria-label="Task title"]');
  await act(() => input(title, "Keep this edit"));
  await act(async () => { blur(title); await Promise.resolve(); });
  expect(title.value).toBe("Keep this edit");
  expect(element('[role="alert"]').textContent).toContain("Could not save the title");
});

function completedTasks(count: number) {
  return Array.from({ length: count }, (_, i) => task({
    id: `done-${i}`, title: `Completed ${i}`, status: "done", orderIndex: i,
    completedAt: new Date(Date.UTC(2026, 0, count - i)).toISOString(),
  }));
}

test("Completed keyboard navigation follows page two and stops at its boundary", async () => {
  useStore.setState({ view: { kind: "completed" }, tasks: completedTasks(32) });
  useStore.getState().setCompletedPage(2);
  await act(() => reactRoot.render(h(KeyboardList, {})));
  const displayed = Array.from(root.querySelectorAll(".task-row-title p"), (row) => row.textContent);
  expect(displayed).toEqual(Array.from({ length: 15 }, (_, i) => `Completed ${i + 15}`));
  expect(visibleTaskIds(useStore.getState().tasks, { kind: "completed" })).toEqual(
    Array.from({ length: 15 }, (_, i) => `done-${i + 15}`),
  );
  await act(() => key(document.body, "j"));
  expect(useStore.getState().selectedId).toBe("done-15");
  await act(() => { for (let i = 0; i < 20; i++) key(document.body, "j"); });
  expect(useStore.getState().selectedId).toBe("done-29");
});

test("search resets Completed to page one and clears the previous selection", async () => {
  useStore.setState({ view: { kind: "completed" }, tasks: completedTasks(32) });
  useStore.getState().setCompletedPage(2);
  useStore.getState().select("done-20");
  await act(() => reactRoot.render(h(KeyboardList, {})));
  await act(() => useStore.getState().setSearchQuery("Completed 31"));
  expect(useStore.getState().completedPage).toBe(1);
  expect(useStore.getState().selectedId).toBeNull();
  expect(root.querySelectorAll(".task-row")).toHaveLength(1);
  await act(() => key(document.body, "j"));
  expect(useStore.getState().selectedId).toBe("done-31");
});

test("removing the last Completed page clamps both the list and keyboard navigation", async () => {
  const tasks = completedTasks(32);
  useStore.setState({ view: { kind: "completed" }, tasks });
  useStore.getState().setCompletedPage(3);
  await act(() => reactRoot.render(h(KeyboardList, {})));
  await act(() => useStore.setState({ tasks: tasks.slice(0, 30) }));
  expect(useStore.getState().completedPage).toBe(2);
  expect(root.querySelectorAll(".task-row")).toHaveLength(15);
  await act(() => key(document.body, "j"));
  expect(useStore.getState().selectedId).toBe("done-15");
});

test("completion shortcuts cannot mutate an off-page selection", async () => {
  useStore.setState({ view: { kind: "completed" }, tasks: completedTasks(32) });
  useStore.getState().setCompletedPage(2);
  useStore.getState().select("done-0");
  await act(() => reactRoot.render(h(KeyboardList, {})));
  await act(() => key(document.body, "c"));
  expect(toggleTask).not.toHaveBeenCalled();
  expect(root.querySelector(".next-up-card")).toBeNull();
});

test("the board shows saved names and global WIP counts under search", async () => {
  useStore.setState({
    boardDefinitions: DEFAULT_COLUMNS.map((c) => ({ ...c, name: c.id === "doing" ? "Working" : c.name, wipLimit: c.id === "doing" ? 1 : null })),
    tasks: [task({ title: "Visible", stage: "doing" }), task({ id: "hidden", title: "Hidden", stage: "doing" })],
    searchQuery: "Visible",
  });
  await act(() => reactRoot.render(h(KeyboardBoard, {})));
  expect(element('[aria-label="Working"] .board-column-count').textContent).toBe("2/1");
  expect(element('[aria-label="Working"] .board-column-count').classList.contains("wip-over")).toBe(true);
  expect(element('[aria-label="Working"] small').textContent).toContain("1 shown");
});

test("column management saves name, color and WIP settings without task shortcuts", async () => {
  const update = mock(async (id: string, input: { name: string; color: string; wipLimit: number | null }) => {
    useStore.setState({ boardDefinitions: useStore.getState().boardDefinitions.map((c) => c.id === id ? { ...c, ...input } : c) });
  });
  useStore.setState({ selectedId: "task", updateBoardColumn: update });
  await act(() => reactRoot.render(h(KeyboardBoard, {})));
  await act(() => element<HTMLButtonElement>('[aria-label="Edit In progress column"]').click());
  const fields = root.querySelectorAll<HTMLInputElement>(".column-editor input");
  await act(() => { input(fields[0], "Writing"); input(fields[1], "#f26cc9"); input(fields[2], "3"); });
  await act(() => key(document.body, "c"));
  expect(toggleTask).not.toHaveBeenCalled();
  await act(async () => { element<HTMLButtonElement>('.column-editor button[type="submit"]').click(); await Promise.resolve(); });
  expect(update).toHaveBeenCalledWith("doing", { name: "Writing", color: "#f26cc9", wipLimit: 3 });
  expect(root.querySelector('[aria-label="Writing"]')).not.toBeNull();
});

test("column reorder buttons preserve Done last and the default destination", async () => {
  const reorder = mock(async (ids: string[]) => {
    useStore.setState({ boardDefinitions: useStore.getState().boardDefinitions.map((c) => ({ ...c, orderIndex: ids.indexOf(c.id) })) });
  });
  useStore.setState({ reorderBoardColumns: reorder });
  await act(() => reactRoot.render(h(KeyboardBoard, {})));
  await act(() => element<HTMLButtonElement>(".board-manage-button").click());
  await act(async () => { element<HTMLButtonElement>('[aria-label="Move To do right"]').click(); await Promise.resolve(); });
  expect(reorder).toHaveBeenCalledWith(["doing", "todo", "blocked", "done"]);
  expect(element<HTMLButtonElement>('[aria-label="Move Done right"]').disabled).toBe(true);
});

test("pointer dragging reorders columns and pointer cancellation leaves them unchanged", async () => {
  const reorder = mock(async (_ids: string[]) => {});
  useStore.setState({ reorderBoardColumns: reorder });
  await act(() => reactRoot.render(h(KeyboardBoard, {})));
  await act(() => element<HTMLButtonElement>(".board-manage-button").click());
  root.querySelectorAll<HTMLElement>(".column-manager-row").forEach((row, index) => {
    row.getBoundingClientRect = () => new DOMRect(0, index * 60, 400, 40);
  });
  const handle = element<HTMLButtonElement>('[aria-label="Drag Blocked to reorder"]');
  await act(() => {
    handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientY: 140, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointermove", { clientY: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
  });
  expect(reorder).not.toHaveBeenCalled();
  await act(async () => {
    handle.dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientY: 140, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointermove", { clientY: 0, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await Promise.resolve();
  });
  expect(reorder).toHaveBeenCalledWith(["blocked", "todo", "doing", "done"]);
});

test("deleting a column requires a destination and never offers protected column deletion", async () => {
  const remove = mock(async (_id: string, _destination: string) => {});
  useStore.setState({ deleteBoardColumn: remove });
  await act(() => reactRoot.render(h(KeyboardBoard, {})));
  await act(() => element<HTMLButtonElement>(".board-manage-button").click());
  expect(root.querySelectorAll(".column-delete")).toHaveLength(2);
  await act(() => element<HTMLButtonElement>(".column-delete").click());
  await act(async () => { element<HTMLButtonElement>(".column-danger-button").click(); await Promise.resolve(); });
  expect(remove).toHaveBeenCalledWith("doing", "todo");
});

test("moving into a full column succeeds and warns using unfiltered task totals", async () => {
  const tasks = [task({ id: "moving", stage: "todo" }), task({ id: "hidden", stage: "doing", title: "Hidden" })];
  useStore.setState({ tasks, searchQuery: "moving", boardDefinitions: DEFAULT_COLUMNS.map((c) => ({ ...c, wipLimit: c.id === "doing" ? 1 : null })) });
  const native = spyOn(api, "moveTaskToStage").mockImplementation(async (id, stage, boardIndex) => [task({ id, stage, boardIndex })]);
  try {
    await initialState.moveTaskToColumn("moving", "doing", 1);
    expect(useStore.getState().tasks.find((t) => t.id === "moving")?.stage).toBe("doing");
    expect(useStore.getState().boardNotice).toContain("2/1");
    await initialState.moveTaskToColumn("moving", "doing", 2);
    expect(useStore.getState().boardNotice).toBeNull();
  } finally { native.mockRestore(); }
});

test("moving a completed task uses one native move and warns about its new WIP count", async () => {
  useStore.setState({ tasks: [task({ status: "done" }), task({ id: "other", stage: "doing" })], boardDefinitions: DEFAULT_COLUMNS.map((c) => ({ ...c, wipLimit: c.id === "doing" ? 1 : null })) });
  const native = spyOn(api, "moveTaskToStage").mockImplementation(async (id, stage, boardIndex) => [task({ id, stage, boardIndex, status: "active" })]);
  try {
    await initialState.moveTaskToColumn("task", "doing", 1);
    expect(toggleTask).not.toHaveBeenCalled();
    expect(native).toHaveBeenCalledTimes(1);
    expect(useStore.getState().boardNotice).toContain("2/1");
  } finally { native.mockRestore(); }
});

test("canceling a card drag never commits a move", async () => {
  const move = mock(async (_id: string, _column: string, _index: number) => {});
  useStore.setState({ moveTaskToColumn: move });
  await act(() => reactRoot.render(h(KeyboardBoard, {})));
  root.querySelectorAll<HTMLElement>(".board-column").forEach((column, i) => {
    column.getBoundingClientRect = () => new DOMRect(i * 300, 0, 274, 400);
  });
  element<HTMLElement>(".board-columns").getBoundingClientRect = () => new DOMRect(0, 0, 1200, 400);
  await act(() => {
    element(".board-card").dispatchEvent(new PointerEvent("pointerdown", { button: 0, clientX: 40, clientY: 50, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 350, clientY: 50, bubbles: true, cancelable: true }));
    document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
  });
  expect(move).not.toHaveBeenCalled();
});

function EstimateForm() {
  const [minutes, setMinutes] = useState<number | null>(null);
  return h("form", null,
    h(EstimatePicker, { value: minutes, onChange: setMinutes }),
    h("output", null, minutes),
  );
}

test("custom estimates commit from the floating picker without submitting the form", async () => {
  await act(async () => reactRoot.render(h(EstimateForm)));
  await act(async () => element<HTMLButtonElement>('[title="Estimated time for this task"]').click());
  const field = document.querySelector<HTMLInputElement>('[aria-label="Custom estimate"]')!;
  expect(root.contains(field)).toBe(false);
  expect(field.isConnected).toBe(true);
  await act(async () => input(field, "1h 30m"));
  const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  await act(async () => { field.dispatchEvent(enter); });
  expect(enter.defaultPrevented).toBe(true);
  expect(element("output").textContent).toBe("90");
  expect(document.querySelector('[aria-label="Custom estimate"]')).toBeNull();
});

test("context-menu paste updates the controlled task title and saves the pasted text", async () => {
  const clipboard = spyOn(navigator.clipboard, "readText").mockResolvedValue("Pasted task");
  const save = spyOn(api, "updateTask").mockImplementation(async (patch) => task({ title: patch.title }));
  try {
    await act(async () => reactRoot.render(h(Fragment, null,
      h(TaskDetail, { taskId: "task" }), h(ContextMenu),
    )));
    const title = element<HTMLInputElement>('[aria-label="Task title"]');
    title.setSelectionRange(0, title.value.length);
    await act(async () => { title.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
    const paste = Array.from(root.querySelectorAll("button")).find((button) => button.textContent?.startsWith("Paste"))!;
    await act(async () => paste.click());
    expect(title.value).toBe("Pasted task");
    await act(async () => blur(title));
    expect(useStore.getState().tasks[0].title).toBe("Pasted task");
  } finally { clipboard.mockRestore(); save.mockRestore(); }
});

test("quick add creates a task and clears the draft", async () => {
  mockIPC((command, args) => {
    if (command === "create_task") {
      const draft = (args as { task: NewTask }).task;
      return task({ id: "new", title: draft.title, priority: clampPriority(draft.priority ?? 4) });
    }
    throw new Error(`Unexpected IPC command: ${command}`);
  });
  useStore.setState({ view: { kind: "inbox" }, labels: [], tasks: [] });
  await act(async () => reactRoot.render(h(QuickAdd)));
  const title = element<HTMLInputElement>("#quick-add-input");
  await act(async () => input(title, "Write report p1"));
  await act(async () => { element("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(useStore.getState().tasks[0]).toMatchObject({ title: "Write report", priority: 1 });
  expect(title.value).toBe("");
});

test("journal drafts save with the keyboard shortcut", async () => {
  mockIPC((command, args) => {
    if (command === "focus_history") return [];
    if (command === "create_journal") {
      const draft = (args as { entry: NewJournalEntry }).entry;
      return { ...draft, id: "entry", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    }
    throw new Error(`Unexpected IPC command: ${command}`);
  });
  useStore.setState({ journal: [] });
  await act(async () => reactRoot.render(h(JournalView)));
  const title = element<HTMLInputElement>(".journal-composer-title");
  const body = element<HTMLTextAreaElement>(".journal-composer-body");
  await act(async () => { input(title, "  Notes  "); input(body, "  Draft text  "); });
  await act(async () => body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })));
  expect(root.querySelector(".journal-entry")?.textContent).toContain("Notes");
  expect(root.querySelector(".journal-entry")?.textContent).toContain("Draft text");
  expect(title.value).toBe("");
  expect(body.value).toBe("");
});

test("quick capture submits the controlled draft to the native backend and clears it", async () => {
  const created: NewTask[] = [];
  let hidden = false;
  mockWindows("quickadd");
  mockIPC((command, args) => {
    switch (command) {
      case "list_labels": return [];
      case "list_priority_profiles": return DEFAULT_PROFILES;
      case "create_task": {
        created.push((args as { task: NewTask }).task);
        return task({ title: created[0].title, priority: 1 });
      }
      case "plugin:window|hide": hidden = true; return;
      default: throw new Error(`Unexpected IPC command: ${command}`);
    }
  }, { shouldMockEvents: true });
  await act(async () => reactRoot.render(h(QuickCapture)));
  const title = element<HTMLInputElement>("input");
  await act(async () => input(title, "Capture draft p1"));
  await act(async () => { element("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(created).toEqual([{ title: "Capture draft", priority: 1 }]);
  expect(title.value).toBe("");
  expect(hidden).toBe(true);
});

test("a pending reminder renders and snoozing does not open the task", async () => {
  const commands: string[] = [];
  mockWindows("notification");
  mockIPC((command) => {
    commands.push(command);
    if (command === "notify_popup_pending") return {
      nonce: 1, kind: "reminder", title: "Review report", body: "Due now",
      accent: "#f2555a", task_id: "task",
    };
  }, { shouldMockEvents: true });
  await act(async () => reactRoot.render(h(NotificationPopup)));
  expect(element(".notification-title").textContent).toBe("Review report");
  expect(element(".notification-card").style.color).toBe("#f2555a");
  await act(async () => element<HTMLButtonElement>(".notification-actions button").click());
  expect(commands).toContain("snooze_task");
  expect(commands).not.toContain("notify_popup_open");
  expect(root.querySelector(".notification-card")).toBeNull();
});

test("the volume slider previews each step but persists only the committed value", async () => {
  const settings = new Map<string, string>();
  mockWindows("main");
  mockIPC((command, args) => {
    const setting = args as { key: string; value: string };
    if (command === "get_setting") return settings.get(setting.key) ?? null;
    if (command === "set_setting") settings.set(setting.key, setting.value);
    if (command === "plugin:app|version") return "1.15.0";
  }, { shouldMockEvents: true });
  await act(async () => reactRoot.render(h(SettingsView)));
  const slider = element<HTMLInputElement>('[aria-label="Reminder volume"]');
  await act(async () => input(slider, "35"));
  expect(slider.value).toBe("35");
  expect(settings.has("reminder_volume")).toBe(false);
  await act(async () => { slider.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(settings.get("reminder_volume")).toBe("35");
});

test("a newer language event wins over a delayed startup read", async () => {
  let resolveRead!: (snapshot: LanguageSnapshot) => void;
  let readStarted!: () => void;
  const reading = new Promise<void>((resolve) => { readStarted = resolve; });
  mockIPC((command) => {
    if (command === "get_language") {
      readStarted();
      return new Promise<LanguageSnapshot>((resolve) => { resolveRead = resolve; });
    }
  }, { shouldMockEvents: true });
  const initializing = initLanguage();
  await reading;
  await emit("language-changed", { preference: "zh-CN", language: "zh-CN", revision: 2 });
  resolveRead({ preference: "auto", language: "en", revision: 0 });
  const off = await initializing;
  expect(useLanguageState.getState().revision).toBe(2);
  expect(i18n.resolvedLanguage).toBe("zh-CN");
  expect(document.documentElement.lang).toBe("zh-CN");
  off();
});

test("late windows restore the saved language and changing auto to the same language still saves the preference", async () => {
  let saved: LanguageSnapshot = { preference: "auto", language: "zh-CN", revision: 0 };
  mockIPC((command, args) => {
    if (command === "get_language") return saved;
    if (command === "set_language") {
      saved = { ...saved, preference: (args as { preference: LanguageSnapshot["preference"] }).preference, revision: saved.revision + 1 };
      return saved;
    }
  }, { shouldMockEvents: true });
  const off = await initLanguage();
  try {
    expect(i18n.resolvedLanguage).toBe("zh-CN");
    await setLanguage("zh-CN");
    expect(useLanguageState.getState().preference).toBe("zh-CN");
    expect(saved.revision).toBe(1);
  } finally { off(); }
  // A fresh webview has no prior revision and reads the native persisted value.
  useLanguageState.setState({ preference: "auto", language: "en", revision: -1 });
  await i18n.changeLanguage("en");
  const offLate = await initLanguage();
  try {
    expect(useLanguageState.getState().preference).toBe("zh-CN");
    expect(i18n.resolvedLanguage).toBe("zh-CN");
  } finally { offLate(); }
});

test("a failed language event subscription stays visible even when the initial read succeeds", async () => {
  mockIPC((command) => {
    if (command === "plugin:event|listen") throw new Error("Event subscription failed");
    if (command === "get_language") return { preference: "en", language: "en", revision: 0 };
  });
  const off = await initLanguage();
  try {
    expect(i18n.resolvedLanguage).toBe("en");
    expect(useLanguageState.getState().error).toContain("Event subscription failed");
  } finally { off(); }
});

test("language switching preserves an unsaved task draft, user text, and the mounted editor", async () => {
  const commands: string[] = [];
  useStore.setState({ tasks: [task({ notes: "用户原文 <b>notes</b>" })] });
  mockIPC((command) => {
    commands.push(command);
    if (command === "get_language") return { preference: "en", language: "en", revision: 0 };
  }, { shouldMockEvents: true });
  const off = await initLanguage();
  try {
    await act(async () => reactRoot.render(h(TaskDetail, { taskId: "task" })));
    const field = element<HTMLInputElement>('[aria-label="Task title"]');
    await act(async () => input(field, 'My draft 中文 <script>alert(1)</script>'));
    document.title = "todofy (3)";
    await act(async () => emit("language-changed", { preference: "zh-CN", language: "zh-CN", revision: 1 }));
    expect(element<HTMLInputElement>('[aria-label="任务标题"]')).toBe(field);
    expect(field.value).toBe('My draft 中文 <script>alert(1)</script>');
    expect(element<HTMLInputElement>('[aria-label="任务备注"]').value).toBe("用户原文 <b>notes</b>");
    expect(root.querySelector("script")).toBeNull();
    expect(document.title).toBe("todofy (3)");
    expect(commands).not.toContain("update_task");
  } finally { off(); }
});

test("a language save failure keeps the previous selection and shows the error", async () => {
  mockWindows("main");
  mockIPC((command) => {
    if (command === "get_language") return { preference: "en", language: "en", revision: 0 };
    if (command === "set_language") throw new Error("Database is read-only");
    if (command === "plugin:app|version") return "1.15.0";
  }, { shouldMockEvents: true });
  const off = await initLanguage();
  try {
    await act(async () => reactRoot.render(h(SettingsView)));
    const select = element<HTMLSelectElement>('[aria-label="App language"]');
    await act(async () => {
      select.value = "zh-CN";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select.value).toBe("en");
    expect(i18n.resolvedLanguage).toBe("en");
    expect(element('[role="alert"]').textContent).toContain("Database is read-only");
    expect(select.disabled).toBe(false);
  } finally { off(); }
});

test("an active notification translates controls without replacing its content, progress cycle, or acknowledgement", async () => {
  const commands: string[] = [];
  mockWindows("notification");
  mockIPC((command) => {
    commands.push(command);
    if (command === "get_language") return { preference: "en", language: "en", revision: 0 };
    if (command === "notify_popup_pending") return {
      nonce: 7, kind: "reminder", title: 'Review <script>alert(1)</script>', body: "Reminder snapshot",
      accent: null, task_id: "task",
    };
  }, { shouldMockEvents: true });
  const off = await initLanguage();
  try {
    await act(async () => reactRoot.render(h(NotificationPopup)));
    const progress = element(".notification-progress");
    await act(async () => emit("language-changed", { preference: "zh-CN", language: "zh-CN", revision: 1 }));
    expect(element(".notification-progress")).toBe(progress);
    expect(element(".notification-title").textContent).toBe('Review <script>alert(1)</script>');
    expect(element(".notification-body").textContent).toBe("Reminder snapshot");
    expect(element(".notification-dismiss").title).toBe("关闭");
    expect(element(".notification-actions").textContent).toContain("分钟");
    expect(root.querySelector("script")).toBeNull();
    expect(commands.filter((command) => command === "notify_popup_ack")).toHaveLength(1);
    expect(commands).not.toContain("notify_popup_dismiss");
  } finally { off(); }
});

test("changing only a default column color in Chinese preserves its stored English name", async () => {
  mockIPC((command, args) => {
    if (command === "update_board_column") {
      const { id, input } = args as { id: string; input: { name: string; color: string; wipLimit: number | null } };
      return DEFAULT_COLUMNS.map((column) => column.id === id ? { ...column, ...input } : column);
    }
  });
  await act(async () => i18n.changeLanguage("zh-CN"));
  await act(() => reactRoot.render(h(KeyboardBoard)));
  await act(() => element<HTMLButtonElement>('[aria-label="编辑“进行中”列"]').click());
  const fields = root.querySelectorAll<HTMLInputElement>(".column-editor input");
  expect(fields[0].value).toBe("In progress");
  await act(() => input(fields[1], "#123456"));
  await act(async () => element<HTMLButtonElement>('.column-editor button[type="submit"]').click());
  const saved = useStore.getState().boardDefinitions.find((column) => column.id === "doing")!;
  expect(saved.name).toBe("In progress");
  expect(saved.color).toBe("#123456");
  expect(root.querySelector('[aria-label="进行中"]')).not.toBeNull();
});

test("UI language changes date words while keeping the clock and week-start preferences", async () => {
  const locale = await import("./locale");
  const { formatTime } = await import("./dates");
  const settings = new Map([["time_format", "24"], ["week_start", "1"]]);
  mockIPC((command, args) => {
    const setting = args as { key: string; value: string };
    if (command === "system_locale") return "en-US";
    if (command === "get_setting") return settings.get(setting.key) ?? null;
    if (command === "set_setting") settings.set(setting.key, setting.value);
  });
  try {
    await locale.initLocale();
    expect(locale.appLocale()).toBe("en-US");
    expect(formatTime("13:05")).toBe("13:05");
    await i18n.changeLanguage("zh-CN");
    expect(locale.appLocale()).toBe("zh-Hans-US");
    expect(locale.usesHour12()).toBe(false);
    expect(locale.weekStart()).toBe(1);
    expect(locale.weekdayNames("long")[0]).toEqual({ index: 1, label: "星期一" });
    const range = locale.formatDateRange(new Date(2026, 10, 2), new Date(2026, 10, 8));
    expect(range).toContain("2026");
    expect(range).not.toContain("November");
    await locale.setTimeFormat("12");
    await locale.setWeekStart("6");
    expect(formatTime("13:05")).toContain("下午");
    expect(locale.weekdayNames("long")[0].index).toBe(6);
    await i18n.changeLanguage("en");
    expect(formatTime("13:05")).toBe("1:05 PM");
    expect(locale.weekStart()).toBe(6);
  } finally {
    settings.clear();
    await locale.initLocale();
  }
});

test.each([
  ["en", 1, "1 Focus session done"],
  ["en", 2, "2 Focus sessions done"],
  ["zh-CN", 1, "已完成 1 个专注时段"],
  ["zh-CN", 2, "已完成 2 个专注时段"],
] as const)("the focus widget count uses %s grammar for %i sessions", async (language, completedFocus, expected) => {
  useStore.setState({
    showFocus: true,
    activeTimer: null,
    pomodoro: {
      phase: "focus", running: true, startAt: null, accumulated: 0,
      completedFocus, target: 1500, focusMin: 25, shortMin: 5,
      longMin: 15, longEvery: 4,
    },
  });
  await act(async () => i18n.changeLanguage(language));
  await act(() => reactRoot.render(h(FocusWidget)));
  expect(root.textContent).toContain(expected);
});
