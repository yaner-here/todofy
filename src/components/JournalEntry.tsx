import { appLocale, usesHour12 } from "../lib/locale";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useStore } from "../store";
import { renderMarkdown } from "../lib/markdown";
import type { JournalEntry as Entry, SessionLog } from "../types";
import { EditIcon, TrashIcon } from "./Icons";
import { JournalEditor, MOODS, MOOD_LABELS } from "./JournalEditor";

interface Props {
  entry: Entry;
  sessions: SessionLog[];
}

export function JournalEntry({ entry, sessions }: Props) {
  const { t } = useTranslation();
  const { patchJournal, removeJournal, requestConfirm } = useStore();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <JournalEditor
        sessions={sessions}
        initial={entry}
        submitLabel={t("common.save")}
        onSubmit={async (draft) => {
          await patchJournal({ id: entry.id, ...draft });
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const time = new Date(entry.createdAt).toLocaleTimeString(appLocale(), {
    hour: "numeric",
    minute: "2-digit",
    hour12: usesHour12(),
  });

  return (
    <article className="journal-entry">
      <div className="journal-entry-head">
        {entry.mood && (
          <span className="journal-mood-badge" title={t(MOOD_LABELS[entry.mood - 1])}>
            {MOODS[entry.mood - 1]}
          </span>
        )}
        <span className="journal-entry-title">{entry.title ?? t("journal.untitledEntry")}</span>
        <span className="journal-entry-time">{time}</span>
        <div className="journal-entry-actions">
          <button onClick={() => setEditing(true)} title={t("journal.editEntry")}>
            <EditIcon width={14} height={14} />
          </button>
          <button
            className="is-danger"
            onClick={() =>
              requestConfirm({
                title: t("journal.deleteEntryTitle"),
                message: t("journal.deleteEntryMessage"),
                confirmLabel: t("common.delete"),
                danger: true,
                onConfirm: () => removeJournal(entry.id),
              })
            }
            title={t("journal.deleteEntry")}
          >
            <TrashIcon width={14} height={14} />
          </button>
        </div>
      </div>
      {entry.body && (
        <div
          className="journal-prose"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body) }}
        />
      )}
    </article>
  );
}
