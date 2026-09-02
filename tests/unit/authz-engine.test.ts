/**
 * Permission tests for the three-role model (Admin / Front Desk / Shop).
 *
 * These assert the boundaries the business actually cares about: the shop floor
 * never sees money, and the front desk sees customers and paperwork but not what
 * the dealership paid or made.
 */
import { describe, expect, it } from "vitest";
import {
  authorize,
  canViewField,
  getScope,
  requireOwnerOverride,
  requirePermission,
  stripFields,
  AuthzError,
} from "@/lib/authz/engine";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES, RESOURCES, ACTIONS } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";

function templateRole(key: string) {
  const tpl = ROLE_TEMPLATES.find((t) => t.key === key)!;
  return {
    key: tpl.key,
    permissions: Object.entries(tpl.grants).flatMap(([resource, grant]) =>
      Object.entries(grant!).map(([action, scope]) => ({ resource, action, scope })),
    ),
    fieldGrants: tpl.fieldGrants.map((fieldKey) => ({ fieldKey })),
  };
}

function makeUser(roleKeys: string[], opts?: Partial<SessionUser>): SessionUser {
  const roles = roleKeys.map(templateRole);
  const { permissions, fieldGrants } = buildPermissionMap(roles);
  return {
    id: "user-1",
    sessionId: "sess-1",
    name: "Test User",
    email: "test@example.com",
    roleKeys,
    isOwner: roleKeys.includes("admin"),
    previewRoleKey: null,
    departmentIds: [],
    departmentKeys: [],
    permissions,
    fieldGrants,
    defaultLandingPage: null,
    ...opts,
  };
}

const MONEY_FIELDS = [
  "acquisition_cost",
  "profit",
  "min_price",
  "consignor_terms",
  "commissions",
  "compensation",
  "banking",
] as const;

describe("the role set itself", () => {
  it("is exactly three roles", () => {
    expect(ROLE_TEMPLATES.map((r) => r.key).sort()).toEqual(["admin", "front_desk", "shop"]);
  });
});

describe("admin", () => {
  const admin = makeUser(["admin"]);

  it("can access every resource/action at ALL scope", () => {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        expect(getScope(admin, resource, action)).toBe("ALL");
      }
    }
  });

  it("can view every sensitive field", () => {
    for (const field of MONEY_FIELDS) expect(canViewField(admin, field)).toBe(true);
    expect(canViewField(admin, "owner_notes")).toBe(true);
    expect(canViewField(admin, "buyer_pii")).toBe(true);
  });
});

describe("front desk", () => {
  const desk = makeUser(["front_desk"]);

  it("sees customers and paperwork", () => {
    expect(canViewField(desk, "buyer_pii")).toBe(true);
    expect(canViewField(desk, "seller_pii")).toBe(true);
    expect(canViewField(desk, "payment_info")).toBe(true);
    expect(canViewField(desk, "title_docs")).toBe(true);
    expect(canViewField(desk, "signed_docs")).toBe(true);
  });

  it("never sees what the dealership paid or made", () => {
    for (const field of MONEY_FIELDS) {
      expect(canViewField(desk, field), `front desk must not see ${field}`).toBe(false);
    }
    expect(canViewField(desk, "owner_notes")).toBe(false);
  });

  it("has no profitability, reports, or configuration access", () => {
    expect(getScope(desk, "profitability", "view")).toBe("NONE");
    expect(getScope(desk, "reports", "view")).toBe("NONE");
    expect(getScope(desk, "admin", "manage_config")).toBe("NONE");
    expect(getScope(desk, "audit", "view")).toBe("NONE");
  });

  it("can run a deal end to end", () => {
    expect(getScope(desk, "sales", "create")).toBe("ALL");
    expect(getScope(desk, "payments", "create")).toBe("ALL");
    expect(getScope(desk, "documents", "generate")).toBe("ALL");
    expect(getScope(desk, "parties", "create")).toBe("ALL");
  });

  it("cannot override the release gate", () => {
    expect(getScope(desk, "sales", "override_gate")).toBe("NONE");
    expect(() => requireOwnerOverride(desk, "buyer says the wire is sent")).toThrow(AuthzError);
  });
});

