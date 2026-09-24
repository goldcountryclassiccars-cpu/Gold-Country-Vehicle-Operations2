/**
 * Calendar: appointments, staff shifts, and time off — plus the one-way
 * Google Calendar mirror.
 *
 * The Google sync deliberately uses the calendar's secret iCal address rather
 * than OAuth: pasting one URL into the app is something Jade can do in a
 * minute, needs no Google Cloud project, and read-only is the right direction
 * of trust — the ops app never writes to the dealership's Google Calendar.
 * Mirrored events are replaced wholesale inside the sync window on every sync,
 * which makes the sync idempotent by construction.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { dealershipDayString, readDay, storeDay } from "@/lib/dealership-date";
import type { SessionUser } from "@/lib/authz/types";
import { expandIcsEvents, parseIcs, zonedToUtc } from "./ics";

export class CalendarError extends Error {}

// ---------------------------------------------------------------------------
// Appointments / shifts / time off
// ---------------------------------------------------------------------------

export async function createEvent(
  user: SessionUser,
  input: { title: string; day: string; time?: string | null; endTime?: string | null; location?: string | null; notes?: string | null },
) {
  const startsAt = combineDayAndTime(input.day, input.time ?? null);
  const endsAt = input.endTime ? combineDayAndTime(input.day, input.endTime) : null;
  if (endsAt && startsAt && endsAt <= startsAt) {
    throw new CalendarError("The end time must be after the start time.");
  }
  const event = await db.calendarEvent.create({
    data: {
      title: input.title.trim(),
      startsAt,
      endsAt,
      allDay: !input.time,
      location: input.location?.trim() || null,
      notes: input.notes?.trim() || null,
      source: "INTERNAL",
      createdById: user.id,
    },
  });
  await audit(user, { action: "calendar.event_create", resourceType: "calendar_event", resourceId: event.id, newValues: { title: event.title, startsAt: event.startsAt } });
  return event;
}

export async function deleteEvent(user: SessionUser, eventId: string) {
  const event = await db.calendarEvent.findUnique({ where: { id: eventId } });
  if (!event) return; // already gone — the desired state
  if (event.source === "GOOGLE") {
    throw new CalendarError("This appointment mirrors Google Calendar — delete it there and it disappears on the next sync.");
  }
  await db.calendarEvent.delete({ where: { id: eventId } });
  await audit(user, { action: "calendar.event_delete", resourceType: "calendar_event", resourceId: eventId, previousValues: { title: event.title, startsAt: event.startsAt } });
}

export async function addShift(user: SessionUser, input: { userId: string; day: string; hours?: string | null }) {
  const day = storeDay(input.day);
  const shift = await db.staffShift.upsert({
    where: { userId_day: { userId: input.userId, day } },
    update: { hours: input.hours?.trim() || null },
    create: { userId: input.userId, day, hours: input.hours?.trim() || null, createdById: user.id },
  });
  await audit(user, { action: "calendar.shift_set", resourceType: "staff_shift", resourceId: shift.id, newValues: { userId: input.userId, day: input.day, hours: shift.hours } });
  return shift;
}

export async function removeShift(user: SessionUser, shiftId: string) {
  const shift = await db.staffShift.findUnique({ where: { id: shiftId } });
  if (!shift) return; // already gone — the desired state
  await db.staffShift.delete({ where: { id: shiftId } });
  await audit(user, { action: "calendar.shift_remove", resourceType: "staff_shift", resourceId: shiftId, previousValues: { userId: shift.userId, day: readDay(shift.day) } });
}

export async function addTimeOff(
  user: SessionUser,
  input: { userId: string; startDay: string; endDay?: string | null; kind: "VACATION" | "TIME_OFF"; note?: string | null },
) {
  const startDay = storeDay(input.startDay);
  const endDay = storeDay(input.endDay || input.startDay);
  if (endDay < startDay) throw new CalendarError("Time off cannot end before it starts.");
  const row = await db.staffTimeOff.create({
    data: { userId: input.userId, startDay, endDay, kind: input.kind, note: input.note?.trim() || null, createdById: user.id },
  });
  await audit(user, { action: "calendar.timeoff_add", resourceType: "staff_time_off", resourceId: row.id, newValues: { userId: input.userId, startDay: input.startDay, endDay: input.endDay ?? input.startDay, kind: input.kind } });
  return row;
}

export async function removeTimeOff(user: SessionUser, id: string) {
  const row = await db.staffTimeOff.findUnique({ where: { id } });
  if (!row) return; // already gone — the desired state
  await db.staffTimeOff.delete({ where: { id } });
  await audit(user, { action: "calendar.timeoff_remove", resourceType: "staff_time_off", resourceId: id, previousValues: { userId: row.userId, startDay: readDay(row.startDay), endDay: readDay(row.endDay) } });
}

/** "2026-09-26" + "2:30 PM" | "14:30" | null → UTC instant (dealership wall clock). */
export function combineDayAndTime(day: string, time: string | null): Date {
  if (!time || !time.trim()) return storeDay(day);
  const t = time.trim().toUpperCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/.exec(t);
  if (!m) throw new CalendarError(`Could not read the time "${time}" — use e.g. 2:30 PM or 14:30.`);
  let hh = Number(m[1]);
  const mm = Number(m[2] ?? "0");
  const ampm = m[3];
  if (ampm === "PM" && hh < 12) hh += 12;
  if (ampm === "AM" && hh === 12) hh = 0;
  if (hh > 23 || mm > 59) throw new CalendarError(`Could not read the time "${time}".`);
  const [y, mo, d] = day.slice(0, 10).split("-").map(Number);
  // Reuse the ICS timezone math: interpret as dealership wall clock.
  return zonedToUtc(y!, mo!, d!, hh, mm, 0, "America/Los_Angeles");
}

