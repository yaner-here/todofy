import { useTranslation } from "react-i18next";
import type { MessageKey } from "../../lib/i18n";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";
import { useStore } from "../../store";
import { api } from "../../lib/api";
import { formatDue, formatTime } from "../../lib/dates";
import { parseQuickAdd } from "../../lib/nlp";
import { useOnboarding } from "../../lib/onboarding";
import { priorityColor, priorityTag } from "../../lib/priority";
import { repeatLabel } from "../../lib/repeat";
import {
  BellIcon,
  BoltIcon,
  CalendarIcon,
  CheckIcon,
  CloudIcon,
  FlagIcon,
  JournalIcon,
  LabelIcon,
  PlusIcon,
  PowerIcon,
  RepeatIcon,
  ShieldCheckIcon,
} from "../Icons";

/* ---------------------------------------------------------------- *
 * 1 — Welcome
 * ---------------------------------------------------------------- */

export function WelcomeSlide() {
  const { t } = useTranslation();
  return (
    <div className="px-2 pt-2 text-center">
      <div className="relative mx-auto grid h-31 w-31 place-items-center">
        <span className="onb-orb pointer-events-none absolute -inset-3.5 rounded-full bg-(--color-accent) opacity-[0.18] blur-3xl" />
        <span className="onb-bloom relative">
          <Mark />
        </span>
      </div>

      <div className="onb-stagger mt-6">
        <Eyebrow>{t("onboarding.welcomeToTodofy")}</Eyebrow>
        <h2 className="mt-2 text-[27px] font-semibold leading-[1.16] tracking-[-0.035em] text-text">
          {t("onboarding.everythingYouNeedToDo")}
          <br />
          {t("onboarding.nothingYouDonT")}
        </h2>
        <p className="mx-auto mt-3 max-w-108 text-[13px] leading-5 text-muted">
          {t("onboarding.yourTasksLiveOnThisMachineInAPlainDatabase")}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <TrustChip icon={<BoltIcon width={12} height={12} />}>
            {t("onboarding.opensInstantly")}
          </TrustChip>
          <TrustChip icon={<ShieldCheckIcon width={12} height={12} />}>
            {t("onboarding.privateByDefault")}
          </TrustChip>
          <TrustChip icon={<CloudIcon width={12} height={12} />}>
            {t("onboarding.worksOffline")}
          </TrustChip>
        </div>
      </div>
    </div>
  );
}

