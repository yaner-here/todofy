import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { calendarConfigured, useCalendar } from "../lib/googleCalendar";
import { CalendarIcon, CloseIcon, GoogleIcon } from "./Icons";
import { Checkbox } from "./Checkbox";

export function CalendarSection() {
  const { session } = useAuth();
  const {
    ready,
    connected,
    email,
    busy,
    connect,
    disconnect,
    pushError,
    keepCompleted,
    setKeepCompleted,
    timedOnly,
    setTimedOnly,
  } = useCalendar();
  const [error, setError] = useState<string | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  // Builds without Google credentials don't advertise the feature at all.
  if (!calendarConfigured) return null;

  const onConnect = async () => {
    setError(null);
    const result = await connect();
    if (!result.ok) setError(result.error);
  };

  return (
    <section className="mb-6">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
        Calendar
      </h3>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {!session ? (
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
              <CalendarIcon width={18} height={18} />
            </span>
            <p className="text-sm text-muted">
              Sign in to your account above to push your tasks to Google
              Calendar.
            </p>
          </div>
        ) : !ready ? (
          <div className="px-4 py-3.5 text-sm text-muted">Loading…</div>
        ) : connected ? (
          <>
            <div className="flex items-center gap-3 px-4 py-3.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                <CalendarIcon width={18} height={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text">
                  {email ?? "Google Calendar connected"}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Your tasks push to a dedicated todofy calendar.
                </p>
              </div>
              <button
                onClick={() => {
                  setError(null);
                  setDisconnectOpen(true);
                }}
                disabled={busy}
                className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
              >
                {busy ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
            <PushStatusRow />
            <div className="flex items-center gap-3 border-t border-border px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">
                  Keep completed tasks
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Leave finished tasks on the calendar with a ✓ instead of
                  removing them when done.
                </p>
              </div>
              <Switch
                checked={keepCompleted}
                onChange={() => void setKeepCompleted(!keepCompleted)}
              />
            </div>
            <div className="flex items-center gap-3 border-t border-border px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">
                  Only tasks with a set time
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Skip date-only tasks and push only those with a specific
                  reminder time.
                </p>
              </div>
              <Switch
                checked={timedOnly}
                onChange={() => void setTimedOnly(!timedOnly)}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2.5 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
                <CalendarIcon width={18} height={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">
                  Connect Google Calendar
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Push tasks with a due date to a dedicated todofy calendar.
                </p>
              </div>
              <button
                onClick={() => void onConnect()}
                disabled={busy}
                className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-bg px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                <GoogleIcon width={14} height={14} />
                {busy ? "Waiting for browser…" : "Connect"}
              </button>
            </div>
            {(error ?? pushError) && (
              <p className="rounded-lg bg-(--color-danger)/10 px-3 py-2 text-xs text-(--color-danger)">
                {error ?? pushError}
              </p>
            )}
          </div>
        )}
      </div>

      {disconnectOpen && (
        <DisconnectModal
          busy={busy}
          error={error}
          onClose={() => setDisconnectOpen(false)}
          onConfirm={async (deleteRemote) => {
            setError(null);
            const result = await disconnect(deleteRemote);
            if (result.ok) setDisconnectOpen(false);
            else setError(result.error);
          }}
        />
      )}
    </section>
  );
}

function DisconnectModal({
  busy,
  error,
  onClose,
  onConfirm,
}: {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (deleteRemote: boolean) => Promise<void>;
}) {
  const [deleteRemote, setDeleteRemote] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="relative w-full max-w-sm animate-fade-rise overflow-hidden rounded-2xl border border-border-strong bg-elevated shadow-2xl shadow-black/50">
        <button
          onClick={onClose}
          title="Close"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-text"
        >
          <CloseIcon width={16} height={16} />
        </button>

        <div className="flex flex-col items-center gap-2 px-6 pt-8 pb-2 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted">
            <CalendarIcon width={24} height={24} />
          </span>
          <h3 className="text-lg font-semibold text-text">
            Disconnect Google Calendar
          </h3>
          <p className="text-xs text-muted">
            todofy will stop pushing tasks to your calendar.
          </p>
        </div>

        <div className="flex flex-col gap-3 px-6 pt-3 pb-6">
          <button
            type="button"
            role="checkbox"
            aria-checked={deleteRemote}
            onClick={() => setDeleteRemote((v) => !v)}
            className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              deleteRemote
                ? "border-(--color-danger)/50 bg-(--color-danger)/5"
                : "border-border bg-bg hover:bg-surface-2"
            }`}
          >
            <span className="mt-0.5">
              <Checkbox
                checked={deleteRemote}
                interactive={false}
                color="var(--color-danger)"
              />
            </span>
            <span className="text-xs text-text">
              Also delete the todofy calendar and its events from Google.
              <span className="mt-0.5 block text-muted">
                Leave unchecked to keep the calendar; reconnecting later resumes
                where you left off.
              </span>
            </span>
          </button>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-(--color-danger)/10 px-3 py-2 text-xs text-(--color-danger)"
            >
              {error}
            </p>
          )}

          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void onConfirm(deleteRemote)}
              disabled={busy}
              className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium text-white transition-colors disabled:opacity-50 ${
                deleteRemote
                  ? "bg-(--color-danger) hover:opacity-90"
                  : "bg-(--color-accent) hover:bg-accent-hover"
              }`}
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const PUSH_META = {
  idle: { dot: "bg-[var(--color-success)]", label: "Up to date" },
  pushing: { dot: "bg-[var(--color-warning)]", label: "Pushing…" },
  error: { dot: "bg-(--color-danger)", label: "Push failed" },
} as const;

function PushStatusRow() {
  const { status, lastPushedAt, pushError, push } = useCalendar();
  const meta = PUSH_META[status];
  const detail =
    status === "error"
      ? (pushError ?? "Something went wrong.")
      : lastPushedAt
        ? `Last pushed ${relativeTime(lastPushedAt)}`
        : "Nothing pushed yet";

  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-3">
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-text">{meta.label}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted">{detail}</p>
      </div>
      <button
        onClick={() => void push()}
        disabled={status === "pushing"}
        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
      >
        {status === "pushing" ? "Pushing…" : "Push now"}
      </button>
    </div>
  );
}

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-(--color-accent)" : "bg-surface-2"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function relativeTime(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
