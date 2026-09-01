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
    isOwner: roleKeys.includes("owner"),
    previewRoleKey: null,
    departmentIds: [],
    departmentKeys: ["mechanical"],
    permissions,
    fieldGrants,
    defaultLandingPage: null,
    ...opts,
  };
}

describe("owner", () => {
  const owner = makeUser(["owner"]);

  it("can access every resource/action at ALL scope", () => {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        expect(getScope(owner, resource, action)).toBe("ALL");
      }
    }
  });

  it("can view every sensitive field", () => {
    expect(canViewField(owner, "acquisition_cost")).toBe(true);
    expect(canViewField(owner, "profit")).toBe(true);
    expect(canViewField(owner, "consignor_terms")).toBe(true);
    expect(canViewField(owner, "owner_notes")).toBe(true);
  });
});

describe("mechanic", () => {
  const mechanic = makeUser(["mechanic"]);

  it("cannot view acquisition cost, profit, or consignor terms", () => {
    expect(canViewField(mechanic, "acquisition_cost")).toBe(false);
    expect(canViewField(mechanic, "profit")).toBe(false);
    expect(canViewField(mechanic, "consignor_terms")).toBe(false);
    expect(canViewField(mechanic, "buyer_pii")).toBe(false);
  });

  it("has no access to expenses, profitability, sales, documents, admin", () => {
    expect(getScope(mechanic, "expenses", "view")).toBe("NONE");
    expect(getScope(mechanic, "profitability", "view")).toBe("NONE");
    expect(getScope(mechanic, "sales", "view")).toBe("NONE");
    expect(getScope(mechanic, "documents", "view")).toBe("NONE");
    expect(getScope(mechanic, "admin", "manage_config")).toBe("NONE");
    expect(getScope(mechanic, "payments", "view")).toBe("NONE");
  });

  it("sees only assigned vehicles", () => {
    expect(authorize(mechanic, "view", "vehicles", { assignedUserIds: ["user-1"] })).toBe(true);
    expect(authorize(mechanic, "view", "vehicles", { assignedUserIds: ["someone-else"] })).toBe(false);
    expect(authorize(mechanic, "view", "vehicles")).toBe(true); // list access; reads must be scope-filtered
  });

  it("sees department work orders and assigned ones", () => {
    expect(
      authorize(mechanic, "view", "work_orders", { departmentKeys: ["mechanical"] }),
    ).toBe(true);
    expect(authorize(mechanic, "view", "work_orders", { departmentKeys: ["body"] })).toBe(false);
    expect(
      authorize(mechanic, "view", "work_orders", { departmentKeys: ["body"], assignedUserIds: ["user-1"] }),
    ).toBe(true);
  });

  it("requirePermission throws for finance resources", () => {
    expect(() => requirePermission(mechanic, "view", "payments")).toThrow(AuthzError);
  });
});

describe("detailer", () => {
  const detailer = makeUser(["detailer"], { departmentKeys: ["detailing"] });

  it("cannot access buyer records (parties) or sales", () => {
    expect(getScope(detailer, "parties", "view")).toBe("NONE");
    expect(getScope(detailer, "sales", "view")).toBe("NONE");
    expect(canViewField(detailer, "buyer_pii")).toBe(false);
  });
});

describe("media user", () => {
  const media = makeUser(["media"], { departmentKeys: ["media"] });

  it("cannot view consignor financial terms or costs", () => {
    expect(canViewField(media, "consignor_terms")).toBe(false);
    expect(canViewField(media, "acquisition_cost")).toBe(false);
    expect(canViewField(media, "min_price")).toBe(false);
  });

  it("can view vehicles and manage media", () => {
    expect(getScope(media, "vehicles", "view")).toBe("ALL");
    expect(getScope(media, "media", "edit")).toBe("ALL");
  });
});

describe("salesperson", () => {
  const sales = makeUser(["sales"], { departmentKeys: ["sales"] });

  it("cannot view profit or acquisition cost without an explicit grant", () => {
    expect(canViewField(sales, "profit")).toBe(false);
    expect(canViewField(sales, "acquisition_cost")).toBe(false);
    expect(canViewField(sales, "consignor_terms")).toBe(false);
    expect(canViewField(sales, "min_price")).toBe(false);
  });

  it("sees own deals only", () => {
    expect(authorize(sales, "view", "sales", { assignedUserIds: ["user-1"] })).toBe(true);
    expect(authorize(sales, "view", "sales", { assignedUserIds: ["other"] })).toBe(false);
  });
});

describe("external vendor", () => {
  const vendor = makeUser(["vendor"], { departmentKeys: [] });

  it("can only access explicitly assigned work orders", () => {
    expect(getScope(vendor, "work_orders", "view")).toBe("ASSIGNED");
    expect(authorize(vendor, "view", "work_orders", { assignedUserIds: ["user-1"] })).toBe(true);
    expect(authorize(vendor, "view", "work_orders", { assignedUserIds: [] })).toBe(false);
  });

  it("has no access to sales, expenses, listings, reports", () => {
    expect(getScope(vendor, "sales", "view")).toBe("NONE");
    expect(getScope(vendor, "expenses", "view")).toBe("NONE");
    expect(getScope(vendor, "listings", "view")).toBe("NONE");
    expect(getScope(vendor, "reports", "view")).toBe("NONE");
  });
});

describe("multiple roles union", () => {
  const dual = makeUser(["mechanic", "sales"], { departmentKeys: ["mechanical", "sales"] });

  it("receives the strongest scope from each role", () => {
    // mechanic gives vehicles:view ASSIGNED; sales gives ALL — union is ALL
    expect(getScope(dual, "vehicles", "view")).toBe("ALL");
    // mechanic-only permissions survive
    expect(getScope(dual, "inspections", "view")).toBe("DEPARTMENT");
    // sales-only permissions survive
    expect(getScope(dual, "sales", "view")).toBe("ASSIGNED");
  });

  it("unions field grants", () => {
    expect(canViewField(dual, "buyer_pii")).toBe(true); // from sales
    expect(canViewField(dual, "profit")).toBe(false); // neither role grants profit
  });
});

describe("owner override", () => {
  it("requires the real owner role and a reason", () => {
    const owner = makeUser(["owner"]);
    const mechanic = makeUser(["mechanic"]);
    expect(() => requireOwnerOverride(owner, "Funds wired, confirmation attached")).not.toThrow();
    expect(() => requireOwnerOverride(owner, "")).toThrow(AuthzError);
    expect(() => requireOwnerOverride(owner, "ok")).toThrow(AuthzError);
    expect(() => requireOwnerOverride(mechanic, "some reason here")).toThrow(AuthzError);
  });
});

describe("stripFields", () => {
  const mechanic = makeUser(["mechanic"]);
  const owner = makeUser(["owner"]);
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

  it("removes protected columns for unauthorized users", () => {
    const sanitized = stripFields(mechanic, record, map);
    expect(sanitized.purchasePrice).toBeUndefined();
    expect(sanitized.forecastProfit).toBeUndefined();
    expect(sanitized.stockNumber).toBe("GC-1001");
    expect(sanitized.askingPrice).toBe(59900);
  });

  it("keeps everything for owners", () => {
    const sanitized = stripFields(owner, record, map);
    expect(sanitized.purchasePrice).toBe(42000);
    expect(sanitized.forecastProfit).toBe(9000);
  });
});
