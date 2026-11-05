import type { FunctionComponent } from "react";
import { useEffect, useRef, useState } from "react";
import { ONBOARDING_STEPS, useOnboarding } from "../../lib/onboarding";
import { ChevronLeftIcon } from "../Icons";
import {
  CaptureSlide,
  FeaturesSlide,
  FinishSlide,
  FocusSlide,
  RemindersSlide,
  ThemeSlide,
  WelcomeSlide,
} from "./slides";

const SLIDES: FunctionComponent[] = [
  WelcomeSlide,
  ThemeSlide,
  CaptureSlide,
  FocusSlide,
  RemindersSlide,
  FeaturesSlide,
  FinishSlide,
];

const NEXT_LABEL = [
  "Get started",
  "Continue",
  "Continue",
  "Continue",
  "Continue",
  "Almost there",
  "Open todofy",
];

/** Matches the leave animations in global.css. */
const TRANSITION_MS = 260;

/**
 * The first-run tour. Shown over the app on a fresh install (see
 * `initOnboarding`) and replayable from Settings → About.
 */
export function Onboarding() {
  const open = useOnboarding((s) => s.open);
  const leaving = useOnboarding((s) => s.leaving);
  const step = useOnboarding((s) => s.step);
  const dir = useOnboarding((s) => s.dir);
  const next = useOnboarding((s) => s.next);
  const back = useOnboarding((s) => s.back);
  const goTo = useOnboarding((s) => s.goTo);
  const finish = useOnboarding((s) => s.finish);

  // The slide being replaced is kept mounted, absolutely positioned over the
  // incoming one, until its exit animation is done.
  const [outgoing, setOutgoing] = useState<number | null>(null);
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    setOutgoing(shown.current);
    shown.current = step;
    const timer = setTimeout(() => setOutgoing(null), TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [step]);

  // Captured, so the app's own shortcuts stay quiet while the tour is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void finish({ skipped: true });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        next();
        return;
      }
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (typing) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, next, back, finish]);

  if (!open) return null;

  const Current = SLIDES[step];
  const Outgoing = outgoing === null ? null : SLIDES[outgoing];

  return (
    <div
      className={`fixed inset-0 z-120 grid place-items-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm ${
        leaving ? "onb-curtain-leaving" : "onb-curtain"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to todofy"
    >
      <div className="onb-card relative my-auto w-full max-w-155` overflow-hidden rounded-3xl border border-border-strong bg-elevated shadow-2xl shadow-black/60">
        <span className="pointer-events-none absolute inset-x-20 -top-32 h-56 rounded-full bg-(--color-accent) opacity-[0.1] blur-3xl" />

        <button
          type="button"
          onClick={() => void finish({ skipped: true })}
          className="absolute right-4 top-4 z-10 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-faint transition-colors hover:bg-surface-2 hover:text-text"
        >
          Skip
        </button>

        <div className="relative px-7 pb-5 pt-9 sm:px-10">
          {/* A floor under the stage keeps the card from resizing much as
              slides of different lengths come and go. */}
          <div className="relative flex min-h-100 items-center">
            <div
              key={step}
              className={`w-full ${dir === 1 ? "onb-enter-right" : "onb-enter-left"}`}
            >
              <Current />
            </div>
            {Outgoing && (
              <div
                key={`out-${outgoing}`}
                className={`onb-leaving ${dir === 1 ? "onb-leave-left" : "onb-leave-right"}`}
                aria-hidden="true"
              >
                <Outgoing />
              </div>
            )}
          </div>
        </div>

        <div className="relative flex items-center gap-4 border-t border-border px-7 py-4 sm:px-10">
          <button
            type="button"
            onClick={back}
            disabled={step === 0}
            aria-label="Previous"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-0"
          >
            <ChevronLeftIcon width={17} height={17} />
          </button>

          <div className="flex flex-1 items-center justify-center gap-1.5">
            {SLIDES.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => goTo(index)}
                aria-label={`Step ${index + 1} of ${ONBOARDING_STEPS}`}
                aria-current={index === step}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  index === step
                    ? "w-6 bg-(--color-accent)"
                    : index < step
                      ? "w-1.5 bg-border-strong"
                      : "w-1.5 bg-border"
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={next}
            className="shrink-0 rounded-xl bg-(--color-accent) px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-black/15 transition-[background-color,transform] hover:bg-accent-hover active:translate-y-px"
          >
            {NEXT_LABEL[step]}
          </button>
        </div>
      </div>
    </div>
  );
}
