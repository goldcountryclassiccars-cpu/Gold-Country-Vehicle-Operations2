import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { createTransportJobAction, setTransportStatusAction } from "@/modules/transport/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Transport" };

const NEXT: Record<string, { value: string; label: string }[]> = {
  QUOTE_REQUESTED: [{ value: "QUOTED", label: "Record quote" }, { value: "CANCELED", label: "Cancel" }],
  QUOTED: [{ value: "BOOKED", label: "Book" }, { value: "CANCELED", label: "Cancel" }],
  BOOKED: [{ value: "PICKUP_SCHEDULED", label: "Schedule pickup" }, { value: "CANCELED", label: "Cancel" }],
  PICKUP_SCHEDULED: [{ value: "IN_TRANSIT", label: "In transit" }],
  IN_TRANSIT: [{ value: "DELIVERED", label: "Delivered" }],
  DELIVERED: [],
  CANCELED: [],
};

const tone = {
  QUOTE_REQUESTED: "neutral",
  QUOTED: "blue",
  BOOKED: "brand",
  PICKUP_SCHEDULED: "blue",
  IN_TRANSIT: "amber",
  DELIVERED: "green",
  CANCELED: "red",
} as const;

export default async function TransportPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "transport");

  const [jobs, episodes] = await Promise.all([
    db.transportJob.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 50 }),
    db.inventoryEpisode.findMany({ where: { active: true }, include: { vehicle: true }, orderBy: { stockNumber: "asc" } }),
  ]);
  const epById = new Map(episodes.map((e) => [e.id, e]));
  const canCreate = hasPermission(user, "transport", "create");
  const canEdit = hasPermission(user, "transport", "edit");
  const canComplete = hasPermission(user, "transport", "complete");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Transport" subtitle="Inbound and outbound vehicle movements — quotes, bookings, custody hand-offs." />

      {canCreate ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-stone-900">New transport job</h2>
          <form action={createTransportJobAction} className="grid gap-2 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label htmlFor="t-episode" className="block text-xs font-medium text-stone-500">Vehicle</label>
              <select id="t-episode" name="episodeId" required className={inputClass}>
                {episodes.map((e) => (
                  <option key={e.id} value={e.id}>{e.stockNumber} — {vehicleLabel(e.vehicle)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="t-dir" className="block text-xs font-medium text-stone-500">Direction</label>
              <select id="t-dir" name="direction" className={inputClass}>
                <option value="OUTBOUND">Outbound (delivery)</option>
                <option value="INBOUND">Inbound (acquisition)</option>
              </select>
            </div>
            <div>
              <label htmlFor="t-quote" className="block text-xs font-medium text-stone-500">Quote ($)</label>
              <input id="t-quote" name="quoteAmount" type="number" min="0" step="0.01" className={inputClass} />
            </div>
            <div>
              <label htmlFor="t-pickup" className="block text-xs font-medium text-stone-500">Pickup</label>
              <input id="t-pickup" name="pickupLocation" className={inputClass} placeholder="Grass Valley, CA" />
            </div>
            <div>
              <label htmlFor="t-delivery" className="block text-xs font-medium text-stone-500">Delivery</label>
              <input id="t-delivery" name="deliveryLocation" className={inputClass} />
            </div>
            <div className="sm:col-span-6">
              <button type="submit" className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                Create job
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {jobs.length === 0 ? (
        <EmptyState title="No transport jobs" />
      ) : (
        <div className="space-y-2">
          {jobs.map((j) => {
            const ep = epById.get(j.episodeId);
            const transitions = (NEXT[j.status] ?? []).filter((t) => (t.value === "DELIVERED" ? canComplete : canEdit));
            return (
              <Card key={j.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {ep ? (
                        <Link href={`/episodes/${ep.id}`} className="text-brand-700 hover:underline">
                          {ep.stockNumber} — {vehicleLabel(ep.vehicle)}
                        </Link>
                      ) : ("Vehicle")}
                    </p>
                    <p className="text-xs text-stone-500">
                      {j.direction === "OUTBOUND" ? "Outbound" : "Inbound"}
                      {j.pickupLocation ? ` · ${j.pickupLocation}` : ""}
                      {j.deliveryLocation ? ` → ${j.deliveryLocation}` : ""}
                      {j.quoteAmount ? ` · quote $${Number(j.quoteAmount).toLocaleString()}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={tone[j.status]}>{j.status.toLowerCase().replace(/_/g, " ")}</Badge>
                    {transitions.length ? (
                      <form action={setTransportStatusAction} className="flex flex-wrap items-center gap-1">
                        <input type="hidden" name="jobId" value={j.id} />
                        {j.status === "QUOTE_REQUESTED" ? (
                          <input name="quoteAmount" type="number" min="0" step="0.01" placeholder="quote $" className="w-20 rounded-md border border-stone-300 px-1 py-0.5 text-xs" />
                        ) : null}
                        {j.status === "IN_TRANSIT" ? (
                          <input name="actualCost" type="number" min="0" step="0.01" placeholder="actual $" className="w-20 rounded-md border border-stone-300 px-1 py-0.5 text-xs" />
                        ) : null}
                        {transitions.map((t) => (
                          <button key={t.value} type="submit" name="status" value={t.value} className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                            {t.label}
                          </button>
                        ))}
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
