import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "integrations");

  const events = await db.integrationEvent.findMany({ orderBy: { createdAt: "desc" }, take: 50 });
  const episodes = await db.inventoryEpisode.findMany({
    where: { id: { in: [...new Set(events.map((e) => e.episodeId).filter(Boolean))] as string[] } },
    select: { id: true, stockNumber: true },
  });
  const stockById = new Map(episodes.map((e) => [e.id, e.stockNumber]));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Integrations"
        subtitle="Outbox events for the listing application. Events are written atomically with the business change and delivered via the authenticated pull API."
      />

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-stone-900">Listing application API</h2>
        <p className="mt-1 text-sm text-stone-600">
          The future listing app authenticates with <code className="rounded bg-stone-100 px-1">Authorization: Bearer &lt;LISTING_API_KEY&gt;</code>{" "}
          and uses: <code className="rounded bg-stone-100 px-1">GET /api/integration/events</code> (pending events),{" "}
          <code className="rounded bg-stone-100 px-1">POST /api/integration/events/:id/ack</code> (acknowledge), and{" "}
          <code className="rounded bg-stone-100 px-1">GET /api/integration/episodes/:id</code> (authoritative vehicle data — public listing fields only).
        </p>
      </Card>

      {events.length === 0 ? (
        <EmptyState title="No integration events yet" hint="Submitting a vehicle to the listing system writes its first event." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-4 py-3">Type</th>
                <th scope="col" className="px-4 py-3">Vehicle</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">Attempts</th>
                <th scope="col" className="px-4 py-3">Created</th>
                <th scope="col" className="px-4 py-3">Delivered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 font-mono text-xs text-stone-800">{e.type}</td>
                  <td className="px-4 py-3 text-stone-700">{e.episodeId ? stockById.get(e.episodeId) ?? "—" : "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={e.status === "DELIVERED" ? "green" : e.status === "FAILED" ? "red" : "amber"}>
                      {e.status.toLowerCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-stone-600">{e.attempts}</td>
                  <td className="px-4 py-3 text-stone-600">{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-stone-600">{e.deliveredAt ? new Date(e.deliveredAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
