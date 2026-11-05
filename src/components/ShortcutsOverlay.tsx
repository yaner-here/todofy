import type { MessageKey } from "../lib/i18n";
import { useTranslation } from "react-i18next";
import { useStore } from "../store";
import { CloseIcon } from "./Icons";

/** One row's worth of keys + description. Keys render as <kbd> chips. */
type Shortcut = { keys: string[]; desc: MessageKey };

const NAVIGATION: Shortcut[] = [
  { keys: ["J"], desc: "shortcuts.nextTask" },
  { keys: ["K"], desc: "shortcuts.previousTask" },
  { keys: ["↑", "↓"], desc: "shortcuts.moveSelection" },
  { keys: ["Shift", "J"], desc: "shortcuts.openJournal" },
  { keys: ["Esc"], desc: "shortcuts.closePanel" },
];

const ACTIONS: Shortcut[] = [
  { keys: ["N"], desc: "shortcuts.newTask" },
  { keys: ["E"], desc: "shortcuts.editTask" },
  { keys: ["C"], desc: "shortcuts.toggleComplete" },
  { keys: ["P"], desc: "shortcuts.togglePin" },
  { keys: ["H"], desc: "shortcuts.moveLeft" },
  { keys: ["L"], desc: "shortcuts.moveRight" },
  { keys: ["Del"], desc: "shortcuts.deleteTask" },
];

const GLOBAL: Shortcut[] = [
  { keys: ["Ctrl", "Alt", "A"], desc: "shortcuts.capture" },
  { keys: ["?"], desc: "shortcuts.showHelp" },
];

export function ShortcutsOverlay() {
  const { t } = useTranslation();
  const show = useStore((s) => s.showShortcuts);
  const close = useStore((s) => s.toggleShortcuts);
  if (!show) return null;

  return (
    <div
      onClick={() => close(false)}
      className="absolute inset-0 z-50 grid animate-fade-rise place-items-center bg-black/40 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface shadow-xl shadow-black/30"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">{t("settings.keyboardShortcuts")}</h2>
          <button
            onClick={() => close(false)}
            className="rounded-md p-1 text-faint transition-colors hover:bg-surface-2 hover:text-text"
            title={t("common.close")}
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <Group title={t("shortcuts.navigation")} rows={NAVIGATION} />
          <Group title={t("shortcuts.selectedTask")} rows={ACTIONS} />
          <Group title={t("shortcuts.global")} rows={GLOBAL} />
        </div>
      </div>
    </div>
  );
}

function Group({ title, rows }: { title: string; rows: Shortcut[] }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 last:mb-0">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-faint">
        {title}
      </p>
      <div className="flex flex-col">
        {rows.map((r) => (
          <div
            key={r.desc}
            className="flex items-center justify-between gap-4 py-1.5"
          >
            <span className="text-sm text-muted">{t(r.desc)}</span>
            <span className="flex shrink-0 items-center gap-1">
              {r.keys.map((k) => (
                <kbd
                  key={k}
                  className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-muted"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
