import { afterEach, expect, test } from "bun:test";
import { advanceReminder, createLocalTime, systemLocalTime } from "./local-time";

const initialTimezone = process.env.TZ;
afterEach(() => {
  if (initialTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = initialTimezone;
});

test("preserves nanoseconds, offsets and leap seconds when advancing a reminder", async () => {
  process.env.TZ = "Etc/UTC";
  const cases = [
    ["2026-11-06 08:30:00.123456789+08:00", "2026-11-07T00:30:00.123456789+00:00"],
    ["2016-12-31T23:59:60.1Z", "2017-01-01T23:59:60.100+00:00"],
    ["2026-11-06T12:30:01Z", "2026-11-07T12:30:01+00:00"],
  ];
  for (const [original, expected] of cases) {
    expect(await advanceReminder(systemLocalTime, original, "daily")).toBe(expected);
  }
  expect(await systemLocalTime.parts("not a timestamp")).toBeNull();
  expect(await systemLocalTime.timestamp("2026-02-30", "12:00:00")).toBeNull();
  expect(await systemLocalTime.timestamp("2026-03-01", "25:00:00")).toBeNull();
});

test("rejects daylight-saving gaps and chooses the earlier repeated time", async () => {
  process.env.TZ = "America/New_York";
  expect(await advanceReminder(systemLocalTime, "2026-03-07T02:30:00-05:00", "daily")).toBeNull();
  expect(await advanceReminder(systemLocalTime, "2026-10-31T01:30:00-04:00", "daily"))
    .toBe("2026-11-01T01:30:00-04:00");
});

test("handles half-hour daylight-saving transitions", async () => {
  process.env.TZ = "Australia/Lord_Howe";
  expect(await advanceReminder(systemLocalTime, "2026-10-03T02:15:00+10:30", "daily")).toBeNull();
  expect(await advanceReminder(systemLocalTime, "2026-04-04T01:45:00+11:00", "daily"))
    .toBe("2026-04-05T01:45:00+11:00");
});

test("uses platform offsets when the webview and native historical timezones differ", async () => {
  process.env.TZ = "Asia/Singapore";
  const native = createLocalTime({ offsets: async (seconds) => seconds.map(() => 8 * 3600) });
  expect(await systemLocalTime.parts("1940-01-01T12:34:56.123456Z"))
    .toEqual({ date: "1940-01-01", time: "19:54:56.123456" });
  expect(await native.parts("1940-01-01T12:34:56.123456Z"))
    .toEqual({ date: "1940-01-01", time: "20:34:56.123456" });
  expect(await advanceReminder(native, "1940-01-01T12:34:56.123456Z", "daily"))
    .toBe("1940-01-02T20:34:56.123456+08:00");
});

test("chooses the earlier instant even for a short-lived timezone offset", async () => {
  const start = Date.parse("2026-01-01T10:00:00Z") / 1000;
  const end = Date.parse("2026-01-01T12:00:00Z") / 1000;
  const timezone = createLocalTime({
    offsets: async (seconds) => seconds.map((value) => value >= start && value < end ? 3600 : 0),
  });
  expect(await timezone.timestamp("2026-01-01", "12:30:00")).toBe("2026-01-01T12:30:00+01:00");
});
