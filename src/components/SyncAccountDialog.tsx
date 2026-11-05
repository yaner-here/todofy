import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useSync, type AccountDataChoice } from "../lib/sync";

export function SyncAccountDialog() {
  const { t } = useTranslation();
  const { email, signOut } = useAuth();
  const { accountChoice, error, resolveAccountChoice } = useSync();
  const [busy, setBusy] = useState<AccountDataChoice | "signout" | null>(null);

  if (!accountChoice) return null;

  const choose = async (choice: AccountDataChoice) => {
    if (busy) return;
    setBusy(choice);
    await resolveAccountChoice(choice);
    setBusy(null);
  };

  const cancel = async () => {
    if (busy) return;
    setBusy("signout");
    await signOut();
    setBusy(null);
  };

  return (
    <div
      className="fixed inset-0 z-110 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-account-title"
    >
      <div className="w-full max-w-md animate-fade-rise rounded-xl border border-border-strong bg-elevated p-5 shadow-2xl shadow-black/50">
        <h3 id="sync-account-title" className="text-base font-semibold text-text">
          {t("account.chooseDataForThisAccount")}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {t("account.thisDeviceAlreadyHasTasksLinkedToAnotherAccountBefore")}
          {email ? ` ${email}` : t("account.thisAccount")}{t("account.chooseWhatTodofyShouldDo")}
        </p>

        <div className="mt-4 grid gap-2.5">
          <button
            type="button"
            onClick={() => choose("copy-local")}
            disabled={busy !== null}
            autoFocus
            className="rounded-xl border border-(--color-accent) bg-accent-soft px-4 py-3 text-left transition-colors hover:brightness-110 disabled:opacity-60"
          >
            <span className="block text-sm font-semibold text-text">
              {t("account.copyThisDeviceSData")}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted">
              {t("account.keepLocalTasksLabelsFocusHistoryAndJournalEntriesAnd")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => choose("account")}
            disabled={busy !== null}
            className="rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2 disabled:opacity-60"
          >
            <span className="block text-sm font-semibold text-text">
              {t("account.useThisAccountSData")}
            </span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted">
              {t("account.removeTheDeviceSSyncedTasksAndLoadThisAccount")}
            </span>
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] px-3 py-2 text-xs text-(--color-danger)">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between">
          <span className="text-[11px] text-faint">
            {t("account.nothingIsUploadedUntilYouChoose")}
          </span>
          <button
            type="button"
            onClick={cancel}
            disabled={busy !== null}
            className="rounded-lg px-3 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-60"
          >
            {t("account.signOut")}
          </button>
        </div>
      </div>
    </div>
  );
}
