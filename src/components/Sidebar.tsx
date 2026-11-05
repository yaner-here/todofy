import type { MessageKey } from "../lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useStore } from "../store";
import type { ViewId } from "../types";
import { toLocalDate, today } from "../lib/dates";
import { appLocale, formatDateRange, weekdayOffset } from "../lib/locale";
import { billingConfigured, useBilling } from "../lib/billing";
import { useUpdater } from "../lib/updater";
import {
  BoardIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  InboxIcon,
  JournalIcon,
  LabelIcon,
  Logo,
  MenuIcon,
  PinIcon,
  CrownIcon,
  RotateIcon,
  SettingsIcon,
  TimerIcon,
  TodayIcon,
  UpcomingIcon,
} from "./Icons";

const NAV: { id: ViewId; label: MessageKey; Icon: typeof InboxIcon }[] = [
  { id: { kind: "today" }, label: "common.today", Icon: TodayIcon },
  { id: { kind: "upcoming" }, label: "navigation.upcoming", Icon: UpcomingIcon },
  { id: { kind: "inbox" }, label: "navigation.inbox", Icon: InboxIcon },
  { id: { kind: "pinned" }, label: "navigation.pinboard", Icon: PinIcon },
  { id: { kind: "completed" }, label: "tasks.completed", Icon: CheckCircleIcon },
  { id: { kind: "board" }, label: "board.board", Icon: BoardIcon },
  { id: { kind: "calendar" }, label: "calendar.calendar", Icon: CalendarIcon },
  { id: { kind: "labels" }, label: "labels.labels", Icon: LabelIcon },
  { id: { kind: "journal" }, label: "journal.journal", Icon: JournalIcon },
];

export function sameView(a: ViewId, b: ViewId): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "label" && b.kind === "label") return a.labelId === b.labelId;
  if (a.kind === "date" && b.kind === "date") return a.date === b.date;
  return true;
}

