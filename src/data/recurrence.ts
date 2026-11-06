type DateParts = { year: number; month: number; day: number };
type Instant = { seconds: number; nanoseconds: number };

// Chrono's NaiveDate bounds, used by existing databases and recurrence rules.
const MIN_YEAR = -262143;
const MAX_YEAR = 262142;

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function validDate(year: number, month: number, day: number): boolean {
  return year >= MIN_YEAR && year <= MAX_YEAR && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Preserve Chrono's accepted timestamp formats and subsecond ordering. */
export function parseInstant(text: string): Instant | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|[+-](\d{2}):(\d{2}))$/.exec(text);
  if (!match) return null;
  const [, y, m, d, h, minute, second, fraction = "", zone, offsetHour, offsetMinute] = match;
  if (!validDate(+y, +m, +d) || +h > 23 || +minute > 59 || +second > 60 ||
      (offsetHour !== undefined && (+offsetHour > 23 || +offsetMinute > 59))) return null;
  const leapSecond = second === "60";
  // JavaScript Date cannot parse leap seconds; keep its preceding second and
  // represent Chrono's extra second in the subsecond field instead.
  const iso = `${y}-${m}-${d}T${h}:${minute}:${leapSecond ? "59" : second}${fraction ? `.${fraction}` : ""}${zone.toUpperCase()}`;
  const time = new Date(iso);
  if (Number.isNaN(time.getTime())) return null;
  const nanoseconds = Number(fraction.slice(0, 9).padEnd(9, "0")) + (leapSecond ? 1_000_000_000 : 0);
  return { seconds: Math.floor(time.getTime() / 1000), nanoseconds };
}

function nextDate(date: DateParts, rule: string): DateParts | null {
  if (rule === "monthly" || rule === "yearly") {
    const monthIndex = date.month - 1 + (rule === "monthly" ? 1 : 12);
    const year = date.year + Math.floor(monthIndex / 12);
    const month = monthIndex % 12 + 1;
    return validDate(year, month, 1) ? { year, month, day: Math.min(date.day, daysInMonth(year, month)) } : null;
  }
  if (rule !== "daily" && rule !== "weekdays" && rule !== "weekly") return null;
  const cursor = new Date(0);
  cursor.setUTCFullYear(date.year, date.month - 1, date.day);
  cursor.setUTCDate(cursor.getUTCDate() + (rule === "weekly" ? 7 : 1));
  while (rule === "weekdays" && (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6)) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const next = { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() };
  return validDate(next.year, next.month, next.day) ? next : null;
}

function formatDate(date: DateParts): string {
  const year = date.year < 0 ? `-${pad(-date.year, 4)}` : date.year > 9999 ? `+${date.year}` : pad(date.year, 4);
  return `${year}-${pad(date.month)}-${pad(date.day)}`;
}

export function advanceDue(due: string, rule: string): string | null {
  const match = /^([+-]\d+|\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(due);
  if (!match) return null;
  const date = { year: +match[1], month: +match[2], day: +match[3] };
  if (!validDate(date.year, date.month, date.day)) return null;
  const next = nextDate(date, rule);
  return next ? formatDate(next) : null;
}

/** ISO timestamp with the current local offset, as used by the existing database. */
export function localTimestamp(date: Date, fraction = `.${pad(date.getMilliseconds(), 3)}`): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const offsetHours = Math.floor(Math.abs(offset) / 60);
  const offsetMinutes = Math.abs(offset) % 60;
  return `${formatDate({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() })}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${fraction}` +
    `${sign}${pad(offsetHours)}:${pad(offsetMinutes)}`;
}

