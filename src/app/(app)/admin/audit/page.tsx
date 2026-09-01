import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { EmptyState, PageHeader } from "@/components/ui";

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

      {events.length === 0 ? (
        <EmptyState title="No matching audit events" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-4 py-3">When</th>
                <th scope="col" className="px-4 py-3">Actor</th>
                <th scope="col" className="px-4 py-3">Acting roles</th>
                <th scope="col" className="px-4 py-3">Action</th>
                <th scope="col" className="px-4 py-3">Resource</th>
                <th scope="col" className="px-4 py-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {events.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-stone-500">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2 text-stone-900">{e.actorName}</td>
                  <td className="px-4 py-2 text-xs text-stone-500">{e.actingRoles || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-stone-800">{e.action}</td>
                  <td className="px-4 py-2 text-xs text-stone-500">
                    {e.resourceType ? `${e.resourceType}${e.resourceId ? ` · ${e.resourceId.slice(0, 8)}…` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-stone-600">{e.reason ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
