/**
 * Calendar — appointments, shifts, time off, and the Google mirror.
 *
 * Asserts what the front desk actually relies on: a "2:30 PM" appointment
 * lands on the right dealership-local day (not the UTC day), scheduling the
 * same person twice on one day updates rather than duplicates, a week of
 * vacation paints every covered day of the month grid, Google-mirrored events
 * cannot be deleted from our side, syncing twice never duplicates, a broken
 * feed stores a readable error instead of throwing, and disconnecting removes
 * the mirrored appointments.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import {
  addShift,
  addTimeOff,
  CalendarError,
  combineDayAndTime,
  createEvent,
  deleteEvent,
  getGoogleSetting,
  getMonthData,
  removeShift,
  removeTimeOff,
  setGoogleUrl,
  syncGoogleCalendar,
} from "@/modules/calendar/service";

function sessionUserFor(roleKey: string, base: { id: string; name: string; email: string }): SessionUser {
  const tpl = ROLE_TEMPLATES.find((t) => t.key === roleKey)!;
  const { permissions, fieldGrants } = buildPermissionMap([
    {
      key: tpl.key,
      permissions: Object.entries(tpl.grants).flatMap(([resource, grant]) =>
        Object.entries(grant!).map(([action, scope]) => ({ resource, action, scope })),
      ),
      fieldGrants: tpl.fieldGrants.map((fieldKey) => ({ fieldKey })),
    },
  ]);
  return {
    id: base.id,
    sessionId: "test",
    name: base.name,
    email: base.email,
    roleKeys: [roleKey],
    isOwner: roleKey === "admin",
    previewRoleKey: null,
    departmentIds: [],
    departmentKeys: [],
    permissions,
    fieldGrants,
    defaultLandingPage: null,
  };
}

/** A tiny in-memory "Google" that serves whatever ICS we hand it. */
function fetchServing(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, { status, headers: { "content-type": "text/calendar" } })) as unknown as typeof fetch;
}

const ics = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;

let admin: SessionUser;
let frontDeskUserId: string;
let savedGoogleSetting: unknown; // restore whatever the row held before the suite

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const rose = await db.user.findUniqueOrThrow({ where: { email: "ops@demo.gccc" } });
  admin = sessionUserFor("admin", jade);
  frontDeskUserId = rose.id;
  savedGoogleSetting = (await db.appSetting.findUnique({ where: { key: "calendar.google" } }))?.value ?? null;
});

afterAll(async () => {
  await db.calendarEvent.deleteMany({ where: { OR: [{ title: { startsWith: "ZZTEST" } }, { source: "GOOGLE", googleUid: { startsWith: "zztest" } }] } });
  await db.staffShift.deleteMany({ where: { note: "zztest" } });
  await db.staffTimeOff.deleteMany({ where: { note: "zztest" } });
  if (savedGoogleSetting === null) {
    await db.appSetting.deleteMany({ where: { key: "calendar.google" } });
  } else {
    await db.appSetting.upsert({
      where: { key: "calendar.google" },
      update: { value: savedGoogleSetting as object },
      create: { key: "calendar.google", value: savedGoogleSetting as object },
    });
  }
});

describe("combineDayAndTime", () => {
  it("reads 12-hour and 24-hour clocks as dealership wall time", () => {
    // 2:30 PM Pacific in July = 21:30Z (PDT)
    expect(combineDayAndTime("2026-07-10", "2:30 PM").toISOString()).toBe("2026-07-10T21:30:00.000Z");
    expect(combineDayAndTime("2026-07-10", "14:30").toISOString()).toBe("2026-07-10T21:30:00.000Z");
    // and in January = 22:30Z (PST)
    expect(combineDayAndTime("2026-01-10", "2:30 PM").toISOString()).toBe("2026-01-10T22:30:00.000Z");
    // blank time = the noon-UTC day marker
    expect(combineDayAndTime("2026-07-10", null).toISOString()).toBe("2026-07-10T12:00:00.000Z");
    // 12 AM / 12 PM edge cases
    expect(combineDayAndTime("2026-07-10", "12 PM").toISOString()).toBe("2026-07-10T19:00:00.000Z");
    expect(combineDayAndTime("2026-07-10", "12 AM").toISOString()).toBe("2026-07-10T07:00:00.000Z");
  });

  it("rejects gibberish with a readable message", () => {
    expect(() => combineDayAndTime("2026-07-10", "half past two")).toThrow(CalendarError);
    expect(() => combineDayAndTime("2026-07-10", "25:00")).toThrow(CalendarError);
  });
});

describe("appointments", () => {
  it("an evening appointment lands on its dealership-local day, not the UTC day", async () => {
    // 8 PM Pacific on the 10th is 03:00Z on the 11th — the month grid must
    // still show it on the 10th.
    const event = await createEvent(admin, { title: "ZZTEST evening test drive", day: "2026-10-10", time: "8:00 PM" });
    expect(event.startsAt.toISOString()).toBe("2026-10-11T03:00:00.000Z");

    const { gridDays } = await getMonthData("2026-10");
    const day10 = gridDays.find((d) => d.day === "2026-10-10")!;
    const day11 = gridDays.find((d) => d.day === "2026-10-11")!;
    expect(day10.events.some((e) => e.title === "ZZTEST evening test drive")).toBe(true);
    expect(day11.events.some((e) => e.title === "ZZTEST evening test drive")).toBe(false);

    await deleteEvent(admin, event.id);
    await deleteEvent(admin, event.id); // idempotent — already gone is fine
  });

  it("refuses an end time before the start", async () => {
    await expect(
      createEvent(admin, { title: "ZZTEST backwards", day: "2026-10-10", time: "3:00 PM", endTime: "2:00 PM" }),
    ).rejects.toThrow("end time must be after");
  });
});

