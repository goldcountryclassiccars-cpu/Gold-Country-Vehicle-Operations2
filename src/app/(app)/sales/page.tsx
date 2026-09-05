import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { getScope, hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { createSaleAction } from "@/modules/sales/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader, inputClass } from "@/components/ui";
import { consignorPayoutClock } from "@/modules/settlements/service";

export const metadata: Metadata = { title: "Deals in Progress" };

const statusTone = {
  DRAFT: "neutral",
  DEPOSIT_REQUESTED: "blue",
  DEPOSIT_RECEIVED: "blue",
  CONTRACTED: "brand",
  FUNDS_PENDING: "amber",
  FUNDED: "amber",
  RELEASED: "green",
  DELIVERED: "green",
  COMPLETE: "green",
  CANCELED: "red",
  UNWOUND: "red",
} as const;

export default async function SalesPage({
  searchParams,
}: {
  // The Pipeline's "Start a deal" button links here with the car already
  // chosen, so the person is not re-picking a vehicle they just tapped.
  searchParams: Promise<{ episode?: string }>;
}) {
  const { episode: preselect } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "sales");

  const scope = getScope(user, "sales", "view");
  const where = scope === "ALL" ? {} : { OR: [{ salespersonId: user.id }, { createdById: user.id }] };

  const [sales, availableEpisodes] = await Promise.all([
    db.saleTransaction.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 }),
    hasPermission(user, "sales", "create")
      ? db.inventoryEpisode.findMany({
          where: { active: true, salesStatus: { in: ["AVAILABLE", "INQUIRY_ACTIVITY", "HOLD"] } },
          include: { vehicle: true },
          orderBy: { stockNumber: "asc" },
        })
      : [],
  ]);

  const episodeIds = [...new Set(sales.map((s) => s.episodeId))];
  const [episodes, buyers] = await Promise.all([
    db.inventoryEpisode.findMany({ where: { id: { in: episodeIds } }, include: { vehicle: true } }),
    db.party.findMany({ where: { id: { in: [...new Set(sales.map((s) => s.buyerPartyId))] } }, select: { id: true, displayName: true } }),
  ]);
  const epById = new Map(episodes.map((e) => [e.id, e]));

  // What is outstanding per deal, in one query rather than one per row — this
  // list is the first screen of the morning and has to stay fast.
  const outstanding = await db.saleDocumentRequirement.groupBy({
    by: ["saleId"],
    where: { saleId: { in: sales.map((sale) => sale.id) }, state: { in: ["REQUIRED", "UNKNOWN"] }, complete: false },
    _count: { _all: true },
  });
  const blockersBySale = new Map(outstanding.map((row) => [row.saleId, row._count._all]));

  // Consignor payout countdowns, for the consignment deals on this list.
  const consignmentEpisodeIds = episodes.filter((e) => e.dealType === "CONSIGNMENT").map((e) => e.id);
  const clocks = new Map(
    await Promise.all(
      consignmentEpisodeIds.map(async (id) => [id, await consignorPayoutClock(id)] as const),
    ),
  );
  const buyerById = new Map(buyers.map((b) => [b.id, b.displayName]));

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Deals in Progress" subtitle="Deals from first deposit through delivery. Canceled deals stay on record." />

      {availableEpisodes.length > 0 ? (
        <Card className="mb-6" accent="fuchsia">
          <h2 className="mb-3 text-sm font-semibold text-stone-900">New deal</h2>
          <form action={createSaleAction} className="grid gap-2 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label htmlFor="s-episode" className="block text-xs font-medium text-stone-500">Vehicle</label>
              <select id="s-episode" name="episodeId" defaultValue={preselect} required className={inputClass}>
                {availableEpisodes.map((e) => (
                  <option key={e.id} value={e.id}>{e.stockNumber} — {vehicleLabel(e.vehicle)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="s-price" className="block text-xs font-medium text-stone-500">Agreed price ($)</label>
              <input id="s-price" name="agreedPrice" type="number" min="0" step="0.01" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="s-deposit" className="block text-xs font-medium text-stone-500">Deposit ($)</label>
              <input id="s-deposit" name="depositAmount" type="number" min="0" step="0.01" className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="s-buyer" className="block text-xs font-medium text-stone-500">Buyer name</label>
              <input id="s-buyer" name="buyerName" required className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="s-email" className="block text-xs font-medium text-stone-500">Buyer email</label>
              <input id="s-email" name="buyerEmail" type="email" className={inputClass} />
            </div>
            <div>
              <label htmlFor="s-phone" className="block text-xs font-medium text-stone-500">Buyer phone</label>
              <input id="s-phone" name="buyerPhone" className={inputClass} />
            </div>
            <div>
              <label htmlFor="s-state" className="block text-xs font-medium text-stone-500">Buyer state</label>
              <input id="s-state" name="buyerState" maxLength={2} className={inputClass} placeholder="CA" />
            </div>
            <div className="flex items-end sm:col-span-2">
              <button type="submit" className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
                Open deal
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {sales.length === 0 ? (
        <EmptyState title="No deals in your scope" />
      ) : (
        <div className="space-y-2">
          {sales.map((s) => {
            const ep = epById.get(s.episodeId);
            const blockers = blockersBySale.get(s.id) ?? 0;
            const clock = ep?.dealType === "CONSIGNMENT" ? clocks.get(ep.id) : null;
            return (
              <Link
                key={s.id}
                href={`/sales/${s.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white p-4 shadow-sm hover:border-brand-600"
              >
                <div>
                  <p className="text-sm font-medium text-stone-900">
                    {ep ? `${ep.stockNumber} — ${vehicleLabel(ep.vehicle)}` : "Deal"}
                  </p>
                  <p className="text-xs text-stone-500">
                    {buyerById.get(s.buyerPartyId) ?? "Buyer"} · ${Number(s.agreedPrice).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {blockers ? (
                    <Badge tone={blockers > 0 ? "amber" : "green"}>
                      {blockers} doc{blockers === 1 ? "" : "s"} outstanding
                    </Badge>
                  ) : null}
                  {clock?.dueBy && !clock.blockedBy ? (
                    <Badge tone={clock.overdue ? "red" : "teal"}>
                      {clock.overdue
                        ? `payout ${Math.abs(clock.daysRemaining ?? 0)}d overdue`
                        : `payout in ${clock.daysRemaining}d`}
                    </Badge>
                  ) : null}
                  <Badge tone={statusTone[s.status]}>{s.status.toLowerCase().replace(/_/g, " ")}</Badge>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
