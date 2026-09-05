import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { EmptyState, PageHeader } from "@/components/ui";
import { DataTable, type Column } from "@/components/data-table";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "audit");
  const { q } = await searchParams;

  const events = await db.auditEvent.findMany({
    where: q
      ? {
          OR: [
            { action: { contains: q, mode: "insensitive" } },
            { actorName: { contains: q, mode: "insensitive" } },
            { resourceType: { contains: q, mode: "insensitive" } },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const columns: Column<(typeof events)[number]>[] = [
    {
      key: "action",
      header: "Action",
      phone: "title",
      className: "font-mono text-xs text-stone-800",
      cell: (e) => e.action,
    },
    {
      key: "when",
      header: "When",
      className: "whitespace-nowrap text-xs text-stone-500",
      cell: (e) => new Date(e.createdAt).toLocaleString(),
    },
    { key: "actor", header: "Actor", className: "text-stone-900", cell: (e) => e.actorName },
    {
      key: "roles",
      header: "Acting roles",
      className: "text-xs text-stone-500",
      cell: (e) => e.actingRoles || "—",
    },
    {
      key: "resource",
      header: "Resource",
      className: "text-xs text-stone-500",
      cell: (e) =>
        e.resourceType ? `${e.resourceType}${e.resourceId ? ` · ${e.resourceId.slice(0, 8)}…` : ""}` : "—",
    },
    { key: "reason", header: "Reason", className: "text-xs text-stone-600", cell: (e) => e.reason ?? "—" },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Audit log" subtitle="Append-only record of every significant action, actor, and change." />

      <form className="mb-4" action="/admin/audit" method="get">
        <label htmlFor="q" className="sr-only">Filter audit events</label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q ?? ""}
          placeholder="Filter by action, actor, or resource…"
          className="w-full max-w-md rounded-md border border-stone-300 px-3 py-2 text-sm shadow-sm"
        />
      </form>

      <DataTable
        caption="Audit events"
        columns={columns}
        rows={events}
        rowKey={(e) => e.id}
        empty={<EmptyState title="No matching audit events" />}
      />
    </div>
  );
}
