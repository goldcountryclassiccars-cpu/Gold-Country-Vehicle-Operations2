/**
 * Calendar days at the dealership.
 *
 * A sale date is a *day*, not an instant, and the difference is not academic:
 * a contract written up at 5pm on 2026-09-30 in Grass Valley is already
 * 2026-10-01 in UTC, and 2026-10-01 is the day the Contract Cancellation Option
 * is replaced by the 3-Day Right to Cancel. Storing that timestamp raw hands
 * the deal the wrong statutory notice, and nothing about the deal looks wrong
 * afterwards.
 *
 * The convention, applied at every write:
 *
 *   a day is stored as **noon UTC** on that day.
 *
 * Noon is far enough from either midnight that no timezone in use can shift the
 * date, so reading the day back with `toISOString().slice(0, 10)` is always
 * correct — which lets the rule engine stay pure and timezone-free.
 */
export const DEALERSHIP_TIME_ZONE = "America/Los_Angeles";

const DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEALERSHIP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Which calendar day an instant falls on at the dealership. "2026-09-30". */
export function dealershipDayString(instant: Date): string {
  return DAY_FORMAT.format(instant);
}

/**
 * Normalises a day — or the day an instant falls on here — to noon UTC.
 *
 * Pass a "YYYY-MM-DD" string straight from a date input, or a Date from
 * `new Date()`; both come back as the same unambiguous stored value.
 */
export function storeDay(day: string | Date): Date {
  const iso = typeof day === "string" ? day.slice(0, 10) : dealershipDayString(day);
  return new Date(`${iso}T12:00:00.000Z`);
}

/** Reads a stored day back as "YYYY-MM-DD". */
export function readDay(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}