/** The app mark, drawing its own checkmark on arrival. */
function Mark() {
  return (
    <svg
      width="86"
      height="86"
      viewBox="0 0 1024 1024"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id="onb-mark"
          x1="512"
          y1="64"
          x2="512"
          y2="960"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#7d8bff" />
          <stop offset="1" stopColor="#6c7cff" />
        </linearGradient>
      </defs>
      <rect
        x="64"
        y="64"
        width="896"
        height="896"
        rx="208"
        fill="url(#onb-mark)"
      />
      <path
        className="onb-draw"
        style={{ strokeDasharray: 600, strokeDashoffset: 600 }}
        d="M300 524 L442 666 L724 384"
        stroke="#ffffff"
        strokeWidth="84"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/* ---------------------------------------------------------------- *
 * 2 — Theme
 * ---------------------------------------------------------------- */

export function ThemeSlide() {
  const { t } = useTranslation();
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  return (
    <div className="onb-stagger text-center">
      <Eyebrow>{t("settings.appearance")}</Eyebrow>
      <SlideTitle>{t("onboarding.pickASide")}</SlideTitle>
      <SlideText>
        {t("onboarding.todofyFollowsYouEitherWaySwitchWheneverYouLikeFrom")}
      </SlideText>

      <div className="mt-7 grid grid-cols-2 gap-4">
        {(["dark", "light"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={theme === mode}
            onClick={() => theme !== mode && toggleTheme()}
            className={`group rounded-2xl border-2 p-2.5 text-left transition-[border-color,transform] active:translate-y-px ${
              theme === mode
                ? "border-(--color-accent)"
                : "border-border hover:border-border-strong"
            }`}
          >
            <ThemePreview mode={mode} />
            <span className="mt-2.5 flex items-center justify-between px-1 pb-0.5">
              <span className="text-[13px] font-medium text-text">
                {mode === "dark" ? t("onboarding.dark") : t("onboarding.light")}
              </span>
              <span
                className={`grid h-4.5 w-4.5 place-items-center rounded-full transition-colors ${
                  theme === mode
                    ? "bg-(--color-accent) text-white"
                    : "border border-border-strong text-transparent"
                }`}
              >
                <CheckIcon width={11} height={11} strokeWidth={3} />
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A miniature of the app in a given theme. The colors are written out rather
 * than read from the CSS variables, since each card has to show the theme it
 * is offering and not the one currently applied.
 */
function ThemePreview({ mode }: { mode: "dark" | "light" }) {
  const c =
    mode === "dark"
      ? {
          bg: "#0e1116",
          side: "#161b22",
          row: "#1c232d",
          line: "#2a333f",
          text: "#3f4b59",
        }
      : {
          bg: "#f7f8fa",
          side: "#ffffff",
          row: "#ffffff",
          line: "#e3e7ec",
          text: "#c8cfd7",
        };
  return (
    <span
      className="flex h-26 gap-1.5 overflow-hidden rounded-xl p-1.5"
      style={{ background: c.bg }}
      aria-hidden="true"
    >
      <span
        className="flex w-[26%] flex-col gap-1.5 rounded-lg p-1.5"
        style={{ background: c.side }}
      >
        <span
          className="h-1.5 w-[70%] rounded-full"
          style={{ background: "#6c7cff" }}
        />
        {[60, 80, 50].map((w, i) => (
          <span
            key={i}
            className="h-1.5 rounded-full"
            style={{ background: c.text, width: `${w}%` }}
          />
        ))}
      </span>
      <span className="flex flex-1 flex-col gap-1.5">
        <span className="h-2 w-[45%] rounded-full" style={{ background: c.text }} />
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="flex flex-1 items-center gap-1.5 rounded-lg px-1.5"
            style={{ background: c.row, border: `1px solid ${c.line}` }}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ border: `1.5px solid ${i === 0 ? "#6c7cff" : c.text}` }}
            />
            <span
              className="h-1.5 rounded-full"
              style={{ background: c.text, width: `${[70, 52, 62][i]}%` }}
            />
          </span>
        ))}
      </span>
    </span>
  );
}

/* ---------------------------------------------------------------- *
 * 3 — Capture
 * ---------------------------------------------------------------- */

const DEMO = "Call the bank tomorrow at 10am p1 every month";

export function CaptureSlide() {
  const { t } = useTranslation();
  const labels = useStore((s) => s.labels);
  const priorityProfiles = useStore((s) => s.priorityProfiles);
  const setDraftText = useOnboarding((s) => s.setDraftText);
  const inputRef = useRef<HTMLInputElement>(null);
  // Stepping back to this slide restores whatever was typed the first time.
  const [value, setValue] = useState(() => useOnboarding.getState().draftText);
  const [touched, setTouched] = useState(() => value.length > 0);
  const [ghost, setGhost] = useState("");

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Type the example out for anyone who is only watching, and drop it the
  // moment they start writing something of their own.
  useEffect(() => {
    if (touched) {
      setGhost("");
      return;
    }
    let shown = 0;
    let timer = 0;
    const tick = () => {
      shown = shown >= DEMO.length ? 0 : shown + 1;
      setGhost(DEMO.slice(0, shown));
      // Hold the finished sentence a beat, then start over from empty.
      timer = window.setTimeout(
        tick,
        shown === DEMO.length ? 2800 : shown === 0 ? 500 : 52,
      );
    };
    timer = window.setTimeout(tick, 650);
    return () => clearTimeout(timer);
  }, [touched]);

  const text = touched ? value : ghost;
  const parsed = useMemo(() => parseQuickAdd(text, labels), [text, labels]);

  // Only what the user actually wrote becomes a real task — the demo is a demo.
  useEffect(() => {
    setDraftText(touched ? value : "");
  }, [touched, value, setDraftText]);

  return (
    <div className="onb-stagger text-center">
      <Eyebrow>{t("onboarding.quickAdd")}</Eyebrow>
      <SlideTitle>{t("onboarding.typeItLikeYouDSayIt")}</SlideTitle>
      <SlideText>
        {t("onboarding.datesTimesPrioritiesAndRepeatsAreReadStraightOutOf")}
      </SlideText>

      <div className="mt-7">
        <div className="flex items-center gap-3 rounded-2xl border border-border-strong bg-bg px-4 py-3.5 text-left shadow-inner shadow-black/5 transition-colors focus-within:border-(--color-accent)">
          <PlusIcon
            width={20}
            height={20}
            className="shrink-0 text-(--color-accent)"
          />
          <div className="relative min-w-0 flex-1">
            {!touched && (
              <div className="pointer-events-none absolute inset-0 flex items-center whitespace-pre text-[13px] text-muted">
                {ghost}
                <span className="onb-caret ml-px inline-block h-3.75 w-[1.5px] bg-(--color-accent) align-middle" />
              </div>
            )}
            <input
              ref={inputRef}
              value={value}
              onInput={(event) => {
                setTouched(true);
                setValue(event.currentTarget.value);
              }}
              aria-label={t("onboarding.yourFirstTask")}
              spellCheck={false}
              className="w-full bg-transparent text-[13px] text-text outline-none"
            />
          </div>
        </div>

        <div className="mt-3 flex min-h-6.5 flex-wrap items-center justify-center gap-1.5">
          {parsed.priority !== null && (
            <ParsedChip
              key={`p${parsed.priority}`}
              color={priorityColor(parsed.priority, priorityProfiles)}
            >
              <FlagIcon width={11} height={11} />
              {priorityTag(parsed.priority, priorityProfiles)}
            </ParsedChip>
          )}
          {parsed.dueDate && (
            <ParsedChip key={`d${parsed.dueDate}`}>
              <CalendarIcon width={11} height={11} />
              {formatDue(parsed.dueDate).label}
            </ParsedChip>
          )}
          {parsed.time && (
            <ParsedChip key={`t${parsed.time}`}>
              <BellIcon width={11} height={11} />
              {formatTime(parsed.time)}
            </ParsedChip>
          )}
          {parsed.repeat && (
            <ParsedChip key={`r${parsed.repeat}`}>
              <RepeatIcon width={11} height={11} />
              {repeatLabel(parsed.repeat)}
            </ParsedChip>
          )}
          {parsed.title.trim() && (
            <span className="text-[11px] text-faint">
              → “{parsed.title.trim()}”
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ParsedChip({
  color,
  children,
}: {
  color?: string;
  children: ReactNode;
}) {
  return (
    <span
      className="onb-pop inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={
        color
          ? { background: `${color}22`, color }
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

/* ---------------------------------------------------------------- *
 * 4 — Focus
 * ---------------------------------------------------------------- */

const LENGTHS = [25, 45, 50];

export function FocusSlide() {
  const { t } = useTranslation();
  const pomodoro = useStore((s) => s.pomodoro);
  const refreshPomodoro = useStore((s) => s.refreshPomodoro);
  const [focusMin, setFocusMin] = useState(pomodoro?.focusMin ?? 25);

  const choose = async (minutes: number) => {
    setFocusMin(minutes);
    // Reconfiguring mid-session would disturb a running timer; nothing is
    // running on a first run, but a replay from Settings might be.
    if (pomodoro?.running) return;
    try {
      await api.setPomodoroConfig(
        minutes,
        pomodoro?.shortMin ?? 5,
        pomodoro?.longMin ?? 15,
        pomodoro?.longEvery ?? 4,
      );
      await refreshPomodoro();
    } catch {
      /* best-effort; it can still be set in Settings */
    }
  };

  return (
    <div className="onb-stagger text-center">
      <Eyebrow>{t("focus.focus")}</Eyebrow>
      <SlideTitle>{t("onboarding.oneTaskAtATime")}</SlideTitle>
      <SlideText>
        {t("onboarding.startAPomodoroOrAStopwatchOnAnyTaskBoth")}
      </SlideText>

      <div className="relative mx-auto mt-6 grid h-33.5 w-33.5 place-items-center">
        <svg
          width="134"
          height="134"
          viewBox="0 0 134 134"
          className="absolute inset-0 -rotate-90"
        >
          <circle
            cx="67"
            cy="67"
            r="58"
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="7"
          />
          <circle
            className="onb-ring"
            style={{ strokeDasharray: 365, strokeDashoffset: 365 }}
            cx="67"
            cy="67"
            r="58"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="7"
            strokeLinecap="round"
          />
        </svg>
        <span className="relative text-center">
          <span className="block text-[26px] font-semibold tabular-nums tracking-tight text-text">
            {focusMin}:00
          </span>
          <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-faint">
            {t("focus.focus")}
          </span>
        </span>
      </div>

      <div className="mt-6">
        <p className="text-[11px] font-medium text-muted">{t("onboarding.sessionLength")}</p>
        <div className="mt-2 inline-grid grid-cols-3 gap-1 rounded-xl border border-border bg-bg p-1">
          {LENGTHS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={focusMin === minutes}
              onClick={() => void choose(minutes)}
              className={`rounded-lg px-5 py-1.5 text-xs font-medium transition-colors ${
                focusMin === minutes
                  ? "bg-(--color-accent) text-white"
                  : "text-muted hover:text-text"
              }`}
            >
              {minutes} {t("onboarding.min")}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * 5 — Capture anywhere + reminders
 * ---------------------------------------------------------------- */

type PermissionState = "idle" | "working" | "granted" | "denied";

export function RemindersSlide() {
  const { t } = useTranslation();
  const [permission, setPermission] = useState<PermissionState>("idle");
  const [autostart, setAutostart] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const [granted, enabled] = await Promise.all([
        isPermissionGranted().catch(() => false),
        api.getAutostart().catch(() => false),
      ]);
      if (granted) setPermission("granted");
      setAutostart(enabled);
      setReady(true);
    })();
  }, []);

  const enableNotifications = async () => {
    setPermission("working");
    try {
      const granted =
        (await isPermissionGranted()) ||
        (await requestPermission()) === "granted";
      await api
        .setSetting("desktop_notifications_enabled", granted ? "true" : "false")
        .catch(() => {});
      setPermission(granted ? "granted" : "denied");
    } catch {
      setPermission("denied");
    }
  };

  const toggleAutostart = async () => {
    const next = !autostart;
    setAutostart(next); // optimistic
    try {
      await api.setAutostart(next);
      if (next) await api.setSetting("startup_mode", "window").catch(() => {});
    } catch {
      setAutostart(!next);
    }
  };

  return (
    <div className="onb-stagger text-center">
      <Eyebrow>{t("onboarding.captureReminders")}</Eyebrow>
      <SlideTitle>{t("onboarding.neverLoseAThought")}</SlideTitle>
      <SlideText>
        {t("onboarding.pressTheHotkeyInAnyAppToJotSomethingDown")}
      </SlideText>

      <HotkeyArt />

      <div className="mt-6 space-y-2">
        <ActionRow
          icon={<BellIcon width={17} height={17} />}
          title={t("settings.desktopNotifications")}
          desc={t("onboarding.getANotificationTheMomentAReminderOrTimerIs")}
        >
          {permission === "granted" ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-success/12 px-3 py-1.5 text-xs font-medium text-success">
              <CheckIcon width={12} height={12} strokeWidth={3} />
              {t("onboarding.enabled")}
            </span>
          ) : (
            <button
              type="button"
              disabled={permission === "working"}
              onClick={() => void enableNotifications()}
              className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
            >
              {permission === "working"
                ? t("onboarding.asking")
                : permission === "denied"
                  ? t("common.retry")
                  : t("onboarding.enable")}
            </button>
          )}
        </ActionRow>

        <ActionRow
          icon={<PowerIcon width={17} height={17} />}
          title={t("onboarding.startTodofyAtLogin")}
          desc={t("onboarding.remindersOnlyFireWhileTodofyIsRunning")}
        >
          <MiniSwitch
            checked={autostart}
            disabled={!ready}
            onChange={() => void toggleAutostart()}
          />
        </ActionRow>
      </div>

      {permission === "denied" && (
        <p className="mt-3 text-[11px] text-(--color-warning)">
          {t("onboarding.yourSystemRefusedTheRequestYouCanStillAllowTodofy")}
        </p>
      )}
    </div>
  );
}

/** Keys press, the capture window drops in, a reminder slides up. One loop. */
function HotkeyArt() {
  const { t } = useTranslation();
  return (
    <div
      className="relative mx-auto mt-6 h-37.5 w-full max-w-100"
      aria-hidden="true"
    >
      <div className="absolute bottom-1 left-2 flex items-center gap-1">
        {["Ctrl", "Alt", "A"].map((key, i) => (
          <span
            key={key}
            className="onb-key rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-[10px] font-semibold text-muted shadow-sm"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            {key}
          </span>
        ))}
      </div>

      <div className="onb-drop absolute left-1/2 top-0 w-63 -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-elevated shadow-2xl shadow-black/40">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <PlusIcon width={14} height={14} className="text-(--color-accent)" />
          <span className="text-[11px] text-muted">{t("onboarding.bookTheDentist")}</span>
          <span className="onb-caret -ml-1 inline-block h-2.75 w-[1.5px] bg-(--color-accent)" />
        </div>
        <div className="border-t border-border px-3 py-1.5 text-[9px] text-faint">
          {t("onboarding.enterToSaveEscToDismiss")}
        </div>
      </div>

      <div className="onb-toast absolute bottom-0 right-0 flex w-52.5 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2.5 shadow-lg shadow-black/20">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-accent-soft text-(--color-accent)">
          <BellIcon width={12} height={12} />
        </span>
        <span className="min-w-0 text-left">
          <span className="block truncate text-[10px] font-medium text-text">
            {t("onboarding.callTheBank")}
          </span>
          <span className="block text-[9px] text-faint">{t("onboarding.dueNow1000")}</span>
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * 6 — The rest of the app
 * ---------------------------------------------------------------- */

const FEATURES = [
  {
    icon: <JournalIcon width={18} height={18} />,
    title: "journal.journal",
    desc: "onboarding.journalHint",
  },
  {
    icon: <CalendarIcon width={18} height={18} />,
    title: "calendar.calendar",
    desc: "onboarding.calendarHint",
  },
  {
    icon: <LabelIcon width={18} height={18} />,
    title: "onboarding.labelsPriorities",
    desc: "onboarding.labelsHint",
  },
  {
    icon: <RepeatIcon width={18} height={18} />,
    title: "onboarding.repeatingTasks",
    desc: "onboarding.repeatHint",
  },
] as const;

export function FeaturesSlide() {
  const { t } = useTranslation();
  return (
    <div className="text-center">
      <div className="onb-stagger">
        <Eyebrow>{t("onboarding.andThereSMore")}</Eyebrow>
        <SlideTitle>{t("onboarding.moreThanATaskList")}</SlideTitle>
        <SlideText>
          {t("onboarding.everythingHereIsLocalAndKeyboardFirstExploreItAt")}
        </SlideText>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-3 text-left">
        {FEATURES.map((feature, i) => (
          <div
            key={feature.title}
            className="onb-pop rounded-2xl border border-border bg-surface p-4"
            style={{ animationDelay: `${140 + i * 90}ms` }}
          >
            <span
              className="onb-float grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-(--color-accent)"
              style={{ animationDelay: `${i * 420}ms` }}
            >
              {feature.icon}
            </span>
            <p className="mt-3 text-[13px] font-medium text-text">
              {t(feature.title)}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-muted">{t(feature.desc)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * 7 — Finish
 * ---------------------------------------------------------------- */

const SHORTCUTS: [string, MessageKey][] = [
  ["Ctrl + Alt + A", "onboarding.captureFromAnyApp"],
  ["N", "onboarding.newTaskRightHere"],
  ["?", "onboarding.everyOtherShortcut"],
];

export function FinishSlide() {
  const { t } = useTranslation();
  const draft = useOnboarding((s) => s.draftText.trim());

  return (
    <div className="onb-stagger text-center">
      <span className="onb-bloom mx-auto grid h-14 w-14 place-items-center rounded-full bg-success/12 text-success">
        <CheckIcon width={26} height={26} strokeWidth={2.5} />
      </span>

      <div>
        <SlideTitle class="mt-5">{t("onboarding.youReSetUp")}</SlideTitle>
        <SlideText>
          {draft
            ? t("onboarding.yourFirstTaskIsWaitingInTodayThreeKeysWorth")
            : t("onboarding.thatSTheWholeTourThreeKeysWorthRemembering")}
        </SlideText>
      </div>

      <div className="mt-6 space-y-2">
        {SHORTCUTS.map(([keys, what]) => (
          <div
            key={keys}
            className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-2.5"
          >
            <kbd className="rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-[11px] font-semibold text-text">
              {keys}
            </kbd>
            <span className="text-[12px] text-muted">{t(what)}</span>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[10px] text-faint">
        {t("onboarding.youCanReplayThisTourAnytimeFromSettingsAbout")}
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- *
 * Shared pieces
 * ---------------------------------------------------------------- */

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-(--color-accent)">
      {children}
    </p>
  );
}

function SlideTitle({
  children,
  class: className = "",
}: {
  children: ReactNode;
  class?: string;
}) {
  return (
    <h2
      className={`text-[24px] font-semibold leading-[1.2] tracking-[-0.035em] text-text ${className}`}
    >
      {children}
    </h2>
  );
}

function SlideText({ children }: { children: ReactNode }) {
  return (
    <p className="mx-auto mt-2.5 max-w-108 text-[13px] leading-5 text-muted">
      {children}
    </p>
  );
}

function TrustChip({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted">
      <span className="text-(--color-accent)">{icon}</span>
      {children}
    </span>
  );
}

function ActionRow({
  icon,
  title,
  desc,
  children,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-text">{title}</span>
        <span className="mt-0.5 block text-[11px] text-muted">{desc}</span>
      </span>
      <span className="shrink-0">{children}</span>
    </div>
  );
}

function MiniSwitch({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
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
