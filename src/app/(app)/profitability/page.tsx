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
import { DataTable, type Column } from "@/components/data-table";

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

  type ProfitRow = (typeof rows)[number];
  const columns: Column<ProfitRow>[] = [
    {
      key: "vehicle",
      header: "Vehicle",
      phone: "title",
      cell: ({ episode: e }) => (
        <>
          <Link href={`/episodes/${e.id}`} className="font-medium text-brand-700 hover:underline">
            {e.stockNumber}
          </Link>
          <p className="text-xs text-stone-400">{vehicleLabel(e.vehicle)}</p>
        </>
      ),
    },
    {
      key: "basis",
      header: "Basis",
      phone: "meta",
      cell: ({ episode: e, p }) =>
        snapByEp.has(e.id) ? (
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
        ),
    },
    {
      key: "deal",
      header: "Deal",
      className: "text-stone-600",
      cell: ({ episode: e }) => (e.dealType === "CONSIGNMENT" ? "Consignment" : "Owned"),
    },
    {
      key: "revenue",
      header: "Revenue",
      className: "text-right text-stone-700",
      headerClassName: "text-right",
      cell: ({ p }) => money(p.revenue),
    },
    ...(showAcquisition
      ? [
          {
            key: "acquisition",
            header: "Acquisition",
            className: "text-right text-stone-700",
            headerClassName: "text-right",
            cell: ({ episode: e, p }: ProfitRow) => (e.dealType === "CONSIGNMENT" ? "n/a" : money(p.acquisitionCost)),
          } satisfies Column<ProfitRow>,
        ]
      : []),
    {
      key: "dealerShare",
      header: "Dealer share",
      className: "text-right text-stone-700",
      headerClassName: "text-right",
      cell: ({ p }) => money(p.dealershipRevenue),
    },
    {
      key: "expenses",
      header: "Expenses",
      className: "text-right text-stone-700",
      headerClassName: "text-right",
      cell: ({ p }) => money(p.dealershipExpenses),
    },
    {
      key: "net",
      header: "Net",
      className: "text-right font-semibold",
      headerClassName: "text-right",
      cell: ({ p }) => (
        <span className={p.netProfit != null && p.netProfit < 0 ? "text-red-700" : "text-stone-900"}>
          {money(p.netProfit)}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Profitability"
        subtitle={`Computed live from the expense ledger and arrangements. Projected net across active inventory: ${money(totals.net)} (dealership expenses ${money(totals.expenses)}).`}
      />

      <DataTable
        caption="Profitability by vehicle"
        columns={columns}
        rows={rows}
        rowKey={({ episode }) => episode.id}
        empty={<EmptyState title="No active inventory" />}
      />

      <Card className="mt-6" accent="green">
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
