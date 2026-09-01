import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { canViewField, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { vehicleLabel } from "@/modules/vehicles/service";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Sold Archive" };

function money(v: unknown): string {
  return v == null ? "—" : `$${Number(v).toLocaleString()}`;
}

export default async function ArchivePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "archive");
  const showProfit = canViewField(user, "profit");

  const episodes = await db.inventoryEpisode.findMany({
    where: { OR: [{ financialCloseStatus: "FINANCIALLY_CLOSED" }, { salesStatus: { in: ["DELIVERED"] } }] },
    include: { vehicle: true },
    orderBy: { closedAt: "desc" },
  });
  const snapshots = await db.profitSnapshot.findMany({ where: { episodeId: { in: episodes.map((e) => e.id) } } });
  const snapByEp = new Map(snapshots.map((s) => [s.episodeId, s]));
  const sales = await db.saleTransaction.findMany({
    where: { episodeId: { in: episodes.map((e) => e.id) }, status: { in: ["DELIVERED", "COMPLETE"] } },
  });
  const saleByEp = new Map(sales.map((s) => [s.episodeId, s]));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Sold Archive"
        subtitle="The permanent record of every vehicle that has passed through the dealership."
      />

      {episodes.length === 0 ? (
        <EmptyState title="No archived vehicles yet" hint="Vehicles appear here after delivery and financial close." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-4 py-3">Vehicle</th>
                <th scope="col" className="px-4 py-3">Deal</th>
                <th scope="col" className="px-4 py-3 text-right">Sale price</th>
                {showProfit ? <th scope="col" className="px-4 py-3 text-right">Final net</th> : null}
                <th scope="col" className="px-4 py-3">Delivered</th>
                <th scope="col" className="px-4 py-3">Closed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {episodes.map((e) => {
                const snap = snapByEp.get(e.id);
                const sale = saleByEp.get(e.id);
                return (
                  <tr key={e.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <Link href={`/vehicles/${e.vehicleId}`} className="font-medium text-brand-700 hover:underline">
                        {vehicleLabel(e.vehicle)}
                      </Link>
                      <p className="text-xs text-stone-400">{e.stockNumber}</p>
                    </td>
                    <td className="px-4 py-3 text-stone-600">{e.dealType === "CONSIGNMENT" ? "Consignment" : "Owned"}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{money(sale?.agreedPrice ?? snap?.revenue)}</td>
                    {showProfit ? (
                      <td className="px-4 py-3 text-right font-semibold text-stone-900">{money(snap?.netProfit)}</td>
                    ) : null}
                    <td className="px-4 py-3 text-stone-600">
                      {sale?.deliveredAt ? new Date(sale.deliveredAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {e.closedAt ? new Date(e.closedAt).toLocaleDateString() : "open"}
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