// ---------------------------------------------------------------------------
// Month assembly
// ---------------------------------------------------------------------------

export interface CalendarDay {
  day: string; // "2026-09-26"
  events: { id: string; title: string; startsAt: Date; endsAt: Date | null; allDay: boolean; location: string | null; notes: string | null; source: "INTERNAL" | "GOOGLE" }[];
  shifts: { id: string; userId: string; userName: string; hours: string | null }[];
  timeOff: { id: string; userId: string; userName: string; kind: "VACATION" | "TIME_OFF"; note: string | null; startDay: string; endDay: string }[];
}

/** Every day of the month grid (leading/trailing days included), fully populated. */
export async function getMonthData(monthStr: string): Promise<{ gridDays: CalendarDay[]; monthStart: string }> {
  const [y, mo] = monthStr.split("-").map(Number);
  if (!y || !mo || mo < 1 || mo > 12) throw new CalendarError("Bad month");
  const first = new Date(Date.UTC(y, mo - 1, 1, 12));
  const gridStart = new Date(first);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay()); // back to Sunday
  const gridEnd = new Date(gridStart);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + 41); // 6 weeks

  // Timed events belong to a dealership-local day, so the query window is a
  // day wider than the grid on both sides and grouping decides membership.
  const qStart = new Date(gridStart.getTime() - 24 * 3600 * 1000);
  const qEnd = new Date(gridEnd.getTime() + 48 * 3600 * 1000);

  const [events, shifts, timeOff, users] = await Promise.all([
    db.calendarEvent.findMany({ where: { startsAt: { gte: qStart, lte: qEnd } }, orderBy: { startsAt: "asc" } }),
    db.staffShift.findMany({ where: { day: { gte: gridStart, lte: gridEnd } } }),
    db.staffTimeOff.findMany({ where: { startDay: { lte: gridEnd }, endDay: { gte: gridStart } } }),
    db.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name.replace(/ \(Demo\)$/, "")]));

  const byDay = new Map<string, CalendarDay>();
  const dayOf = (d: Date, allDay: boolean) => (allDay ? readDay(d)! : dealershipDayString(d));
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setUTCDate(d.getUTCDate() + i);
    const key = readDay(d)!;
    byDay.set(key, { day: key, events: [], shifts: [], timeOff: [] });
  }

  for (const e of events) {
    const key = dayOf(e.startsAt, e.allDay);
    byDay.get(key)?.events.push({ id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay, location: e.location, notes: e.notes, source: e.source });
  }
  for (const s of shifts) {
    const key = readDay(s.day)!;
    byDay.get(key)?.shifts.push({ id: s.id, userId: s.userId, userName: nameOf.get(s.userId) ?? "Staff", hours: s.hours });
  }
  for (const t of timeOff) {
    // paint every covered day in the grid
    const start = new Date(Math.max(t.startDay.getTime(), gridStart.getTime()));
    const end = new Date(Math.min(t.endDay.getTime(), gridEnd.getTime()));
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = readDay(d)!;
      byDay.get(key)?.timeOff.push({
        id: t.id,
        userId: t.userId,
        userName: nameOf.get(t.userId) ?? "Staff",
        kind: t.kind,
        note: t.note,
        startDay: readDay(t.startDay)!,
        endDay: readDay(t.endDay)!,
      });
    }
  }
  for (const day of byDay.values()) {
    day.shifts.sort((a, b) => a.userName.localeCompare(b.userName));
  }
  return { gridDays: [...byDay.values()], monthStart: readDay(first)! };
}

// ---------------------------------------------------------------------------
// Google Calendar mirror (secret iCal address)
// ---------------------------------------------------------------------------

const GOOGLE_SETTING_KEY = "calendar.google";
const SYNC_WINDOW_PAST_DAYS = 30;
const SYNC_WINDOW_FUTURE_DAYS = 180;
const AUTO_SYNC_MINUTES = 15;

