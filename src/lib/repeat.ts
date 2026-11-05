import type { RepeatRule } from "../types";
import { t, type MessageKey } from "./i18n";

/**
 * Selectable recurrence options, in menu order. `null` = does not repeat.
 * Labels are kept short for the date picker's chip row.
 */
export const REPEAT_OPTIONS: { value: RepeatRule | null; label: MessageKey }[] = [
  { value: null, label: "repeat.never" },
  { value: "daily", label: "repeat.daily" },
  { value: "weekdays", label: "repeat.weekdays" },
  { value: "weekly", label: "repeat.weekly" },
  { value: "monthly", label: "repeat.monthly" },
  { value: "yearly", label: "repeat.yearly" },
];

const LABELS: Record<RepeatRule, MessageKey> = {
  daily: "repeat.daily",
  weekdays: "repeat.everyWeekday",
  weekly: "repeat.weekly",
  monthly: "repeat.monthly",
  yearly: "repeat.yearly",
};

/** Human label for a recurrence rule (short form for chips). */
export function repeatLabel(rule: RepeatRule | null | undefined): string {
  return t(rule ? LABELS[rule] : "repeat.none");
}
