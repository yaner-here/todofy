import { t, type MessageKey } from "../lib/i18n";
import { Trans, useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../lib/api";
import {
  hasOverrides,
  displayPriorityName,
  inputOf,
  isCustomized,
  PRIORITY_VALUES,
  profileFor,
  type PriorityProfile,
  type PriorityProfileInput,
} from "../lib/priority";
import {
  customKeysFor,
  MAX_CUSTOM_BYTES,
  parseSoundSettings,
  playSound,
  SOUND_KEYS,
  type SoundId,
} from "../lib/sound";
import { PALETTE } from "./LabelForm";
import { FlagIcon } from "./Icons";

/**
 * Settings → Priorities. The four priorities are fixed, so this renames,
 * recolors and re-sounds them rather than adding or removing any.
 *
 * Every reminder control carries a "Default" option, which stores a null and
 * means "follow the global settings in Notifications". That keeps the common
 * case configured in one place and leaves an untouched priority behaving
 * exactly as it did before profiles existed.
 */
export function PriorityProfilesSection() {
  const { t } = useTranslation();
  const { priorityProfiles, updatePriorityProfile, resetPriorityProfile } =
    useStore();
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-6">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
        {t("priorities.priorities")}
      </h3>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <p className="border-b border-border px-4 py-3 text-xs text-muted">
          <Trans i18nKey="priorities.description" components={{ em: <em className="not-italic text-faint" />, code: <code /> }} />
        </p>
        {error && (
          <p
            role="alert"
            className="border-b border-border px-4 py-2 text-xs text-(--color-danger)"
          >
            {error}
          </p>
        )}
        {PRIORITY_VALUES.map((priority) => {
          const profile = profileFor(priority, priorityProfiles);
          const open = editing === priority;
          const changed = isCustomized(profile) || hasOverrides(profile);
          return (
            <div key={priority} className="border-b border-border last:border-b-0">
              <div className="flex items-center gap-3 px-4 py-3">
                <span
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2"
                  style={{ color: profile.color }}
                >
                  <FlagIcon width={18} height={18} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text">
                    {displayPriorityName(profile)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {summarize(profile)}
                  </p>
                </div>
                {changed && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await resetPriorityProfile(priority);
                        setEditing(null);
                      })
                    }
                    className="shrink-0 text-xs text-muted hover:text-text disabled:opacity-50"
                  >
                    {t("common.reset")}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setEditing(open ? null : priority);
                    setError(null);
                  }}
                  aria-expanded={open}
                  className="shrink-0 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
                >
                  {open ? t("common.close") : t("common.edit")}
                </button>
              </div>
              {open && (
                <PriorityEditor
                  key={profile.updatedAt}
                  profile={profile}
                  busy={busy}
                  onCancel={() => setEditing(null)}
                  onSave={(input) =>
                    run(async () => {
                      await updatePriorityProfile(priority, input);
                      setEditing(null);
                    })
                  }
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The one-line description under each priority's name. */
function summarize(profile: PriorityProfile): string {
  const parts: string[] = [`P${profile.priority}`];
  if (profile.priority === 4 && !isCustomized(profile)) {
    parts.push(t("priorities.hidden"));
  }
  if (profile.sound) {
    parts.push(
      profile.sound === "none"
        ? t("priorities.silent")
        : t(SOUND_LABELS[profile.sound]).toLowerCase(),
    );
  }
  if (profile.repeatMinutes !== null) {
    parts.push(
      profile.repeatMinutes === 0
        ? t("priorities.once")
        : t("priorities.repeats", { count: profile.repeatMinutes }),
    );
  }
  if (profile.notificationStyle) {
    parts.push(
      profile.notificationStyle === "native"
        ? t("priorities.systemNotification")
        : t("priorities.popup"),
    );
  }
  return parts.join(" · ");
}

const SOUND_LABELS: Record<SoundId, MessageKey> = {
  none: "sound.silent",
  chime: "sound.chime",
  ping: "sound.ping",
  bell: "sound.bell",
  custom: "common.custom",
};

/** `null` is always first, and always means "follow the global setting". */
const SOUND_CHOICES: { value: SoundId | null; label: MessageKey }[] = [
  { value: null, label: "priorities.default" },
  { value: "none", label: "sound.silent" },
  { value: "chime", label: "sound.chime" },
  { value: "ping", label: "sound.ping" },
  { value: "bell", label: "sound.bell" },
  { value: "custom", label: "sound.custom" },
];

const STYLE_CHOICES: { value: "custom" | "native" | null; label: MessageKey }[] = [
  { value: null, label: "priorities.default" },
  { value: "custom", label: "settings.inAppPopup" },
  { value: "native", label: "settings.system" },
];

const REPEAT_CHOICES: { value: number | null; label: MessageKey }[] = [
  { value: null, label: "priorities.default" },
  { value: 0, label: "settings.noRepeat" },
  { value: 2, label: "settings.repeat2" },
  { value: 5, label: "settings.repeat5" },
  { value: 10, label: "settings.repeat10" },
];

const RAMP_CHOICES: { value: boolean | null; label: MessageKey }[] = [
  { value: null, label: "priorities.default" },
  { value: true, label: "settings.ramp" },
  { value: false, label: "settings.level" },
];

function PriorityEditor({
  profile,
  busy,
  onCancel,
  onSave,
}: {
  profile: PriorityProfile;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: PriorityProfileInput) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<PriorityProfileInput>(() =>
    inputOf(profile),
  );
  const [customName, setCustomName] = useState<string | null>(null);
  const [soundError, setSoundError] = useState("");
  const keys = customKeysFor(profile.priority);

  // The stored file name, if this priority already has a sound of its own.
  useEffect(() => {
    api
      .getSetting(keys.name)
      .then(setCustomName)
      .catch(() => {});
  }, [keys.name]);

  const patch = (change: Partial<PriorityProfileInput>) =>
    setDraft((current) => ({ ...current, ...change }));

  const colorValid = /^#[0-9a-fA-F]{6}$/.test(draft.color);
  const trimmed = draft.name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 40 && colorValid;

  /**
   * Kept as bytes under this priority's own key rather than a path, so the
   * sound survives the file moving — and device-local, so a megabyte of audio
   * never rides along in a sync payload.
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
          api.setSetting(keys.data, data),
          api.setSetting(keys.name, file.name),
        ]);
        setCustomName(file.name);
        setSoundError("");
        patch({ sound: "custom" });
        void preview("custom", data);
      } catch {
        setSoundError(t("priorities.thatFileCouldnTBeRead"));
      }
    };
    input.click();
  };

  /** A preview that stays silent has to say why, or it reads as unimplemented. */
  const preview = async (sound: SoundId, data?: string | null) => {
    if (sound === "none") return;
    try {
      setSoundError("");
      const customData =
        data ?? (sound === "custom" ? await api.getSetting(keys.data) : null);
      // Without an override, a preview plays at whatever the global volume is
      // — parsed rather than `Number()`d, since an unset one is an empty
      // string and `Number("")` is a perfectly silent 0.
      const volume =
        draft.volume ??
        parseSoundSettings({
          volume: await api.getSetting(SOUND_KEYS.volume).catch(() => null),
        }).volume;
      // The ramp belongs to repeats, so a preview plays at the set volume.
      await playSound({ sound, volume, ramp: false, customData });
    } catch (error) {
      setSoundError(
        error instanceof Error ? error.message : t("priorities.thatSoundCouldnTBePlayed"),
      );
    }
  };

  const chooseSound = (sound: SoundId | null) => {
    setSoundError("");
    // Picking "Custom…" with nothing loaded for this priority means "go find
    // one"; its bytes live under this priority's own key.
    if (sound === "custom" && !customName) return pickCustomSound();
    patch({ sound });
    if (sound) void preview(sound);
  };

  return (
    <form
      className="animate-fade-rise border-t border-border px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid || busy) return;
        onSave({ ...draft, name: trimmed });
      }}
    >
      <label className="block text-xs font-medium text-muted">
        {t("priorities.name")}
        <input
          autoFocus
          value={draft.name}
          maxLength={40}
          disabled={busy}
          onInput={(event) => patch({ name: event.currentTarget.value })}
          className="mt-1.5 w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 text-sm text-text outline-none focus:border-(--color-accent)"
        />
      </label>

      <p className="mt-3 mb-2 text-xs font-medium text-muted">{t("board.color")}</p>
      <div
        role="group"
        aria-label={t("priorities.priorityColorPresets")}
        className="flex flex-wrap gap-1.5"
      >
        {PALETTE.map((preset) => (
          <button
            key={preset}
            type="button"
            disabled={busy}
            aria-label={t("common.useColor", { color: preset })}
            aria-pressed={draft.color.toLowerCase() === preset}
            onClick={() => patch({ color: preset })}
            style={{ background: preset }}
            className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
              draft.color.toLowerCase() === preset
                ? "ring-2 ring-(--color-accent) ring-offset-2 ring-offset-(--color-surface)"
                : ""
            }`}
          />
        ))}
      </div>
      <input
        value={draft.color}
        disabled={busy}
        onInput={(event) => patch({ color: event.currentTarget.value })}
        aria-invalid={!colorValid}
        aria-label={t("priorities.priorityColor")}
        placeholder="#6c7cff"
        className="mt-2 w-28 rounded-lg border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-text outline-none focus:border-(--color-accent)"
      />
      {!colorValid && (
        <p className="mt-1.5 text-xs text-(--color-danger)">
          {t("board.useASixDigitHexColorSuchAs6c7cff")}
        </p>
      )}

      <Chips
        label={t("priorities.reminderSound")}
        choices={SOUND_CHOICES.map((choice) =>
          choice.value === "custom" && customName
            ? { ...choice, label: customName.replace(/\.[^.]+$/, "") }
            : choice,
        )}
        value={draft.sound}
        onSelect={chooseSound}
        disabled={busy}
      />
      {draft.sound === "custom" && (
        <button
          type="button"
          onClick={pickCustomSound}
          className="mt-1.5 text-xs text-(--color-accent) hover:underline"
        >
          {t("priorities.chooseADifferentFile")}
        </button>
      )}
      {soundError && (
        <p className="mt-1.5 text-xs text-(--color-danger)">{soundError}</p>
      )}
      {draft.sound === "custom" && (
        <p className="mt-1.5 text-xs text-faint">
          {t("priorities.customSoundStoredLocally")}
        </p>
      )}

      {draft.sound !== "none" && (
        <>
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs font-medium text-muted">{t("priorities.volume")}</p>
            {draft.volume !== null && (
              <button
                type="button"
                onClick={() => patch({ volume: null })}
                className="text-xs text-muted hover:text-text"
              >
                {t("priorities.useDefault")}
              </button>
            )}
          </div>
          {draft.volume === null ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ volume: 70 })}
              className="mt-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
            >
              {t("priorities.setAVolumeForThisPriority")}
            </button>
          ) : (
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={draft.volume}
              disabled={busy}
              onInput={(event) =>
                patch({ volume: Number(event.currentTarget.value) })
              }
              className="mt-1.5 w-full accent-(--color-accent)"
              aria-label={t("priorities.reminderVolumeForThisPriority")}
            />
          )}

          <Chips
            label={t("priorities.whenAReminderRepeats")}
            choices={RAMP_CHOICES}
            value={draft.ramp}
            onSelect={(ramp) => patch({ ramp })}
            disabled={busy}
          />
        </>
      )}

      <Chips
        label={t("priorities.notificationStyle")}
        choices={STYLE_CHOICES}
        value={draft.notificationStyle}
        onSelect={(notificationStyle) => patch({ notificationStyle })}
        disabled={busy}
      />

      <Chips
        label={t("priorities.repeatAnUnansweredReminder")}
        choices={REPEAT_CHOICES}
        value={draft.repeatMinutes}
        onSelect={(repeatMinutes) => patch({ repeatMinutes })}
        disabled={busy}
      />

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          {t("common.cancel")}
        </button>
        <button
          type="submit"
          disabled={busy || !valid}
          className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {busy ? t("board.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

/** A labelled row of single-choice chips, where one of them is "Default". */
function Chips<T>({
  label,
  choices,
  value,
  onSelect,
  disabled,
}: {
  label: string;
  choices: { value: T; label: string }[];
  value: T;
  onSelect: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <p className="mt-3 mb-2 text-xs font-medium text-muted">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {choices.map((choice) => {
          const active = choice.value === value;
          return (
            <button
              key={String(choice.value)}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onSelect(choice.value)}
              className={`max-w-40 truncate rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                active
                  ? "border-(--color-accent) bg-accent-soft text-text"
                  : "border-border text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
    </>
  );
}
