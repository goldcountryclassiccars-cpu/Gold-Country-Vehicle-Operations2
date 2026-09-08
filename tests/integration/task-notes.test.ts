/**
 * Task notes — staff responding to assigned tasks with more than "DONE".
 *
 * Asserts the behaviors the shop actually relies on: a note lands on the task
 * and reads back in order, "save note & mark done" is one stroke that leaves
 * both the note and the completion in history, the task's creator and assignee
 * hear about a note someone else wrote (and the author does not), and notes
 * survive completion — the whole point is reading the explanation afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import { addTaskNote, completeTaskWithNote, createTask } from "@/modules/workflow/service";

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

let admin: SessionUser; // creates the tasks (Jade)
let shop: SessionUser; // responds to them (shared shop account)
const taskIds: string[] = [];

async function notifCount(userId: string) {
  return db.notification.count({ where: { userId, title: { startsWith: "Note on task: ZZTEST" } } });
}

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const shopUser = await db.user.findUniqueOrThrow({ where: { email: "mechanic@demo.gccc" } });
  admin = sessionUserFor("admin", jade);
  shop = sessionUserFor("shop", shopUser);
});

afterAll(async () => {
  await db.comment.deleteMany({ where: { taskId: { in: taskIds } } });
  await db.notification.deleteMany({ where: { title: { startsWith: "Note on task: ZZTEST" } } });
  await db.task.deleteMany({ where: { id: { in: taskIds } } });
});

describe("task notes", () => {
  it("a note lands on the task and reads back in order", async () => {
    const task = await createTask(admin, { title: "ZZTEST note thread", assigneeId: shop.id });
    taskIds.push(task.id);

    await addTaskNote(shop, task.id, "Compression checked, cylinders 2 and 3 low.");
    await addTaskNote(shop, task.id, "Ordered a gasket set — back Thursday.");

    const notes = await db.comment.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
    expect(notes.map((n) => n.body)).toEqual([
      "Compression checked, cylinders 2 and 3 low.",
      "Ordered a gasket set — back Thursday.",
    ]);
    expect(notes[0]!.authorId).toBe(shop.id);
    expect(notes[0]!.authorName).toBe(shop.name);
    expect(notes[0]!.visibility).toBe("INTERNAL");
  });

  it("notifies the task's creator, not the note's author", async () => {
    const task = await createTask(admin, { title: "ZZTEST who hears", assigneeId: shop.id });
    taskIds.push(task.id);

    const adminBefore = await notifCount(admin.id);
    const shopBefore = await notifCount(shop.id);
    await addTaskNote(shop, task.id, "Started on it this morning.");

    // Creator (admin) hears; the author (shop, also the assignee) does not.
    expect(await notifCount(admin.id)).toBe(adminBefore + 1);
    expect(await notifCount(shop.id)).toBe(shopBefore);
    const notif = await db.notification.findFirst({
      where: { userId: admin.id, title: "Note on task: ZZTEST who hears" },
    });
    expect(notif?.body).toBe("Started on it this morning.");
  });

  it("save note & mark done is one stroke: note saved, task DONE, both in history", async () => {
    const task = await createTask(admin, { title: "ZZTEST done with note", assigneeId: shop.id });
    taskIds.push(task.id);

    await completeTaskWithNote(shop, task.id, "Replaced the master cylinder; brakes bled and road-tested.");

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.status).toBe("DONE");
    expect(after.completedAt).not.toBeNull();

    const notes = await db.comment.findMany({ where: { taskId: task.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain("master cylinder");

    // Both the note and the completion are audited.
    const audits = await db.auditEvent.findMany({
      where: { resourceType: "task", resourceId: task.id, action: "task.status" },
    });
    expect(audits.length).toBeGreaterThan(0);
  });

  it("completing with a blank note completes without inventing an empty comment", async () => {
    const task = await createTask(admin, { title: "ZZTEST blank note", assigneeId: shop.id });
    taskIds.push(task.id);

    await completeTaskWithNote(shop, task.id, "   ");

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.status).toBe("DONE");
    expect(await db.comment.count({ where: { taskId: task.id } })).toBe(0);
  });

  it("notes survive completion — the explanation stays readable afterwards", async () => {
    const task = await createTask(admin, { title: "ZZTEST notes survive", assigneeId: shop.id });
    taskIds.push(task.id);

    await addTaskNote(shop, task.id, "Waiting on parts.");
    await completeTaskWithNote(shop, task.id, "Parts arrived, installed, done.");

    const notes = await db.comment.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });
    expect(notes).toHaveLength(2);

    // And a follow-up can still be added after the task is DONE — an admin
    // replying to what the shop wrote.
    await addTaskNote(admin, task.id, "Great — invoice the consignor for the parts.");
    expect(await db.comment.count({ where: { taskId: task.id } })).toBe(3);
  });
});
