import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { canViewField, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { computeProfitability } from "@/modules/finance/service";
import { boardStage } from "@/modules/episodes/board";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { DataTable, type Column } from "@/components/data-table";

export const metadata: Metadata = { title: "Reports" };

function money(v: number | null | undefined): string {
  if (v == null) return "—";
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export default async function ReportsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "reports");
  const showProfit = canViewField(user, "profit");

  const [active, sources, allEpisodes] = await Promise.all([
    db.inventoryEpisode.findMany({ where: { active: true }, include: { vehicle: true } }),
    db.acquisitionSource.findMany(),
    db.inventoryEpisode.findMany({ include: { vehicle: true } }),
  ]);
  const sourceById = new Map(sources.map((s) => [s.id, s.name]));

  // Headline numbers
  const pipelineValue = active.reduce((s, e) => s + (e.askingPrice ? Number(e.askingPrice) : 0), 0);
  const now = Date.now();
  const ages = active
    .filter((e) => e.acceptedAt)
    .map((e) => Math.floor((now - new Date(e.acceptedAt!).getTime()) / 86400_000));
  const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;

  const profits = showProfit ? await Promise.all(allEpisodes.map(async (e) => ({ e, p: await computeProfitability(e.id) }))) : [];
  const totalNet = profits.reduce((s, { p }) => s + (p.netProfit ?? 0), 0);

  // Source performance: count (+ net when granted) per source across ALL episodes.
  const bySource = new Map<string, { name: string; count: number; net: number }>();
  for (const e of allEpisodes) {
    const name = e.acquisitionSourceId ? sourceById.get(e.acquisitionSourceId) ?? "Unknown" : "Unrecorded";
    const row = bySource.get(name) ?? { name, count: 0, net: 0 };
    row.count += 1;
    if (showProfit) {
      const p = profits.find((x) => x.e.id === e.id)?.p;
      row.net += p?.netProfit ?? 0;
    }
    bySource.set(name, row);
  }
  const sourceRows = [...bySource.values()].sort((a, b) => (showProfit ? b.net - a.net : b.count - a.count));
  const maxMetric = Math.max(...sourceRows.map((r) => (showProfit ? Math.abs(r.net) : r.count)), 1);

  // Aging (active inventory, oldest first)
  const aging = active
    .filter((e) => e.acceptedAt)
    .map((e) => ({ e, days: Math.floor((now - new Date(e.acceptedAt!).getTime()) / 86400_000) }))
    .sort((a, b) => b.days - a.days);

  const stageCounts = new Map<string, number>();
  for (const e of active) {
    const s = boardStage(e);
    stageCounts.set(s, (stageCounts.get(s) ?? 0) + 1);
  }

  const agingColumns: Column<(typeof aging)[number]>[] = [
    {
      key: "vehicle",
      header: "Vehicle",
      phone: "title",
      cell: ({ e }) => (
        <Link href={`/episodes/${e.id}`} className="text-brand-700 hover:underline">
          {e.stockNumber} — {vehicleLabel(e.vehicle)}
        </Link>
      ),
    },
    {
      key: "days",
      header: "Days",
      phone: "meta",
      className: "text-right tabular-nums",
      headerClassName: "text-right",
      cell: ({ days }) => (
        <span className={days > 90 ? "font-semibold text-red-700" : "text-stone-900"}>{days} days</span>
      ),
    },
    { key: "stage", header: "Stage", className: "text-stone-600", cell: ({ e }) => boardStage(e) },
    {
      key: "asking",
      header: "Asking",
      className: "text-right text-stone-700",
      headerClassName: "text-right",
      cell: ({ e }) => (e.askingPrice ? money(Number(e.askingPrice)) : "—"),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Reports" subtitle="Live operational and financial reporting — computed, never cached totals." />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card accent="blue">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Active inventory</p>
          <p className="mt-1 text-3xl font-semibold text-stone-900">{active.length}</p>
          <p className="mt-1 text-xs text-stone-500">
            {[...stageCounts.entries()].map(([s, c]) => `${c} ${s.toLowerCase()}`).join(" · ") || "—"}
          </p>
        </Card>
        <Card accent="brand">
          <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Pipeline value (asking)</p>
          <p className="mt-1 text-3xl font-semibold text-stone-900">{money(pipelineValue)}</p>
          <p className="mt-1 text-xs text-stone-500">Average age {avgAge} days</p>
        </Card>
        {showProfit ? (
          <Card accent={totalNet < 0 ? "rose" : "green"}>
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Net profit (all episodes)</p>
            <p className={`mt-1 text-3xl font-semibold ${totalNet < 0 ? "text-red-700" : "text-stone-900"}`}>{money(totalNet)}</p>
            <p className="mt-1 text-xs text-stone-500">Projected + realized, from the ledger</p>
          </Card>
        ) : (
          <Card accent="stone">
            <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Vehicles handled</p>
            <p className="mt-1 text-3xl font-semibold text-stone-900">{allEpisodes.length}</p>
            <p className="mt-1 text-xs text-stone-500">All time</p>
          </Card>
        )}
      </div>

      <Card className="mb-6" accent="cyan">
        <h2 className="text-base font-semibold text-stone-900">Acquisition source performance</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          {showProfit ? "Net profit contribution by source (bar length), with vehicle counts." : "Vehicles by acquisition source."}
        </p>
        {sourceRows.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">No data yet.</p>
        ) : (
          <ul className="mt-4 space-y-2" role="list">
            {sourceRows.map((r) => {
              const metric = showProfit ? r.net : r.count;
              const width = Math.max((Math.abs(metric) / maxMetric) * 100, 2);
              return (
                <li key={r.name} className="group grid grid-cols-[10rem_1fr_auto] items-center gap-3">
                  <span className="truncate text-sm text-stone-700" title={r.name}>{r.name}</span>
                  <span className="h-4 w-full">
                    <span
                      className="block h-4 rounded-r-[4px] bg-brand-600 transition-opacity group-hover:opacity-80"
                      style={{ width: `${width}%` }}
                      title={`${r.name}: ${showProfit ? money(r.net) : r.count} (${r.count} vehicle${r.count === 1 ? "" : "s"})`}
                    />
                  </span>
                  <span className="text-right text-sm tabular-nums text-stone-900">
                    {showProfit ? money(r.net) : r.count}
                    <span className="ml-1 text-xs text-stone-400">({r.count})</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-stone-900">Inventory aging</h2>
        <p className="mt-0.5 text-xs text-stone-500">Days since acceptance, oldest first. Long-aged vehicles may need a price review.</p>
        <DataTable
          bare
          className="mt-3"
          caption="Inventory aging, oldest first"
          columns={agingColumns}
          rows={aging}
          rowKey={({ e }) => e.id}
          empty={
            <div className="mt-3">
              <EmptyState title="No active inventory" />
            </div>
          }
        />
      </Card>
    </div>
  );
}
