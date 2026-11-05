import { appLocale } from "../lib/locale";
import { useTranslation } from "react-i18next";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuth } from "../lib/auth";
import {
  type BillingCatalogPlan,
  type BillingPlan,
  billingConfigured,
  useBilling,
} from "../lib/billing";
import { useSync } from "../lib/sync";
import {
  CheckIcon,
  CloseIcon,
  CrownIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  KeyIcon,
  LemonSqueezyIcon,
} from "./Icons";

const FEATURES = [
  "billing.tasksLabelsJournalAndFocusHistory",
  "billing.theSameTodofyAccountOnEveryDevice",
  "billing.aCalmLocalFirstWorkflowThatWorksOffline",
] as const;

export function ProPaywall() {
  const { t } = useTranslation();
  const {
    gateOpen,
    gateReason,
    closeGate,
    state,
    allowed,
    plan,
    validUntil,
    error,
    busy,
    catalog,
    catalogState,
    catalogError,
    testMode,
    lastCheckoutPlan,
    loadCatalog,
    checkout,
    activate,
    openPortal,
    refresh,
  } = useBilling();
  const { session, email, openDialog } = useAuth();
  const { status: syncStatus, syncNow } = useSync();
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>("yearly");
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [license, setLicense] = useState("");
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    if (gateOpen) {
      setLicenseOpen(gateReason === "license");
      return;
    }
    setSelectedPlan("yearly");
    setLicenseOpen(false);
    setLicense("");
    setReveal(false);
  }, [gateOpen, gateReason]);

  useEffect(() => {
    if (gateOpen && lastCheckoutPlan) setLicenseOpen(true);
  }, [gateOpen, lastCheckoutPlan]);

  useEffect(() => {
    if (!gateOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy && !useAuth.getState().dialogOpen)
        closeGate();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gateOpen, closeGate, busy]);

  if (!billingConfigured || !gateOpen) return null;

  const buy = async () => {
    try {
      await checkout(selectedPlan);
    } catch {
      // A safe, normalized error is rendered from the billing store.
    }
  };

  const submitLicense = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || license.trim().length < 10 || busy) return;
    try {
      await activate(license);
      setLicense("");
      setReveal(false);
    } catch {
      // A safe, normalized error is rendered from the billing store.
    }
  };

  const selectedCatalogPlan = catalog.find((item) => item.id === selectedPlan);
  const checkoutUnavailable = !session && catalogState !== "ready";
  const showPlanPicker = !allowed || plan === "transition";

  return (
    <div
      className="fixed inset-0 z-110 grid place-items-center overflow-y-auto bg-black/65 p-4 backdrop-blur-sm"
      onMouseDown={(event) =>
        event.target === event.currentTarget && !busy && closeGate()
      }
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pro-dialog-title"
        className="relative my-auto w-full max-w-147.5 animate-fade-rise overflow-hidden rounded-[22px] border border-border-strong bg-elevated shadow-2xl shadow-black/55"
      >
        <div className="pointer-events-none absolute inset-x-16 -top-28 h-52 rounded-full bg-(--color-accent) opacity-[0.09] blur-3xl" />

        <button
          type="button"
          onClick={closeGate}
          disabled={busy}
          title={t("common.close")}
          aria-label={t("billing.closeTodofyPro")}
          className="absolute right-4 top-4 z-10 grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          <CloseIcon width={17} height={17} />
        </button>

        <div className="relative max-h-[calc(100vh-2rem)] overflow-y-auto px-6 py-7 sm:px-10 sm:py-9">
          <header className="mx-auto max-w-md text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-[14px] border border-(--color-accent)/20 bg-accent-soft text-(--color-accent) shadow-lg shadow-black/10">
              <CrownIcon width={22} height={22} />
            </span>
            <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.26em] text-(--color-accent)">
              Todofy Pro
            </p>
            <h2
              id="pro-dialog-title"
              className="mt-2 text-[27px] font-semibold leading-[1.18] tracking-[-0.035em] text-text sm:text-[30px]"
            >
              {t("billing.syncWithoutChangingHowYouWork")}
            </h2>
            <p className="mx-auto mt-3 max-w-sm text-[13px] leading-5 text-muted">
              {t("billing.carryYourTodofySystemBetweenDevicesWhileKeepingTheQuiet")}
            </p>
          </header>

          {testMode && (
            <Notice tone="warning" className="mt-6">
              {t("billing.testCheckoutIsEnabledTestPurchasesDoNotGrantLive")}
            </Notice>
          )}

          {!showPlanPicker ? (
            <ActivePlan
              state={state}
              plan={plan}
              validUntil={validUntil}
              busy={busy}
              syncBusy={syncStatus === "syncing"}
              canManage={plan === "monthly" || plan === "yearly"}
              onRefresh={() => void refresh()}
              onManage={() => void openPortal().catch(() => {})}
              onSync={() => void syncNow(true)}
            />
          ) : (
            <div className="mt-7">
              <AccessNotice
                state={state}
                allowed={allowed}
                plan={plan}
                validUntil={validUntil}
              />

              <div
                role="group"
                aria-label={t("billing.billingPeriod")}
                className="mx-auto grid max-w-82.5 grid-cols-2 rounded-xl border border-border bg-bg p-1"
              >
                <PlanToggle
                  active={selectedPlan === "monthly"}
                  onClick={() => setSelectedPlan("monthly")}
                >
                  {t("billing.monthly")}
                </PlanToggle>
                <PlanToggle
                  active={selectedPlan === "yearly"}
                  onClick={() => setSelectedPlan("yearly")}
                >
                  {t("billing.yearly")}
                  <span
                    className={`ml-1.5 text-[9px] font-semibold ${selectedPlan === "yearly" ? "text-(--color-accent)" : "text-faint"}`}
                  >
                    {t("billing.save")}
                  </span>
                </PlanToggle>
              </div>

              <SelectedPlanPrice
                plan={selectedPlan}
                catalogPlan={selectedCatalogPlan}
              />

              <div className="mx-auto mt-5 max-w-97.5 space-y-2.5">
                {FEATURES.map((feature) => (
                  <p
                    key={feature}
                    className="flex items-start gap-2.5 text-[12px] leading-5 text-muted"
                  >
                    <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent-soft text-(--color-accent)">
                      <CheckIcon width={10} height={10} strokeWidth={3} />
                    </span>
                    {t(feature)}
                  </p>
                ))}
              </div>

              <button
                type="button"
                disabled={busy || checkoutUnavailable}
                onClick={() => void buy()}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-(--color-accent) px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-black/15 transition-[background-color,transform] hover:bg-accent-hover active:translate-y-px disabled:opacity-55"
              >
                <LemonSqueezyIcon width={17} height={17} />
                {busy
                  ? t("billing.openingSecureCheckout")
                  : t("billing.continueToSecureCheckout")}
                {!busy && (
                  <ExternalLinkIcon width={14} height={14} className="opacity-70" />
                )}
              </button>
              <p className="mt-2 flex items-center justify-center gap-1.5 text-[10px] text-faint">
                <LemonSqueezyIcon width={12} height={12} />
                {t("billing.secureCheckoutAndBillingByLemonSqueezy")}
              </p>

              {catalogState === "loading" && !session && (
                <p className="mt-3 text-center text-[11px] text-muted">
                  {t("billing.loadingSecureCheckout")}
                </p>
              )}
              {catalogError && (
                <div
                  role="alert"
                  className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-(--color-danger)/10 px-3 py-2.5 text-xs text-(--color-danger)"
                >
                  <span>{catalogError}</span>
                  <button
                    type="button"
                    onClick={() => void loadCatalog()}
                    className="shrink-0 font-semibold underline underline-offset-2"
                  >
                    {t("billing.retry")}
                  </button>
                </div>
              )}
              {lastCheckoutPlan && (
                <Notice tone="accent" className="mt-4">
                  {t("billing.checkoutOpenedAfterPurchaseReturnHereAndActivateTheLicense")}
                </Notice>
              )}

              <div className="my-6 h-px bg-border" />

              <button
                type="button"
                aria-expanded={licenseOpen}
                aria-controls="pro-license-panel"
                onClick={() => setLicenseOpen((value) => !value)}
                className="mx-auto flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:text-text"
              >
                <KeyIcon width={15} height={15} className="text-(--color-accent)" />
                {t("billing.haveALicenseKey")}
                <span
                  className={`text-[10px] transition-transform ${licenseOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                >
                  ⌄
                </span>
              </button>

              {licenseOpen && (
                <div id="pro-license-panel" className="mt-3 animate-fade-rise">
                  {!session ? (
                    <SignedOutActivation onSignIn={() => openDialog("pro")} />
                  ) : (
                    <LicenseForm
                      email={email}
                      license={license}
                      reveal={reveal}
                      busy={busy}
                      onLicenseChange={setLicense}
                      onReveal={() => setReveal((value) => !value)}
                      onSubmit={submitLicense}
                    />
                  )}
                </div>
              )}

              {session && (plan === "monthly" || plan === "yearly") && (
                <div className="mt-5 flex items-center justify-center gap-4 text-[11px]">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openPortal().catch(() => {})}
                    className="font-medium text-muted hover:text-text disabled:opacity-50"
                  >
                    {t("billing.managePreviousPlan")}
                  </button>
                  <span className="h-3 w-px bg-border" />
                  <button
                    type="button"
                    disabled={state === "checking" || busy}
                    onClick={() => void refresh()}
                    className="font-medium text-muted hover:text-text disabled:opacity-50"
                  >
                    {state === "checking" ? t("billing.checking") : t("billing.refreshAccess")}
                  </button>
                </div>
              )}
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-lg bg-(--color-danger)/10 px-3 py-2.5 text-xs text-(--color-danger)"
            >
              {error}
            </p>
          )}

          <footer className="mt-7 text-center text-[10px] leading-4 text-faint">
            <p>
              {t("billing.localFeaturesRemainFreeCancelAnytimeWithA14Day")}
            </p>
            <p className="mt-1.5 flex items-center justify-center gap-2">
              <LegalLink href="https://unifybrowse.com/products/todofy/terms">
                {t("billing.terms")}
              </LegalLink>
              <span aria-hidden="true">·</span>
              <LegalLink href="https://unifybrowse.com/products/todofy/privacy">
                {t("billing.privacy")}
              </LegalLink>
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

function PlanToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg px-3 py-2 text-xs font-medium transition-all ${
        active
          ? "bg-surface-2 text-text shadow-sm"
          : "text-muted hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

function SelectedPlanPrice({
  plan,
  catalogPlan,
}: {
  plan: BillingPlan;
  catalogPlan?: BillingCatalogPlan;
}) {
  const { t } = useTranslation();
  const amount = catalogPlan?.amount ?? (plan === "monthly" ? 399 : 3900);
  const period = plan === "monthly" ? "month" : "year";
  return (
    <div className="mt-6 text-center">
      <p className="flex items-end justify-center gap-2 text-text">
        <span className="text-[38px] font-semibold leading-none tracking-[-0.045em]">
          {formatMoney(amount, catalogPlan?.currency ?? "EUR")}
        </span>
        <span className="pb-0.5 text-xs text-muted">/ {period}</span>
      </p>
      <p className="mt-2 min-h-4 text-[11px] font-medium text-(--color-accent)">
        {plan === "yearly" ? t("billing.save888EveryYear") : t("billing.simpleMonthlyBilling")}
      </p>
    </div>
  );
}

function AccessNotice({
  state,
  allowed,
  plan,
  validUntil,
}: {
  state: string;
  allowed: boolean;
  plan: BillingPlan | "transition" | null;
  validUntil: string | null;
}) {
  const { t } = useTranslation();
  // An entitled account only reaches the picker on transition access, and that
  // stays true while the entitlement is re-verified in the background.
  if (allowed) {
    if (plan !== "transition") return null;
    return (
      <Notice tone="accent" className="mb-5">
        {validUntil
          ? t("billing.transitionThrough", { date: formatDate(validUntil) })
          : t("billing.yourTransitionAccessIsActiveChooseAPlanToKeep")}
      </Notice>
    );
  }
  if (state === "checking") {
    return <Notice className="mb-5">{t("billing.checkingYourCurrentProAccess")}</Notice>;
  }
  if (state === "pending") {
    return (
      <Notice tone="accent" className="mb-5">
        {t("billing.yourPurchaseIsStillBeingConfirmedYouCanRefreshAccess")}
      </Notice>
    );
  }
  if (state === "expired") {
    return (
      <Notice className="mb-5">
        {t("billing.yourPreviousProPlanHasEndedChooseAPlanTo")}
      </Notice>
    );
  }
  if (state === "revoked") {
    return (
      <Notice className="mb-5">
        {t("billing.thisAccountNoLongerHasProAccessChooseAPlan")}
      </Notice>
    );
  }
  return null;
}

function SignedOutActivation({ onSignIn }: { onSignIn: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-border bg-surface p-4 text-center">
      <p className="text-xs leading-5 text-muted">
        {t("billing.signInOrCreateAnAccountFirstYourLicenseWill")}
      </p>
      <button
        type="button"
        onClick={onSignIn}
        className="mt-3 w-full rounded-lg border border-border-strong bg-bg px-3 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-2"
      >
        {t("billing.signInOrCreateAccount")}
      </button>
    </div>
  );
}

function LicenseForm({
  email,
  license,
  reveal,
  busy,
  onLicenseChange,
  onReveal,
  onSubmit,
}: {
  email: string | null;
  license: string;
  reveal: boolean;
  busy: boolean;
  onLicenseChange: (value: string) => void;
  onReveal: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  return (
    <form
      onSubmit={onSubmit}
      className="rounded-xl border border-border bg-surface p-4"
    >
      <p className="text-center text-[11px] leading-5 text-muted">
        {t("billing.activateFor")}
        <strong className="font-medium text-text">{email ?? t("billing.thisAccount")}</strong>
        {t("billing.aLicenseCanBelongToOnlyOneTodofyAccount")}
      </p>
      <label className="mt-3 block">
        <span className="sr-only">{t("billing.lemonSqueezyLicenseKey")}</span>
        <div className="relative">
          <input
            type={reveal ? "text" : "password"}
            value={license}
            onInput={(event) => onLicenseChange(event.currentTarget.value)}
            placeholder={t("billing.pasteYourLicenseKey")}
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-bg py-2.5 pl-3 pr-10 font-mono text-xs text-text outline-none transition-colors placeholder:font-sans placeholder:text-faint focus:border-(--color-accent)"
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={onReveal}
            title={reveal ? t("billing.hideLicense") : t("billing.showLicense")}
            aria-label={reveal ? t("billing.hideLicense") : t("billing.showLicense")}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center text-faint hover:text-text"
          >
            {reveal ? (
              <EyeOffIcon width={16} height={16} />
            ) : (
              <EyeIcon width={16} height={16} />
            )}
          </button>
        </div>
      </label>
      <button
        type="submit"
        disabled={busy || license.trim().length < 10}
        className="mt-2.5 w-full rounded-lg bg-(--color-accent) px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {busy ? t("billing.verifyingLicense") : t("billing.activateTodofyPro")}
      </button>
    </form>
  );
}

function ActivePlan({
  state,
  plan,
  validUntil,
  busy,
  syncBusy,
  canManage,
  onRefresh,
  onManage,
  onSync,
}: {
  state: string;
  plan: BillingPlan | "transition" | null;
  validUntil: string | null;
  busy: boolean;
  syncBusy: boolean;
  canManage: boolean;
  onRefresh: () => void;
  onManage: () => void;
  onSync: () => void;
}) {
  const { t } = useTranslation();
  const cancelled = state === "cancelled_active";
  const grace = state === "grace";
  const heading = grace
    ? t("billing.yourPaymentNeedsAttention")
    : cancelled
      ? t("billing.yourSubscriptionIsCancelled")
      : plan === "transition"
        ? t("billing.transitionAccessIsActive")
        : t("billing.todofyProIsActive");
  const detail = grace
    ? validUntil
      ? t("billing.recoveryThrough", { date: formatDate(validUntil) })
      : t("billing.cloudSyncRemainsAvailableWhileLemonSqueezyRetriesYourPayment")
    : cancelled
      ? validUntil
        ? t("account.renewalOffThrough", { date: formatDate(validUntil) })
        : t("billing.renewalIsOffCloudSyncRemainsAvailableUntilTheEnd")
      : validUntil
        ? t("billing.verifiedThrough", { date: formatDate(validUntil) })
        : t("billing.yourAccountCanUseCloudSync");

  return (
    <div className="mt-8 text-center">
      <span
        className={`mx-auto grid h-12 w-12 place-items-center rounded-full ${
          grace
            ? "bg-(--color-warning)/12 text-(--color-warning)"
            : cancelled
              ? "bg-accent-soft text-(--color-accent)"
              : "bg-success/12 text-success"
        }`}
      >
        <CheckIcon width={23} height={23} strokeWidth={2.5} />
      </span>
      <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-faint">
        {plan === "monthly"
          ? t("billing.monthlyPlan")
          : plan === "yearly"
            ? t("billing.yearlyPlan")
            : t("billing.cloudSync")}
      </p>
      <h3 className="mt-1.5 text-xl font-semibold tracking-tight text-text">
        {heading}
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted">{detail}</p>

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onSync}
          disabled={syncBusy}
          className="rounded-xl bg-(--color-accent) px-3 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {syncBusy ? t("account.syncing") : t("account.syncNow")}
        </button>
        {canManage ? (
          <button
            type="button"
            onClick={onManage}
            disabled={busy}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-bg px-3 py-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {grace
              ? t("billing.fixPayment")
              : cancelled
                ? t("billing.viewSubscription")
                : t("billing.manageSubscription")}
            <ExternalLinkIcon width={13} height={13} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            className="rounded-xl border border-border bg-bg px-3 py-3 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {t("billing.refreshAccess")}
          </button>
        )}
      </div>
      {canManage && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          className="mt-3 text-[11px] font-medium text-muted hover:text-text disabled:opacity-50"
        >
          {state === "checking" ? t("billing.checking") : t("billing.refreshAccess")}
        </button>
      )}
    </div>
  );
}

function LegalLink({ href, children }: { href: string; children: string }) {
  return (
    <button
      type="button"
      onClick={() => void openUrl(href).catch(() => {})}
      className="underline underline-offset-2 transition-colors hover:text-text"
    >
      {children}
    </button>
  );
}

function Notice({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warning";
  className?: string;
}) {
  const color =
    tone === "accent"
      ? "border-(--color-accent)/25 bg-accent-soft text-muted"
      : tone === "warning"
        ? "border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 text-(--color-warning)"
        : "border-border bg-surface text-muted";
  return (
    <p
      className={`rounded-xl border px-3.5 py-3 text-center text-[11px] leading-5 ${color} ${className}`}
    >
      {children}
    </p>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(appLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(appLocale(), {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}
