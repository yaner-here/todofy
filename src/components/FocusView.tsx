import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { PomodoroPhase, SessionLog } from "../types";
import { api } from "../lib/api";
import { clock, formatDuration, secondsSince } from "../lib/duration";
import { toLocalDate, today } from "../lib/dates";
import { PauseIcon, PlayIcon, RotateIcon, SkipIcon, TimerIcon } from "./Icons";

const PHASE_LABEL: Record<PomodoroPhase, string> = {
  focus: "Focus",
  short: "Short break",
  long: "Long break",
};

export function FocusView() {
  const {
    pomodoro,
    pomodoroStart,
    pomodoroPause,
    pomodoroReset,
    pomodoroNext,
    setPomodoroConfig,
    activeTimer,
  } = useStore();

  const [history, setHistory] = useState<SessionLog[]>([]);
  const [, setNow] = useState(Date.now());

  // Reload history whenever a session ends (activeTimer transitions to null).
  useEffect(() => {
    api
      .focusHistory()
      .then(setHistory)
      .catch(() => {});
  }, [activeTimer]);

  // Tick while the Pomodoro runs so the countdown updates.
  useEffect(() => {
    if (!pomodoro?.running) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [pomodoro?.running]);

  const p = pomodoro;
  const elapsed = p
    ? p.accumulated + (p.running && p.startAt ? secondsSince(p.startAt) : 0)
    : 0;
  const remaining = p ? p.target - elapsed : 0;
  const overtime = remaining < 0;

  return (
    <main className="redesign-secondary focus-main flex flex-1 flex-col overflow-hidden bg-bg">
      <header className="app-page-header shrink-0 px-8 pt-8 pb-4">
        <h2 className="text-2xl font-semibold tracking-tight">Focus</h2>
        <p className="mt-0.5 text-sm text-muted">
          Run a Pomodoro, tune its lengths, and review your focus history
        </p>
      </header>

      <div className="secondary-scroll focus-content mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 pt-2 pb-8">
        {p && (
          <section className="focus-timer-panel mb-6 flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-6 py-8">
            <div className="focus-panel-topline">
              <span
                className={`focus-phase ${
                  p.phase === "focus"
                    ? "bg-accent-soft text-(--color-accent)"
                    : "bg-surface-2 text-success"
                }`}
              >
                <TimerIcon width={14} height={14} />
                {PHASE_LABEL[p.phase]} session
              </span>
              <span>
                Round {(p.completedFocus % p.longEvery) + 1} of {p.longEvery}
              </span>
            </div>

            <span
              className={`focus-clock ${
                overtime ? "text-(--color-warning)" : "text-text"
              }`}
            >
              {clock(remaining)}
            </span>

            <p className="focus-prompt">
              Pick one outcome. Everything else can wait until the timer ends.
            </p>

            <div className="focus-controls">
              <button
                onClick={pomodoroReset}
                title="Reset phase"
                className="grid h-11 w-11 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <RotateIcon width={18} height={18} />
              </button>
              <button
                onClick={p.running ? pomodoroPause : pomodoroStart}
                className="grid h-14 w-14 place-items-center rounded-full bg-(--color-accent) text-white transition-colors hover:bg-accent-hover"
                title={p.running ? "Pause" : "Start"}
              >
                {p.running ? (
                  <PauseIcon width={24} height={24} />
                ) : (
                  <PlayIcon width={24} height={24} />
                )}
              </button>
              <button
                onClick={pomodoroNext}
                title="Skip to next phase"
                className="grid h-11 w-11 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <SkipIcon width={18} height={18} />
              </button>
            </div>

            <div className="focus-session-progress">
              <span
                style={{
                  width: `${Math.min(100, Math.max(4, (elapsed / Math.max(1, p.target)) * 100))}%`,
                }}
              />
            </div>
          </section>
        )}

        {p && (
          <aside className="focus-side-panel">
            <div className="focus-side-heading">
              <p>Session plan</p>
              <span>Adjust the rhythm to match your energy.</span>
            </div>
            <div className="focus-length-grid">
              <NumberField
                label="Focus"
                value={p.focusMin}
                onCommit={(v) =>
                  setPomodoroConfig(v, p.shortMin, p.longMin, p.longEvery)
                }
              />
              <NumberField
                label="Short break"
                value={p.shortMin}
                onCommit={(v) =>
                  setPomodoroConfig(p.focusMin, v, p.longMin, p.longEvery)
                }
              />
              <NumberField
                label="Long break"
                value={p.longMin}
                onCommit={(v) =>
                  setPomodoroConfig(p.focusMin, p.shortMin, v, p.longEvery)
                }
              />
              <NumberField
                label="Long every"
                value={p.longEvery}
                onCommit={(v) =>
                  setPomodoroConfig(p.focusMin, p.shortMin, p.longMin, v)
                }
              />
            </div>
            <div className="focus-rhythm-note">
              <span>Next</span>
              <strong>
                {p.phase === "focus" ? "Short recovery" : "Focus session"}
              </strong>
              <small>
                {p.phase === "focus"
                  ? `${p.shortMin} minutes away`
                  : `${p.focusMin} minutes`}
              </small>
            </div>
          </aside>
        )}

        <div className="focus-history-panel">
          <History sessions={history} />
        </div>
      </div>
    </main>
  );
}

function History({ sessions }: { sessions: SessionLog[] }) {
  const t = today();
  const weekAgo = toLocalDate(new Date(Date.now() - 6 * 86400000));
  const todayTotal = sum(
    sessions.filter((s) => toLocalDate(new Date(s.startAt)) === t),
  );
  const weekTotal = sum(
    sessions.filter((s) => toLocalDate(new Date(s.startAt)) >= weekAgo),
  );
  const allTotal = sum(sessions);

  // Group by local day, newest first (the list already arrives sorted desc).
  const groups: { day: string; items: SessionLog[] }[] = [];
  for (const s of sessions) {
    const day = toLocalDate(new Date(s.startAt));
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(s);
    else groups.push({ day, items: [s] });
  }

  return (
    <section>
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
        History
      </h3>

      <div className="mb-3 grid grid-cols-3 gap-3">
        <Stat label="Today" value={formatDuration(todayTotal)} />
        <Stat label="This week" value={formatDuration(weekTotal)} />
        <Stat label="Tracked total" value={formatDuration(allTotal)} />
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          No focus sessions yet. Press play on a task to start tracking.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="flex items-center justify-between border-b border-border bg-surface-2 px-4 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">
                  {dayLabel(g.day)}
                </span>
                <span className="text-[11px] text-faint">
                  {formatDuration(sum(g.items))}
                </span>
              </div>
              {g.items.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0"
                >
                  <TimerIcon
                    width={14}
                    height={14}
                    className="shrink-0 text-faint"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-text">
                    {s.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {timeRange(s.startAt, s.endAt)}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                    {formatDuration(s.seconds)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-3 text-center">
      <p className="text-lg font-semibold tabular-nums text-text">{value}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wider text-faint">
        {label}
      </p>
    </div>
  );
}

/** Small labelled number input that commits on blur / Enter. */
function NumberField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);

  const commit = () => {
    const n = Math.max(1, Math.round(Number(text) || value));
    if (n !== value) onCommit(n);
    setText(String(n));
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
        {label}
      </span>
      <input
        type="number"
        min={1}
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-(--color-accent)"
      />
    </label>
  );
}

function sum(sessions: SessionLog[]): number {
  return sessions.reduce((acc, s) => acc + s.seconds, 0);
}

function dayLabel(day: string): string {
  const t = today();
  if (day === t) return "Today";
  if (day === toLocalDate(new Date(Date.now() - 86400000))) return "Yesterday";
  return new Date(day + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function timeRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}
