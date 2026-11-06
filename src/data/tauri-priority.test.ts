import { expect, test } from "bun:test";
import { TestDatabase } from "../../tests/crud-fixture";
import { createPriorityRepository } from "./tauri-priority";

test("priority models validate, round-trip overrides and reset without losing identity", async () => {
  const db = new TestDatabase();
  const priorities = createPriorityRepository(db);
  const input = { name: "  Urgent  ", color: "#AABBCC", sound: "none" as const, volume: 0,
    ramp: false, notificationStyle: "native" as const, repeatMinutes: 0 };
  try {
    expect((await priorities.listPriorityProfiles()).map((profile) => profile.priority)).toEqual([1, 2, 3, 4]);
    const updated = (await priorities.updatePriorityProfile(1, input))[0];
    expect(updated).toMatchObject({ priority: 1, name: "Urgent", color: "#aabbcc", sound: "none",
      volume: 0, ramp: false, notificationStyle: "native", repeatMinutes: 0 });
    expect(updated.updatedAt).not.toBe("1970-01-01T00:00:01Z");
    const reset = (await priorities.resetPriorityProfile(1))[0];
    expect(reset).toMatchObject({ priority: 1, name: "Priority 1", color: "#f2555a", sound: null,
      volume: null, ramp: null, notificationStyle: null, repeatMinutes: null });
    expect(reset.updatedAt).not.toBe("1970-01-01T00:00:01Z");
    await expect(priorities.updatePriorityProfile(5, input)).rejects.toThrow("priority");
    await expect(priorities.updatePriorityProfile(1, { ...input, name: "🙂".repeat(41) })).rejects.toThrow("Priority name");
    await expect(priorities.updatePriorityProfile(1, { ...input, color: "red" })).rejects.toThrow("color");
    await expect(priorities.updatePriorityProfile(1, { ...input, volume: 101 })).rejects.toThrow("Volume");
    await expect(priorities.updatePriorityProfile(1, { ...input, repeatMinutes: -1 })).rejects.toThrow("Repeat");
  } finally { db.sqlite.close(); }
});
