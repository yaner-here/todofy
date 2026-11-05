import { useTranslation } from "react-i18next";
import { useState } from "react";
import { activeCount, useStore } from "../store";
import type { ViewId } from "../types";
import { EditIcon, PlusIcon, SearchIcon, TrashIcon } from "./Icons";
import { LabelForm } from "./LabelForm";

export function LabelsView() {
  const { t } = useTranslation();
  const {
    tasks,
    labels,
    setView,
    addLabel,
    editLabel,
    removeLabel,
    requestConfirm,
  } = useStore();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = labels.filter((l) =>
    l.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <main className="redesign-secondary labels-main flex flex-1 flex-col overflow-hidden bg-bg">
      <header className="app-page-header shrink-0 px-8 pt-8 pb-4">
        <h2 className="text-2xl font-semibold tracking-tight">{t("labels.labels")}</h2>
        <p className="mt-0.5 text-sm text-muted">
          {t("labels.searchEditAndManageYourLabels")}
        </p>
      </header>

      <div className="secondary-toolbar mx-auto flex w-full max-w-2xl items-center gap-2 px-8">
        <div className="relative flex-1">
          <SearchIcon
            width={15}
            height={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder={t("labels.searchLabels")}
            className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-(--color-accent)"
          />
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setAdding((v) => !v);
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-md bg-(--color-accent) px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <PlusIcon width={15} height={15} />
          {t("labels.newLabel")}
        </button>
      </div>

      <div className="secondary-scroll labels-content mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 pt-4 pb-8">
        {adding && (
          <div className="mb-3">
            <LabelForm
              onSubmit={async (name, color) => {
                await addLabel(name, color);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          </div>
        )}

        {filtered.length === 0 ? (
          <p className="mt-10 text-center text-sm text-faint">
            {labels.length === 0
              ? t("labels.noLabelsYet")
              : t("labels.noLabelsMatchYourSearch")}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {filtered.map((l) => {
              if (editingId === l.id) {
                return (
                  <LabelForm
                    key={l.id}
                    initialName={l.name}
                    initialColor={l.color}
                    onSubmit={async (name, color) => {
                      await editLabel(l.id, name, color);
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                );
              }

              const id: ViewId = { kind: "label", labelId: l.id };
              const count = activeCount(tasks, id);
              return (
                <div
                  key={l.id}
                  className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-sm transition-colors hover:border-border hover:bg-surface"
                >
                  <button
                    onClick={() => setView(id)}
                    className="flex flex-1 items-center gap-3 overflow-hidden text-left"
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: l.color }}
                    />
                    <span className="flex-1 truncate">{l.name}</span>
                    <span className="text-xs tabular-nums text-faint">
                      {count} {t("labels.active")}
                    </span>
                  </button>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    <button
                      onClick={() => {
                        setAdding(false);
                        setEditingId(l.id);
                      }}
                      className="rounded p-1 text-faint hover:text-text"
                      title={t("labels.editLabel")}
                    >
                      <EditIcon width={14} height={14} />
                    </button>
                    <button
                      onClick={() =>
                        requestConfirm({
                          title: t("labels.deleteLabelTitle"),
                          message: t("labels.deleteLabelMessage", { name: l.name }),
                          confirmLabel: t("common.delete"),
                          danger: true,
                          onConfirm: () => removeLabel(l.id),
                        })
                      }
                      className="rounded p-1 text-faint hover:text-(--color-danger)"
                      title={t("labels.deleteLabel")}
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
