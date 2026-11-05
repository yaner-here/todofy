import { useTranslation } from "react-i18next";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { CloseIcon, EyeIcon, EyeOffIcon, GoogleIcon, UserIcon } from "./Icons";

type Mode = "signin" | "signup";

export function AuthDialog() {
  const { t } = useTranslation();
  const {
    dialogOpen,
    dialogIntent,
    session,
    closeDialog,
    signIn,
    signUp,
    signInWithGoogle,
  } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    if (!dialogOpen) {
      setPassword("");
      setError(null);
      setNotice(null);
      setBusy(false);
      setGoogleBusy(false);
    }
  }, [dialogOpen]);

  useEffect(() => {
    if (session) closeDialog();
  }, [session, closeDialog]);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        if (!busy && !googleBusy) closeDialog();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, closeDialog, busy, googleBusy]);

  if (!dialogOpen) return null;

  const signup = mode === "signup";
  const proIntent = dialogIntent === "pro";

  const google = async () => {
    if (googleBusy) return;
    setError(null);
    setNotice(null);
    setGoogleBusy(true);
    try {
      const result = await signInWithGoogle();
      if (!result.ok) setError(result.error);
    } finally {
      setGoogleBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = signup
        ? await signUp(email, password)
        : await signIn(email, password);
      if (!result.ok) {
        setError(result.error);
      } else if (result.message) {
        setNotice(result.message);
        setMode("signin");
        setPassword("");
      } else {
        closeDialog();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) =>
        event.target === event.currentTarget &&
        !busy &&
        !googleBusy &&
        closeDialog()
      }
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
        className="relative w-full max-w-sm animate-fade-rise overflow-hidden rounded-2xl border border-border-strong bg-elevated shadow-2xl shadow-black/50"
      >
        <button
          type="button"
          onClick={closeDialog}
          disabled={busy || googleBusy}
          title={t("common.close")}
          aria-label={t("account.closeAccountDialog")}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-faint transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          <CloseIcon width={16} height={16} />
        </button>

        <div className="flex flex-col items-center gap-2 px-6 pt-8 pb-2 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-(--color-accent)">
            <UserIcon width={24} height={24} />
          </span>
          <h3 id="auth-dialog-title" className="text-lg font-semibold text-text">
            {signup
              ? t("account.createYourTodofyAccount")
              : proIntent
                ? t("account.signInToActivatePro")
                : t("account.welcomeBack")}
          </h3>
          <p className="text-xs text-muted">
            {proIntent
              ? t("account.yourLicenseIsLinkedToTheAccountYouChooseHere")
              : t("account.anAccountIsOnlyNeededForOptionalCloudSync")}
          </p>
        </div>

        <div className="flex flex-col gap-3 px-6 pt-4">
          <button
            type="button"
            onClick={() => void google()}
            disabled={googleBusy || busy}
            className="flex items-center justify-center gap-2.5 rounded-lg border border-border bg-bg px-3 py-2.5 text-sm font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            <GoogleIcon width={18} height={18} />
            {googleBusy ? t("account.waitingForBrowser") : t("account.continueWithGoogle")}
          </button>
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
              {t("account.or")}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 px-6 pt-3 pb-6">
          <Field
            label={t("account.email")}
            type="email"
            value={email}
            autocomplete="email"
            placeholder="you@example.com"
            onInput={setEmail}
          />
          <Field
            label={t("account.password")}
            type="password"
            value={password}
            autocomplete={signup ? "new-password" : "current-password"}
            placeholder={signup ? t("account.atLeast6Characters") : "••••••••"}
            onInput={setPassword}
            revealable
          />

          {notice && (
            <p
              role="status"
              className="rounded-lg bg-[var(--color-success)]/10 px-3 py-2 text-xs text-success"
            >
              {notice}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-(--color-danger)/10 px-3 py-2 text-xs text-(--color-danger)"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={
              busy || googleBusy || !email.trim() || password.length < 6
            }
            className="mt-1 rounded-lg bg-(--color-accent) px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy
              ? signup
                ? t("account.creatingAccount")
                : t("account.signingIn")
              : signup
                ? t("account.createAccount")
                : t("account.signIn")}
          </button>
        </form>

        <div className="border-t border-border px-6 py-3.5 text-center">
          <button
            type="button"
            onClick={() => {
              setMode(signup ? "signin" : "signup");
              setError(null);
              setNotice(null);
              setPassword("");
            }}
            className="group text-xs text-muted"
          >
            {signup ? t("account.alreadyHaveAnAccount") : t("account.newToTodofy")}
            <span className="font-medium text-(--color-accent) transition-colors group-hover:text-[var(--color-accent-hover)]">
              {signup ? t("account.signIn") : t("account.createAnAccount")}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  placeholder,
  autocomplete,
  onInput,
  revealable,
}: {
  label: string;
  type: string;
  value: string;
  placeholder?: string;
  autocomplete?: string;
  onInput: (value: string) => void;
  revealable?: boolean;
}) {
  const { t } = useTranslation();
  const [reveal, setReveal] = useState(false);
  const inputType = revealable && reveal ? "text" : type;
  return (
    <label className="flex flex-col gap-1 text-left">
      <span className="text-[10px] font-medium uppercase tracking-wider text-faint">
        {label}
      </span>
      <div className="relative">
        <input
          type={inputType}
          value={value}
          placeholder={placeholder}
          autoComplete={autocomplete}
          onInput={(event) => onInput(event.currentTarget.value)}
          className={`w-full rounded-lg border border-border bg-bg py-2 pl-3 text-sm outline-none transition-colors focus:border-(--color-accent) ${revealable ? "pr-10" : "pr-3"}`}
        />
        {revealable && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setReveal((value) => !value)}
            title={reveal ? t("account.hidePassword") : t("account.showPassword")}
            aria-label={reveal ? t("account.hidePassword") : t("account.showPassword")}
            className="absolute inset-y-0 right-0 grid w-10 place-items-center text-faint transition-colors hover:text-text"
          >
            {reveal ? (
              <EyeOffIcon width={16} height={16} />
            ) : (
              <EyeIcon width={16} height={16} />
            )}
          </button>
        )}
      </div>
    </label>
  );
}