describe("shifts and time off", () => {
  it("scheduling the same person twice on one day updates, never duplicates", async () => {
    const first = await addShift(admin, { userId: frontDeskUserId, day: "2026-10-12", hours: "9–5" });
    await db.staffShift.update({ where: { id: first.id }, data: { note: "zztest" } });
    const second = await addShift(admin, { userId: frontDeskUserId, day: "2026-10-12", hours: "10–6" });
    expect(second.id).toBe(first.id);
    expect(second.hours).toBe("10–6");

    const { gridDays } = await getMonthData("2026-10");
    const day = gridDays.find((d) => d.day === "2026-10-12")!;
    expect(day.shifts.filter((s) => s.userId === frontDeskUserId)).toHaveLength(1);

    await removeShift(admin, first.id);
    await removeShift(admin, first.id); // idempotent
    expect(await db.staffShift.findUnique({ where: { id: first.id } })).toBeNull();
  });

  it("a week of vacation paints every covered day of the grid", async () => {
    const row = await addTimeOff(admin, {
      userId: frontDeskUserId,
      startDay: "2026-10-19",
      endDay: "2026-10-23",
      kind: "VACATION",
      note: "zztest",
    });
    const { gridDays } = await getMonthData("2026-10");
    for (const d of ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]) {
      const day = gridDays.find((g) => g.day === d)!;
      const band = day.timeOff.find((t) => t.id === row.id);
      expect(band, `expected vacation band on ${d}`).toBeTruthy();
      expect(band!.kind).toBe("VACATION");
      expect(band!.startDay).toBe("2026-10-19");
      expect(band!.endDay).toBe("2026-10-23");
    }
    const before = gridDays.find((g) => g.day === "2026-10-18")!;
    expect(before.timeOff.some((t) => t.id === row.id)).toBe(false);

    await removeTimeOff(admin, row.id);
    await removeTimeOff(admin, row.id); // idempotent
  });

  it("refuses time off that ends before it starts", async () => {
    await expect(
      addTimeOff(admin, { userId: frontDeskUserId, startDay: "2026-10-20", endDay: "2026-10-19", kind: "TIME_OFF" }),
    ).rejects.toThrow("cannot end before");
  });
});

describe("google mirror", () => {
  const feedUrl = "https://calendar.google.com/calendar/ical/zztest/basic.ics";

  it("rejects non-https addresses and junk", async () => {
    await expect(setGoogleUrl(admin, "http://calendar.google.com/x.ics")).rejects.toThrow("https");
    await expect(setGoogleUrl(admin, "not a url")).rejects.toThrow("URL");
  });

  it("mirrors the feed, and syncing twice never duplicates", async () => {
    await setGoogleUrl(admin, feedUrl);
    const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const y = soon.getUTCFullYear();
    const m = String(soon.getUTCMonth() + 1).padStart(2, "0");
    const d = String(soon.getUTCDate()).padStart(2, "0");
    const feed = ics(
      `BEGIN:VEVENT\r\nUID:zztest-1\r\nSUMMARY:Auction pickup\r\nDTSTART:${y}${m}${d}T170000Z\r\nDTEND:${y}${m}${d}T180000Z\r\nLOCATION:Roseville\r\nEND:VEVENT`,
    );

    const first = await syncGoogleCalendar(admin, { fetchImpl: fetchServing(feed) });
    expect(first.lastError).toBeNull();
    expect(first.lastCount).toBe(1);

    const second = await syncGoogleCalendar(admin, { fetchImpl: fetchServing(feed) });
    expect(second.lastCount).toBe(1);
    const mirrored = await db.calendarEvent.findMany({ where: { googleUid: "zztest-1" } });
    expect(mirrored).toHaveLength(1);
    expect(mirrored[0]!.source).toBe("GOOGLE");
    expect(mirrored[0]!.location).toBe("Roseville");
  });

  it("refuses to delete a mirrored event from our side", async () => {
    const mirrored = await db.calendarEvent.findFirstOrThrow({ where: { googleUid: "zztest-1" } });
    await expect(deleteEvent(admin, mirrored.id)).rejects.toThrow("delete it there");
  });

  it("a broken feed stores a readable error instead of throwing", async () => {
    const afterHtml = await syncGoogleCalendar(admin, { fetchImpl: fetchServing("<html>sign in</html>") });
    expect(afterHtml.lastError).toContain("did not return a calendar feed");

    const after500 = await syncGoogleCalendar(admin, { fetchImpl: fetchServing("nope", 500) });
    expect(after500.lastError).toContain("500");

    // the previously mirrored event is untouched by a failed sync
    expect(await db.calendarEvent.count({ where: { googleUid: "zztest-1" } })).toBe(1);
  });

  it("never logs the secret address — audit records the host only", async () => {
    const audits = await db.auditEvent.findMany({
      where: { action: { in: ["calendar.google_connect", "calendar.google_sync"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) {
      expect(JSON.stringify(a.newValues ?? {})).not.toContain("/calendar/ical/zztest");
    }
  });

  it("disconnecting removes the mirrored appointments", async () => {
    await setGoogleUrl(admin, null);
    expect(await db.calendarEvent.count({ where: { googleUid: "zztest-1" } })).toBe(0);
    expect((await getGoogleSetting()).url).toBeNull();
  });
});
