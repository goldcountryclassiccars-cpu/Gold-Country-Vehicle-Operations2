/**
 * Central authorization registry.
 *
 * Resources, actions, sensitive field keys, and the default role templates
 * (used by the seed and by Administration when resetting a role to defaults).
 * Role grants live in the database and are editable without code changes;
 * this file defines the vocabulary and the shipped defaults.
 */

export const RESOURCES = [
  "vehicles",
  "episodes",
  "intake",
  "locations",
  "parties",
  "tasks",
  "comments",
  "inspections",
  "work_orders",
  "approvals",
  "expenses",
  "profitability",
  "media",
  "listings",
  "sales",
  "payments",
  "documents",
  "transport",
  "consignments",
  "settlements",
  "reports",
  "archive",
  "notifications",
  "integrations",
  "audit",
  "admin",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = [
  "view",
  "create",
  "edit",
  "assign",
  "approve",
  "complete",
  "reopen",
  "archive",
  "export",
  "generate",
  "send",
  "delete_draft",
  "override_gate",
  "manage_config",
] as const;
export type Action = (typeof ACTIONS)[number];

export type Scope = "ALL" | "DEPARTMENT" | "ASSIGNED" | "OWN" | "NONE";

/** Separately protected field categories (see PERMISSIONS.md §Sensitive fields). */
export const SENSITIVE_FIELDS = [
  "acquisition_cost", // purchase price, acquisition fees
  "consignor_terms", // guaranteed amount, commission, payout
  "min_price", // minimum acceptable price / negotiation floor
  "profit", // forecast + final profit, margins
  "owner_notes", // owner-only notes and discussions
  "seller_pii", // seller personal information
  "buyer_pii", // buyer personal information
  "payment_info", // payment references and milestones detail
  "title_docs", // title documents
  "id_docs", // driver-license documents
  "signed_docs", // signed sales documents
  "banking", // banking details / payout references
  "commissions", // sales commissions
  "compensation", // employee compensation
  "accounting_refs", // accounting references and sync data
] as const;
export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

/**
 * Three roles, chosen 2026-09 to match how the dealership actually works:
 * Jade and Sergio run everything, Rose runs the front desk, and the shop floor
 * shares an iPad. Ten roles described a larger company than this one.
 */
export const ROLE_KEYS = ["admin", "front_desk", "shop"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

type Grant = Partial<Record<Action, Scope>>;
export interface RoleTemplate {
  key: RoleKey;
  name: string;
  description: string;
  grants: Partial<Record<Resource, Grant>>;
  fieldGrants: SensitiveField[];
}

const fullAccess: Grant = Object.fromEntries(ACTIONS.map((a) => [a, "ALL"])) as Grant;

/** Default role templates. Owners are locked to full access; others are editable. */
export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    key: "admin",
    name: "Admin",
    description:
      "Full access to every module, record, field and configuration. Jade and Sergio.",
    grants: Object.fromEntries(RESOURCES.map((r) => [r, fullAccess])) as RoleTemplate["grants"],
    fieldGrants: [...SENSITIVE_FIELDS],
  },
  {
    key: "front_desk",
    name: "Front Desk",
    description:
      "Deals, buyers, payments, paperwork and the vehicle record. Sees customer information but not what the dealership paid or made.",
    grants: {
      vehicles: { view: "ALL", create: "ALL", edit: "ALL" },
      episodes: { view: "ALL", create: "ALL", edit: "ALL" },
      intake: { view: "ALL", create: "ALL", edit: "ALL", complete: "ALL" },
      locations: { view: "ALL" },
      parties: { view: "ALL", create: "ALL", edit: "ALL" },
      tasks: { view: "ALL", create: "ALL", edit: "ALL", assign: "ALL", complete: "ALL", reopen: "ALL" },
      comments: { view: "ALL", create: "ALL" },
      inspections: { view: "ALL" },
      work_orders: { view: "ALL" },
      expenses: { view: "ALL", create: "ALL", edit: "ALL" },
      media: { view: "ALL", create: "ALL", edit: "ALL" },
      sales: { view: "ALL", create: "ALL", edit: "ALL" },
      payments: { view: "ALL", create: "ALL", edit: "ALL" },
      documents: { view: "ALL", create: "ALL", edit: "ALL", generate: "ALL", send: "ALL" },
      consignments: { view: "ALL" },
      settlements: { view: "ALL", create: "ALL", edit: "ALL" },
      archive: { view: "ALL" },
      notifications: { view: "OWN" },
    },
    // Customer-facing work needs buyer and seller details and the paperwork that
    // goes with them. Acquisition cost, profit, minimum price and consignor
    // terms are deliberately absent — those stay with Admin.
    fieldGrants: ["buyer_pii", "seller_pii", "payment_info", "title_docs", "id_docs", "signed_docs"],
  },
  {
    key: "shop",
    name: "Shop",
    description:
      "Vehicles, tasks, inspections, work orders and photos. Shared on the shop iPad, so it sees all shop work rather than one person's.",
    grants: {
      vehicles: { view: "ALL" },
      episodes: { view: "ALL" },
      locations: { view: "ALL" },
      // "ALL" rather than "ASSIGNED" is deliberate: the iPad is signed in once
      // as a shared account, so it must show everyone's work for people to find
      // their own name on the list.
      tasks: { view: "ALL", create: "ALL", edit: "ALL", complete: "ALL", reopen: "ALL" },
      comments: { view: "ALL", create: "ALL" },
      inspections: { view: "ALL", create: "ALL", edit: "ALL", complete: "ALL" },
      work_orders: { view: "ALL", create: "ALL", edit: "ALL", complete: "ALL" },
      media: { view: "ALL", create: "ALL" },
      notifications: { view: "OWN" },
    },
    fieldGrants: [],
  },
];

export const SCOPE_RANK: Record<Scope, number> = {
  NONE: 0,
  OWN: 1,
  ASSIGNED: 2,
  DEPARTMENT: 3,
  ALL: 4,
};
