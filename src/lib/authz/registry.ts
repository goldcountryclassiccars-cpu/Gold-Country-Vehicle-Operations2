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

export const ROLE_KEYS = [
  "owner",
  "ops_manager",
  "mechanic",
  "detailer",
  "body",
  "media",
  "sales",
  "finance",
  "transport",
  "vendor",
] as const;
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
    key: "owner",
    name: "Owner / Administrator",
    description: "Full access to every module, record, field, approval, and configuration.",
    grants: Object.fromEntries(RESOURCES.map((r) => [r, fullAccess])) as RoleTemplate["grants"],
    fieldGrants: [...SENSITIVE_FIELDS],
  },
  {
    key: "ops_manager",
    name: "Operations Manager",
    description:
      "Vehicle workflow, intake, custody, assignments, tasks, inspections, work orders, media readiness, operational reports.",
    grants: {
      vehicles: { view: "ALL", create: "ALL", edit: "ALL" },
      episodes: { view: "ALL", create: "ALL", edit: "ALL" },
      intake: { view: "ALL", create: "ALL", edit: "ALL", complete: "ALL" },
      locations: { view: "ALL", create: "ALL", edit: "ALL" },
      parties: { view: "ALL", create: "ALL", edit: "ALL" },
      tasks: { view: "ALL", create: "ALL", edit: "ALL", assign: "ALL", complete: "ALL", reopen: "ALL" },
      comments: { view: "ALL", create: "ALL" },
      inspections: { view: "ALL", create: "ALL", edit: "ALL", assign: "ALL", complete: "ALL" },
      work_orders: { view: "ALL", create: "ALL", edit: "ALL", assign: "ALL", complete: "ALL" },
      approvals: { view: "ALL", create: "ALL", approve: "ALL" }, // amount thresholds enforced separately
      expenses: { view: "ALL", create: "ALL", edit: "ALL" },
      media: { view: "ALL", create: "ALL", edit: "ALL", assign: "ALL" },
      listings: { view: "ALL" },
      transport: { view: "ALL", create: "ALL", edit: "ALL" },
      reports: { view: "DEPARTMENT" },
      archive: { view: "ALL" },
      notifications: { view: "OWN" },
    },
    fieldGrants: ["seller_pii"], // needed for intake/custody coordination
  },
  {
    key: "mechanic",
    name: "Mechanic",
    description: "Assigned mechanical work: inspections, issues, work orders, parts and labor.",
    grants: {
      vehicles: { view: "ASSIGNED" },
      episodes: { view: "ASSIGNED" },
      tasks: { view: "ASSIGNED", edit: "ASSIGNED", complete: "ASSIGNED" },
      comments: { view: "ASSIGNED", create: "ASSIGNED" },
      inspections: { view: "DEPARTMENT", create: "DEPARTMENT", edit: "ASSIGNED", complete: "ASSIGNED" },
      work_orders: { view: "DEPARTMENT", edit: "ASSIGNED", complete: "ASSIGNED" },
      approvals: { view: "OWN", create: "ASSIGNED" },
      media: { view: "ASSIGNED", create: "ASSIGNED" }, // mechanical photos
      notifications: { view: "OWN" },
    },
    fieldGrants: [],
  },
  {
    key: "detailer",
    name: "Detailer",
    description: "Assigned detailing work, checklists, condition notes, before/after photos.",
    grants: {
      vehicles: { view: "ASSIGNED" },
      episodes: { view: "ASSIGNED" },
      tasks: { view: "ASSIGNED", edit: "ASSIGNED", complete: "ASSIGNED" },
      comments: { view: "ASSIGNED", create: "ASSIGNED" },
      work_orders: { view: "DEPARTMENT", edit: "ASSIGNED", complete: "ASSIGNED" },
      media: { view: "ASSIGNED", create: "ASSIGNED" },
      notifications: { view: "OWN" },
    },
    fieldGrants: [],
  },
  {
    key: "body",
    name: "Body & Paint Technician",
    description: "Assigned body/paint issues, estimates, work orders, before/after photos.",
    grants: {
      vehicles: { view: "ASSIGNED" },
      episodes: { view: "ASSIGNED" },
      tasks: { view: "ASSIGNED", edit: "ASSIGNED", complete: "ASSIGNED" },
      comments: { view: "ASSIGNED", create: "ASSIGNED" },
      inspections: { view: "DEPARTMENT", create: "DEPARTMENT", edit: "ASSIGNED", complete: "ASSIGNED" },
      work_orders: { view: "DEPARTMENT", edit: "ASSIGNED", complete: "ASSIGNED" },
      approvals: { view: "OWN", create: "ASSIGNED" },
      media: { view: "ASSIGNED", create: "ASSIGNED" },
      notifications: { view: "OWN" },
    },
    fieldGrants: [],
  },
  {
    key: "media",
    name: "Media / Marketing",
    description: "Media queue, checklists, uploads, listing readiness, listing handoffs.",
    grants: {
      vehicles: { view: "ALL" }, // approved specs only (field-filtered)
      episodes: { view: "ALL" },
      tasks: { view: "ASSIGNED", edit: "ASSIGNED", complete: "ASSIGNED" },
      comments: { view: "ASSIGNED", create: "ASSIGNED" },
      media: { view: "ALL", create: "ALL", edit: "ALL", complete: "ALL" },
      listings: { view: "ALL", generate: "ALL" },
      notifications: { view: "OWN" },
    },
    fieldGrants: [],
  },
  {
    key: "sales",
    name: "Salesperson",
    description: "Available inventory, own deals, holds and deposits, buyers, closing tasks, transport status.",
    grants: {
      vehicles: { view: "ALL" },
      episodes: { view: "ALL" },
      tasks: { view: "ASSIGNED", edit: "ASSIGNED", complete: "ASSIGNED" },
      comments: { view: "ASSIGNED", create: "ASSIGNED" },
      media: { view: "ALL" },
      listings: { view: "ALL" },
      sales: { view: "ASSIGNED", create: "ALL", edit: "ASSIGNED" },
      parties: { view: "ASSIGNED", create: "ALL", edit: "ASSIGNED" }, // buyers on own deals
      payments: { view: "ASSIGNED" },
      documents: { view: "ASSIGNED" },
      transport: { view: "ASSIGNED" },
      notifications: { view: "OWN" },
    },
    // Buyer PII on own deals is scoped by record access; profit/cost require explicit grants.
    fieldGrants: ["buyer_pii"],
  },
  {
    key: "finance",
    name: "Finance / Title / Deal Administration",
    description: "Closing desk, payments, documents, titles, consignor settlements, reconciliation.",
    grants: {
      vehicles: { view: "ALL" },
      episodes: { view: "ALL" },
      tasks: { view: "ASSIGNED", edit: "ASSIGNED", complete: "ASSIGNED" },
      comments: { view: "ASSIGNED", create: "ASSIGNED" },
      sales: { view: "ALL", edit: "ALL" },
      parties: { view: "ALL", create: "ALL", edit: "ALL" },
      payments: { view: "ALL", create: "ALL", edit: "ALL" },
      documents: { view: "ALL", create: "ALL", edit: "ALL", generate: "ALL", send: "ALL" },
      transport: { view: "ALL" },
      consignments: { view: "ALL" },
      settlements: { view: "ALL", create: "ALL", edit: "ALL" },
      expenses: { view: "ALL", create: "ALL", edit: "ALL" },
      reports: { view: "DEPARTMENT" },
      archive: { view: "ALL" },
      notifications: { view: "OWN" },
    },
    fieldGrants: [
      "buyer_pii",
      "seller_pii",
      "payment_info",
      "title_docs",
      "id_docs",
      "signed_docs",
      "consignor_terms",
      "accounting_refs",
    ],
  },
  {
    key: "transport",
    name: "Transport Coordinator",
    description: "Transport queue, quotes, pickups, deliveries, carrier documents.",
    grants: {
      vehicles: { view: "ASSIGNED" },
      episodes: { view: "ASSIGNED" },
      tasks: { view: "ASSIGNED", edit: "ASSIGNED", complete: "ASSIGNED" },
      comments: { view: "ASSIGNED", create: "ASSIGNED" },
      transport: { view: "ALL", create: "ALL", edit: "ALL", complete: "ALL" },
      parties: { view: "ASSIGNED" }, // buyer contact needed for delivery
      notifications: { view: "OWN" },
    },
    fieldGrants: ["buyer_pii"], // delivery contact info only; enforced by sanitizer
  },
  {
    key: "vendor",
    name: "External Vendor",
    description: "Only work orders explicitly assigned to this vendor.",
    grants: {
      vehicles: { view: "ASSIGNED" },
      tasks: { view: "ASSIGNED", edit: "ASSIGNED", complete: "ASSIGNED" },
      comments: { view: "ASSIGNED", create: "ASSIGNED" }, // vendor-visible comments only
      work_orders: { view: "ASSIGNED", edit: "ASSIGNED", complete: "ASSIGNED" },
      media: { view: "ASSIGNED", create: "ASSIGNED" },
      notifications: { view: "OWN" },
    },
    fieldGrants: [],
  },
];

/** Scope strength ordering for unioning multiple roles: larger wins. */
export const SCOPE_RANK: Record<Scope, number> = {
  NONE: 0,
  OWN: 1,
  ASSIGNED: 2,
  DEPARTMENT: 3,
  ALL: 4,
};
