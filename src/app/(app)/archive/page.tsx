import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { canViewField, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { vehicleLabel } from "@/modules/vehicles/service";
import { EmptyState, PageHeader } from "@/components/ui";
import { DataTable, type Column } from "@/components/data-table";

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

  type ArchiveRow = (typeof episodes)[number];
  const columns: Column<ArchiveRow>[] = [
    {
      key: "vehicle",
      header: "Vehicle",
      phone: "title",
      cell: (e) => (
        <>
          <Link href={`/vehicles/${e.vehicleId}`} className="font-medium text-brand-700 hover:underline">
            {vehicleLabel(e.vehicle)}
          </Link>
          <p className="text-xs text-stone-400">{e.stockNumber}</p>
        </>
      ),
    },
    {
      key: "deal",
      header: "Deal",
      className: "text-stone-600",
      cell: (e) => (e.dealType === "CONSIGNMENT" ? "Consignment" : "Owned"),
    },
    {
      key: "salePrice",
      header: "Sale price",
      className: "text-right text-stone-700",
      headerClassName: "text-right",
      cell: (e) => money(saleByEp.get(e.id)?.agreedPrice ?? snapByEp.get(e.id)?.revenue),
    },
    ...(showProfit
      ? [
          {
            key: "net",
            header: "Final net",
            className: "text-right font-semibold text-stone-900",
            headerClassName: "text-right",
            cell: (e: ArchiveRow) => money(snapByEp.get(e.id)?.netProfit),
          } satisfies Column<ArchiveRow>,
        ]
      : []),
    {
      key: "delivered",
      header: "Delivered",
      className: "text-stone-600",
      cell: (e) => {
        const sale = saleByEp.get(e.id);
        return sale?.deliveredAt ? new Date(sale.deliveredAt).toLocaleDateString() : "—";
      },
    },
    {
      key: "closed",
      header: "Closed",
      className: "text-stone-600",
      cell: (e) => (e.closedAt ? new Date(e.closedAt).toLocaleDateString() : "open"),
    },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Sold Archive"
        subtitle="The permanent record of every vehicle that has passed through the dealership."
      />

      <DataTable
        caption="Archived vehicles"
        columns={columns}
        rows={episodes}
        rowKey={(e) => e.id}
        empty={
          <EmptyState
            title="No archived vehicles yet"
            hint="Vehicles appear here after delivery and financial close."
          />
        }
      />
    </div>
  );
}
