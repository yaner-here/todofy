import { expect, test } from "bun:test";
import { TestDatabase } from "../../tests/crud-fixture";
import { createTimerRepository } from "./tauri-timer";

test("timer models come from SQLite after native transitions", async () => {
  const db = new TestDatabase();
  const calls: string[] = [];
  db.sqlite.exec("INSERT INTO tasks(id,title,created_at,updated_at,estimate_minutes) VALUES ('t','Read','now','now',15)");
  const timer = createTimerRepository(db, async (command) => {
    calls.push(command);
    if (command === "start_timer") {
      db.sqlite.exec("INSERT INTO time_sessions(id,task_id,start_at,resumed_at,accumulated,updated_at) VALUES ('s','t','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z',10,'now')");
    }
    if (command === "pause_timer") db.sqlite.exec("UPDATE time_sessions SET resumed_at=NULL, accumulated=20 WHERE id='s'");
    if (command === "pomodoro_start") db.sqlite.exec("UPDATE pomodoro SET phase='short',running=1,start_at='now',short_min=7 WHERE id=1");
  });
  try {
    expect(await timer.activeTimer()).toBeNull();
    expect(await timer.startTimer("t")).toEqual({
      taskId: "t", title: "Read", startAt: "2026-01-01T00:00:00Z",
      resumedAt: "2026-01-01T00:00:00Z", accumulated: 10, estimateMinutes: 15,
    });
    expect(await timer.pauseTimer()).toMatchObject({ resumedAt: null, accumulated: 20 });
    expect(await timer.pomodoroStart()).toMatchObject({ phase: "short", running: true, target: 420 });
    db.sqlite.exec("UPDATE time_sessions SET end_at='2026-01-01T01:00:00Z',seconds=20 WHERE id='s'");
    expect(await timer.focusHistory(0)).toEqual([{
      id: "s", taskId: "t", title: "Read", startAt: "2026-01-01T00:00:00Z",
      endAt: "2026-01-01T01:00:00Z", seconds: 20,
    }]);
    expect(calls).toEqual(["active_timer", "start_timer", "pause_timer", "pomodoro_start"]);
  } finally { db.sqlite.close(); }
});
