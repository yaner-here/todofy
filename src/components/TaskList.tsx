import { appLocale } from "../lib/locale";
import { t } from "../lib/i18n";
import { Trans, useTranslation } from "react-i18next";
import { useEffect } from "react";
import { lazy, Suspense } from "react";
import { applySearchAndFilters, tasksForView, useStore } from "../store";
import {
  completedTasksPage,
  COMPLETED_PAGE_SIZE,
  sectionsForView,
} from "../lib/grouping";
import { completionStats } from "../lib/streak";
import type { Task, ViewId } from "../types";
import { QuickAdd } from "./QuickAdd";
import { TaskItem } from "./TaskItem";
import { TaskSection } from "./TaskSection";
import { LabelsView } from "./LabelsView";
import { FocusView } from "./FocusView";
import { CalendarView } from "./CalendarView";
import { BoardView } from "./BoardView";
import { SearchBar } from "./SearchBar";
import { TaskDetail } from "./TaskDetail";
import { ChevronLeftIcon, ChevronRightIcon, InboxIcon } from "./Icons";

const SettingsView = lazy(() =>
  import("./SettingsView").then(({ SettingsView }) => ({ default: SettingsView })),
);
const JournalView = lazy(() =>
  import("./JournalView").then(({ JournalView }) => ({ default: JournalView })),
);

