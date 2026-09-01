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
  { href: "/approvals", label: "Approvals", icon: "BadgeCheck", requires: { resource: "approvals", action: "approve" } },
  { href: "/expenses", label: "Expenses", icon: "Receipt", requires: { resource: "expenses", action: "view" } },
  { href: "/profitability", label: "Profitability", icon: "TrendingUp", requires: { resource: "profitability", action: "view" } },
  { href: "/media", label: "Media", icon: "Camera", requires: { resource: "media", action: "view" } },
  { href: "/listings", label: "Listings", icon: "Megaphone", requires: { resource: "listings", action: "view" } },
  { href: "/sales", label: "Sales", icon: "Handshake", requires: { resource: "sales", action: "view" } },
  { href: "/closing", label: "Closing Desk", icon: "FileCheck", requires: { resource: "payments", action: "view" } },
  { href: "/documents", label: "Documents", icon: "FileText", requires: { resource: "documents", action: "view" } },
  { href: "/transport", label: "Transport", icon: "Truck", requires: { resource: "transport", action: "view" } },
  { href: "/consignments", label: "Consignments", icon: "FileSignature", requires: { resource: "consignments", action: "view" } },
  { href: "/settlements", label: "Settlements", icon: "Banknote", requires: { resource: "settlements", action: "view" } },
  { href: "/reports", label: "Reports", icon: "BarChart3", requires: { resource: "reports", action: "view" } },
  { href: "/archive", label: "Sold Archive", icon: "Archive", requires: { resource: "archive", action: "view" } },
  { href: "/integrations", label: "Integrations", icon: "Plug", requires: { resource: "integrations", action: "view" } },
  { href: "/admin", label: "Administration", icon: "Settings", requires: { resource: "admin", action: "manage_config" } },
];

export function navForUser(user: SessionUser): NavItem[] {
  return NAV_ITEMS.filter((item) => hasPermission(user, item.requires.resource, item.requires.action));
}
