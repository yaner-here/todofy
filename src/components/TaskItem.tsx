import { useTranslation } from "react-i18next";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useStore } from "../store";
import { formatDue, formatReminder, isPast } from "../lib/dates";
import type { Task } from "../types";
import {
  BellIcon,
  CheckCircleIcon,
  CheckIcon,
  FlagIcon,
  GripIcon,
  HourglassIcon,
  PauseIcon,
  PinIcon,
  PlayIcon,
  RepeatIcon,
  StopIcon,
  TimerIcon,
  TrashIcon,
} from "./Icons";
import { repeatLabel } from "../lib/repeat";
import { formatDuration, formatMinutes } from "../lib/duration";
import { displayPriorityName, priorityTag, profileFor, showsPriority } from "../lib/priority";
import { overEstimateBy, trackedElapsed, trackingState } from "../lib/tracking";
import { useTick } from "../lib/useTick";

const DUE_TONE: Record<string, string> = {
  overdue: "is-overdue",
  today: "is-today",
  soon: "is-soon",
  future: "is-future",
};

interface DragProps {
  reorderable?: boolean;
  dragging?: boolean;
  dropEdge?: "top" | "bottom" | null;
  rowRef?: (element: HTMLElement | null) => void;
  onHandlePointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function TaskItem({ task, drag }: { task: Task; drag?: DragProps }) {
  const { t } = useTranslation();
  const {
    labels,
    priorityProfiles,
    toggleTask,
    removeTask,
    patchTask,
    select,
    selectedId,
    requestConfirm,
    activeTimer,
    startTaskTimer,
    pauseTaskTimer,
    resumeTaskTimer,
    stopTaskTimer,
  } = useStore();
  const priority = profileFor(task.priority, priorityProfiles);
  const done = task.status === "done";
  const selected = selectedId === task.id;
  const taskLabels = labels.filter((label) => task.labelIds.includes(label.id));
  // A completed task is never late, so its reminder no longer colours the date.
  const lateReminder = !done && isPast(task.remindAt);
  const due = task.dueDate ? formatDue(task.dueDate, done ? null : task.remindAt) : null;
  const subtaskTotal = task.subtasks.length;
  const subtaskDone = task.subtasks.filter((subtask) => subtask.done).length;
  const tracking = trackingState(task.id, activeTimer);
  // A paused clock doesn't move, so there's nothing to re-render for.
  useTick(tracking === "running");
  const elapsed = trackedElapsed(task, activeTimer);
  const over = overEstimateBy(task, elapsed);

  return (
    <article
      ref={drag?.rowRef}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => select(task.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!event.repeat) select(task.id);
        }
      }}
      className={`task-row ${selected ? "is-selected" : ""} ${done ? "is-done" : ""} ${drag?.dragging ? "is-dragging" : ""} ${tracking !== "off" ? "is-tracked" : ""}`}
    >
      {drag?.dropEdge && <span className={`drop-indicator is-${drag.dropEdge}`} />}
      {drag?.reorderable && (
        <span
          onPointerDown={drag.onHandlePointerDown}
          onClick={(event) => event.stopPropagation()}
          className="task-drag-handle"
          title={t("tasks.dragToReorder")}
        >
          <GripIcon width={16} height={16} />
        </span>
      )}

      <button
        type="button"
        className="task-complete"
        style={!done ? { borderColor: priority.color } : undefined}
        title={done ? t("common.markActive") : t("common.complete")}
        onClick={(event) => {
          event.stopPropagation();
          toggleTask(task.id, !done);
        }}
      >
        {done && <CheckIcon width={12} height={12} strokeWidth={3} />}
      </button>

      <div className="task-row-title">
        <p>{task.title}</p>
        {subtaskTotal > 0 && (
          <span title={t("common.stepsDone", { done: subtaskDone, total: subtaskTotal })}>
            <CheckCircleIcon width={13} height={13} />
            {subtaskDone}/{subtaskTotal}
          </span>
        )}
      </div>

      <div className="task-row-meta">
        {showsPriority(task.priority, priorityProfiles) && (
          <span style={{ color: priority.color }} title={displayPriorityName(priority)}>
            <FlagIcon width={13} height={13} />
            {priorityTag(task.priority, priorityProfiles)}
          </span>
        )}
        {due && <span className={DUE_TONE[due.tone]}>{due.label}</span>}
        {task.remindAt && (
          <span
            className={lateReminder ? "is-overdue" : ""}
            title={
              lateReminder
                ? t("tasks.reminderPassed", { time: formatReminder(task.remindAt) })
                : formatReminder(task.remindAt)
            }
          >
            <BellIcon width={13} height={13} />{formatReminder(task.remindAt)}
          </span>
        )}
        {task.repeat && (
          <span title={t("tasks.repeatHint", { repeat: repeatLabel(task.repeat).toLowerCase() })}>
            <RepeatIcon width={13} height={13} />{repeatLabel(task.repeat)}
          </span>
        )}
        {task.estimateMinutes !== null && (
          <span title={t("tasks.estimatedHint", { duration: formatMinutes(task.estimateMinutes) })}>
            <HourglassIcon width={13} height={13} />{formatMinutes(task.estimateMinutes)}
          </span>
        )}
        {elapsed > 0 && (
          <span
            className={
              over > 0
                ? "is-over"
                : tracking === "running"
                  ? "is-tracking"
                  : tracking === "paused"
                    ? "is-held"
                    : ""
            }
            title={
              over > 0
                ? t("tasks.overEstimateHint", { over: formatDuration(over), estimate: formatMinutes(task.estimateMinutes ?? 0) })
                : tracking === "running"
                  ? t("tasks.trackingNow")
                  : tracking === "paused"
                    ? t("tasks.pausedTheClockIsHeld")
                    : t("common.timeTrackedOnThisTask")
            }
          >
            <TimerIcon width={13} height={13} />{formatDuration(elapsed)}
            {over > 0 ? ` (+${formatDuration(over)})` : tracking === "paused" ? " paused" : ""}
          </span>
        )}
        {taskLabels.map((label) => (
          <span key={label.id} className="task-label" style={{ color: label.color }}>
            <i style={{ background: label.color }} />{label.name}
          </span>
        ))}
      </div>

      <div className="task-row-actions">
        {!done && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (tracking === "off") startTaskTimer(task.id);
              else if (tracking === "running") pauseTaskTimer();
              else resumeTaskTimer();
            }}
            className={tracking === "running" ? "is-running" : tracking === "paused" ? "is-held" : ""}
            title={
              tracking === "running"
                ? t("focus.pauseTracking")
                : tracking === "paused"
                  ? t("focus.resumeTracking")
                  : t("tasks.startTrackingTime")
            }
          >
            {tracking === "running" ? (
              <PauseIcon width={15} height={15} />
            ) : (
              <PlayIcon width={15} height={15} />
            )}
          </button>
        )}
        {!done && tracking !== "off" && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              stopTaskTimer();
            }}
            className="is-running"
            title={t("tasks.stopTrackingAndBankTheTime")}
          >
            <StopIcon width={15} height={15} />
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            patchTask({ id: task.id, pinned: !task.pinned });
          }}
          className={task.pinned ? "is-pinned" : ""}
          title={task.pinned ? t("tasks.unpin") : t("tasks.pinToTop")}
        >
          <PinIcon width={15} height={15} />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            requestConfirm({
              title: t("tasks.deleteTitle"),
              message: t("common.deleteTaskMessage", { title: task.title }),
              confirmLabel: t("common.delete"),
              danger: true,
              onConfirm: () => removeTask(task.id),
            });
          }}
          title={t("common.delete")}
        >
          <TrashIcon width={15} height={15} />
        </button>
      </div>
    </article>
  );
}
