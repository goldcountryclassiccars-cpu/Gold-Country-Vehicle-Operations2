"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import {
  addShift,
  addTimeOff,
  CalendarError,
  createEvent,
  deleteEvent,
  removeShift,
  removeTimeOff,
  setGoogleUrl,
  syncGoogleCalendar,
} from "./service";

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

/** Every add-form reports its outcome; nothing on this page fails silently. */
export interface CalendarFormState {
  error?: string;
  saved?: number; // increments so the form can reset after each success
}

function back(day?: string | null) {
  revalidatePath("/calendar");
  return day; // callers ignore; path revalidation is what matters
}

const eventSchema = z.object({
  title: z.string().trim().min(1, "Give the appointment a title"),
  day: DAY,
  time: z.preprocess(emptyToUndef, z.string().optional()),
  endTime: z.preprocess(emptyToUndef, z.string().optional()),
  location: z.preprocess(emptyToUndef, z.string().optional()),
  notes: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function createEventAction(prev: CalendarFormState, formData: FormData): Promise<CalendarFormState> {
  const user = await getSessionUser();
  requirePermission(user, "create", "calendar");
  const parsed = eventSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  try {
    await createEvent(user, parsed.data);
  } catch (e) {
    if (e instanceof CalendarError) return { error: e.message };
    throw e;
  }
  back(parsed.data.day);
  return { saved: (prev.saved ?? 0) + 1 };
}

export async function deleteEventAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "calendar");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await deleteEvent(user, id);
  } catch (e) {
    if (e instanceof CalendarError) return;
    throw e;
  }
  back();
}

const shiftSchema = z.object({
  userId: z.string().uuid("Pick a person"),
  day: DAY,
  hours: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function addShiftAction(prev: CalendarFormState, formData: FormData): Promise<CalendarFormState> {
  const user = await getSessionUser();
  requirePermission(user, "create", "calendar");
  const parsed = shiftSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  try {
    await addShift(user, parsed.data);
  } catch (e) {
    if (e instanceof CalendarError) return { error: e.message };
    throw e;
  }
  back(parsed.data.day);
  return { saved: (prev.saved ?? 0) + 1 };
}

export async function removeShiftAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "calendar");
  const id = String(formData.get("id") ?? "");
  if (id) await removeShift(user, id);
  back();
}

const timeOffSchema = z.object({
  userId: z.string().uuid("Pick a person"),
  startDay: DAY,
  endDay: z.preprocess(emptyToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  kind: z.enum(["VACATION", "TIME_OFF"]),
  note: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function addTimeOffAction(prev: CalendarFormState, formData: FormData): Promise<CalendarFormState> {
  const user = await getSessionUser();
  requirePermission(user, "create", "calendar");
  const parsed = timeOffSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form" };
  try {
    await addTimeOff(user, parsed.data);
  } catch (e) {
    if (e instanceof CalendarError) return { error: e.message };
    throw e;
  }
  back(parsed.data.startDay);
  return { saved: (prev.saved ?? 0) + 1 };
}

export async function removeTimeOffAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "edit", "calendar");
  const id = String(formData.get("id") ?? "");
  if (id) await removeTimeOff(user, id);
  back();
}

// --- Google sync (Admin only — the secret address is a credential) ----------

export async function saveGoogleUrlAction(prev: CalendarFormState, formData: FormData): Promise<CalendarFormState> {
  const user = await getSessionUser();
  requirePermission(user, "manage_config", "admin");
  const url = String(formData.get("url") ?? "").trim();
  try {
    await setGoogleUrl(user, url || null);
    if (url) await syncGoogleCalendar(user); // first sync right away; result shows on the page
  } catch (e) {
    if (e instanceof CalendarError) return { error: e.message };
    throw e;
  }
  back();
  return { saved: (prev.saved ?? 0) + 1 };
}

export async function syncNowAction() {
  const user = await getSessionUser();
  requirePermission(user, "manage_config", "admin");
  await syncGoogleCalendar(user);
  back();
}
