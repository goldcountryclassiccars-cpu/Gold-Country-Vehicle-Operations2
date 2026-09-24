import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { dealershipDayString, dealershipTimeString, storeDay } from "@/lib/dealership-date";
import { autoSyncIfStale, getMonthData, type CalendarDay } from "@/modules/calendar/service";
import { deleteEventAction, removeShiftAction, removeTimeOffAction, syncNowAction } from "@/modules/calendar/actions";
import { AddEventForm, AddShiftForm, AddTimeOffForm, GoogleUrlForm } from "./calendar-forms";
import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Calendar" };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthLabel(monthStart: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(storeDay(monthStart));
}
function dayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(storeDay(day));
}
function shiftMonth(monthStr: string, delta: number): string {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1, 12));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function eventTime(e: { startsAt: Date; allDay: boolean }): string {
  return e.allDay ? "All day" : dealershipTimeString(e.startsAt).split(", ")[1] ?? "";
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; d?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "calendar");

  const today = dealershipDayString(new Date());
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.m ?? "") ? params.m! : today.slice(0, 7);
  const selected = /^\d{4}-\d{2}-\d{2}$/.test(params.d ?? "") ? params.d! : month === today.slice(0, 7) ? today : null;

  const canManage = hasPermission(user, "calendar", "create");
  const isAdmin = hasPermission(user, "admin", "manage_config");

  // Keep the Google mirror fresh — quietly, never blocking the page on failure.
  const google = await autoSyncIfStale().catch(() => null);

  const { gridDays } = await getMonthData(month);
  const selectedDay = selected ? (gridDays.find((g) => g.day === selected) ?? null) : null;
  const users = canManage
    ? await db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];
  const userOptions = users.map((u) => ({ id: u.id, name: u.name.replace(/ \(Demo\)$/, "") }));

  const dayHref = (g: CalendarDay) => `/calendar?m=${month}&d=${g.day}#day`;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Calendar"
        subtitle="Appointments, who's working, and time off — one month at a glance. Tap a day for the details."
        actions={
          <div className="flex items-center gap-1">
            <Link href={`/calendar?m=${shiftMonth(month, -1)}`} aria-label="Previous month" className="min-h-11 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-50">←</Link>
            <Link href={`/calendar?m=${today.slice(0, 7)}&d=${today}#day`} className="min-h-11 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-50">Today</Link>
            <Link href={`/calendar?m=${shiftMonth(month, 1)}`} aria-label="Next month" className="min-h-11 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-50">→</Link>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-stone-900">{monthLabel(`${month}-01`)}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-brand-600" aria-hidden /> Appointment</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sky-500" aria-hidden /> From Google</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" aria-hidden /> Time off</span>
          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" aria-hidden /> Vacation</span>
        </div>
      </div>

      <Card className="p-2 sm:p-3">
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md bg-stone-200" role="grid" aria-label={`Calendar for ${monthLabel(`${month}-01`)}`}>
          {WEEKDAYS.map((w) => (
            <div key={w} className="bg-stone-50 px-1 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              {w}
            </div>
          ))}
          {gridDays.map((g) => {
            const inMonth = g.day.slice(0, 7) === month;
            const isToday = g.day === today;
            const isSelected = g.day === selected;
            const shownEvents = g.events.slice(0, 3);
            return (
              <Link
                key={g.day}
                href={dayHref(g)}
                aria-label={`${dayLabel(g.day)}: ${g.events.length} appointment(s), ${g.shifts.length} working, ${g.timeOff.length} off`}
                className={`block min-h-[68px] p-1 align-top sm:min-h-[104px] sm:p-1.5 ${
                  isSelected ? "bg-brand-50 ring-2 ring-inset ring-brand-600" : inMonth ? "bg-white hover:bg-stone-50" : "bg-stone-50/70 hover:bg-stone-100"
                }`}
              >
                <div className="flex items-start justify-between">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      isToday ? "bg-brand-700 text-white" : inMonth ? "text-stone-800" : "text-stone-400"
                    }`}
                  >
                    {Number(g.day.slice(8, 10))}
                  </span>
                  {/* Phone: dots instead of chips */}
                  {g.events.length > 0 ? (
                    <span className="flex gap-0.5 sm:hidden" aria-hidden>
                      {g.events.slice(0, 3).map((e) => (
                        <span key={e.id} className={`h-1.5 w-1.5 rounded-full ${e.source === "GOOGLE" ? "bg-sky-500" : "bg-brand-600"}`} />
                      ))}
                    </span>
                  ) : null}
                </div>

                {/* Time off first — it should be the loudest thing in the cell */}
                {g.timeOff.map((t) => (
                  <p
                    key={`${t.id}-${g.day}`}
                    className={`mt-0.5 truncate rounded border-l-2 px-1 text-[10px] font-semibold leading-4 ${
                      t.kind === "VACATION" ? "border-rose-500 bg-rose-100 text-rose-900" : "border-amber-500 bg-amber-100 text-amber-900"
                    }`}
                  >
                    {t.userName.split(" ")[0]} · {t.kind === "VACATION" ? "vacation" : "off"}
                  </p>
                ))}

                <div className="hidden sm:block">
                  {shownEvents.map((e) => (
                    <p
                      key={e.id}
                      className={`mt-0.5 truncate rounded px-1 text-[10px] leading-4 ${
                        e.source === "GOOGLE" ? "bg-sky-100 text-sky-900" : "bg-brand-100 text-brand-800"
                      }`}
                    >
                      {e.allDay ? "" : `${eventTime(e)} `}
                      {e.title}
                    </p>
                  ))}
                  {g.events.length > 3 ? <p className="mt-0.5 px-1 text-[10px] text-stone-500">+{g.events.length - 3} more</p> : null}
                  {g.shifts.length > 0 ? (
                    <p className="mt-0.5 truncate px-1 text-[10px] leading-4 text-stone-500">
                      👤 {g.shifts.map((s) => s.userName.split(" ")[0]).slice(0, 3).join(", ")}
                      {g.shifts.length > 3 ? ` +${g.shifts.length - 3}` : ""}
                    </p>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      </Card>

      {selectedDay ? (
        <section id="day" className="mt-6">
          <h2 className="text-lg font-semibold text-stone-900">{dayLabel(selectedDay.day)}</h2>
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            <Card accent="brand">
              <h3 className="mb-2 text-sm font-semibold text-stone-900">Appointments</h3>
              {selectedDay.events.length === 0 ? (
                <p className="text-sm text-stone-500">Nothing scheduled.</p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {selectedDay.events.map((e) => (
                    <li key={e.id} className="flex items-start justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-stone-900">
                          <span className="mr-1.5 font-semibold text-brand-700">{eventTime(e)}</span>
                          {e.title}
                        </p>
                        {e.location ? <p className="text-xs text-stone-500">{e.location}</p> : null}
                        {e.notes ? <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs text-stone-500">{e.notes}</p> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {e.source === "GOOGLE" ? (
                          <Badge tone="blue" title="Mirrored from Google Calendar — manage it there">Google</Badge>
                        ) : canManage ? (
                          <form action={deleteEventAction}>
                            <input type="hidden" name="id" value={e.id} />
                            <button type="submit" className="min-h-8 rounded px-1.5 text-xs text-stone-400 hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${e.title}`}>
                              Remove
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {canManage ? (
                <details className="mt-3 border-t border-stone-100 pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline">Add appointment</summary>
                  <div className="mt-2"><AddEventForm day={selectedDay.day} /></div>
                </details>
              ) : null}
            </Card>

            <Card accent="teal">
              <h3 className="mb-2 text-sm font-semibold text-stone-900">Working this day</h3>
              {selectedDay.shifts.length === 0 ? (
                <p className="text-sm text-stone-500">Nobody scheduled yet.</p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {selectedDay.shifts.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                      <p className="text-sm text-stone-900">
                        {s.userName}
                        {s.hours ? <span className="ml-1.5 text-xs text-stone-500">{s.hours}</span> : null}
                      </p>
                      {canManage ? (
                        <form action={removeShiftAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <button type="submit" className="min-h-8 rounded px-1.5 text-xs text-stone-400 hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${s.userName}'s shift`}>
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canManage ? (
                <details className="mt-3 border-t border-stone-100 pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline">Schedule someone</summary>
                  <div className="mt-2"><AddShiftForm day={selectedDay.day} users={userOptions} /></div>
                </details>
              ) : null}
            </Card>

            <Card accent="amber">
              <h3 className="mb-2 text-sm font-semibold text-stone-900">Time off</h3>
              {selectedDay.timeOff.length === 0 ? (
                <p className="text-sm text-stone-500">Everyone&rsquo;s available.</p>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {selectedDay.timeOff.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                      <div>
                        <p className="text-sm text-stone-900">
                          {t.userName}
                          <Badge tone={t.kind === "VACATION" ? "red" : "amber"}>{t.kind === "VACATION" ? "vacation" : "time off"}</Badge>
                        </p>
                        <p className="text-xs text-stone-500">
                          {t.startDay === t.endDay ? "Just this day" : `${t.startDay} → ${t.endDay}`}
                          {t.note ? ` · ${t.note}` : ""}
                        </p>
                      </div>
                      {canManage ? (
                        <form action={removeTimeOffAction}>
                          <input type="hidden" name="id" value={t.id} />
                          <button type="submit" className="min-h-8 rounded px-1.5 text-xs text-stone-400 hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${t.userName}'s time off`}>
                            Remove
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canManage ? (
                <details className="mt-3 border-t border-stone-100 pt-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline">Add time off</summary>
                  <div className="mt-2"><AddTimeOffForm day={selectedDay.day} users={userOptions} /></div>
                </details>
              ) : null}
            </Card>
          </div>
        </section>
      ) : null}

      {isAdmin ? (
        <Card className="mt-6" accent="blue">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-stone-900">Google Calendar</h3>
              {google?.url ? (
                google.lastError ? (
                  <p className="text-xs text-red-700">Last sync failed: {google.lastError}</p>
                ) : google.lastSyncAt ? (
                  <p className="text-xs text-stone-500">
                    Synced {dealershipTimeString(new Date(google.lastSyncAt))} · {google.lastCount} appointment{google.lastCount === 1 ? "" : "s"} mirrored
                    {google.unsupportedRules > 0 ? ` · ${google.unsupportedRules} repeating pattern(s) only partly supported` : ""}
                  </p>
                ) : (
                  <p className="text-xs text-stone-500">Connected — first sync pending.</p>
                )
              ) : (
                <p className="text-xs text-stone-500">Not connected. Appointments from your Google Calendar can appear here automatically (read-only).</p>
              )}
            </div>
            {google?.url ? (
              <form action={syncNowAction}>
                <button type="submit" className="min-h-11 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-50">
                  Sync now
                </button>
              </form>
            ) : null}
          </div>
          <details className="mt-3 border-t border-stone-100 pt-3">
            <summary className="cursor-pointer text-sm font-medium text-brand-700 hover:underline">
              {google?.url ? "Change or disconnect" : "Connect Google Calendar"}
            </summary>
            <div className="mt-2 max-w-xl">
              <GoogleUrlForm currentHost={google?.url ? new URL(google.url).host : null} />
            </div>
          </details>
        </Card>
      ) : null}
    </div>
  );
}
