import { t } from "../lib/i18n";
import { DEFAULT_PROFILES, PRIORITY_VALUES, type PriorityProfile, type PriorityProfileInput, type PriorityValue } from "../lib/priority";
import { SOUNDS } from "../lib/sound";
import { op, tauriDatabase, type Database, type SqlRow } from "./database";
import { trimWhitespace } from "./operations";

function profilesFromRows(rows: SqlRow[]): PriorityProfile[] {
  return rows.map((row) => ({
    ...row as unknown as PriorityProfile,
    ramp: row.ramp === null ? null : row.ramp !== 0,
  }));
}

function validatePriority(priority: number): asserts priority is PriorityValue {
  if (!PRIORITY_VALUES.includes(priority as PriorityValue)) throw new Error(t("validation.priority"));
}

function validateInput(input: PriorityProfileInput): void {
  const name = trimWhitespace(input.name);
  if (!name || [...name].length > 40) throw new Error(t("validation.priorityName"));
  if (!/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error(t("validation.color"));
  if (input.sound !== null && !SOUNDS.some((sound) => sound.value === input.sound)) throw new Error(t("validation.sound"));
  if (input.volume !== null && (!Number.isInteger(input.volume) || input.volume < 0 || input.volume > 100)) {
    throw new Error(t("validation.volume"));
  }
  if (input.notificationStyle !== null && !["custom", "native"].includes(input.notificationStyle)) {
    throw new Error(t("validation.style"));
  }
  if (input.repeatMinutes !== null && (!Number.isInteger(input.repeatMinutes) || input.repeatMinutes < 0 || input.repeatMinutes > 1440)) {
    throw new Error(t("validation.repeat"));
  }
}

export function createPriorityRepository(db: Database = tauriDatabase) {
  async function save(priority: PriorityValue, input: PriorityProfileInput): Promise<PriorityProfile[]> {
    const results = await db.run([
      op("priority.update", trimWhitespace(input.name), input.color.toLowerCase(), input.sound, input.volume,
        input.ramp, input.notificationStyle, input.repeatMinutes, new Date().toISOString(), priority),
      op("priority.list"),
    ]);
    return profilesFromRows(results[1]);
  }

  return {
    async listPriorityProfiles(): Promise<PriorityProfile[]> {
      const [rows] = await db.run([op("priority.list")]);
      return profilesFromRows(rows);
    },
    async updatePriorityProfile(priority: number, input: PriorityProfileInput): Promise<PriorityProfile[]> {
      validatePriority(priority);
      validateInput(input);
      return save(priority, input);
    },
    async resetPriorityProfile(priority: number): Promise<PriorityProfile[]> {
      validatePriority(priority);
      const { name, color } = DEFAULT_PROFILES[priority - 1];
      return save(priority, { name, color, sound: null, volume: null, ramp: null, notificationStyle: null, repeatMinutes: null });
    },
  };
}
