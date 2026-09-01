import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { canViewField, requirePermission, requireField } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { computeProfitability } from "@/modules/finance/service";
import { snapshotProfitAction } from "@/modules/finance/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Profitability" };

function money(v: number | null): string {
  if (v == null) return "—";
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function ProfitabilityPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "profitability");
  // Profit numbers are a protected field category — enforced server-side.
  requireField(user, "profit");
  const showAcquisition = canViewField(user, "acquisition_cost");

  const episodes = await db.inventoryEpisode.findMany({
    where: { active: true },
    include: { vehicle: true },
    orderBy: { stockNumber: "asc" },
  });
  const snapshots = await db.profitSnapshot.findMany({ where: { episodeId: { in: episodes.map((e) => e.id) } } });
  const snapByEp = new Map(snapshots.map((s) => [s.episodeId, s]));
  const rows = await Promise.all(episodes.map(async (e) => ({ episode: e, p: await computeProfitability(e.id) })));

  const totals = rows.reduce(
    (acc, { p }) => {
      acc.expenses += p.dealershipExpenses;
      acc.net += p.netProfit ?? 0;
      return acc;
    },
    { expenses: 0, net: 0 },
  );

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Profitability"
        subtitle={`Computed live from the expense ledger and arrangements. Projected net across active inventory: ${money(totals.net)} (dealership expenses ${money(totals.expenses)}).`}
      />

      {rows.length === 0 ? (
        <EmptyState title="No active inventory" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-4 py-3">Vehicle</th>
                <th scope="col" className="px-4 py-3">Deal</th>
                <th scope="col" className="px-4 py-3 text-right">Revenue</th>
                {showAcquisition ? <th scope="col" className="px-4 py-3 text-right">Acquisition</th> : null}
                <th scope="col" className="px-4 py-3 text-right">Dealer share</th>
                <th scope="col" className="px-4 py-3 text-right">Expenses</th>
                <th scope="col" className="px-4 py-3 text-right">Net</th>
                <th scope="col" className="px-4 py-3">Basis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map(({ episode: e, p }) => (
                <tr key={e.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3">
                    <Link href={`/episodes/${e.id}`} className="font-medium text-brand-700 hover:underline">
                      {e.stockNumber}
                    </Link>
                    <p className="text-xs text-stone-400">{vehicleLabel(e.vehicle)}</p>
                  </td>
                  <td className="px-4 py-3 text-stone-600">{e.dealType === "CONSIGNMENT" ? "Consignment" : "Owned"}</td>
                  <td className="px-4 py-3 text-right text-stone-700">{money(p.revenue)}</td>
                  {showAcquisition ? (
                    <td className="px-4 py-3 text-right text-stone-700">{e.dealType === "CONSIGNMENT" ? "n/a" : money(p.acquisitionCost)}</td>
                  ) : null}
                  <td className="px-4 py-3 text-right text-stone-700">{money(p.dealershipRevenue)}</td>
                  <td className="px-4 py-3 text-right text-stone-700">{money(p.dealershipExpenses)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${p.netProfit != null && p.netProfit < 0 ? "text-red-700" : "text-stone-900"}`}>
                    {money(p.netProfit)}
                  </td>
                  <td className="px-4 py-3">
                    {snapByEp.has(e.id) ? (
                      <Badge tone="green">closed snapshot</Badge>
                    ) : p.revenueIsProjected ? (
                      <Badge tone="amber">projected</Badge>
                    ) : (
                      <form action={snapshotProfitAction}>
                        <input type="hidden" name="episodeId" value={e.id} />
                        <button type="submit" className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                          Snapshot final
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card className="mt-6">
        <h2 className="text-sm font-semibold text-stone-900">How these numbers work</h2>
        <p className="mt-1 text-sm text-stone-600">
          Every figure is computed from the expense ledger and the confidential arrangement — never stored as a running
          total. For consignments, the dealer share uses the guaranteed-net or commission structure; acquisition cost
          applies only to dealer-owned vehicles. Amounts use the best-known value per entry (actual, else committed,
          else approved, else estimate). Voided and declined entries are excluded. At financial close an immutable
          snapshot preserves the final numbers.
        </p>
      </Card>
    </div>
  );
}