describe("shop", () => {
  const shop = makeUser(["shop"]);

  it("sees no money of any kind", () => {
    for (const field of MONEY_FIELDS) {
      expect(canViewField(shop, field), `shop must not see ${field}`).toBe(false);
    }
    expect(canViewField(shop, "buyer_pii")).toBe(false);
    expect(canViewField(shop, "seller_pii")).toBe(false);
  });

  it("has no access to expenses, deals, payments, documents or admin", () => {
    expect(getScope(shop, "expenses", "view")).toBe("NONE");
    expect(getScope(shop, "profitability", "view")).toBe("NONE");
    expect(getScope(shop, "sales", "view")).toBe("NONE");
    expect(getScope(shop, "payments", "view")).toBe("NONE");
    expect(getScope(shop, "documents", "view")).toBe("NONE");
    expect(getScope(shop, "admin", "manage_config")).toBe("NONE");
  });

  it("sees ALL work, not just its own — the iPad is a shared login", () => {
    // If this were ASSIGNED, the shared shop iPad would show an empty task list,
    // because the account signed in is nobody's individual account.
    expect(getScope(shop, "tasks", "view")).toBe("ALL");
    expect(getScope(shop, "work_orders", "view")).toBe("ALL");
    expect(getScope(shop, "inspections", "view")).toBe("ALL");
    expect(authorize(shop, "view", "tasks", { assignedUserIds: ["someone-else"] })).toBe(true);
  });

  it("can create and finish its own work", () => {
    expect(getScope(shop, "tasks", "create")).toBe("ALL");
    expect(getScope(shop, "tasks", "complete")).toBe("ALL");
    expect(getScope(shop, "work_orders", "complete")).toBe("ALL");
    expect(getScope(shop, "media", "create")).toBe("ALL");
  });

  it("requirePermission throws for money resources", () => {
    expect(() => requirePermission(shop, "view", "payments")).toThrow(AuthzError);
    expect(() => requirePermission(shop, "view", "profitability")).toThrow(AuthzError);
  });
});

describe("multiple roles union", () => {
  const dual = makeUser(["front_desk", "shop"]);

  it("receives the strongest scope from each role", () => {
    expect(getScope(dual, "sales", "view")).toBe("ALL"); // front desk only
    expect(getScope(dual, "inspections", "create")).toBe("ALL"); // shop only
  });

  it("unions field grants without inventing new ones", () => {
    expect(canViewField(dual, "buyer_pii")).toBe(true); // from front desk
    expect(canViewField(dual, "profit")).toBe(false); // neither role grants it
    expect(canViewField(dual, "acquisition_cost")).toBe(false);
  });
});

describe("admin override", () => {
  it("requires a real admin and a substantive reason", () => {
    const admin = makeUser(["admin"]);
    const shop = makeUser(["shop"]);
    expect(() => requireOwnerOverride(admin, "Funds wired, confirmation attached")).not.toThrow();
    expect(() => requireOwnerOverride(admin, "")).toThrow(AuthzError);
    expect(() => requireOwnerOverride(admin, "ok")).toThrow(AuthzError);
    expect(() => requireOwnerOverride(shop, "some reason here")).toThrow(AuthzError);
  });

  it("is not granted by preview mode", () => {
    const previewing = makeUser(["admin"], { isOwner: false, previewRoleKey: "shop" });
    expect(() => requireOwnerOverride(previewing, "a perfectly good reason")).toThrow(AuthzError);
  });
});

describe("stripFields", () => {
  const shop = makeUser(["shop"]);
  const desk = makeUser(["front_desk"]);
  const admin = makeUser(["admin"]);
  const record = {
    id: "e1",
    stockNumber: "GC-1001",
    purchasePrice: 42000,
    forecastProfit: 9000,
    askingPrice: 59900,
  };
  const map: Partial<Record<"acquisition_cost" | "profit", (keyof typeof record)[]>> = {
    acquisition_cost: ["purchasePrice"],
    profit: ["forecastProfit"],
  };

  it("removes protected columns for the shop", () => {
    const sanitized = stripFields(shop, record, map);
    expect(sanitized.purchasePrice).toBeUndefined();
    expect(sanitized.forecastProfit).toBeUndefined();
    expect(sanitized.stockNumber).toBe("GC-1001");
    expect(sanitized.askingPrice).toBe(59900);
  });

  it("removes them for the front desk too", () => {
    const sanitized = stripFields(desk, record, map);
    expect(sanitized.purchasePrice).toBeUndefined();
    expect(sanitized.forecastProfit).toBeUndefined();
    expect(sanitized.askingPrice).toBe(59900);
  });

  it("keeps everything for admins", () => {
    const sanitized = stripFields(admin, record, map);
    expect(sanitized.purchasePrice).toBe(42000);
    expect(sanitized.forecastProfit).toBe(9000);
  });
});
