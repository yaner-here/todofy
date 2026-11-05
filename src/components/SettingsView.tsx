import type { MessageKey } from "../lib/i18n";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { setLanguage, useLanguageState } from "../lib/language";
import type { LanguagePreference } from "../types";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import {
  autoSummary,
  timeFormat,
  weekStartSetting,
  type TimeFormatPref,
  type WeekStartPref,
} from "../lib/locale";
import {
  DEFAULT_VOLUME,
  MAX_CUSTOM_BYTES,
  parseSoundSettings,
  playSound,
  type SoundSettings,
  SOUNDS,
  SOUND_KEYS,
  type SoundId,
} from "../lib/sound";
import {
  addQuickTime,
  DEFAULT_QUICK_TIMES,
  MAX_QUICK_TIMES,
  parseQuickTimes,
  QUICK_TIMES_KEY,
  serializeQuickTimes,
} from "../lib/quickTimes";
import { formatTime } from "../lib/dates";
import { Checkbox } from "./Checkbox";
import { TimeField } from "./TimeField";
import { useStore } from "../store";
import { useOnboarding } from "../lib/onboarding";
import { RELEASES_URL, useUpdater } from "../lib/updater";
import type { TaskTimerMode } from "../types";
import { AccountSection } from "./AccountSection";
import { CalendarSection } from "./CalendarSection";
import { PriorityProfilesSection } from "./PriorityProfilesSection";
import { VoiceSettingsSection } from "./VoiceSettingsSection";
import {
  BellIcon,
  BoltIcon,
  CheckCircleIcon,
  CloseIcon,
  DownloadIcon,
  ExternalLinkIcon,
  GitHubIcon,
  MoonIcon,
  PlayIcon,
  PowerIcon,
  SunIcon,
  RotateIcon,
  WebsiteIcon,
} from "./Icons";

const WEBSITE_URL = "https://unifybrowse.com/products/todofy";
const GITHUB_URL = "https://github.com/salarzeidanlou/todofy";

const openExternal = (url: string) => {
  openUrl(url).catch(() => {});
};

type StartupMode = "window" | "tray";
type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const CORNERS: { value: Corner; label: MessageKey }[] = [
  { value: "top-left", label: "settings.topLeft" },
  { value: "top-right", label: "settings.topRight" },
  { value: "bottom-left", label: "settings.bottomLeft" },
  { value: "bottom-right", label: "settings.bottomRight" },
];

const TIME_FORMATS: { value: TimeFormatPref; label: MessageKey }[] = [
  { value: "auto", label: "locale.auto" },
  { value: "12", label: "locale.hour12" },
  { value: "24", label: "locale.hour24" },
];

const WEEK_STARTS: { value: WeekStartPref; label: MessageKey }[] = [
  { value: "auto", label: "locale.auto" },
  { value: "1", label: "locale.monday" },
  { value: "0", label: "locale.sunday" },
  { value: "6", label: "locale.saturday" },
];

/** How often an unanswered reminder repeats. "0" is the default: it doesn't. */
// Phrased as intervals, not durations: under a "keep reminding" heading a bare
// "10 min" reads as how long the nagging lasts, which is not what it sets.
const REPEAT_INTERVALS: { value: string; label: MessageKey }[] = [
  { value: "0", label: "settings.noRepeat" },
  { value: "2", label: "settings.repeat2" },
  { value: "5", label: "settings.repeat5" },
  { value: "10", label: "settings.repeat10" },
];

const TIMER_MODES: { value: TaskTimerMode; label: MessageKey; hint: MessageKey }[] = [
  {
    value: "tracker",
    label: "settings.stopwatch",
    hint: "settings.stopwatchHint",
  },
  {
    value: "pomodoro",
    label: "settings.pomodoro",
    hint: "settings.pomodoroHint",
  },
];

// How the backend routed the test notification (see notify::deliver).
const ROUTE_LABEL: Record<string, MessageKey> = {
  popup: "settings.routePopup",
  portal: "settings.routePortal",
  fallback: "settings.routeFallback",
};

