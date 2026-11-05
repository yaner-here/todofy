import { Trans, useTranslation } from "react-i18next";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import { parseQuickAdd } from "../lib/nlp";
import {
  DEFAULT_PROFILES,
  priorityColor,
  priorityTag,
  type PriorityProfile,
} from "../lib/priority";
import { repeatLabel } from "../lib/repeat";
import { combineDateTime, formatDue, formatTime, today } from "../lib/dates";
import type { Label, NewTask } from "../types";
import { BellIcon, CalendarIcon, FlagIcon, Logo, RepeatIcon } from "./Icons";

/**
 * The floating quick-capture window. Lives in its own transparent,
 * always-on-top Tauri window that the Ctrl+Alt+A global shortcut summons. It
 * shares the SQLite backend with the main app; after adding a task it emits
 * `todo-added` so an open main window refreshes.
 */
export function QuickCapture() {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [labels, setLabels] = useState<Label[]>([]);
  // This window has no store of its own, so the profiles behind the parsed
  // chip are fetched the way labels are, falling back to the built-ins.
  const [priorityProfiles, setPriorityProfiles] =
    useState<PriorityProfile[]>(DEFAULT_PROFILES);
  const inputRef = useRef<HTMLInputElement>(null);
  const shownAt = useRef(Date.now());

  const parsed = useMemo(() => parseQuickAdd(title, labels), [title, labels]);
  const hasChips =
    !!parsed.dueDate ||
    !!parsed.time ||
    parsed.priority !== null ||
    parsed.repeat !== null ||
    parsed.labelNames.length > 0;

  const focusInput = () =>
    requestAnimationFrame(() => inputRef.current?.focus());

  const dismiss = async () => {
    setTitle("");
    await getCurrentWindow().hide();
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const finalTitle = parsed.title.trim();
    if (!finalTitle) return;

    const finalTime = parsed.time;
    // A time or a recurrence needs a date to anchor to — default to today.
    const finalDue =
      parsed.dueDate || (finalTime || parsed.repeat ? today() : null);

    const task: NewTask = { title: finalTitle, priority: parsed.priority ?? 4 };
    if (finalDue) task.dueDate = finalDue;
    if (finalDue && finalTime)
      task.remindAt = combineDateTime(finalDue, finalTime);
    if (parsed.repeat) task.repeat = parsed.repeat;
    if (parsed.labelIds.length) task.labelIds = parsed.labelIds;

    try {
      await api.createTask(task);
      await emit("todo-added");
    } finally {
      await dismiss();
    }
  };

  useEffect(() => {
    // Labels are needed so `#tag` tokens resolve to real labels.
    api
      .listLabels()
      .then(setLabels)
      .catch(() => {});
    api
      .listPriorityProfiles()
      .then(setPriorityProfiles)
      .catch(() => {});

    const win = getCurrentWindow();
    focusInput();

    // Rust emits this each time it shows the window — reset, refetch labels
    // (in case they changed, or the initial load raced app startup), refocus.
    const unShow = win.listen("quick-show", () => {
      setTitle("");
      shownAt.current = Date.now();
      api
        .listLabels()
        .then(setLabels)
        .catch(() => {});
      api
        .listPriorityProfiles()
        .then(setPriorityProfiles)
        .catch(() => {});
      focusInput();
    });
    // Focus the input as soon as the window actually gains OS-level focus —
    // more reliable than a fixed delay, since `set_focus()` on the Rust side
    // can land after this component has already mounted. Dismiss on
    // click-away, ignoring the transient blur that can fire right as the
    // window is being shown.
    const unFocus = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        focusInput();
      } else if (Date.now() - shownAt.current > 200) {
        dismiss();
      }
    });

    return () => {
      unShow.then((f) => f());
      unFocus.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="quick-capture-stage">
      <form onSubmit={submit} className="quick-capture-card animate-fade-rise">
        <header className="quick-capture-header">
          <div>
            <Logo size={20} />
            <span>{t("tasks.quickCapture")}</span>
          </div>
          <span>todofy</span>
        </header>
        <div className="quick-capture-input-row">
          <input
            ref={inputRef}
            value={title}
            onInput={(e) => setTitle(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                dismiss();
              }
            }}
            placeholder={t("tasks.whatNeedsDoingTryPayRentFriday5pm")}
            className="quick-capture-input"
          />
          <button
            type="submit"
            disabled={!parsed.title.trim()}
            className="quick-capture-submit"
          >
            {t("tasks.addTask")} <kbd>↵</kbd>
          </button>
        </div>

        {hasChips ? (
          <div className="quick-capture-footer">
            {parsed.priority !== null && (
              <Chip color={priorityColor(parsed.priority, priorityProfiles)}>
                <FlagIcon width={11} height={11} />
                {priorityTag(parsed.priority, priorityProfiles)}
              </Chip>
            )}
            {parsed.dueDate && (
              <Chip>
                <CalendarIcon width={11} height={11} />
                {formatDue(parsed.dueDate).label}
              </Chip>
            )}
            {parsed.time && (
              <Chip>
                <BellIcon width={11} height={11} />
                {formatTime(parsed.time)}
              </Chip>
            )}
            {parsed.repeat && (
              <Chip>
                <RepeatIcon width={11} height={11} />
                {repeatLabel(parsed.repeat)}
              </Chip>
            )}
            {parsed.labelNames.map((name) => {
              const color = labels.find((l) => l.name === name)?.color;
              return (
                <Chip key={name} color={color}>
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: color }}
                  />
                  {name}
                </Chip>
              );
            })}
          </div>
        ) : (
          <div className="quick-capture-footer">
            <Trans i18nKey="tasks.captureSyntax" components={{ b: <b /> }} />
            <span>
              <kbd>Esc</kbd>{t("tasks.dismiss")}
            </span>
          </div>
        )}
      </form>
    </div>
  );
}

function Chip({
  color,
  children,
}: {
  color?: string;
  children: ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={
        color
          ? { background: color + "22", color }
          : {
              background: "var(--color-accent-soft)",
              color: "var(--color-accent)",
            }
      }
    >
      {children}
    </span>
  );
}
