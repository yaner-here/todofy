import { invoke } from "@tauri-apps/api/core";
import type { ActiveTimer, Pomodoro, PomodoroPhase, SessionLog } from "../types";
import { op, tauriDatabase, type Database } from "./database";

type NativeCall = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
const nativeCall: NativeCall = (command, args) => invoke(command, args);

/** Native code maintains background timers; TypeScript owns their public models. */
export function createTimerRepository(db: Database = tauriDatabase, call: NativeCall = nativeCall) {
  async function readActive(): Promise<ActiveTimer | null> {
    const [rows] = await db.run([op("timer.active")]);
    return rows.length ? rows[0] as unknown as ActiveTimer : null;
  }

  async function readPomodoro(): Promise<Pomodoro> {
    const [rows] = await db.run([op("timer.pomodoro")]);
    if (rows.length !== 1) throw new Error("Pomodoro state is unavailable");
    const row = rows[0] as unknown as Omit<Pomodoro, "target" | "running"> & { running: number };
    const phase: PomodoroPhase = row.phase;
    const minutes = phase === "short" ? row.shortMin : phase === "long" ? row.longMin : row.focusMin;
    return { ...row, phase, running: row.running !== 0, target: minutes * 60 };
  }

  async function activeAfter(command: string, args?: Record<string, unknown>): Promise<ActiveTimer | null> {
    await call(command, args);
    return readActive();
  }

  async function pomodoroAfter(command: string, args?: Record<string, unknown>): Promise<Pomodoro> {
    await call(command, args);
    return readPomodoro();
  }

  return {
    activeTimer: () => activeAfter("active_timer"),
    startTimer: (id: string) => activeAfter("start_timer", { id }),
    pauseTimer: () => activeAfter("pause_timer"),
    resumeTimer: () => activeAfter("resume_timer"),
    stopTimer: async () => { await call("stop_timer"); },
    async focusHistory(limit = 200): Promise<SessionLog[]> {
      const [rows] = await db.run([op("timer.history", limit <= 0 ? 200 : limit)]);
      return rows as unknown as SessionLog[];
    },
    getPomodoro: () => pomodoroAfter("get_pomodoro"),
    pomodoroStart: () => pomodoroAfter("pomodoro_start"),
    pomodoroPause: () => pomodoroAfter("pomodoro_pause"),
    pomodoroReset: () => pomodoroAfter("pomodoro_reset"),
    pomodoroNext: () => pomodoroAfter("pomodoro_next"),
    setPomodoroConfig: (focusMin: number, shortMin: number, longMin: number, longEvery: number) =>
      pomodoroAfter("set_pomodoro_config", { focusMin, shortMin, longMin, longEvery }),
  };
}