/** Top-level product navigation from the selected redesign. */
export function Sidebar() {
  const { t } = useTranslation();
  const { view, setView, sidebarCollapsed, toggleSidebar } = useStore();
  const billingAllowed = useBilling((state) => state.allowed);
  const openPro = useBilling((state) => state.openGate);
  const updateState = useUpdater((state) => state.state);
  const updateVersion = useUpdater((state) => state.version);
  const updateDismissed = useUpdater((state) => state.dismissedVersion);
  const downloaded = useUpdater((state) => state.downloaded);
  const total = useUpdater((state) => state.total);
  const [version, setVersion] = useState("");

  // Only worth a permanent seat in the top bar once there's something to do
  // about it. A download in flight and a finished install always show: this is
  // the only progress indicator outside Settings, and hiding a pending restart
  // would strand the user on the old version.
  const showUpdate =
    updateState === "downloading" ||
    updateState === "ready" ||
    (updateState === "available" && updateDismissed !== updateVersion);

  const percent =
    total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  const navigate = (nextView: ViewId) => {
    setView(nextView);
    if (!sidebarCollapsed && window.matchMedia("(max-width: 940px)").matches) {
      toggleSidebar();
    }
  };

  return (
    <header className="app-topbar">
      <div className="app-brand">
        <Logo size={30} />
        <span>todofy</span>
        {version && <small className="app-version">v{version}</small>}
        <button
          type="button"
          className={`rail-toggle ${sidebarCollapsed ? "" : "is-active"}`}
          onClick={toggleSidebar}
          aria-expanded={!sidebarCollapsed}
          aria-controls="day-navigation"
          aria-label={sidebarCollapsed ? t("navigation.openCalendarNavigation") : t("common.closeCalendarNavigation")}
          title={sidebarCollapsed ? t("navigation.openCalendar") : t("navigation.closeCalendar")}
        >
          <MenuIcon width={20} height={20} />
        </button>
      </div>

      <nav className="top-navigation" aria-label={t("navigation.primaryNavigation")}>
        {NAV.map(({ id, label, Icon }) => {
          const active =
            sameView(view, id) || (id.kind === "upcoming" && view.kind === "date");
          return (
            <button
              key={label}
              type="button"
              onClick={() => navigate(id)}
              className={`top-nav-item ${active ? "is-active" : ""}`}
              aria-label={t(label)}
              aria-current={active ? "page" : undefined}
              title={t(label)}
            >
              <Icon width={19} height={19} />
              <span>{t(label)}</span>
            </button>
          );
        })}
      </nav>

      <div className="top-actions">
        {/* Icon-only on purpose: the top bar is already tight at narrow widths,
            and the full story lives one click away in Settings. */}
        {showUpdate && (
          <button
            type="button"
            onClick={() => navigate({ kind: "settings" })}
            className={`top-nav-item top-update ${updateState === "downloading" ? "is-downloading" : ""}`}
            aria-label={
              updateState === "downloading"
                ? t("updates.downloadingTitle", { version: updateVersion, progress: percent === null ? "" : ` — ${percent}%` })
                : updateState === "ready"
                  ? t("updates.installedTitle", { version: updateVersion })
                  : t("updates.availableTitle", { version: updateVersion })
            }
            title={
              updateState === "downloading"
                ? percent === null ? t("updates.downloadingVersion", { version: updateVersion }) : t("updates.downloadingProgress", { version: updateVersion, percent })
                : updateState === "ready"
                  ? t("updates.restartTitle", { version: updateVersion })
                  : t("updates.availableTitle", { version: updateVersion })
            }
          >
            {updateState === "downloading" ? (
              <UpdateProgress percent={percent} />
            ) : updateState === "ready" ? (
              <RotateIcon width={20} height={20} />
            ) : (
              <DownloadIcon width={20} height={20} />
            )}
          </button>
        )}
        {billingConfigured && (
          <button
            type="button"
            onClick={() => openPro(billingAllowed ? "upgrade" : "cloud_sync")}
            className={`top-nav-item top-pro ${billingAllowed ? "is-active" : ""}`}
            aria-label={billingAllowed ? t("navigation.todofyProStatus") : t("navigation.unlockCloudSync")}
            title={billingAllowed ? "Todofy Pro" : t("billing.cloudSync")}
          >
            <CrownIcon width={20} height={20} />
            <span>{billingAllowed ? "Pro" : t("billing.cloudSync")}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => navigate({ kind: "focus" })}
          className={`top-nav-item top-focus ${view.kind === "focus" ? "is-active" : ""}`}
          aria-label={t("focus.focus")}
          aria-current={view.kind === "focus" ? "page" : undefined}
          title={t("focus.focus")}
        >
          <TimerIcon width={20} height={20} />
          <span>{t("focus.focus")}</span>
        </button>
        <button
          type="button"
          onClick={() => navigate({ kind: "settings" })}
          className={`top-nav-item top-settings ${view.kind === "settings" ? "is-active" : ""}`}
          aria-label={t("settings.settings")}
          aria-current={view.kind === "settings" ? "page" : undefined}
          title={t("settings.settings")}
        >
          <SettingsIcon width={20} height={20} />
          <span>{t("settings.settings")}</span>
        </button>
      </div>
    </header>
  );
}

/**
 * Download progress as a ring around the update button. Falls back to an
 * indeterminate spinner until the server has told us the total size, which
 * some releases only report once the transfer is under way.
 */
function UpdateProgress({ percent }: { percent: number | null }) {
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      className={`update-ring ${percent === null ? "is-indeterminate" : ""}`}
      aria-hidden="true"
    >
      <circle className="update-ring-track" cx="10" cy="10" r={radius} />
      <circle
        className="update-ring-value"
        cx="10"
        cy="10"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={
          percent === null
            ? circumference * 0.75
            : circumference * (1 - percent / 100)
        }
      />
    </svg>
  );
}

