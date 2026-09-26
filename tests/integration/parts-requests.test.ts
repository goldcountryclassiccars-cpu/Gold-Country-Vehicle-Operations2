/**
 * Parts & Supplies — the shared "we need this" list.
 *
 * Asserts what the shop relies on: every role can add and tick items (it's
 * everyone's list), the typed "requested by" name is what's shown (the shop
 * iPad is one shared login), ticking is undoable after a mis-tap, a removed
 * item leaves the list but not the audit trail, and ordered items stay visible
 * for a while so people can see their request was handled.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { hasPermission } from "@/lib/authz/engine";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import { NAV_ITEMS, navForUser } from "@/lib/navigation";
import {
  countPartsNeeded,
  createPartRequest,
  listPartRequests,
  ORDERED_VISIBLE_DAYS,
  PartsError,
  removePartRequest,
  setPartOrdered,
} from "@/modules/parts/service";

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

let admin: SessionUser;
let shop: SessionUser;
const createdIds: string[] = [];

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const shopUser = await db.user.findUniqueOrThrow({ where: { email: "mechanic@demo.gccc" } });
  admin = sessionUserFor("admin", jade);
  shop = sessionUserFor("shop", shopUser);
});

afterAll(async () => {
  await db.auditEvent.deleteMany({ where: { resourceType: "part_request", resourceId: { in: createdIds } } });
  await db.partRequest.deleteMany({ where: { id: { in: createdIds } } });
});

async function add(user: SessionUser, description: string, requestedByName: string) {
  const row = await createPartRequest(user, { description, requestedByName });
  createdIds.push(row.id);
  return row;
}

describe("who can use Parts & Supplies", () => {
  it.each(["admin", "front_desk", "shop"])("%s can view, add and tick items, and sees the dashboard tile", (roleKey) => {
    const u = sessionUserFor(roleKey, { id: "x", name: "X", email: "x@x" });
    expect(hasPermission(u, "parts", "view")).toBe(true);
    expect(hasPermission(u, "parts", "create")).toBe(true);
    expect(hasPermission(u, "parts", "edit")).toBe(true);
    expect(navForUser(u).some((n) => n.href === "/parts")).toBe(true);
  });

  it("sits in the nav under the name Jade asked for", () => {
    expect(NAV_ITEMS.find((n) => n.href === "/parts")?.label).toBe("Parts & Supplies");
  });
});

describe("the list", () => {
  it("records the typed name, not the shared login", async () => {
    const row = await add(shop, "ZZTEST 3/8 flare-nut wrench", "Brian");
    expect(row.requestedByName).toBe("Brian");
    expect(row.createdById).toBe(shop.id);
    const { needed } = await listPartRequests();
    expect(needed.some((r) => r.id === row.id)).toBe(true);
  });

  it("refuses an empty note or a missing name, with a reason", async () => {
    await expect(createPartRequest(shop, { description: "   ", requestedByName: "Brian" })).rejects.toBeInstanceOf(PartsError);
    await expect(createPartRequest(shop, { description: "ZZTEST clay bar", requestedByName: " " })).rejects.toThrow(/Requested by/);
  });

  it("ticking moves an item to Ordered with who and when; unticking undoes it", async () => {
    const row = await add(shop, "ZZTEST fuel pump for the Mustang", "Spencer");
    const before = await countPartsNeeded();

    const ticked = await setPartOrdered(admin, row.id, true);
    expect(ticked.orderedAt).not.toBeNull();
    expect(ticked.orderedByName).toBe(admin.name);
    expect(await countPartsNeeded()).toBe(before - 1);
    let lists = await listPartRequests();
    expect(lists.needed.some((r) => r.id === row.id)).toBe(false);
    expect(lists.ordered.some((r) => r.id === row.id)).toBe(true);

    // ticking twice is harmless
    const again = await setPartOrdered(admin, row.id, true);
    expect(again.orderedAt?.getTime()).toBe(ticked.orderedAt?.getTime());

    const unticked = await setPartOrdered(shop, row.id, false);
    expect(unticked.orderedAt).toBeNull();
    expect(unticked.orderedByName).toBeNull();
    lists = await listPartRequests();
    expect(lists.needed.some((r) => r.id === row.id)).toBe(true);

    const events = await db.auditEvent.findMany({ where: { resourceType: "part_request", resourceId: row.id }, select: { action: true } });
    expect(events.map((e) => e.action).sort()).toEqual(["parts.request_create", "parts.request_ordered", "parts.request_unordered"]);
  });

  it("ordered items drop off the page after the visible window", async () => {
    const row = await add(shop, "ZZTEST old order", "Amber");
    await setPartOrdered(admin, row.id, true);
    const later = new Date(Date.now() + (ORDERED_VISIBLE_DAYS + 1) * 24 * 60 * 60 * 1000);
    const { ordered } = await listPartRequests(later);
    expect(ordered.some((r) => r.id === row.id)).toBe(false);
  });

  it("removing takes it off the list but keeps the record; removing twice is fine", async () => {
    const row = await add(shop, "ZZTEST added by mistake", "Amber");
    await removePartRequest(shop, row.id);
    await removePartRequest(shop, row.id);
    const { needed, ordered } = await listPartRequests();
    expect([...needed, ...ordered].some((r) => r.id === row.id)).toBe(false);
    const kept = await db.partRequest.findUnique({ where: { id: row.id } });
    expect(kept?.archivedAt).not.toBeNull();
    await expect(setPartOrdered(admin, row.id, true)).rejects.toBeInstanceOf(PartsError);
  });
});
