/**
 * The iCalendar reader behind the Google Calendar sync. Each test is one
 * real-world quirk that would otherwise corrupt an appointment silently:
 * folded lines, escaped commas, the three DTSTART flavors, DST-crossing
 * timezone math, recurrence with COUNT/UNTIL/BYDAY, exception dates,
 * per-instance overrides, cancellations, and unsupported patterns.
 */
import { describe, expect, it } from "vitest";
import { expandIcsEvents, parseIcs, unfoldIcsLines, zonedToUtc } from "@/modules/calendar/ics";

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const W_START = new Date("2026-09-01T00:00:00Z");
const W_END = new Date("2026-12-31T23:59:59Z");

describe("line unfolding and text escapes", () => {
  it("joins folded lines and unescapes text", () => {
    const lines = unfoldIcsLines("SUMMARY:Test drive with John\r\n  Baxter\\, Sr.\r\nUID:x");
    expect(lines[0]).toBe("SUMMARY:Test drive with John Baxter\\, Sr.");

    const events = parseIcs(
      wrap("BEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Buyer meeting\\, then lunch\r\nDTSTART:20260910T170000Z\r\nEND:VEVENT"),
    );
    expect(events[0]!.summary).toBe("Buyer meeting, then lunch");
  });
});

describe("date flavors", () => {
  it("reads UTC instants", () => {
    const [e] = parseIcs(wrap("BEGIN:VEVENT\r\nUID:1\r\nSUMMARY:x\r\nDTSTART:20260910T170000Z\r\nEND:VEVENT"));
    expect(e!.allDay).toBe(false);
    expect(e!.startsAt.toISOString()).toBe("2026-09-10T17:00:00.000Z");
  });

  it("reads TZID wall-clock times, correctly across DST", () => {
    // 2 PM Pacific is 21:00Z during PDT (September)…
    expect(zonedToUtc(2026, 9, 10, 14, 0, 0, "America/Los_Angeles").toISOString()).toBe("2026-09-10T21:00:00.000Z");
    // …and 22:00Z during PST (December).
    expect(zonedToUtc(2026, 12, 10, 14, 0, 0, "America/Los_Angeles").toISOString()).toBe("2026-12-10T22:00:00.000Z");

    const [e] = parseIcs(
      wrap("BEGIN:VEVENT\r\nUID:1\r\nSUMMARY:x\r\nDTSTART;TZID=America/Los_Angeles:20260910T140000\r\nEND:VEVENT"),
    );
    expect(e!.startsAt.toISOString()).toBe("2026-09-10T21:00:00.000Z");
  });

  it("reads all-day events as noon-UTC days", () => {
    const [e] = parseIcs(wrap("BEGIN:VEVENT\r\nUID:1\r\nSUMMARY:x\r\nDTSTART;VALUE=DATE:20260910\r\nEND:VEVENT"));
    expect(e!.allDay).toBe(true);
    expect(e!.startsAt.toISOString()).toBe("2026-09-10T12:00:00.000Z");
  });
});

describe("expansion", () => {
  it("keeps single events inside the window, drops those outside", () => {
    const events = parseIcs(
      wrap(
        "BEGIN:VEVENT\r\nUID:in\r\nSUMMARY:inside\r\nDTSTART:20261001T170000Z\r\nEND:VEVENT\r\n" +
          "BEGIN:VEVENT\r\nUID:out\r\nSUMMARY:outside\r\nDTSTART:20270301T170000Z\r\nEND:VEVENT",
      ),
    );
    const { instances } = expandIcsEvents(events, W_START, W_END);
    expect(instances.map((i) => i.uid)).toEqual(["in"]);
  });

  it("expands WEEKLY;BYDAY with COUNT, keeping durations", () => {
    const events = parseIcs(
      wrap(
        "BEGIN:VEVENT\r\nUID:mtg\r\nSUMMARY:Staff meeting\r\nDTSTART:20260907T160000Z\r\nDTEND:20260907T163000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=4\r\nEND:VEVENT",
      ),
    );
    const { instances, unsupportedRules } = expandIcsEvents(events, W_START, W_END);
    expect(unsupportedRules).toEqual([]);
    expect(instances.map((i) => i.startsAt.toISOString().slice(0, 10))).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    expect(instances[0]!.endsAt!.getTime() - instances[0]!.startsAt.getTime()).toBe(30 * 60 * 1000);
  });

  it("honors UNTIL and EXDATE", () => {
    const events = parseIcs(
      wrap(
        "BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:daily\r\nDTSTART:20260901T150000Z\r\nRRULE:FREQ=DAILY;UNTIL=20260904T150000Z\r\nEXDATE:20260902T150000Z\r\nEND:VEVENT",
      ),
    );
    const { instances } = expandIcsEvents(events, W_START, W_END);
    expect(instances.map((i) => i.startsAt.toISOString().slice(8, 10))).toEqual(["01", "03", "04"]);
  });

  it("applies RECURRENCE-ID overrides and drops cancelled occurrences", () => {
    const events = parseIcs(
      wrap(
        "BEGIN:VEVENT\r\nUID:r\r\nSUMMARY:Weekly detail\r\nDTSTART:20260907T180000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\n" +
          // second occurrence moved an hour later and retitled
          "BEGIN:VEVENT\r\nUID:r\r\nSUMMARY:Weekly detail (moved)\r\nDTSTART:20260914T190000Z\r\nRECURRENCE-ID:20260914T180000Z\r\nEND:VEVENT\r\n" +
          // third occurrence cancelled
          "BEGIN:VEVENT\r\nUID:r\r\nSUMMARY:Weekly detail\r\nDTSTART:20260921T180000Z\r\nRECURRENCE-ID:20260921T180000Z\r\nSTATUS:CANCELLED\r\nEND:VEVENT",
      ),
    );
    const { instances } = expandIcsEvents(events, W_START, W_END);
    expect(instances).toHaveLength(2);
    expect(instances[0]!.title).toBe("Weekly detail");
    expect(instances[1]!.title).toBe("Weekly detail (moved)");
    expect(instances[1]!.startsAt.toISOString()).toBe("2026-09-14T19:00:00.000Z");
  });

  it("labels unsupported recurrence patterns instead of guessing dates", () => {
    const events = parseIcs(
      wrap(
        "BEGIN:VEVENT\r\nUID:u\r\nSUMMARY:Third Thursday thing\r\nDTSTART:20260917T170000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=TH;BYSETPOS=3\r\nEND:VEVENT",
      ),
    );
    const { instances, unsupportedRules } = expandIcsEvents(events, W_START, W_END);
    expect(unsupportedRules).toEqual(["u"]);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.title).toContain("pattern not fully supported");
  });

  it("interval weekly without BYDAY steps by whole weeks", () => {
    const events = parseIcs(
      wrap("BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:biweekly\r\nDTSTART:20260901T150000Z\r\nRRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3\r\nEND:VEVENT"),
    );
    const { instances } = expandIcsEvents(events, W_START, W_END);
    expect(instances.map((i) => i.startsAt.toISOString().slice(0, 10))).toEqual([
      "2026-09-01",
      "2026-09-15",
      "2026-09-29",
    ]);
  });
});