export function SettingsView() {
  const { t } = useTranslation();
  const {
    theme,
    toggleTheme,
    celebrate,
    toggleCelebrate,
    toggleShortcuts,
    setTimeFormat,
    setWeekStart,
    taskTimerMode,
    setTaskTimerMode,
  } = useStore();
  const autoCheckUpdates = useUpdater((s) => s.autoCheck);
  const setAutoCheckUpdates = useUpdater((s) => s.setAutoCheck);
  const autoInstallUpdates = useUpdater((s) => s.autoInstall);
  const setAutoInstallUpdates = useUpdater((s) => s.setAutoInstall);
  const canSelfUpdate = useUpdater((s) => s.canSelfUpdate);
  // Read back from the locale module, which the store actions keep in step.
  const timeFormatPref = timeFormat();
  const weekStartPref = weekStartSetting();
  const [autostart, setAutostart] = useState(false);
  const [mode, setMode] = useState<StartupMode>("window");
  const [desktopNotifications, setDesktopNotifications] = useState(true);
  const [notifStyle, setNotifStyle] = useState<"custom" | "native">("custom");
  const [notifPosition, setNotifPosition] = useState<Corner>("bottom-right");
  const [version, setVersion] = useState("");
  const [ready, setReady] = useState(false);
  const [repeatEvery, setRepeatEvery] = useState("0");
  const [sound, setSound] = useState<SoundId>("chime");
  const [volume, setVolume] = useState(DEFAULT_VOLUME);
  const [ramp, setRamp] = useState(false);
  const [customName, setCustomName] = useState("");
  const [soundError, setSoundError] = useState("");
  const [quickTimes, setQuickTimesState] = useState(DEFAULT_QUICK_TIMES);
  const [newQuickTime, setNewQuickTime] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [testRoute, setTestRoute] = useState("");

  // Load current startup preferences from the backend.
  useEffect(() => {
    (async () => {
      const [
        enabled,
        storedMode,
        storedNotifications,
        style,
        position,
        repeat,
        storedSound,
        storedVolume,
        storedRamp,
        storedName,
        storedQuickTimes,
      ] = await Promise.all([
        api.getAutostart().catch(() => false),
        api.getSetting("startup_mode").catch(() => null),
        api.getSetting("desktop_notifications_enabled").catch(() => null),
        api.getSetting("notification_style").catch(() => null),
        api.getSetting("notification_position").catch(() => null),
        api.getSetting("reminder_repeat_minutes").catch(() => null),
        api.getSetting(SOUND_KEYS.sound).catch(() => null),
        api.getSetting(SOUND_KEYS.volume).catch(() => null),
        api.getSetting(SOUND_KEYS.ramp).catch(() => null),
        api.getSetting(SOUND_KEYS.name).catch(() => null),
        api.getSetting(QUICK_TIMES_KEY).catch(() => null),
      ]);
      setQuickTimesState(parseQuickTimes(storedQuickTimes));
      setAutostart(enabled);
      if (storedMode === "tray" || storedMode === "window") setMode(storedMode);
      setDesktopNotifications(storedNotifications !== "false");
      setNotifStyle(style === "native" ? "native" : "custom");
      if (CORNERS.some((c) => c.value === position))
        setNotifPosition(position as Corner);
      if (REPEAT_INTERVALS.some((option) => option.value === repeat))
        setRepeatEvery(repeat as string);
      const parsed = parseSoundSettings({
        sound: storedSound,
        volume: storedVolume,
        ramp: storedRamp,
      });
      setSound(parsed.sound);
      setVolume(parsed.volume);
      setRamp(parsed.ramp);
      setCustomName(storedName ?? "");
      setReady(true);
    })();
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  const toggleAutostart = async () => {
    const next = !autostart;
    setAutostart(next); // optimistic
    try {
      await api.setAutostart(next);
    } catch {
      setAutostart(!next); // revert on failure
    }
  };

  const chooseMode = async (next: StartupMode) => {
    setMode(next);
    try {
      await api.setSetting("startup_mode", next);
    } catch {
      /* best-effort; the current selection stays shown */
    }
  };

  const toggleDesktopNotifications = async () => {
    const next = !desktopNotifications;
    setDesktopNotifications(next); // optimistic
    try {
      await api.setSetting(
        "desktop_notifications_enabled",
        next ? "true" : "false",
      );
    } catch {
      setDesktopNotifications(!next); // revert on failure
    }
  };

  const chooseStyle = async (next: "custom" | "native") => {
    const prev = notifStyle;
    setNotifStyle(next); // optimistic
    try {
      await api.setSetting("notification_style", next);
    } catch {
      setNotifStyle(prev);
    }
  };

  const choosePosition = async (next: Corner) => {
    const prev = notifPosition;
    setNotifPosition(next); // optimistic
    try {
      await api.setSetting("notification_position", next);
    } catch {
      setNotifPosition(prev);
    }
  };

  const chooseRepeat = async (next: string) => {
    const prev = repeatEvery;
    setRepeatEvery(next); // optimistic
    try {
      await api.setSetting("reminder_repeat_minutes", next);
    } catch {
      setRepeatEvery(prev);
    }
  };

  const chooseSound = async (next: SoundId) => {
    setSoundError("");
    // Picking "Custom…" with nothing loaded means "go find one".
    if (next === "custom" && !customName) return pickCustomSound();
    setSound(next);
    await api.setSetting(SOUND_KEYS.sound, next).catch(() => {});
    void previewSound(next, volume);
  };

  const changeVolume = (next: number) => {
    setVolume(next);
    void api.setSetting(SOUND_KEYS.volume, String(next)).catch(() => {});
  };

  const toggleRamp = async () => {
    const next = !ramp;
    setRamp(next);
    await api.setSetting(SOUND_KEYS.ramp, String(next)).catch(() => {});
  };

  /**
   * Keeps the bytes rather than the path, so the sound survives the original
   * file being moved or deleted.
   */
  const pickCustomSound = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_CUSTOM_BYTES) {
        setSoundError(
          t("common.fileTooLarge", { size: Math.round(file.size / 1024), limit: MAX_CUSTOM_BYTES / 1024 }),
        );
        return;
      }
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        const data = btoa(binary);
        await Promise.all([
          api.setSetting(SOUND_KEYS.data, data),
          api.setSetting(SOUND_KEYS.name, file.name),
          api.setSetting(SOUND_KEYS.sound, "custom"),
        ]);
        setSound("custom");
        setCustomName(file.name);
        void playPreview({
          sound: "custom",
          volume,
          ramp: false,
          customData: data,
        });
      } catch {
        setSoundError(t("priorities.thatFileCouldnTBeRead"));
      }
    };
    input.click();
  };

  /** The ramp belongs to repeats, so a preview plays at the set volume. */
  const previewSound = async (id: SoundId, level: number) => {
    const data =
      id === "custom"
        ? await api.getSetting(SOUND_KEYS.data).catch(() => null)
        : null;
    await playPreview({
      sound: id,
      volume: level,
      ramp: false,
      customData: data,
    });
  };

  /** A preview that stays silent has to say why, or it reads as unimplemented. */
  const playPreview = async (settings: SoundSettings) => {
    try {
      setSoundError("");
      await playSound(settings);
    } catch (error) {
      setSoundError(
        error instanceof Error
          ? error.message
          : t("priorities.thatSoundCouldnTBePlayed"),
      );
    }
  };

  const saveQuickTimes = (next: string[]) => {
    setQuickTimesState(next);
    void api
      .setSetting(QUICK_TIMES_KEY, serializeQuickTimes(next))
      .catch(() => {});
  };

  const removeQuickTime = (time: string) =>
    saveQuickTimes(quickTimes.filter((t) => t !== time));

  const addNewQuickTime = () => {
    if (!newQuickTime) return;
    saveQuickTimes(addQuickTime(quickTimes, newQuickTime));
    setNewQuickTime(null);
  };

  const chooseTimeFormat = (next: TimeFormatPref) => {
    void setTimeFormat(next);
  };

  const chooseWeekStart = (next: WeekStartPref) => {
    void setWeekStart(next);
  };

  const sendTestNotification = async () => {
    setTestStatus("sending");
    try {
      // Goes through the same portal path reminders use; resolves to the
      // route that delivered it ("portal" or "fallback").
      const route = await api.sendTestNotification();
      setTestRoute(route);
      setTestStatus("sent");
    } catch {
      setTestStatus("error");
    } finally {
      setTimeout(() => setTestStatus("idle"), 5000);
    }
  };

  return (
    <main className="redesign-secondary settings-main flex flex-1 flex-col overflow-hidden bg-bg">
      <header className="app-page-header shrink-0 px-8 pt-8 pb-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("settings.settings")}</h2>
        <p className="mt-0.5 text-sm text-muted">{t("settings.startupAppearanceAndAbout")}</p>
      </header>

      <div className="secondary-scroll settings-content mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 pt-2 pb-8">
        <AccountSection />
        <CalendarSection />
        <LanguageSection />
        <VoiceSettingsSection />

        {/* Startup */}
        <Section title={t("settings.startup")}>
          <Row
            icon={<PowerIcon width={18} height={18} />}
            title={t("settings.runTodofyOnStartup")}
            desc={t("settings.launchAutomaticallyWhenYouSignInToYourComputer")}
          >
            <Switch
              checked={autostart}
              onChange={toggleAutostart}
              disabled={!ready}
            />
          </Row>

          {autostart && (
            <div className="animate-fade-rise border-t border-border px-4 py-3.5">
              <p className="mb-2.5 text-xs font-medium text-muted">
                {t("settings.whenTodofyStartsAtLogin")}
              </p>
              <div className="flex flex-col gap-2">
                <ModeOption
                  active={mode === "window"}
                  onSelect={() => chooseMode("window")}
                  title={t("settings.openTheWindow")}
                  desc={t("settings.startWithTheTodofyWindowVisible")}
                />
                <ModeOption
                  active={mode === "tray"}
                  onSelect={() => chooseMode("tray")}
                  title={t("settings.startInTheTray")}
                  desc={t("settings.runQuietlyInTheSystemTrayOpenItFromThe")}
                />
              </div>
            </div>
          )}
        </Section>

        <PriorityProfilesSection />

        {/* Quick capture */}
        <Section title={t("tasks.quickCapture")}>
          <Row
            icon={<BoltIcon width={18} height={18} />}
            title={t("settings.globalQuickAddHotkey")}
            desc={t("settings.pressThisFromAnyAppToPopUpTodofyS")}
          >
            <kbd className="shrink-0 rounded-lg border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
              Ctrl + Alt + A
            </kbd>
          </Row>
        </Section>

        {/* Notifications */}
        <Section title={t("settings.notifications")}>
          <Row
            icon={<BellIcon width={18} height={18} />}
            title={t("settings.desktopNotifications")}
            desc={t("settings.showANativeSystemNotificationWhenAReminderOrTimer")}
          >
            <Switch
              checked={desktopNotifications}
              onChange={toggleDesktopNotifications}
              disabled={!ready}
            />
          </Row>

          {desktopNotifications && (
            <div className="animate-fade-rise border-t border-border px-4 py-3.5">
              <p className="mb-2.5 text-xs font-medium text-muted">
                {t("priorities.notificationStyle")}
              </p>
              <div className="flex flex-col gap-2">
                <ModeOption
                  active={notifStyle === "custom"}
                  onSelect={() => chooseStyle("custom")}
                  title={t("settings.inAppPopup")}
                  desc={t("settings.showTodofySOwnNotificationInAScreenCornerAbove")}
                />
                <ModeOption
                  active={notifStyle === "native"}
                  onSelect={() => chooseStyle("native")}
                  title={t("settings.systemNotification")}
                  desc={t("settings.handTheNotificationToYourDesktopSNotificationCentre")}
                />
              </div>

              {notifStyle === "custom" && (
                <div className="mt-3.5 animate-fade-rise">
                  <p className="mb-2 text-xs font-medium text-muted">
                    {t("settings.positionOnScreen")}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {CORNERS.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => choosePosition(c.value)}
                        className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                          notifPosition === c.value
                            ? "border-(--color-accent) bg-accent-soft text-text"
                            : "border-border text-muted hover:bg-surface-2 hover:text-text"
                        }`}
                      >
                        {t(c.label)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {desktopNotifications && (
            <div className="border-t border-border px-4 py-3.5">
              <p className="mb-2 text-xs font-medium text-muted">
                {t("priorities.repeatAnUnansweredReminder")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {REPEAT_INTERVALS.map((option) => (
                  <Choice
                    key={option.value}
                    active={repeatEvery === option.value}
                    onSelect={() => chooseRepeat(option.value)}
                    label={t(option.label)}
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-faint">
                {repeatEvery === "0"
                  ? t("settings.aReminderShowsOnceAndThenWaitsForYou")
                  : t("settings.repeatExplanation", { count: repeatEvery })}
              </p>

              <p className="mt-4 mb-2 text-xs font-medium text-muted">{t("settings.sound")}</p>
              <div className="grid grid-cols-3 gap-2">
                {SOUNDS.map((option) => (
                  <Choice
                    key={option.value}
                    active={sound === option.value}
                    onSelect={() => chooseSound(option.value)}
                    label={
                      option.value === "custom" && customName
                        ? customName.replace(/\.[^.]+$/, "")
                        : t(option.label)
                    }
                  />
                ))}
              </div>

              {sound === "custom" && (
                <button
                  onClick={pickCustomSound}
                  className="mt-2 text-xs text-(--color-accent) hover:underline"
                >
                  {t("priorities.chooseADifferentFile")}
                </button>
              )}
              {soundError && (
                <p className="mt-2 text-xs text-(--color-danger)">{soundError}</p>
              )}

              {sound !== "none" && (
                <div className="mt-4 animate-fade-rise">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-muted">{t("priorities.volume")}</p>
                    <button
                      onClick={() => previewSound(sound, volume)}
                      className="text-xs text-(--color-accent) hover:underline"
                    >
                      {t("settings.play")}
                    </button>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={volume}
                    onInput={(e) => setVolume(Number(e.currentTarget.value))}
                    ref={(input) => {
                      if (!input) return;
                      // Persist on native change, not React's per-step onChange.
                      const commit = () => changeVolume(Number(input.value));
                      input.addEventListener("change", commit);
                      return () => input.removeEventListener("change", commit);
                    }}
                    className="w-full accent-(--color-accent)"
                    aria-label={t("settings.reminderVolume")}
                  />

                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={ramp}
                    onClick={toggleRamp}
                    className="mt-3 flex w-full items-start gap-2.5 text-left text-xs text-muted"
                  >
                    <span className="mt-0.5">
                      <Checkbox checked={ramp} interactive={false} size={16} />
                    </span>
                    <span>
                      {t("settings.getLouderEachTimeAReminderRepeats")}
                      {repeatEvery === "0" && (
                        <em className="not-italic text-faint">
                          {" "}
                          {t("settings.needsRepeatingRemindersAbove")}
                        </em>
                      )}
                    </span>
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-border px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text">{t("settings.testNotification")}</p>
              <p className="mt-0.5 text-xs text-muted">
                {testStatus === "sent"
                  ? t("settings.testSent", { route: t(ROUTE_LABEL[testRoute] ?? "settings.notification") })
                  : testStatus === "error"
                    ? t("settings.couldnTSendANotification")
                    : t("settings.sendAOneOffNotificationToConfirmYourSetup")}
              </p>
            </div>
            <button
              onClick={sendTestNotification}
              disabled={testStatus === "sending"}
              className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
            >
              {testStatus === "sending" ? t("settings.sending") : t("settings.sendTest")}
            </button>
          </div>
        </Section>

        {/* Date & time */}
        <Section title={t("settings.dateTime")}>
          <div className="px-4 py-3.5">
            <p className="mb-2.5 text-xs font-medium text-muted">{t("settings.clock")}</p>
            <div className="grid grid-cols-3 gap-2">
              {TIME_FORMATS.map((option) => (
                <Choice
                  key={option.value}
                  active={timeFormatPref === option.value}
                  onSelect={() => chooseTimeFormat(option.value)}
                  label={t(option.label)}
                />
              ))}
            </div>

            <p className="mt-3.5 mb-2.5 text-xs font-medium text-muted">
              {t("settings.weekStartsOn")}
            </p>
            <div className="grid grid-cols-4 gap-2">
              {WEEK_STARTS.map((option) => (
                <Choice
                  key={option.value}
                  active={weekStartPref === option.value}
                  onSelect={() => chooseWeekStart(option.value)}
                  label={t(option.label)}
                />
              ))}
            </div>

            <p className="mt-3 text-xs text-faint">
              {t("settings.autoFollowsYourSystemSettingsCurrently")} {autoSummary()}.
            </p>

            <p className="mt-4 mb-2 text-xs font-medium text-muted">
              {t("settings.quickTimesInTheDatePicker")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {quickTimes.map((time) => (
                <button
                  key={time}
                  onClick={() => removeQuickTime(time)}
                  title={t("settings.remove")}
                  className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text transition-colors hover:border-(--color-danger) hover:text-(--color-danger)"
                >
                  {formatTime(time)}
                  <CloseIcon width={12} height={12} />
                </button>
              ))}
              {quickTimes.length < MAX_QUICK_TIMES && (
                <TimeField
                  value={newQuickTime}
                  onChange={setNewQuickTime}
                  onDone={addNewQuickTime}
                  label={t("tasks.add")}
                />
              )}
            </div>
            <p className="mt-2 text-xs text-faint">
              {quickTimes.length
                ? t("settings.shownAsOneTapButtonsWhenYouSetATime")
                : t("settings.noShortcutsTheDatePickerShowsOnlyTheTimeField")}
            </p>
          </div>
        </Section>

        {/* Task timer */}
        <Section title={t("settings.taskTimer")}>
          <div className="px-4 py-3.5">
            <p className="mb-2.5 text-xs font-medium text-muted">
              {t("settings.thePlayButtonOnATask")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {TIMER_MODES.map((option) => (
                <Choice
                  key={option.value}
                  active={taskTimerMode === option.value}
                  onSelect={() => setTaskTimerMode(option.value)}
                  label={t(option.label)}
                />
              ))}
            </div>
            <p className="mt-3 text-xs text-faint">
              {
                t(TIMER_MODES.find((option) => option.value === taskTimerMode)
                  ?.hint ?? "settings.stopwatchHint")
              }{" "}
              {t("settings.eitherWayTheTaskSTimeIsRecordedAndStart")}
            </p>
          </div>
        </Section>

        {/* Appearance */}
        <Section title={t("settings.appearance")}>
          <Row
            icon={
              theme === "dark" ? (
                <MoonIcon width={18} height={18} />
              ) : (
                <SunIcon width={18} height={18} />
              )
            }
            title={t("settings.theme")}
            desc={theme === "dark" ? t("settings.darkModeIsOn") : t("settings.lightModeIsOn")}
          >
            <button
              onClick={toggleTheme}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              {t("settings.switchTo")} {theme === "dark" ? "light" : "dark"}
            </button>
          </Row>

          <Row
            icon={<CheckCircleIcon width={18} height={18} />}
            title={t("settings.celebrateCompletions")}
            desc={t("settings.playALittleConfettiBurstWhenYouFinishATask")}
          >
            <Switch checked={celebrate} onChange={toggleCelebrate} />
          </Row>
        </Section>

        {/* Keyboard */}
        <Section title={t("settings.keyboard")}>
          <Row
            title={t("settings.keyboardShortcuts")}
            desc={t("settings.navigateAndEditWithoutTheMousePressAnytimeToOpen")}
          >
            <button
              onClick={() => toggleShortcuts(true)}
              className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              {t("settings.viewShortcuts")}
            </button>
          </Row>
        </Section>

        {/* Updates */}
        <Section title={t("settings.updates")}>
          <UpdateRow version={version} />
          <div className="border-t border-border" />
          <Row
            icon={<RotateIcon width={18} height={18} />}
            title={t("settings.checkAutomatically")}
            desc={t("settings.lookForANewVersionQuietlyOnceADayAnd")}
          >
            <Switch
              checked={autoCheckUpdates}
              onChange={() => void setAutoCheckUpdates(!autoCheckUpdates)}
            />
          </Row>
          <div className="border-t border-border" />
          <Row
            icon={<DownloadIcon width={18} height={18} />}
            title={t("settings.installAutomatically")}
            desc={
              canSelfUpdate
                ? t("settings.offerToInstallANewVersionAsSoonAsIt")
                : t("settings.thisCopyIsManagedByYourPackageManagerSoNew")
            }
          >
            <Switch
              checked={autoInstallUpdates && canSelfUpdate}
              disabled={!autoCheckUpdates || !canSelfUpdate}
              onChange={() => void setAutoInstallUpdates(!autoInstallUpdates)}
            />
          </Row>
        </Section>

        {/* About */}
        <Section title={t("settings.about")}>
          <Row
            icon={<PlayIcon width={18} height={18} />}
            title={t("settings.replayTheWelcomeTour")}
            desc={t("settings.walkThroughCaptureFocusAndRemindersAgain")}
          >
            <button
              onClick={() => useOnboarding.getState().start()}
              className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              {t("settings.showTour")}
            </button>
          </Row>
          <div className="border-t border-border" />
          <Row
            icon={<WebsiteIcon width={18} height={18} />}
            title={t("settings.todofyWebsite")}
            desc={t("settings.newsDownloadsAndMoreFromUnifybrowse")}
          >
            <ExternalButton
              label={t("settings.visitWebsite")}
              onClick={() => openExternal(WEBSITE_URL)}
            />
          </Row>
          <div className="border-t border-border" />
          <Row
            icon={<GitHubIcon width={18} height={18} />}
            title={t("settings.githubRepository")}
            desc={t("settings.exploreTheSourceReportAnIssueOrContribute")}
          >
            <ExternalButton
              label={t("settings.openGithub")}
              onClick={() => openExternal(GITHUB_URL)}
            />
          </Row>
          <div className="border-t border-border" />
          <Row
            title={t("settings.version")}
            desc={t("settings.youReRunningTheLatestInstalledBuild")}
          >
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
              {version ? `v${version}` : "—"}
            </span>
          </Row>
        </Section>
      </div>
    </main>
  );
}

/**
 * The whole update story in one row: what is installed, what is available,
 * how far a download has got, and the one action that makes sense next.
 */
function UpdateRow({ version }: { version: string }) {
  const { t } = useTranslation();
  const {
    state,
    version: next,
    error,
    downloaded,
    total,
    canSelfUpdate,
  } = useUpdater();
  const check = useUpdater((s) => s.check);
  const install = useUpdater((s) => s.install);
  const restart = useUpdater((s) => s.restart);

  const percent =
    total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;

  const desc =
    state === "checking"
      ? t("settings.lookingForANewVersion")
      : state === "available"
        ? canSelfUpdate
          ? t("updates.availableDownload", { version: next })
          : t("updates.packageAvailable", { version: next })
        : state === "downloading"
          ? total > 0
            ? t("updates.downloadingProgress", { version: next, percent })
            : t("updates.downloadingVersion", { version: next })
          : state === "ready"
            ? t("updates.installedRestart", { version: next })
            : state === "error"
              ? (error ?? t("settings.theUpdateFailed"))
              : version
                ? t("updates.upToDateVersion", { version })
                : t("settings.checkWhetherANewerVersionIsAvailable");

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
            state === "available" || state === "ready"
              ? "bg-accent-soft text-(--color-accent)"
              : "bg-surface-2 text-muted"
          }`}
        >
          <DownloadIcon width={18} height={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text">{t("settings.softwareUpdate")}</p>
          <p
            className={`mt-0.5 text-xs ${
              state === "error" ? "text-(--color-danger)" : "text-muted"
            }`}
          >
            {desc}
          </p>
        </div>
        <div className="shrink-0">
          {state === "ready" ? (
            <button
              onClick={() => void restart()}
              className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
            >
              {t("settings.restartNow")}
            </button>
          ) : state === "available" ? (
            <button
              onClick={() => void install()}
              className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
            >
              {canSelfUpdate ? t("settings.downloadAndInstall") : t("settings.openReleases")}
            </button>
          ) : (
            <button
              onClick={() => void check(true)}
              disabled={state === "checking" || state === "downloading"}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
            >
              {state === "checking"
                ? t("billing.checking")
                : state === "downloading"
                  ? t("settings.downloading")
                  : state === "error"
                    ? t("common.retry")
                    : t("settings.checkNow")}
            </button>
          )}
        </div>
      </div>

      {state === "downloading" && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-(--color-accent) transition-[width] duration-200"
            style={{ width: total > 0 ? `${percent}%` : "35%" }}
          />
        </div>
      )}

      {(state === "available" || state === "ready") && (
        <button
          onClick={() => openExternal(RELEASES_URL)}
          className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-muted transition-colors hover:text-text"
        >
          {t("settings.seeWhatSNewInV")}{next}
          <ExternalLinkIcon width={11} height={11} />
        </button>
      )}
    </div>
  );
}

/** A compact single-select option, as used by the date & time preferences. */
function Choice({
  active,
  onSelect,
  label,
}: {
  active: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={active}
      className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-(--color-accent) bg-accent-soft text-text"
          : "border-border text-muted hover:bg-surface-2 hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function ExternalButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      {label}
      <ExternalLinkIcon width={13} height={13} />
    </button>
  );
}

function LanguageSection() {
  const { t } = useTranslation();
  const { preference, error } = useLanguageState();
  const [busy, setBusy] = useState(false);
  const change = async (next: LanguagePreference) => {
    setBusy(true);
    try { await setLanguage(next); }
    catch (error) { useLanguageState.setState({ error: String(error) }); }
    finally { setBusy(false); }
  };
  return (
    <Section title={t("language.title")}>
      <Row title={t("language.label")} desc={t("language.hint")}>
        <select aria-label={t("language.label")} value={preference} disabled={busy}
          onChange={(event) => void change(event.currentTarget.value as LanguagePreference)}
          className="rounded-lg border border-border bg-surface-2 px-2 py-1.5 text-sm text-text">
          <option value="auto">{t("language.system")}</option>
          <option value="en">English</option>
          <option value="zh-CN">简体中文</option>
        </select>
      </Row>
      {busy && <p role="status" className="px-4 pb-3 text-xs text-muted">{t("language.saving")}</p>}
      {error && <p role="alert" className="px-4 pb-3 text-xs text-(--color-danger)">{t("language.failed", { message: error })}</p>}
    </Section>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
        {title}
      </h3>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {children}
      </div>
    </section>
  );
}

function Row({
  icon,
  title,
  desc,
  children,
}: {
  icon?: ReactNode;
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {icon && (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">{title}</p>
        {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <button
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

function ModeOption({
  active,
  onSelect,
  title,
  desc,
}: {
  active: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      onClick={onSelect}
      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        active
          ? "border-(--color-accent) bg-accent-soft"
          : "border-border hover:bg-surface-2"
      }`}
    >
      <span
        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 transition-colors ${
          active ? "border-(--color-accent)" : "border-border-strong"
        }`}
      >
        {active && <span className="h-2 w-2 rounded-full bg-(--color-accent)" />}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="mt-0.5 text-xs text-muted">{desc}</p>
      </div>
    </button>
  );
}
