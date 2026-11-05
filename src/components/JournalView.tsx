import { appLocale } from "../lib/locale";
import { t } from "../lib/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { api } from "../lib/api";
import { today } from "../lib/dates";
import type { JournalEntry as Entry, SessionLog } from "../types";
import { JournalEditor } from "./JournalEditor";
import { JournalEntry } from "./JournalEntry";

function groupHeading(date: string): string {
  if (date === today()) return t("common.today");
  return new Date(date + "T00:00:00").toLocaleDateString(appLocale(), {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function JournalView() {
  const { t } = useTranslation();
  const { journal, addJournal } = useStore();
  const [sessions, setSessions] = useState<SessionLog[]>([]);

  useEffect(() => {
    api
      .focusHistory()
      .then(setSessions)
      .catch(() => {});
  }, []);

  const groups = useMemo(() => {
    const byDate = new Map<string, Entry[]>();
    for (const entry of journal) {
      const list = byDate.get(entry.entryDate) ?? [];
      list.push(entry);
      byDate.set(entry.entryDate, list);
    }
    return [...byDate.entries()];
  }, [journal]);

  return (
    <main className="redesign-secondary flex flex-1 flex-col overflow-hidden bg-bg">
      <header className="app-page-header shrink-0 px-8 pt-8 pb-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("journal.journal")}</h2>
        <p className="mt-0.5 text-sm text-muted">{t("journal.writeAndReflectOnYourDays")}</p>
      </header>

      <div className="secondary-scroll mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 pt-2 pb-10">
        <JournalEditor
          sessions={sessions}
          submitLabel={t("journal.addEntry")}
          onSubmit={async (draft) => {
            await addJournal(draft);
          }}
        />

        {journal.length === 0 ? (
          <p className="mt-10 text-center text-sm text-faint">
            {t("journal.noEntriesYetStartWritingAbove")}
          </p>
        ) : (
          <div className="mt-7 flex flex-col gap-7">
            {groups.map(([date, entries]) => (
              <section key={date} className="journal-day">
                <div className="journal-day-heading">
                  <strong>{groupHeading(date)}</strong>
                  <span>
                    {t("common.entryCount", { count: entries.length })}
                  </span>
                </div>
                {entries.map((entry) => (
                  <JournalEntry
                    key={entry.id}
                    entry={entry}
                    sessions={sessions}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