/** Date-oriented context rail that replaces the old feature sidebar. */
export function DayRail() {
  const { t } = useTranslation();
  const { tasks, journal, view, setView, sidebarCollapsed, toggleSidebar } =
    useStore();
  const todayKey = today();
  const selectedKey = view.kind === "date" ? view.date : view.kind === "today" ? todayKey : null;
  const [anchorDate, setAnchorDate] = useState(() =>
    new Date((selectedKey ?? todayKey) + "T00:00:00"),
  );

  useEffect(() => {
    if (selectedKey) setAnchorDate(new Date(selectedKey + "T00:00:00"));
  }, [selectedKey]);

  const weekStart = new Date(anchorDate);
  weekStart.setDate(anchorDate.getDate() - weekdayOffset(anchorDate));
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);
    const key = toLocalDate(date);
    return {
      date,
      key,
      count: tasks.filter((task) => task.status === "active" && task.dueDate === key).length,
      journaled: journal.some((entry) => entry.entryDate === key),
    };
  });
  const weekEnd = week[6].date;
  const isCurrentWeek = week.some(({ key }) => key === todayKey);

  const moveWeek = (direction: -1 | 1) => {
    const next = new Date(anchorDate);
    next.setDate(next.getDate() + direction * 7);
    setAnchorDate(next);
  };

  const chooseDay = (key: string) => {
    setView(key === todayKey ? { kind: "today" } : { kind: "date", date: key });
    if (!sidebarCollapsed && window.matchMedia("(max-width: 940px)").matches) {
      toggleSidebar();
    }
  };

  const rangeLabel = formatDateRange(weekStart, weekEnd);

  return (
    <aside id="day-navigation" className={`day-rail ${sidebarCollapsed ? "" : "is-open"}`} aria-label={t("navigation.dayNavigation")}>
      <div className="mini-calendar">
        <div className="mini-calendar-heading">
          <div>
            <small>{t("focus.thisWeek")}</small>
            <strong>{rangeLabel}</strong>
          </div>
          <div className="mini-calendar-actions">
            {!isCurrentWeek && (
              <button type="button" onClick={() => setAnchorDate(new Date(todayKey + "T00:00:00"))}>
                {t("common.today")}
              </button>
            )}
            <button type="button" onClick={() => moveWeek(-1)} aria-label={t("navigation.previousWeek")} title={t("navigation.previousWeek")}>
              <ChevronLeftIcon width={15} height={15} />
            </button>
            <button type="button" onClick={() => moveWeek(1)} aria-label={t("navigation.nextWeek")} title={t("navigation.nextWeek")}>
              <ChevronRightIcon width={15} height={15} />
            </button>
          </div>
        </div>
        <div className="mini-week">
          {week.map(({ date, key, count, journaled }) => {
            const current = key === todayKey;
            const selected = key === selectedKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => chooseDay(key)}
                className={`${current ? "is-current" : ""} ${selected ? "is-selected" : ""}`}
                aria-pressed={selected}
                aria-label={t("navigation.daySummary", { date: date.toLocaleDateString(appLocale(), { weekday: "long", month: "long", day: "numeric" }), tasks: count ? t("navigation.dayTasks", { count }) : t("navigation.dayNoTasks"), journal: journaled ? t("navigation.dayJournal") : "" })}
              >
                <span>{date.toLocaleDateString(appLocale(), { weekday: "narrow" })}</span>
                <b>{date.getDate()}</b>
                <i className={count > 0 ? "has-tasks" : ""}>{count || ""}</i>
                {journaled && <em className="journal-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="day-links-heading">
        <span>{t("navigation.dailyPlan")}</span>
        <small>{t("common.taskCount", { count: week.reduce((total, day) => total + day.count, 0) })}</small>
      </div>
      <div className="day-links">
        {week.map(({ date, key, count }) => {
          const current = key === todayKey;
          const active = key === selectedKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => chooseDay(key)}
              className={`day-link ${active ? "is-active" : ""}`}
              aria-current={active ? "date" : undefined}
            >
              <span className="day-link-date">
                <b>{date.getDate()}</b>
                <small>{date.toLocaleDateString(appLocale(), { month: "short" })}</small>
              </span>
              <span className="day-link-copy">
                <strong>{current ? t("common.today") : date.toLocaleDateString(appLocale(), { weekday: "long" })}</strong>
                <small>{count ? t("navigation.planned", { count }) : t("navigation.openDay")}</small>
              </span>
              <span className={`day-link-count ${count ? "has-tasks" : ""}`}>{count || "—"}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
