import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { vehicleWhereForUser, vehicleLabel } from "@/modules/vehicles/service";
import { displayStage } from "@/modules/episodes/stage";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

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
          placeholder="Search make, model, identifier, stock number…"
          className="w-full max-w-md rounded-md border border-stone-300 px-3 py-2 text-sm shadow-sm"
        />
      </form>

      {vehicles.length === 0 ? (
        <EmptyState title="No vehicles found" hint={q ? "Try a different search." : "Add your first vehicle to get started."} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-4 py-3">Vehicle</th>
                <th scope="col" className="px-4 py-3">Identifier</th>
                <th scope="col" className="px-4 py-3">Stock #</th>
                <th scope="col" className="px-4 py-3">Deal type</th>
                <th scope="col" className="px-4 py-3">Stage</th>
                <th scope="col" className="px-4 py-3">Asking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {vehicles.map((v) => {
                const ep = v.episodes[0];
                return (
                  <tr key={v.id} className="hover:bg-stone-50">
                    <td className="px-4 py-3">
                      <Link href={`/vehicles/${v.id}`} className="font-medium text-brand-700 hover:underline">
                        {vehicleLabel(v)}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-stone-600">{v.identifiers[0]?.value ?? "—"}</td>
                    <td className="px-4 py-3">
                      {ep ? (
                        <Link href={`/episodes/${ep.id}`} className="text-brand-700 hover:underline">
                          {ep.stockNumber}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-600">
                      {ep ? (ep.dealType === "CONSIGNMENT" ? "Consignment" : ep.dealType === "DEALER_PURCHASE" ? "Dealer-owned" : ep.dealType) : "—"}
                    </td>
                    <td className="px-4 py-3">{ep ? <Badge tone="brand">{displayStage(ep)}</Badge> : "—"}</td>
                    <td className="px-4 py-3 text-stone-700">
                      {ep?.askingPrice ? `$${Number(ep.askingPrice).toLocaleString()}` : "—"}
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
