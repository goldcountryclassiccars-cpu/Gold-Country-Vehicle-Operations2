import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { listingReadiness } from "@/modules/media/service";
import { submitToListingAction } from "@/modules/media/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Listings" };

export default async function ListingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "listings");

  const episodes = await db.inventoryEpisode.findMany({
    where: { active: true, salesStatus: { in: ["AVAILABLE", "INQUIRY_ACTIVITY", "HOLD"] } },
    include: { vehicle: true },
    orderBy: { stockNumber: "asc" },
  });
  const rows = await Promise.all(episodes.map(async (e) => ({ episode: e, readiness: await listingReadiness(e.id) })));
  const canSubmit = hasPermission(user, "listings", "generate");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Listings"
        subtitle="Listing readiness per vehicle. This system stays authoritative for specs, price, and availability; the listing application handles publication."
      />

      {rows.length === 0 ? (
        <EmptyState title="No vehicles in a listable state" />
      ) : (
        <div className="space-y-4">
          {rows.map(({ episode: e, readiness }) => (
            <Card key={e.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link href={`/episodes/${e.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
                    {e.stockNumber} — {vehicleLabel(e.vehicle)}
                  </Link>
                  <p className="mt-0.5 text-xs text-stone-500">
                    Marketing: {e.marketingStatus.toLowerCase().replace(/_/g, " ")}
                    {e.askingPrice ? ` · $${Number(e.askingPrice).toLocaleString()}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={readiness.ready ? "green" : "amber"}>
                    {readiness.ready ? "ready to list" : `${readiness.checks.filter((c) => c.ok).length}/${readiness.checks.length} checks`}
                  </Badge>
                  {canSubmit && readiness.ready && !["SUBMITTED_TO_LISTING_SYSTEM", "LIVE", "MARKED_SOLD"].includes(e.marketingStatus) ? (
                    <form action={submitToListingAction}>
                      <input type="hidden" name="episodeId" value={e.id} />
                      <button type="submit" className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                        Submit to listing system
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
              <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {readiness.checks.map((c) => (
                  <li key={c.key} className="flex items-center gap-2 text-sm">
                    <span aria-hidden="true" className={c.ok ? "text-emerald-600" : "text-stone-300"}>
                      {c.ok ? "✓" : "○"}
                    </span>
                    <span className={c.ok ? "text-stone-700" : "text-stone-500"}>
                      {c.label}
                      {c.detail && !c.ok ? <span className="text-xs text-stone-400"> — {c.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
