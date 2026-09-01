import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { releaseGate } from "@/modules/sales/service";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Closing Desk" };

export default async function ClosingPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "payments");

  const sales = await db.saleTransaction.findMany({
    where: { status: { in: ["DEPOSIT_REQUESTED", "DEPOSIT_RECEIVED", "CONTRACTED", "FUNDS_PENDING", "FUNDED", "RELEASED"] } },
    orderBy: { createdAt: "asc" },
    include: { payments: true, documents: true },
  });
  const episodes = await db.inventoryEpisode.findMany({
    where: { id: { in: [...new Set(sales.map((s) => s.episodeId))] } },
    include: { vehicle: true },
  });
  const epById = new Map(episodes.map((e) => [e.id, e]));
  const gates = new Map(await Promise.all(sales.map(async (s) => [s.id, await releaseGate(s.id)] as const)));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Closing Desk" subtitle="Every open deal, its funding position, and its document status." />

      {sales.length === 0 ? (
        <EmptyState title="No deals in closing" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-4 py-3">Deal</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Agreed</th>
                <th scope="col" className="px-4 py-3 text-right">Cleared</th>
                <th scope="col" className="px-4 py-3">Docs</th>
                <th scope="col" className="px-4 py-3">Release gate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sales.map((s) => {
                const ep = epById.get(s.episodeId);
                const cleared = s.payments.filter((p) => p.status === "CLEARED" && p.kind !== "REFUND").reduce((x, p) => x + Number(p.amount), 0);
                const docs = s.documents.filter((d) => d.status !== "VOIDED");
                const signed = docs.filter((d) => d.status === "SIGNED" || d.status === "FILED").length;
                const gate = gates.get(s.id);
                return (
                  <tr key={s.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <Link href={`/sales/${s.id}`} className="font-medium text-brand-700 hover:underline">
                        {ep ? `${ep.stockNumber} — ${vehicleLabel(ep.vehicle)}` : "Deal"}
                      </Link>
                    </td>
                    <td className="px-4 py-3"><Badge tone="brand">{s.status.toLowerCase().replace(/_/g, " ")}</Badge></td>
                    <td className="px-4 py-3 text-right text-stone-700">${Number(s.agreedPrice).toLocaleString()}</td>
                    <td className="px-4 py-3 text-right text-stone-900">${cleared.toLocaleString()}</td>
                    <td className="px-4 py-3 text-stone-600">{signed}/{docs.length} signed</td>
                    <td className="px-4 py-3">
                      <Badge tone={gate?.ok ? "green" : "amber"}>{gate?.ok ? "clear" : "blocked"}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
