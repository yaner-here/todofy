import { t } from "../lib/i18n";
import { appLocale } from "../lib/locale";
import type { MessageKey } from "../lib/i18n";
import { Trans, useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useAuth, type AuthResult } from "../lib/auth";
import { useSync, type SyncStatus } from "../lib/sync";
import { syncConfigured } from "../lib/supabase";
import { billingConfigured, useBilling } from "../lib/billing";
import { CloudIcon, CrownIcon, TrashIcon, UserIcon } from "./Icons";
import { Checkbox } from "./Checkbox";

export function AccountSection() {
  const { t } = useTranslation();
  const { ready, session, email, openDialog, signOut, deleteAccount } =
    useAuth();
  const { openGate } = useBilling();

  if (!syncConfigured) {
    return (
      <section className="mb-6">
        <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
          {t("account.account")}
        </h3>
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="px-4 py-3.5 text-sm text-muted">
            {t("account.accountSyncIsnTConfiguredInThisBuild")}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mb-6">
      <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-faint">
        {t("account.account")}
      </h3>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        {!ready ? (
          <div className="px-4 py-3.5 text-sm text-muted">{t("account.loading")}</div>
        ) : session ? (
          <SignedInRow
            email={email}
            onSignOut={signOut}
            deleteAccount={deleteAccount}
          />
        ) : (
          <SignInRow
            onSignIn={() => openDialog("account")}
            onExplorePro={() => openGate("upgrade")}
          />
        )}
      </div>
    </section>
  );
}

function SignInRow({
  onSignIn,
  onExplorePro,
}: {
  onSignIn: () => void;
  onExplorePro: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
        <UserIcon width={18} height={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">{t("account.cloudSyncAccount")}</p>
        <p className="mt-0.5 text-xs text-muted">
          {t("account.localTodofyStaysFreeSignInWhenYouWantPro")}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {billingConfigured && (
          <button
            type="button"
            onClick={onExplorePro}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-(--color-accent) transition-colors hover:bg-accent-soft"
          >
            {t("account.viewPro")}
          </button>
        )}
        <button
          type="button"
          onClick={onSignIn}
          className="rounded-lg bg-(--color-accent) px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {t("account.signIn")}
        </button>
      </div>
    </div>
  );
}

function SignedInRow({
  email,
  onSignOut,
  deleteAccount,
}: {
  email: string | null;
  onSignOut: () => Promise<void>;
  deleteAccount: (wipeLocal: boolean) => Promise<AuthResult>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">
          <UserIcon width={18} height={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text">
            {email ?? t("account.signedIn")}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {t("account.thisIsTheAccountYourLicenseAndCloudDataBelong")}
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            setBusy(true);
            try {
              await onSignOut();
            } finally {
              setBusy(false);
            }
          }}
          disabled={busy}
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          {busy ? t("account.signingOut") : t("account.signOut")}
        </button>
      </div>
      {billingConfigured && <CloudSyncPlanRow />}
      <SyncStatusRow />
      <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
        <p className="text-xs text-muted">
          {t("account.deleteYourAccountCloudDataAndCancelLinkedBilling")}
        </p>
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="shrink-0 rounded-lg border border-(--color-danger)/40 px-3 py-1.5 text-xs font-medium text-(--color-danger) transition-colors hover:bg-(--color-danger)/10"
        >
          {t("account.deleteAccount")}
        </button>
      </div>
      {deleteOpen && (
        <DeleteAccountModal
          deleteAccount={deleteAccount}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </>
  );
}

function CloudSyncPlanRow() {
  const { t } = useTranslation();
  const { state, allowed, plan, validUntil, openGate } = useBilling();
  const title =
    state === "checking"
      ? t("account.checkingTodofyPro")
      : state === "cancelled_active"
        ? t("account.subscriptionCancelled")
        : state === "grace"
          ? t("account.paymentIssueTemporaryAccess")
          : allowed
            ? plan === "transition"
              ? t("account.cloudSyncTransitionAccess")
              : t("account.todofyProActive")
            : state === "unavailable"
              ? t("account.couldNotVerifyTodofyPro")
              : t("account.cloudSyncNeedsTodofyPro");
  const formattedEnd = validUntil
    ? new Date(validUntil).toLocaleDateString(appLocale())
    : null;
  const detail =
    state === "cancelled_active" && formattedEnd
      ? t("account.renewalOffThrough", { date: formattedEnd })
      : state === "grace" && formattedEnd
        ? t("account.recoveryEnds", { date: formattedEnd })
        : allowed && formattedEnd
          ? t("account.verifiedThrough", { date: formattedEnd })
          : t("account.399MonthlyOr39YearlyYouCanAlsoActivate");

  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-3.5">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${allowed ? "bg-accent-soft text-(--color-accent)" : "bg-surface-2 text-muted"}`}
      >
        {allowed ? (
          <CrownIcon width={18} height={18} />
        ) : (
          <CloudIcon width={18} height={18} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text">{title}</p>
        <p className="mt-0.5 text-xs text-muted">{detail}</p>
      </div>
      <button
        type="button"
        onClick={() => openGate(allowed ? "upgrade" : "license")}
        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-(--color-accent) transition-colors hover:bg-accent-soft"
      >
        {allowed ? t("account.viewPlan") : t("account.unlockSync")}
      </button>
    </div>
  );
}

const STATUS_META: Record<SyncStatus, { dot: string; label: MessageKey }> = {
  idle: { dot: "bg-[var(--color-success)]", label: "account.synced" },
  syncing: { dot: "bg-[var(--color-warning)]", label: "account.syncing" },
  offline: { dot: "bg-[var(--color-faint)]", label: "account.offline" },
  error: { dot: "bg-(--color-danger)", label: "account.syncFailed" },
  paused: { dot: "bg-[var(--color-faint)]", label: "account.syncPaused" },
};

function SyncStatusRow() {
  const { t } = useTranslation();
  const { status, lastSyncedAt, error, syncNow } = useSync();
  const { allowed, openGate } = useBilling();
  const meta = STATUS_META[status];
  const gated = billingConfigured && !allowed;
  const detail =
    status === "error" || status === "paused"
      ? (error ??
        (gated
          ? t("account.activateTodofyProToBeginSyncing")
          : t("account.somethingWentWrong")))
      : status === "idle" && !lastSyncedAt
        ? t("account.notSyncedYet")
        : lastSyncedAt
          ? t("account.lastSynced", { time: relativeTime(lastSyncedAt) })
          : "";

  return (
    <div className="flex items-center gap-3 border-t border-border bg-surface px-4 py-3">
      <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-text">{t(meta.label)}</p>
        {detail && (
          <p className="mt-0.5 truncate text-[11px] text-muted">{detail}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => (gated ? openGate("cloud_sync") : void syncNow(true))}
        disabled={status === "syncing"}
        className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
      >
        {status === "syncing" ? t("account.syncing") : gated ? t("account.unlockSync") : t("account.syncNow")}
      </button>
    </div>
  );
}

function relativeTime(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (secs < 10) return t("account.justNow");
  if (secs < 60) return t("common.secondsAgo", { count: secs });
  const mins = Math.floor(secs / 60);
  if (mins < 60) return t("common.minutesAgo", { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("common.hoursAgo", { count: hours });
  return t("common.daysAgo", { count: Math.floor(hours / 24) });
}

function DeleteAccountModal({
  deleteAccount,
  onClose,
}: {
  deleteAccount: (wipeLocal: boolean) => Promise<AuthResult>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [wipeLocal, setWipeLocal] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canDelete = confirm.trim().toUpperCase() === "DELETE";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const run = async () => {
    if (!canDelete || busy) return;
    setError(null);
    setBusy(true);
    const result = await deleteAccount(wipeLocal);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-130 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && onClose()
      }
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        className="relative w-full max-w-sm animate-fade-rise overflow-hidden rounded-2xl border border-border-strong bg-elevated shadow-2xl shadow-black/50"
      >
        <div className="flex flex-col items-center gap-2 px-6 pt-8 pb-2 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-(--color-danger)/10 text-(--color-danger)">
            <TrashIcon width={24} height={24} />
          </span>
          <h3 id="delete-account-title" className="text-lg font-semibold text-text">
            {t("account.deleteAccount")}
          </h3>
          <p className="text-xs leading-5 text-muted">
            {t("account.thisPermanentlyDeletesYourTodofyAccountAndCloudDataAny")}
          </p>
        </div>

        <div className="flex flex-col gap-3 px-6 pt-3 pb-6">
          <button
            type="button"
            role="checkbox"
            aria-checked={wipeLocal}
            onClick={() => setWipeLocal((value) => !value)}
            className={`flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
              wipeLocal
                ? "border-(--color-danger)/50 bg-(--color-danger)/5"
                : "border-border bg-bg hover:bg-surface-2"
            }`}
          >
            <span className="mt-0.5">
              <Checkbox
                checked={wipeLocal}
                interactive={false}
                color="var(--color-danger)"
              />
            </span>
            <span className="text-xs text-text">
              {t("account.alsoDeleteAppDataStoredOnThisDevice")}
              <span className="mt-0.5 block text-muted">
                {t("account.leaveUncheckedToKeepYourLocalTasksJournalAndCalendar")}
              </span>
            </span>
          </button>

          <label className="flex flex-col gap-1 text-left">
            <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
              <Trans i18nKey="account.deleteConfirmation" components={{ code: <code className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] normal-case tracking-normal text-(--color-danger)" /> }} />
            </span>
            <input
              value={confirm}
              placeholder="DELETE"
              onInput={(event) => setConfirm(event.currentTarget.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none transition-colors focus:border-(--color-danger)"
            />
          </label>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-(--color-danger)/10 px-3 py-2 text-xs text-(--color-danger)"
            >
              {error}
            </p>
          )}

          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => void run()}
              disabled={!canDelete || busy}
              className="flex-1 rounded-lg bg-(--color-danger) px-3 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {busy ? t("account.cancellingAndDeleting") : t("account.deleteAccount")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
