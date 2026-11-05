import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { columnName, DONE_COLUMN, orderedColumns, TODO_COLUMN } from "../lib/board";
import { useColumnReorder } from "../lib/useColumnReorder";
import type { BoardColumnDefinition, BoardColumnInput } from "../types";
import { PALETTE } from "./LabelForm";
import { CloseIcon, GripIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "./Icons";

export function BoardColumnsDialog({ initialId, onClose }: { initialId?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { boardDefinitions, reorderBoardColumns, deleteBoardColumn } = useStore();
  const columns = orderedColumns(boardDefinitions);
  const [editing, setEditing] = useState<string | null>(initialId ?? null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [destination, setDestination] = useState(TODO_COLUMN);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement);
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError(null);
    try { await action(); }
    catch (e) { setError(String(e)); }
    finally { pending.current = false; setBusy(false); }
  };
  const reorder = (ids: string[]) => void run(() => reorderBoardColumns(ids));
  const { start, setRowRef, overId } = useColumnReorder(columns.map((c) => c.id), reorder);
  const move = (id: string, direction: -1 | 1) => {
    const ids = columns.map((c) => c.id);
    const from = ids.indexOf(id), to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length - 1 || id === DONE_COLUMN) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorder(ids);
  };
  useEffect(() => {
    const first = dialog.current?.querySelector<HTMLElement>(".column-editor input")
      ?? dialog.current?.querySelector<HTMLElement>("button");
    first?.focus();
    return () => {
      const previous = previousFocus.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  const current = columns.find((c) => c.id === editing);
  const deletion = columns.find((c) => c.id === deleting);
  return (
    <div className="column-dialog-backdrop" onMouseDown={(e) => {
      if (e.target === e.currentTarget && !pending.current) onClose();
    }}>
      <div ref={dialog} className="column-dialog" role="dialog" aria-modal="true" aria-labelledby="columns-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); if (!pending.current) onClose(); }
          if (e.key !== "Tab") return;
          const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []);
          const first = elements[0], last = elements[elements.length - 1];
          if (!dialog.current?.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first)?.focus(); }
          else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
        }}>
        <header className="column-dialog-header">
          <div><h2 id="columns-title">{t("board.manageColumns")}</h2><p>{t("board.shapeYourWorkflowWipLimitsGiveANudgeWhenA")}</p></div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t("board.closeColumnSettings")}><CloseIcon width={18} height={18} /></button>
        </header>
        <div className="column-dialog-scroll">
          {error && <p className="column-error" role="alert">{error}</p>}
          <div className="column-manager-list">
            {columns.map((column, index) => (
              <div key={column.id} ref={setRowRef(column.id)} className={`column-manager-row ${overId === column.id ? "is-drop-target" : ""}`}>
                <button type="button" className="column-drag-handle" disabled={busy || column.id === DONE_COLUMN}
                  onPointerDown={start(column.id)} aria-label={t("board.dragColumn", { name: columnName(column) })}
                  onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); move(column.id, e.key === "ArrowUp" ? -1 : 1); } }}>
                  <GripIcon width={16} height={16} />
                </button>
                <i className="column-color-dot" style={{ background: column.color }} />
                <div className="column-manager-copy"><strong>{columnName(column)}</strong><small>{column.id === DONE_COLUMN ? t("board.completionColumnHint") : column.id === TODO_COLUMN ? t("board.defaultDestination") : column.wipLimit ? t("board.limitHint", { count: column.wipLimit }) : t("board.noLimitHint")}</small></div>
                <button type="button" disabled={busy || index === 0 || column.id === DONE_COLUMN} aria-label={t("board.moveLeft", { name: columnName(column) })} onClick={() => move(column.id, -1)}><ChevronLeftIcon width={14} height={14} /></button>
                <button type="button" disabled={busy || index >= columns.length - 2} aria-label={t("board.moveRight", { name: columnName(column) })} onClick={() => move(column.id, 1)}><ChevronRightIcon width={14} height={14} /></button>
                <button type="button" disabled={busy} onClick={() => { setEditing(column.id); setDeleting(null); setError(null); }}>{t("common.edit")}</button>
                {column.id !== TODO_COLUMN && column.id !== DONE_COLUMN && <button type="button" className="column-delete" disabled={busy} onClick={() => { setDeleting(column.id); setEditing(null); setDestination(TODO_COLUMN); setError(null); }}>{t("common.delete")}</button>}
              </div>
            ))}
          </div>
          {deletion && <section className="column-delete-panel">
            <h3>{t("board.deleteConfirm", { name: columnName(deletion) })}</h3>
            <p>{t("board.moveItsTasksToAnotherColumnCompletedTasksWillRemember")}</p>
            <label>{t("board.moveTasksTo")}<select value={destination} disabled={busy} onChange={(e) => setDestination(e.currentTarget.value)}>
              {columns.filter((c) => c.id !== deletion.id && c.id !== DONE_COLUMN).map((c) => <option key={c.id} value={c.id}>{columnName(c)}</option>)}
            </select></label>
            <div className="column-editor-actions"><button type="button" disabled={busy} onClick={() => setDeleting(null)}>{t("common.cancel")}</button>
              <button type="button" className="column-danger-button" disabled={busy} onClick={() => void run(async () => { await deleteBoardColumn(deletion.id, destination); setDeleting(null); })}>{t("board.moveTasksAndDelete")}</button></div>
          </section>}
          {editing !== null && (editing === "new" || current) && <ColumnEditor key={editing} column={current} busy={busy} onCancel={() => setEditing(null)} onSave={(input) => run(async () => {
            if (current) await useStore.getState().updateBoardColumn(current.id, input);
            else await useStore.getState().createBoardColumn(input);
            setEditing(null);
            requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>(".column-add-button")?.focus());
          })} />}
          {editing !== "new" && <button type="button" className="column-add-button" disabled={busy} onClick={() => { setEditing("new"); setDeleting(null); setError(null); }}><PlusIcon width={16} height={16} />{t("board.addColumn")}</button>}
        </div>
      </div>
    </div>
  );
}

