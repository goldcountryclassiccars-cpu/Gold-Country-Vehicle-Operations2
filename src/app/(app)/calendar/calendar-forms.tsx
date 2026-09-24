"use client";

import { useActionState } from "react";
import {
  addShiftAction,
  addTimeOffAction,
  createEventAction,
  saveGoogleUrlAction,
  type CalendarFormState,
} from "@/modules/calendar/actions";
import { inputClass } from "@/components/ui";

function Alert({ state }: { state: CalendarFormState }) {
  if (!state.error) return null;
  return (
    <p className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{state.error}</p>
  );
}

const buttonClass =
  "min-h-11 rounded-md bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:opacity-60";

export function AddEventForm({ day }: { day: string }) {
  const [state, formAction, pending] = useActionState<CalendarFormState, FormData>(createEventAction, {});
  return (
    <form key={state.saved ?? 0} action={formAction} className="space-y-2">
      <Alert state={state} />
      <input type="hidden" name="day" value={day} />
      <label htmlFor="ev-title" className="block text-xs font-medium text-stone-600">Title</label>
      <input id="ev-title" name="title" required placeholder="e.g. Test drive — '65 Mustang, John B." className={inputClass + " mt-0"} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="ev-time" className="block text-xs font-medium text-stone-600">Time</label>
          <input id="ev-time" name="time" placeholder="2:30 PM (blank = all day)" className={inputClass + " mt-0"} />
        </div>
        <div>
          <label htmlFor="ev-end" className="block text-xs font-medium text-stone-600">Ends</label>
          <input id="ev-end" name="endTime" placeholder="3:30 PM (optional)" className={inputClass + " mt-0"} />
        </div>
      </div>
      <label htmlFor="ev-loc" className="block text-xs font-medium text-stone-600">Location (optional)</label>
      <input id="ev-loc" name="location" className={inputClass + " mt-0"} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Adding…" : "Add appointment"}
      </button>
    </form>
  );
}

export function AddShiftForm({ day, users }: { day: string; users: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<CalendarFormState, FormData>(addShiftAction, {});
  return (
    <form key={state.saved ?? 0} action={formAction} className="space-y-2">
      <Alert state={state} />
      <input type="hidden" name="day" value={day} />
      <label htmlFor="sh-user" className="block text-xs font-medium text-stone-600">Who</label>
      <select id="sh-user" name="userId" required defaultValue="" className={inputClass + " mt-0"}>
        <option value="" disabled>Pick a person…</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
      <label htmlFor="sh-hours" className="block text-xs font-medium text-stone-600">Hours (optional)</label>
      <input id="sh-hours" name="hours" placeholder="e.g. 9–5" className={inputClass + " mt-0"} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Adding…" : "Schedule for this day"}
      </button>
    </form>
  );
}

export function AddTimeOffForm({ day, users }: { day: string; users: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState<CalendarFormState, FormData>(addTimeOffAction, {});
  return (
    <form key={state.saved ?? 0} action={formAction} className="space-y-2">
      <Alert state={state} />
      <label htmlFor="to-user" className="block text-xs font-medium text-stone-600">Who</label>
      <select id="to-user" name="userId" required defaultValue="" className={inputClass + " mt-0"}>
        <option value="" disabled>Pick a person…</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>{u.name}</option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="to-start" className="block text-xs font-medium text-stone-600">First day</label>
          <input id="to-start" name="startDay" type="date" required defaultValue={day} className={inputClass + " mt-0"} />
        </div>
        <div>
          <label htmlFor="to-end" className="block text-xs font-medium text-stone-600">Last day</label>
          <input id="to-end" name="endDay" type="date" className={inputClass + " mt-0"} />
        </div>
      </div>
      <label htmlFor="to-kind" className="block text-xs font-medium text-stone-600">Kind</label>
      <select id="to-kind" name="kind" defaultValue="TIME_OFF" className={inputClass + " mt-0"}>
        <option value="TIME_OFF">Time off</option>
        <option value="VACATION">Vacation</option>
      </select>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Adding…" : "Add time off"}
      </button>
    </form>
  );
}

export function GoogleUrlForm({ currentHost }: { currentHost: string | null }) {
  const [state, formAction, pending] = useActionState<CalendarFormState, FormData>(saveGoogleUrlAction, {});
  return (
    <form key={state.saved ?? 0} action={formAction} className="space-y-2">
      <Alert state={state} />
      <p className="text-xs text-stone-600">
        In Google Calendar (on a computer): Settings → pick your calendar → <strong>Integrate calendar</strong> →
        copy the <strong>Secret address in iCal format</strong> and paste it here. The link is a key to reading the
        calendar — the app stores it, shows only the site name back, and never writes to your Google Calendar.
      </p>
      {currentHost ? (
        <p className="text-xs text-stone-500">Currently connected to <strong>{currentHost}</strong>. Pasting a new address replaces it; saving empty disconnects and removes the mirrored appointments.</p>
      ) : null}
      <label htmlFor="g-url" className="block text-xs font-medium text-stone-600">Secret iCal address</label>
      <input id="g-url" name="url" type="password" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" className={inputClass + " mt-0"} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Connecting…" : currentHost ? "Save" : "Connect Google Calendar"}
      </button>
    </form>
  );
}
