import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useStore } from "../store";
import { today } from "../lib/dates";
import { daySummary, summaryText } from "../lib/journal";
import type { SessionLog } from "../types";
import { DatePicker } from "./DatePicker";

export const MOODS = ["😞", "😕", "😐", "🙂", "😄"];
export const MOOD_LABELS = ["journal.rough", "journal.low", "journal.okay", "journal.good", "journal.great"] as const;

export interface JournalDraft {
  title: string | null;
  body: string;
  mood: number | null;
  entryDate: string;
}

interface Props {
  sessions: SessionLog[];
  initial?: Partial<JournalDraft>;
  submitLabel: string;
  onSubmit: (draft: JournalDraft) => void | Promise<void>;
  onCancel?: () => void;
}

export function JournalEditor({
  sessions,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const tasks = useStore((s) => s.tasks);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [mood, setMood] = useState<number | null>(initial?.mood ?? null);
  const [entryDate, setEntryDate] = useState(initial?.entryDate ?? today());
  const [saving, setSaving] = useState(false);

  const summary = daySummary(tasks, sessions, entryDate);
  const prompt = summaryText(summary);

  const submit = async () => {
    if (!body.trim() && !title.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        title: title.trim() || null,
        body: body.trim(),
        mood,
        entryDate,
      });
      if (!initial) {
        setTitle("");
        setBody("");
        setMood(null);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="journal-composer">
      <input
        className="journal-composer-title"
        value={title}
        onInput={(e) => setTitle(e.currentTarget.value)}
        placeholder={t("journal.titleOptional")}
      />
      <textarea
        id={initial ? undefined : "journal-add-input"}
        className="journal-composer-body"
        value={body}
        onInput={(e) => setBody(e.currentTarget.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
        }}
        placeholder={t("journal.writeFreelyMarkdownSupported")}
        rows={initial ? 5 : 4}
      />

      {prompt && (
        <button
          type="button"
          className="journal-summary-chip"
          onClick={() =>
            setBody((b) => (b.trim() ? `${b}\n\n${prompt}` : prompt))
          }
          title={t("journal.insertThisDaySSummary")}
        >
          <span aria-hidden="true">✨</span> {prompt}
        </button>
      )}

      <div className="journal-toolbar">
        <div className="mood-picker" role="group" aria-label={t("journal.mood")}>
          {MOODS.map((face, i) => {
            const value = i + 1;
            return (
              <button
                key={value}
                type="button"
                className={`mood-btn ${mood === value ? "is-active" : ""}`}
                onClick={() => setMood(mood === value ? null : value)}
                title={t(MOOD_LABELS[i])}
                aria-label={t(MOOD_LABELS[i])}
                aria-pressed={mood === value}
              >
                {face}
              </button>
            );
          })}
        </div>

        <DatePicker
          value={entryDate}
          onChange={(d) => setEntryDate(d ?? today())}
          allowClear={false}
        />

        <div className="journal-toolbar-actions">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted hover:text-text"
            >
              {t("common.cancel")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving || (!body.trim() && !title.trim())}
            className="rounded-md bg-(--color-accent) px-3.5 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
