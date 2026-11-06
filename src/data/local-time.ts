import { invoke } from "@tauri-apps/api/core";
import { advanceDue, formatDate, parseInstant } from "./recurrence";

export interface LocalReminderTime { date: string; time: string }
export interface LocalTime {
  parts(timestamp: string): Promise<LocalReminderTime | null>;
  timestamp(date: string, time: string): Promise<string | null>;
}

/** Raw UTC offsets, in seconds, supplied by a platform timezone database. */
export interface TimezoneOffsets {
  offsets(seconds: number[]): Promise<(number | null)[]>;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");
function fraction(nanoseconds: number): string {
  if (nanoseconds === 0) return "";
  const digits = nanoseconds % 1_000_000 === 0 ? 3 : nanoseconds % 1_000 === 0 ? 6 : 9;
  return `.${pad(nanoseconds, 9).slice(0, digits)}`;
}

function wallDate(seconds: number): Date | null {
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localFields(date: Date): string {
  return formatDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

function offsetText(seconds: number): string {
  const minutes = Math.floor(Math.abs(seconds) / 60);
  return `${seconds < 0 ? "-" : "+"}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** Browser fallback; use local calendar fields to retain historical second-level offsets. */
export const webviewTimezone: TimezoneOffsets = {
  async offsets(seconds) {
    return seconds.map((instant) => {
      const date = wallDate(instant);
      if (!date) return null;
      const local = new Date(0);
      local.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
      local.setUTCHours(date.getHours(), date.getMinutes(), date.getSeconds(), 0);
      const offset = local.getTime() / 1000 - instant;
      return Number.isFinite(offset) ? offset : null;
    });
  },
};

/** OS data only: the native scheduler uses this same timezone on desktop. */
export const tauriTimezone: TimezoneOffsets = {
  offsets: (seconds) => invoke<(number | null)[]>("timezone_offsets", { seconds }),
};

export function createLocalTime(timezone: TimezoneOffsets): LocalTime {
  return {
    async parts(timestamp) {
      const instant = parseInstant(timestamp);
      if (!instant) return null;
      const [offset] = await timezone.offsets([instant.seconds]);
      if (offset === null || offset === undefined) return null;
      const date = wallDate(instant.seconds + offset);
      if (!date) return null;
      const leap = instant.nanoseconds >= 1_000_000_000;
      const seconds = date.getUTCSeconds() + Number(leap);
      return {
        date: localFields(date),
        time: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(seconds)}` +
          fraction(instant.nanoseconds % 1_000_000_000),
      };
    },

    async timestamp(date, time) {
      const dateMatch = /^([+-]\d+|\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(date);
      const timeMatch = /^(\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/.exec(time);
      if (!dateMatch || !timeMatch) return null;
      const [, y, m, d] = dateMatch;
      const [, h, minute, second, subsecond = ""] = timeMatch;
      const year = Number(y), month = Number(m), day = Number(d);
      const hours = Number(h), minutes = Number(minute), seconds = Number(second);
      if (year < -262143 || year > 262142 || month < 1 || month > 12 || day < 1 || day > 31 ||
          hours > 23 || minutes > 59 || seconds > 60) return null;

      const wall = new Date(0);
      wall.setUTCFullYear(year, month - 1, day);
      wall.setUTCHours(hours, minutes, Math.min(seconds, 59), 0);
      if (Number.isNaN(wall.getTime()) || wall.getUTCFullYear() !== year ||
          wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day ||
          wall.getUTCHours() !== hours || wall.getUTCMinutes() !== minutes ||
          wall.getUTCSeconds() !== Math.min(seconds, 59)) return null;

      const naive = wall.getTime() / 1000;
      // Probe around the desired wall time, then verify each possible offset
      // against its candidate UTC instant. This rejects gaps and lets us pick
      // the earlier instant for overlaps, including half-hour transitions.
      const samples = [naive - 172800,
        ...Array.from({ length: 49 }, (_, index) => naive + (index - 24) * 3600),
        naive + 172800];
      const known = new Set((await timezone.offsets(samples)).filter((value): value is number => value !== null));
      const checked = new Set<number>();
      const valid: { instant: number; offset: number }[] = [];
      for (let round = 0; round < 4; round++) {
        const pending = [...known].filter((offset) => !checked.has(offset));
        if (!pending.length) break;
        pending.forEach((offset) => checked.add(offset));
        const actual = await timezone.offsets(pending.map((offset) => naive - offset));
        for (let index = 0; index < pending.length; index++) {
          const offset = pending[index];
          if (actual[index] === offset) valid.push({ instant: naive - offset, offset });
          else if (actual[index] !== null && actual[index] !== undefined) known.add(actual[index]!);
        }
      }
      valid.sort((a, b) => a.instant - b.instant);
      if (!valid.length) return null;
      const nanos = Number(subsecond.slice(0, 9).padEnd(9, "0"));
      return `${localFields(wall)}T${pad(hours)}:${pad(minutes)}:${pad(seconds)}` +
        `${fraction(nanos)}${offsetText(valid[0].offset)}`;
    },
  };
}

export const systemLocalTime = createLocalTime(webviewTimezone);
export const tauriLocalTime = createLocalTime(tauriTimezone);

export async function advanceReminder(localTime: LocalTime, timestamp: string, rule: string): Promise<string | null> {
  const local = await localTime.parts(timestamp);
  if (!local) return null;
  const nextDate = advanceDue(local.date, rule);
  return nextDate ? localTime.timestamp(nextDate, local.time) : null;
}