function ColumnEditor({ column, busy, onCancel, onSave }: {
  column?: BoardColumnDefinition; busy: boolean; onCancel: () => void; onSave: (input: BoardColumnInput) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(column?.name ?? "");
  const [color, setColor] = useState(column?.color ?? "#6c7cff");
  const [limit, setLimit] = useState(column?.wipLimit?.toString() ?? "");
  const colorValid = /^#[0-9a-fA-F]{6}$/.test(color);
  const limitValid = limit === "" || /^\d+$/.test(limit) && Number(limit) >= 1 && Number(limit) <= 9999;
  const valid = name.trim().length > 0 && name.trim().length <= 60 && colorValid && limitValid;
  return (
    <form className="column-editor" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void onSave({ name: name.trim(), color, wipLimit: column?.id === DONE_COLUMN || !limit ? null : Number(limit) }); }}>
      <h3>{column ? t("board.editColumn", { name: columnName(column) }) : t("board.newColumn")}</h3>
      <label>{t("board.columnName")}<input autoFocus value={name} maxLength={60} disabled={busy} onInput={(e) => setName(e.currentTarget.value)} /></label>
      <label>{t("board.color")}<input value={color} disabled={busy} onInput={(e) => setColor(e.currentTarget.value)} aria-invalid={!colorValid} placeholder="#6c7cff" /></label>
      <div className="column-palette" role="group" aria-label={t("board.columnColorPresets")}>{PALETTE.map((c) => <button key={c} type="button" disabled={busy} aria-label={t("common.useColor", { color: c })} aria-pressed={color.toLowerCase() === c} style={{ background: c }} onClick={() => setColor(c)} />)}</div>
      {!colorValid && <small className="column-error">{t("board.useASixDigitHexColorSuchAs6c7cff")}</small>}
      {column?.id !== DONE_COLUMN && <label>{t("board.wipLimit")}<input type="number" min="1" max="9999" step="1" value={limit} disabled={busy} onInput={(e) => setLimit(e.currentTarget.value)} placeholder={t("board.noLimit")} aria-invalid={!limitValid} /><small>{t("board.leaveEmptyForNoLimitCountsAllActiveTasksIncluding")}</small></label>}
      {!limitValid && <small className="column-error">{t("board.enterAWholeNumberBetween1And9999")}</small>}
      <div className="column-editor-actions"><button type="button" disabled={busy} onClick={onCancel}>{t("common.cancel")}</button><button type="submit" className="column-save-button" disabled={busy || !valid}>{busy ? t("board.saving") : t("board.saveColumn")}</button></div>
    </form>
  );
}