function viewTitle(view: ViewId, labelName?: string): string {
  switch (view.kind) {
    case "inbox":
      return t("navigation.inbox");
    case "today":
      return new Date().toLocaleDateString(appLocale(), {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    case "upcoming":
      return t("navigation.upcoming");
    case "date":
      return new Date(view.date + "T00:00:00").toLocaleDateString(appLocale(), {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    case "pinned":
      return t("navigation.pinboard");
    case "completed":
      return t("tasks.completed");
    case "labels":
      return t("labels.labels");
    case "settings":
      return t("settings.settings");
    case "focus":
      return t("focus.focus");
    case "journal":
      return t("journal.journal");
    case "calendar":
      return t("calendar.calendar");
    case "board":
      return t("board.board");
    case "label":
      return labelName ?? t("tasks.label");
  }
}

function viewSubtitle(view: ViewId): string {
  switch (view.kind) {
    case "inbox":
      return t("tasks.tasksWithoutADate");
    case "today":
      return t("tasks.dueTodayAndOverdue");
    case "upcoming":
      return t("tasks.scheduledForLater");
    case "date":
      return t("tasks.aFocusedPlanForThisDay");
    case "pinned":
      return t("tasks.tasksYouVePinnedToTheTop");
    case "completed":
      return t("tasks.everythingYouVeFinished");
    case "labels":
      return t("tasks.manageYourLabels");
    case "settings":
      return t("settings.startupAppearanceAndAbout");
    case "focus":
      return t("tasks.pomodoroAndFocusHistory");
    case "journal":
      return t("tasks.writeAndReflect");
    case "calendar":
      return t("tasks.tasksAndEventsByMonth");
    case "board":
      return t("board.moveWorkAcrossStages");
    case "label":
      return t("tasks.taggedTasks");
  }
}

export function TaskList() {
  const { t } = useTranslation();
  const {
    tasks,
    labels,
    view,
    loading,
    selectedId,
    completedPage,
    setCompletedPage,
    searchQuery,
    filterLabelIds,
    filterPriorities,
    clearFilters,
    rescheduleOverdue,
    loadError,
    load,
  } = useStore();
  const inView = applySearchAndFilters(
    tasksForView(tasks, view),
    searchQuery,
    filterLabelIds,
    filterPriorities,
  );
  const completed = completedTasksPage(
    view.kind === "completed" ? inView : [],
    completedPage,
  );

  useEffect(() => {
    // Deleting/reopening tasks can remove the last page. Persist the clamp so
    // adding tasks later doesn't unexpectedly jump back to that old page.
    if (view.kind === "completed" && completedPage !== completed.page) {
      setCompletedPage(completed.page);
    }
  }, [view.kind, completedPage, completed.page, setCompletedPage]);

  if (view.kind === "labels") return <LabelsView />;
  if (view.kind === "focus") return <FocusView />;
  if (view.kind === "calendar") return <CalendarView />;
  if (view.kind === "board") return <BoardView />;
  if (view.kind === "settings" || view.kind === "journal") {
    return (
      <Suspense
        fallback={
          <main className="redesign-main" aria-busy="true">
            <div className="task-page-scroll" role="status">{t("tasks.openingView")}</div>
          </main>
        }
      >
        {view.kind === "settings" && <SettingsView />}
        {view.kind === "journal" && <JournalView />}
      </Suspense>
    );
  }

  const labelName =
    view.kind === "label"
      ? labels.find((label) => label.id === view.labelId)?.name
      : undefined;
  const isCompletedView = view.kind === "completed";
  const showQuickAdd = view.kind !== "completed" && view.kind !== "pinned";
  const stats = completionStats(tasks);
  const showStats =
    (view.kind === "today" || view.kind === "completed") &&
    (stats.doneToday > 0 || stats.streak > 1);

  const active = inView.filter((task) => task.status === "active");
  const done = inView.filter((task) => task.status === "done");
  const selected = (isCompletedView ? completed.tasks : inView).find(
    (task) => task.id === selectedId,
  );
  const selectedActive = active.find((task) => task.id === selectedId);
  // Daily views always surface the next active task. Pinboard and Completed
  // stay compact until the user explicitly chooses a task to inspect.
  const detailTask =
    view.kind === "pinned" || isCompletedView
      ? selected
      : selectedActive ?? active[0];
  const showTaskDetail = !!detailTask;
  const hasFilters =
    searchQuery.trim() !== "" ||
    filterLabelIds.length > 0 ||
    filterPriorities.length > 0;
  const {
    page: currentCompletedPage,
    pageCount: completedPageCount,
    start: completedPageStart,
  } = completed;
  const sections = (isCompletedView
    ? [{ key: "all", title: null, tasks: completed.tasks }]
    : sectionsForView(active, view)
  ).filter((section) => section.tasks.length > 0);

  const changeCompletedPage = (page: number) => {
    setCompletedPage(page);
    document.querySelector(".task-page-scroll")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="redesign-main">
      <header className="app-page-header">
        <div>
          <h2>{viewTitle(view, labelName)}</h2>
          <p>{viewSubtitle(view)}</p>
        </div>
        {showStats && (
          <div className="daily-stats">
            {stats.doneToday > 0 && <span>✓ {stats.doneToday} {t("tasks.today")}</span>}
            {stats.streak > 1 && <span>{stats.streak}{t("tasks.dayStreak")}</span>}
          </div>
        )}
      </header>

      <div className="task-page-scroll">
        {showTaskDetail && (
          <section className="next-up-section">
            <p className="section-kicker">
              {view.kind === "pinned"
                ? t("tasks.pinnedTask")
                : isCompletedView
                  ? t("tasks.completedTask")
                  : t("tasks.nextUp")}
            </p>
            <TaskDetail taskId={detailTask.id} />
          </section>
        )}

        <section className="agenda-section">
          <div className="agenda-heading">
            <div>
              <h3>{isCompletedView ? t("tasks.completedTasks") : t("tasks.yourDay")}</h3>
              <span>{t("common.taskCount", { count: inView.length })}</span>
            </div>
            <SearchBar />
          </div>

          {loadError && (
            <div className="load-error" role="alert">
              <p>{loadError}</p>
              <button type="button" onClick={() => load()}>
                {t("common.retry")}
              </button>
            </div>
          )}

          {loading ? (
            <Skeleton />
          ) : active.length === 0 && done.length === 0 ? (
            hasFilters ? (
              <FilteredEmpty clearFilters={clearFilters} />
            ) : (
              <Empty view={view} />
            )
          ) : (
            <>
              {sections.map((section) => (
                <div key={section.key} className="task-group">
                  {section.title && (
                    <div className="task-group-heading">
                      <p className={section.tone === "overdue" ? "is-overdue" : ""}>
                        {section.title}
                        <span>{section.tasks.length}</span>
                      </p>
                      {section.tone === "overdue" && (
                        <button
                          type="button"
                          onClick={() => rescheduleOverdue()}
                          title={t("tasks.moveAllOverdueTasksToToday")}
                        >
                          {t("tasks.rescheduleToToday")}
                        </button>
                      )}
                    </div>
                  )}
                  <TaskSection tasks={section.tasks} reorderable={!isCompletedView} />
                </div>
              ))}

              {isCompletedView && completedPageCount > 1 && (
                <nav className="completed-pagination" aria-label={t("tasks.completedTasksPages")}>
                  <p>
                    {t("tasks.resultRange", { start: completedPageStart + 1, end: Math.min(completedPageStart + COMPLETED_PAGE_SIZE, inView.length), total: inView.length })}
                  </p>
                  <div>
                    <button
                      type="button"
                      onClick={() => changeCompletedPage(currentCompletedPage - 1)}
                      disabled={currentCompletedPage === 1}
                      aria-label={t("tasks.previousCompletedTasksPage")}
                    >
                      <ChevronLeftIcon width={14} height={14} />
                      {t("tasks.previous")}
                    </button>
                    <span>{t("tasks.pageProgress", { page: currentCompletedPage, total: completedPageCount })}</span>
                    <button
                      type="button"
                      onClick={() => changeCompletedPage(currentCompletedPage + 1)}
                      disabled={currentCompletedPage === completedPageCount}
                      aria-label={t("tasks.nextCompletedTasksPage")}
                    >
                      {t("focus.next")}
                      <ChevronRightIcon width={14} height={14} />
                    </button>
                  </div>
                </nav>
              )}

              {done.length > 0 && !isCompletedView && (
                <div className="task-group completed-group">
                  <div className="task-group-heading">
                    <p>{t("tasks.completed")} <span>{done.length}</span></p>
                  </div>
                  <div className="task-row-list is-completed">
                    {done.map((task: Task) => (
                      <TaskItem key={task.id} task={task} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {showQuickAdd && (
        <footer className="capture-dock">
          <QuickAdd />
          <p className="capture-hint"><Trans i18nKey="tasks.captureShortcut" components={{ kbd: <kbd /> }} /></p>
        </footer>
      )}
    </main>
  );
}

function FilteredEmpty({ clearFilters }: { clearFilters: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="empty-state">
      <InboxIcon width={28} height={28} />
      <p>{t("tasks.noTasksMatchYourSearchOrFilters")}</p>
      <button type="button" onClick={clearFilters}>{t("tasks.clearFilters")}</button>
    </div>
  );
}

function Empty({ view }: { view: ViewId }) {
  const { t } = useTranslation();
  const message =
    view.kind === "today"
      ? t("tasks.nothingDueTodayEnjoyTheCalm")
        : view.kind === "upcoming"
          ? t("tasks.noUpcomingTasksScheduled")
          : view.kind === "date"
            ? t("tasks.nothingScheduledForThisDayYet")
        : view.kind === "inbox"
          ? t("tasks.inboxZeroAddATaskToGetStarted")
          : view.kind === "pinned"
            ? t("tasks.noPinnedTasksYet")
            : view.kind === "completed"
              ? t("tasks.nothingCompletedYet")
              : t("tasks.noTasksWithThisLabelYet");
  return (
    <div className="empty-state">
      <InboxIcon width={30} height={30} />
      <p>{message}</p>
      <small>{t("tasks.useQuickCaptureBelowOrPressCtrlAltAFrom")}</small>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="task-row-list">
      {[0, 1, 2].map((index) => (
        <div key={index} className="task-row-skeleton" />
      ))}
    </div>
  );
}
