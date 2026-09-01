import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { canViewField, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { displayStage } from "@/modules/episodes/stage";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Consignments" };

export default async function ConsignmentsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "consignments");
  const canSeeTerms = canViewField(user, "consignor_terms");
  const canSeeSellers = canViewField(user, "seller_pii");

  const episodes = await db.inventoryEpisode.findMany({
    where: { dealType: "CONSIGNMENT" },
    include: { vehicle: true, arrangement: true },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
  const consignorIds = [...new Set(episodes.map((e) => e.arrangement?.sellerPartyId).filter(Boolean))] as string[];
  const consignors = canSeeSellers
    ? await db.party.findMany({ where: { id: { in: consignorIds } }, select: { id: true, displayName: true } })
    : [];
  const consignorById = new Map(consignors.map((c) => [c.id, c.displayName]));
  const settlements = await db.settlement.findMany({ where: { episodeId: { in: episodes.map((e) => e.id) } } });
  const settlementByEp = new Map(settlements.map((s) => [s.episodeId, s]));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Consignments" subtitle="Every consignment arrangement — agreement window, terms, and settlement state." />

      {episodes.length === 0 ? (
        <EmptyState title="No consignment vehicles" />
      ) : (
        <div className="space-y-3">
          {episodes.map((e) => {
            const s = settlementByEp.get(e.id);
            const arr = e.arrangement;
            return (
              <div key={e.id} className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Link href={`/episodes/${e.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
                      {e.stockNumber} — {vehicleLabel(e.vehicle)}
                    </Link>
                    <p className="text-xs text-stone-500">
                      {canSeeSellers && arr?.sellerPartyId ? `Consignor: ${consignorById.get(arr.sellerPartyId) ?? "—"} · ` : ""}
                      Stage: {displayStage(e)}
                      {arr?.agreementExpiresAt ? ` · agreement expires ${new Date(arr.agreementExpiresAt).toLocaleDateString()}` : ""}
                    </p>
                    {canSeeTerms && arr ? (
                      <p className="mt-1 text-xs text-stone-600">
                        {arr.guaranteedConsignorNet != null
                          ? `Guaranteed net $${Number(arr.guaranteedConsignorNet).toLocaleString()}`
                          : arr.commissionStructure
                            ? `Commission: ${JSON.stringify(arr.commissionStructure)}`
                            : "Terms not recorded"}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {s ? (
                      <Link href="/settlements">
                        <Badge tone={s.status === "PAID" ? "green" : "amber"}>settlement {s.status.toLowerCase().replace(/_/g, " ")}</Badge>
                      </Link>
                    ) : (
                      <Badge tone={e.active ? "brand" : "neutral"}>{e.active ? "active" : "closed"}</Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
