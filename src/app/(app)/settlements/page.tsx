import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { canViewField, hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import {
  approveSettlementAction,
  closeEpisodeAction,
  createSettlementAction,
  markSettlementPaidAction,
} from "@/modules/transport/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Settlements" };

const tone = { DRAFT: "neutral", PENDING_APPROVAL: "blue", APPROVED: "amber", PAID: "green" } as const;

export default async function SettlementsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "settlements");
  const canSeeTerms = canViewField(user, "consignor_terms");

  const [settlements, settleableEpisodes] = await Promise.all([
    db.settlement.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.inventoryEpisode.findMany({
      where: {
        dealType: "CONSIGNMENT",
        active: true,
        salesStatus: { in: ["FUNDED", "RELEASED", "DELIVERED"] },
      },
      include: { vehicle: true },
    }),
  ]);
  const existingByEpisode = new Set(settlements.map((s) => s.episodeId));
  const pendingGeneration = settleableEpisodes.filter((e) => !existingByEpisode.has(e.id));

  const episodes = await db.inventoryEpisode.findMany({
    where: { id: { in: [...new Set(settlements.map((s) => s.episodeId))] } },
    include: { vehicle: true },
  });
  const epById = new Map(episodes.map((e) => [e.id, e]));
  const consignors = await db.party.findMany({
    where: { id: { in: [...new Set(settlements.map((s) => s.consignorPartyId))] } },
    select: { id: true, displayName: true },
  });
  const consignorById = new Map(consignors.map((c) => [c.id, c.displayName]));

  const canCreate = hasPermission(user, "settlements", "create");
  const canApprove = hasPermission(user, "approvals", "approve");
  const canEdit = hasPermission(user, "settlements", "edit");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Settlements"
        subtitle="Consignor payout statements: sale price, commission, expense chargebacks, net due. Payment closes the loop to financial close."
      />

      {canCreate && pendingGeneration.length > 0 ? (
        <Card className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-stone-900">Ready to settle</h2>
          <ul className="space-y-2">
            {pendingGeneration.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-sm">
                <span className="text-stone-800">{e.stockNumber} — {vehicleLabel(e.vehicle)}</span>
                <form action={createSettlementAction}>
                  <input type="hidden" name="episodeId" value={e.id} />
                  <button type="submit" className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800">
                    Generate settlement
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {settlements.length === 0 ? (
        <EmptyState title="No settlements yet" hint="Settlements are generated for funded/delivered consignment deals." />
      ) : (
        <div className="space-y-3">
          {settlements.map((s) => {
            const ep = epById.get(s.episodeId);
            const overdue = s.dueBy && s.status !== "PAID" && new Date(s.dueBy) < new Date();
            return (
              <Card key={s.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {ep ? (
                        <Link href={`/episodes/${ep.id}`} className="text-brand-700 hover:underline">
                          {ep.stockNumber} — {vehicleLabel(ep.vehicle)}
                        </Link>
                      ) : ("Episode")}
                    </p>
                    <p className="text-xs text-stone-500">
                      Consignor: {consignorById.get(s.consignorPartyId) ?? "—"}
                      {s.dueBy ? ` · due ${new Date(s.dueBy).toLocaleDateString()}` : ""}
                    </p>
                    {canSeeTerms ? (
                      <p className="mt-2 text-sm text-stone-700">
                        Sale ${Number(s.salePrice).toLocaleString()} − commission ${Number(s.commissionAmount).toLocaleString()} −
                        chargebacks ${Number(s.expenseChargebacks).toLocaleString()} ={" "}
                        <strong>net ${Number(s.netToConsignor).toLocaleString()}</strong>
                      </p>
                    ) : (
                      <p className="mt-2 text-xs text-stone-400">Financial terms restricted to roles with consignor-terms access.</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="flex gap-1">
                      {overdue ? <Badge tone="red">overdue</Badge> : null}
                      <Badge tone={tone[s.status]}>{s.status.toLowerCase().replace(/_/g, " ")}</Badge>
                    </span>
                    {s.status === "PENDING_APPROVAL" && canApprove ? (
                      <form action={approveSettlementAction}>
                        <input type="hidden" name="settlementId" value={s.id} />
                        <button type="submit" className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800">
                          Approve payout
                        </button>
                      </form>
                    ) : null}
                    {s.status === "APPROVED" && canEdit ? (
                      <form action={markSettlementPaidAction} className="flex items-end gap-1">
                        <input type="hidden" name="settlementId" value={s.id} />
                        <input name="reference" placeholder="payment ref" className={inputClass + " mt-0 w-28 px-2 py-1 text-xs"} />
                        <button type="submit" className="rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800">
                          Mark paid
                        </button>
                      </form>
                    ) : null}
                    {s.status === "PAID" && ep?.active && canEdit ? (
                      <form action={closeEpisodeAction}>
                        <input type="hidden" name="episodeId" value={s.episodeId} />
                        <button type="submit" className="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">
                          Financial close
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
