import type { Action, Resource } from "@/lib/authz/registry";
import { hasPermission } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // lucide icon name, resolved client-side
  /** Shown only when the user has this permission. */
  requires: { resource: Resource; action: Action };
}

/**
 * Navigation is generated from permissions. Items the user cannot access are
 * absent entirely — never rendered as disabled.
 *
 * Owners see the full list; frontline roles resolve to 4–6 items.
 */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", requires: { resource: "notifications", action: "view" } },
  { href: "/my-work", label: "My Work", icon: "ClipboardCheck", requires: { resource: "tasks", action: "view" } },
  { href: "/vehicles", label: "Vehicles", icon: "Car", requires: { resource: "vehicles", action: "view" } },
  { href: "/pipeline", label: "Pipeline", icon: "Kanban", requires: { resource: "episodes", action: "view" } },
  { href: "/inspections", label: "Inspections", icon: "Search", requires: { resource: "inspections", action: "view" } },
  { href: "/work-orders", label: "Work Orders", icon: "Wrench", requires: { resource: "work_orders", action: "view" } },
  { href: "/expenses", label: "Expenses", icon: "Receipt", requires: { resource: "expenses", action: "view" } },
  { href: "/profitability", label: "Profitability", icon: "TrendingUp", requires: { resource: "profitability", action: "view" } },
  { href: "/media", label: "Media", icon: "Camera", requires: { resource: "media", action: "view" } },
  { href: "/sales", label: "Deals in Progress", icon: "Handshake", requires: { resource: "sales", action: "view" } },
  { href: "/documents", label: "Documents", icon: "FileText", requires: { resource: "documents", action: "view" } },
  { href: "/reports", label: "Reports", icon: "BarChart3", requires: { resource: "reports", action: "view" } },
  { href: "/archive", label: "Sold Archive", icon: "Archive", requires: { resource: "archive", action: "view" } },
  { href: "/admin", label: "Administration", icon: "Settings", requires: { resource: "admin", action: "manage_config" } },
];

/**
 * Removed from the sidebar deliberately, 2026-09: Approvals, Listings, Closing
 * Desk, Transport, Consignments, Settlements, Integrations.
 *
 * The routes still exist and still enforce permissions — they are unlinked, not
 * deleted, because several carry logic the business still depends on:
 *
 * - /closing holds the release gate (a vehicle should not leave before it is
 *   funded and the paperwork is signed). That check is being moved onto the
 *   deal page rather than discarded.
 * - /settlements computes what is owed to a consignor. Gold Country takes
 *   consignments regularly, so this is a real liability record; it is moving
 *   onto the vehicle page.
 * - /transport is unused as a workflow, but outbound transport survives as an
 *   expense category marked buyer pass-through.
 *
 * Deleting the routes outright would take the calculations with them.
 */
export const UNLINKED_ROUTES = [
  "/approvals",
  "/listings",
  "/closing",
  "/transport",
  "/consignments",
  "/settlements",
  "/integrations",
] as const;

export function navForUser(user: SessionUser): NavItem[] {
  return NAV_ITEMS.filter((item) => hasPermission(user, item.requires.resource, item.requires.action));
}