export interface GoogleCalendarSetting {
  url: string | null;
  lastSyncAt: string | null;
  lastCount: number | null;
  lastError: string | null;
  unsupportedRules: number;
}

export async function getGoogleSetting(): Promise<GoogleCalendarSetting> {
  const row = await db.appSetting.findUnique({ where: { key: GOOGLE_SETTING_KEY } });
  const v = (row?.value as Partial<GoogleCalendarSetting>) ?? {};
  return { url: v.url ?? null, lastSyncAt: v.lastSyncAt ?? null, lastCount: v.lastCount ?? null, lastError: v.lastError ?? null, unsupportedRules: v.unsupportedRules ?? 0 };
}

async function saveGoogleSetting(v: GoogleCalendarSetting) {
  await db.appSetting.upsert({
    where: { key: GOOGLE_SETTING_KEY },
    update: { value: v as object },
    create: { key: GOOGLE_SETTING_KEY, value: v as object },
  });
}

export async function setGoogleUrl(user: SessionUser, url: string | null) {
  if (url) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new CalendarError("That does not look like a URL.");
    }
    if (parsed.protocol !== "https:") throw new CalendarError("The calendar address must start with https://");
  }
  const prev = await getGoogleSetting();
  await saveGoogleSetting({ url, lastSyncAt: null, lastCount: null, lastError: null, unsupportedRules: 0 });
  if (!url) {
    // Disconnecting removes the mirrored events too — they have no source now.
    await db.calendarEvent.deleteMany({ where: { source: "GOOGLE" } });
  }
  await audit(user, {
    action: url ? "calendar.google_connect" : "calendar.google_disconnect",
    resourceType: "calendar",
    // The secret address grants read access to the whole calendar; never log it.
    newValues: { connected: Boolean(url), host: url ? new URL(url).host : null, replaced: Boolean(prev.url) },
  });
}

/**
 * Pulls the Google calendar and replaces the mirrored window. Never throws for
 * fetch/parse problems — the failure is stored and shown on the calendar page.
 */
export async function syncGoogleCalendar(
  user: SessionUser | null,
  opts?: { fetchImpl?: typeof fetch },
): Promise<GoogleCalendarSetting> {
  const setting = await getGoogleSetting();
  if (!setting.url) return setting;
  const fetchImpl = opts?.fetchImpl ?? fetch;

  const now = new Date();
  const windowStart = new Date(now.getTime() - SYNC_WINDOW_PAST_DAYS * 24 * 3600 * 1000);
  const windowEnd = new Date(now.getTime() + SYNC_WINDOW_FUTURE_DAYS * 24 * 3600 * 1000);

  try {
    const res = await fetchImpl(setting.url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!res.ok) throw new Error(`Google answered ${res.status}`);
    const text = await res.text();
    if (text.length > 5 * 1024 * 1024) throw new Error("Calendar feed is larger than 5MB");
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("That address did not return a calendar feed");

    const { instances, unsupportedRules } = expandIcsEvents(parseIcs(text), windowStart, windowEnd);

    await db.$transaction([
      db.calendarEvent.deleteMany({ where: { source: "GOOGLE", startsAt: { gte: windowStart, lte: windowEnd } } }),
      db.calendarEvent.createMany({
        data: instances.map((i) => ({
          title: i.title,
          startsAt: i.startsAt,
          endsAt: i.endsAt,
          allDay: i.allDay,
          location: i.location,
          notes: i.notes,
          source: "GOOGLE" as const,
          googleUid: i.uid,
        })),
      }),
    ]);

    const updated: GoogleCalendarSetting = {
      url: setting.url,
      lastSyncAt: new Date().toISOString(),
      lastCount: instances.length,
      lastError: null,
      unsupportedRules: unsupportedRules.length,
    };
    await saveGoogleSetting(updated);
    await audit(user, { action: "calendar.google_sync", resourceType: "calendar", newValues: { count: instances.length, unsupportedRules: unsupportedRules.length }, source: user ? "web" : "system" });
    return updated;
  } catch (e) {
    const message = e instanceof Error ? (e.name === "TimeoutError" ? "Google did not answer within 8 seconds" : e.message) : "Sync failed";
    const failed: GoogleCalendarSetting = { ...setting, lastError: message };
    await saveGoogleSetting(failed);
    return failed;
  }
}

/** Refreshes the mirror when it is stale; quiet best-effort for page loads. */
export async function autoSyncIfStale(): Promise<GoogleCalendarSetting> {
  const setting = await getGoogleSetting();
  if (!setting.url) return setting;
  const stale = !setting.lastSyncAt || Date.now() - new Date(setting.lastSyncAt).getTime() > AUTO_SYNC_MINUTES * 60 * 1000;
  if (!stale) return setting;
  return syncGoogleCalendar(null).catch(() => setting);
}
