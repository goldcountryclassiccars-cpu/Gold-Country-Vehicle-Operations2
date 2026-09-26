/**
 * Parts & Supplies — a shared "we need this" list.
 *
 * Kept deliberately small (Jade, 2026-09-26: "keep it simple, just a note of
 * what is needed and who requested it"): a mechanic needs a part or a tool,
 * detail needs supplies — somebody writes it down, somebody orders it and
 * ticks it off. No quantities, vendors, prices or vehicle links; those can be
 * typed into the note if they matter.
 *
 * "Requested by" is a typed name, not the login: the shop floor works from one
 * shared iPad account, so the login would say "Shop" for everyone. The login
 * is still recorded (createdById) and every change is audited.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/authz/types";

export class PartsError extends Error {}

/** How long a ticked-off item stays visible under "Ordered" before dropping off the page. */
export const ORDERED_VISIBLE_DAYS = 30;

const MAX_DESCRIPTION = 500;
const MAX_NAME = 80;

export async function createPartRequest(
  user: SessionUser,
  input: { description: string; requestedByName: string },
) {
  const description = input.description.trim();
  const requestedByName = input.requestedByName.trim();
  if (!description) throw new PartsError("Say what's needed.");
  if (!requestedByName) throw new PartsError("Put your name in “Requested by” so whoever orders it knows who to ask.");
  if (description.length > MAX_DESCRIPTION) throw new PartsError(`Keep the note under ${MAX_DESCRIPTION} characters.`);
  if (requestedByName.length > MAX_NAME) throw new PartsError("That name is too long.");

  const row = await db.partRequest.create({
    data: { description, requestedByName, createdById: user.id },
  });
  await audit(user, {
    action: "parts.request_create",
    resourceType: "part_request",
    resourceId: row.id,
    newValues: { description, requestedByName },
  });
  return row;
}

/**
 * Tick or untick "ordered". Unticking exists because a mis-tap on a phone is
 * common and should be undoable without asking an Admin.
 */
export async function setPartOrdered(user: SessionUser, id: string, ordered: boolean) {
  const row = await db.partRequest.findUnique({ where: { id } });
  if (!row || row.archivedAt) throw new PartsError("That item is no longer on the list.");
  if (ordered === (row.orderedAt !== null)) return row; // already in the desired state

  const updated = await db.partRequest.update({
    where: { id },
    data: ordered
      ? { orderedAt: new Date(), orderedById: user.id, orderedByName: user.name }
      : { orderedAt: null, orderedById: null, orderedByName: null },
  });
  await audit(user, {
    action: ordered ? "parts.request_ordered" : "parts.request_unordered",
    resourceType: "part_request",
    resourceId: id,
    previousValues: { orderedAt: row.orderedAt, orderedByName: row.orderedByName },
    newValues: { orderedAt: updated.orderedAt, orderedByName: updated.orderedByName },
  });
  return updated;
}

/** Take an item off the list (added by mistake, or no longer needed). Soft — the row and audit stay. */
export async function removePartRequest(user: SessionUser, id: string) {
  const row = await db.partRequest.findUnique({ where: { id } });
  if (!row || row.archivedAt) return; // already gone — the desired state
  await db.partRequest.update({ where: { id }, data: { archivedAt: new Date(), archivedById: user.id } });
  await audit(user, {
    action: "parts.request_remove",
    resourceType: "part_request",
    resourceId: id,
    previousValues: { description: row.description, requestedByName: row.requestedByName },
  });
}

/** Still needed (oldest first — it has waited longest) and recently ordered (newest first). */
export async function listPartRequests(now: Date = new Date()) {
  const since = new Date(now.getTime() - ORDERED_VISIBLE_DAYS * 24 * 60 * 60 * 1000);
  const [needed, ordered] = await Promise.all([
    db.partRequest.findMany({
      where: { archivedAt: null, orderedAt: null },
      orderBy: { createdAt: "asc" },
    }),
    db.partRequest.findMany({
      where: { archivedAt: null, orderedAt: { gte: since } },
      orderBy: { orderedAt: "desc" },
    }),
  ]);
  return { needed, ordered };
}

export async function countPartsNeeded() {
  return db.partRequest.count({ where: { archivedAt: null, orderedAt: null } });
}
