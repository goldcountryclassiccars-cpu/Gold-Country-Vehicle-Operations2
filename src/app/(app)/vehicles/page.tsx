import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { vehicleWhereForUser, vehicleLabel } from "@/modules/vehicles/service";
import { displayStage, STAGE_TONE } from "@/modules/episodes/stage";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { DataTable, type Column } from "@/components/data-table";

export const metadata: Metadata = { title: "Vehicles" };

export default async function VehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "vehicles");
  const { q } = await searchParams;

  const where = vehicleWhereForUser(user);
  const vehicles = await db.vehicle.findMany({
    where: q
      ? {
          AND: [
            where,
            {
              OR: [
                { make: { contains: q, mode: "insensitive" } },
                { model: { contains: q, mode: "insensitive" } },
                { identifiers: { some: { value: { contains: q, mode: "insensitive" } } } },
                { episodes: { some: { stockNumber: { contains: q, mode: "insensitive" } } } },
              ],
            },
          ],
        }
      : where,
    include: {
      identifiers: { where: { isPrimary: true }, take: 1 },
      episodes: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const columns: Column<(typeof vehicles)[number]>[] = [
    {
      key: "vehicle",
      header: "Vehicle",
      phone: "title",
      cell: (v) => (
        <Link href={`/vehicles/${v.id}`} className="font-medium text-brand-700 hover:underline">
          {vehicleLabel(v)}
        </Link>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      phone: "meta",
      cell: (v) => {
        const ep = v.episodes[0];
        return ep ? <Badge tone={STAGE_TONE[displayStage(ep)]}>{displayStage(ep)}</Badge> : "—";
      },
    },
    { key: "vin", header: "VIN", className: "text-stone-600", cell: (v) => v.identifiers[0]?.value ?? "—" },
    {
      key: "stock",
      header: "Stock #",
      cell: (v) => {
        const ep = v.episodes[0];
        return ep ? (
          <Link href={`/episodes/${ep.id}`} className="text-brand-700 hover:underline">
            {ep.stockNumber}
          </Link>
        ) : (
          "—"
        );
      },
    },
    {
      key: "dealType",
      header: "Deal type",
      className: "text-stone-600",
      cell: (v) => {
        const ep = v.episodes[0];
        if (!ep) return "—";
        return ep.dealType === "CONSIGNMENT" ? "Consignment" : ep.dealType === "DEALER_PURCHASE" ? "Dealer-owned" : ep.dealType;
      },
    },
    {
      key: "asking",
      header: "Asking",
      className: "text-stone-700",
      cell: (v) => {
        const ep = v.episodes[0];
        return ep?.askingPrice ? `$${Number(ep.askingPrice).toLocaleString()}` : "—";
      },
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Vehicles"
        subtitle="Every vehicle the dealership has handled — current and historical."
        actions={
          hasPermission(user, "vehicles", "create") ? (
            <Link
              href="/vehicles/new"
              className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
            >
              New vehicle
            </Link>
          ) : undefined
        }
      />

      <form className="mb-4" action="/vehicles" method="get">
        <label htmlFor="q" className="sr-only">
          Search vehicles
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q ?? ""}
          placeholder="Search make, model, VIN, stock number…"
          className="w-full max-w-md rounded-md border border-stone-300 px-3 py-2 text-sm shadow-sm"
        />
      </form>

      <DataTable
        caption="Vehicles in inventory"
        columns={columns}
        rows={vehicles}
        rowKey={(v) => v.id}
        empty={
          <EmptyState
            title="No vehicles found"
            hint={q ? "Try a different search." : "Add your first vehicle to get started."}
          />
        }
      />
    </div>
  );
}
