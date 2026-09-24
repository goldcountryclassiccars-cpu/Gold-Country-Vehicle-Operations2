/**
 * A small iCalendar (.ics) reader for the Google Calendar sync.
 *
 * Hand-written for the same reason as the CSV reader: the format's real-world
 * quirks are few, known, and each deserves its own test — line folding, escaped
 * text, three flavors of DTSTART (UTC, TZID-local, all-day), recurrence rules,
 * exception dates, and per-instance overrides (RECURRENCE-ID).
 *
 * Recurrence support is deliberately bounded: DAILY / WEEKLY (with BYDAY) /
 * MONTHLY (same day-of-month) / YEARLY, with INTERVAL, COUNT and UNTIL. A rule
 * using parts beyond that (BYSETPOS, BYMONTHDAY lists, …) is not guessed at —
 * the event is imported at its first occurrence inside the window and marked,
 * and the sync result counts it, so an unsupported pattern is visible rather
 * than silently wrong.
 */

export interface IcsRawEvent {
  uid: string;
  summary: string;
  /** UTC instant for timed events; noon-UTC day for all-day events. */
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  status: string | null;
  rrule: string | null;
  /** EXDATE values, normalized to instance keys (ms timestamps). */
  exdates: number[];
  /** RECURRENCE-ID instance key when this VEVENT overrides one occurrence. */
  recurrenceId: number | null;
}

export interface IcsInstance {
  uid: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  location: string | null;
  notes: string | null;
}

export interface IcsExpandResult {
  instances: IcsInstance[];
  /** UIDs whose RRULE used parts we do not expand. */
  unsupportedRules: string[];
}

// --- line-level parsing ------------------------------------------------------

/** RFC 5545 line unfolding: a line starting with space/tab continues the previous. */
export function unfoldIcsLines(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      out.push(line);
    }
  }
  return out;
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseProp(line: string): Prop | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: (name ?? "").toUpperCase(), params, value };
}

// --- date handling -----------------------------------------------------------

/** Offset of `tz` from UTC at `date`, in milliseconds. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour! === 24 ? 0 : parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return asUtc - date.getTime();
}

/** Interprets a wall-clock time in `tz` as a UTC instant. */
export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  hh: number,
  mm: number,
  ss: number,
  tz: string,
): Date {
  let utc = Date.UTC(y, mo - 1, d, hh, mm, ss);
  // Two passes converge across DST boundaries.
  for (let i = 0; i < 2; i++) {
    utc = Date.UTC(y, mo - 1, d, hh, mm, ss) - tzOffsetMs(new Date(utc), tz);
  }
  return new Date(utc);
}

/** All-day days are stored as noon UTC, same convention as dealership-date.ts. */
function dayToNoonUtc(y: number, mo: number, d: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
}

const DT_RE = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/;

function parseDt(value: string, params: Record<string, string>): { date: Date; allDay: boolean } | null {
  const m = DT_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (params.VALUE === "DATE" || hh === undefined) {
    return { date: dayToNoonUtc(Number(y), Number(mo), Number(d)), allDay: true };
  }
  if (z) {
    return { date: new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss))), allDay: false };
  }
  // Floating or TZID-local wall clock. Google always sends TZID for these.
  const tz = params.TZID ?? "UTC";
  return { date: zonedToUtc(Number(y), Number(mo), Number(d), Number(hh), Number(mm!), Number(ss!), tz), allDay: false };
}

// --- VEVENT extraction ---------------------------------------------------------

export function parseIcs(text: string): IcsRawEvent[] {
  const lines = unfoldIcsLines(text);
  const events: IcsRawEvent[] = [];
  let cur: Partial<IcsRawEvent> & { exdates: number[] } = { exdates: [] };
  let inEvent = false;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      cur = { exdates: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      inEvent = false;
      if (cur.uid && cur.summary !== undefined && cur.startsAt) {
        events.push({
          uid: cur.uid,
          summary: cur.summary || "(no title)",
          startsAt: cur.startsAt,
          endsAt: cur.endsAt ?? null,
          allDay: cur.allDay ?? false,
          location: cur.location ?? null,
          description: cur.description ?? null,
          status: cur.status ?? null,
          rrule: cur.rrule ?? null,
          exdates: cur.exdates,
          recurrenceId: cur.recurrenceId ?? null,
        });
      }
      continue;
    }
    if (!inEvent) continue;

    const prop = parseProp(line);
    if (!prop) continue;
    switch (prop.name) {
      case "UID":
        cur.uid = prop.value.trim();
        break;
      case "SUMMARY":
        cur.summary = unescapeText(prop.value).trim();
        break;
      case "LOCATION":
        cur.location = unescapeText(prop.value).trim() || null;
        break;
      case "DESCRIPTION":
        cur.description = unescapeText(prop.value).trim() || null;
        break;
      case "STATUS":
        cur.status = prop.value.trim().toUpperCase();
        break;
      case "RRULE":
        cur.rrule = prop.value.trim();
        break;
      case "DTSTART": {
        const dt = parseDt(prop.value, prop.params);
        if (dt) {
          cur.startsAt = dt.date;
          cur.allDay = dt.allDay;
        }
        break;
      }
      case "DTEND": {
        const dt = parseDt(prop.value, prop.params);
        if (dt) cur.endsAt = dt.date;
        break;
      }
      case "EXDATE": {
        for (const v of prop.value.split(",")) {
          const dt = parseDt(v, prop.params);
          if (dt) cur.exdates.push(dt.date.getTime());
        }
        break;
      }
      case "RECURRENCE-ID": {
        const dt = parseDt(prop.value, prop.params);
        if (dt) cur.recurrenceId = dt.date.getTime();
        break;
      }
    }
  }
  return events;
}

// --- recurrence expansion ------------------------------------------------------

const BYDAY_TO_DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const SUPPORTED_RRULE_KEYS = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "WKST"]);

function parseRrule(rrule: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of rrule.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return out;
}

/**
 * Expands events into concrete instances inside [windowStart, windowEnd].
 * Cancelled events are dropped; RECURRENCE-ID overrides replace the matching
 * generated occurrence.
 */
export function expandIcsEvents(events: IcsRawEvent[], windowStart: Date, windowEnd: Date): IcsExpandResult {
  const instances: IcsInstance[] = [];
  const unsupportedRules: string[] = [];

  // Per-instance overrides, keyed by uid + original occurrence time.
  const overrides = new Map<string, IcsRawEvent>();
  for (const e of events) {
    if (e.recurrenceId !== null) overrides.set(`${e.uid}@${e.recurrenceId}`, e);
  }

  const pushInstance = (base: IcsRawEvent, startsAt: Date, endsAt: Date | null) => {
    if (startsAt < windowStart || startsAt > windowEnd) return;
    const override = overrides.get(`${base.uid}@${startsAt.getTime()}`);
    const source = override ?? base;
    if (source.status === "CANCELLED") return;
    const start = override ? override.startsAt : startsAt;
    const end = override ? override.endsAt : endsAt;
    instances.push({
      uid: base.uid,
      title: source.summary,
      startsAt: start,
      endsAt: end,
      allDay: source.allDay,
      location: source.location,
      notes: source.description,
    });
  };

  for (const e of events) {
    if (e.recurrenceId !== null) continue; // consumed as overrides
    if (e.status === "CANCELLED") continue;
    const durationMs = e.endsAt ? e.endsAt.getTime() - e.startsAt.getTime() : null;

    if (!e.rrule) {
      pushInstance(e, e.startsAt, e.endsAt);
      continue;
    }

    const rule = parseRrule(e.rrule);
    const freq = rule.FREQ;
    const hasUnsupported =
      Object.keys(rule).some((k) => !SUPPORTED_RRULE_KEYS.has(k)) ||
      !freq ||
      !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq) ||
      (rule.BYDAY !== undefined && freq !== "WEEKLY");
    if (hasUnsupported) {
      unsupportedRules.push(e.uid);
      // Import the first occurrence at/after the window start, honestly labeled.
      const first = e.startsAt >= windowStart ? e.startsAt : windowStart;
      instances.push({
        uid: e.uid,
        title: `${e.summary} (repeats — pattern not fully supported)`,
        startsAt: e.startsAt >= windowStart ? e.startsAt : first,
        endsAt: e.startsAt >= windowStart ? e.endsAt : null,
        allDay: e.allDay,
        location: e.location,
        notes: e.description,
      });
      continue;
    }

    const interval = Math.max(1, Number(rule.INTERVAL ?? "1") || 1);
    const count = rule.COUNT ? Number(rule.COUNT) : null;
    let until: Date | null = null;
    if (rule.UNTIL) {
      const dt = parseDt(rule.UNTIL, {});
      until = dt ? dt.date : null;
    }
    const exdates = new Set(e.exdates);

    const byday =
      freq === "WEEKLY" && rule.BYDAY
        ? rule.BYDAY.split(",").map((d) => BYDAY_TO_DOW[d.trim()]).filter((d): d is number => d !== undefined)
        : null;

    let produced = 0;
    let guard = 0;
    const cursor = new Date(e.startsAt);

    while (guard++ < 1000) {
      if (until && cursor > until) break;
      if (count !== null && produced >= count) break;
      if (cursor > windowEnd) break;

      const matchesByday = !byday || byday.includes(cursor.getUTCDay());
      if (matchesByday) {
        produced += 1; // COUNT counts occurrences from DTSTART, in or out of window
        if (!exdates.has(cursor.getTime())) {
          pushInstance(e, new Date(cursor), durationMs !== null ? new Date(cursor.getTime() + durationMs) : null);
        }
      }

      // advance
      if (freq === "DAILY") {
        cursor.setUTCDate(cursor.getUTCDate() + interval);
      } else if (freq === "WEEKLY") {
        if (byday) {
          // step day by day; jump interval weeks at each week boundary from start
          const prevWeek = weekIndex(e.startsAt, cursor);
          cursor.setUTCDate(cursor.getUTCDate() + 1);
          const nowWeek = weekIndex(e.startsAt, cursor);
          if (nowWeek !== prevWeek && interval > 1) {
            cursor.setUTCDate(cursor.getUTCDate() + 7 * (interval - 1));
          }
        } else {
          cursor.setUTCDate(cursor.getUTCDate() + 7 * interval);
        }
      } else if (freq === "MONTHLY") {
        cursor.setUTCMonth(cursor.getUTCMonth() + interval);
      } else {
        cursor.setUTCFullYear(cursor.getUTCFullYear() + interval);
      }
    }
  }

  instances.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { instances, unsupportedRules: [...new Set(unsupportedRules)] };
}

/** Whole weeks elapsed since the week containing `origin` (Sunday-based). */
function weekIndex(origin: Date, d: Date): number {
  const originWeekStart = new Date(origin);
  originWeekStart.setUTCDate(originWeekStart.getUTCDate() - originWeekStart.getUTCDay());
  originWeekStart.setUTCHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - originWeekStart.getTime()) / (7 * 24 * 3600 * 1000));
}
