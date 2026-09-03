import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { authorize, canViewField, hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { vehicleLabel } from "@/modules/vehicles/service";
import { sanitizeArrangementForUser } from "@/modules/vehicles/sanitize";
import { displayStage, STAGE_TONE } from "@/modules/episodes/stage";
import { STATUS_DIMENSIONS, type StatusDimension } from "@/modules/episodes/service";
import { changeStatusAction, setPriceAction, updateArrangementAction } from "@/modules/episodes/actions";
import { Badge, Card, DescriptionList, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Episode" };

const DIMENSION_META: { key: StatusDimension; label: string; field: string }[] = [
  { key: "custody", label: "Custody", field: "custodyStatus" },
  { key: "reconditioning", label: "Reconditioning", field: "reconditioningStatus" },
  { key: "marketing", label: "Marketing", field: "marketingStatus" },
  { key: "sales", label: "Sales", field: "salesStatus" },
  { key: "document", label: "Documents", field: "documentStatus" },
  { key: "financial", label: "Financial close", field: "financialCloseStatus" },
];

function pretty(v: string): string {
  return v.toLowerCase().replace(/_/g, " ");
}

export default async function EpisodeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "episodes");
  const { id } = await params;

  const episode = await db.inventoryEpisode.findUnique({
    where: { id },
    include: { vehicle: true, arrangement: true, intake: true },
  });
  if (!episode) notFound();
  const assigned = [episode.salespersonId, episode.operationsOwnerId].filter(Boolean) as string[];
  if (!authorize(user, "view", "episodes", { assignedUserIds: assigned })) notFound();

  const [source, location, history, seller] = await Promise.all([
    episode.acquisitionSourceId
      ? db.acquisitionSource.findUnique({ where: { id: episode.acquisitionSourceId } })
      : null,
    episode.currentLocationId ? db.location.findUnique({ where: { id: episode.currentLocationId } }) : null,
    db.statusChange.findMany({ where: { episodeId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    episode.arrangement?.sellerPartyId && canViewField(user, "seller_pii")
      ? db.party.findUnique({ where: { id: episode.arrangement.sellerPartyId } })
      : null,
  ]);

  const canEdit = hasPermission(user, "episodes", "edit");
  const arrangement = episode.arrangement
    ? sanitizeArrangementForUser(user, episode.arrangement as unknown as Record<string, unknown>)
    : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={`${episode.stockNumber} — ${vehicleLabel(episode.vehicle)}`}
        subtitle={episode.dealType === "CONSIGNMENT" ? "Consignment" : episode.dealType === "DEALER_PURCHASE" ? "Dealer-owned" : episode.dealType}
        badge={<Badge tone={STAGE_TONE[displayStage(episode)]}>{displayStage(episode)}</Badge>}
        actions={
          <div className="flex gap-2">
            <Link href={`/vehicles/${episode.vehicleId}`} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
              Vehicle record
            </Link>
            {hasPermission(user, "intake", "create") && episode.intake?.status !== "complete" ? (
              <Link href={`/episodes/${episode.id}/intake`} className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                {episode.intake ? "Resume intake" : "Start intake"}
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-4 text-base font-semibold text-stone-900">Status</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {DIMENSION_META.map((dim) => {
                const current = (episode as unknown as Record<string, string>)[dim.field] ?? "";
                return (
                  <div key={dim.key} className="rounded-md border border-stone-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{dim.label}</p>
                      <Badge tone="brand">{pretty(current)}</Badge>
                    </div>
                    {canEdit ? (
                      <form action={changeStatusAction} className="mt-2 flex gap-1">
                        <input type="hidden" name="episodeId" value={episode.id} />
                        <input type="hidden" name="dimension" value={dim.key} />
                        <label htmlFor={`status-${dim.key}`} className="sr-only">Change {dim.label} status</label>
                        <select id={`status-${dim.key}`} name="toValue" defaultValue={current} className="w-full rounded-md border border-stone-300 px-2 py-1 text-xs">
                          {STATUS_DIMENSIONS[dim.key].map((v) => (
                            <option key={v} value={v}>{pretty(v)}</option>
                          ))}
                        </select>
                        <button type="submit" className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                          Set
                        </button>
                      </form>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-base font-semibold text-stone-900">Details</h2>
            <DescriptionList
              items={[
                { label: "Stock number", value: episode.stockNumber },
                { label: "Acquisition source", value: source?.name },
                { label: "Current location", value: location?.name },
                { label: "Accepted", value: episode.acceptedAt ? new Date(episode.acceptedAt).toLocaleDateString() : null },
                { label: "Expected arrival", value: episode.expectedArrivalAt ? new Date(episode.expectedArrivalAt).toLocaleDateString() : null },
                { label: "Arrived", value: episode.actualArrivalAt ? new Date(episode.actualArrivalAt).toLocaleDateString() : null },
                { label: "First listed", value: episode.firstListedAt ? new Date(episode.firstListedAt).toLocaleDateString() : null },
                { label: "Asking price", value: episode.askingPrice ? `$${Number(episode.askingPrice).toLocaleString()}` : null },
              ]}
            />
            {canEdit ? (
              <form action={setPriceAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-4">
                <input type="hidden" name="episodeId" value={episode.id} />
                <div>
                  <label htmlFor="askingPrice" className="block text-xs font-medium text-stone-500">New asking price ($)</label>
                  <input id="askingPrice" name="askingPrice" type="number" step="0.01" min="0" required className={inputClass} />
                </div>
                <div className="flex-1">
                  <label htmlFor="price-reason" className="block text-xs font-medium text-stone-500">Reason</label>
                  <input id="price-reason" name="reason" className={inputClass} />
                </div>
                <button type="submit" className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">
                  Update price
                </button>
              </form>
            ) : null}
          </Card>

          {arrangement && (canViewField(user, "acquisition_cost") || canViewField(user, "consignor_terms") || canViewField(user, "min_price") || canViewField(user, "owner_notes")) ? (
            <Card className="border-amber-200">
              <h2 className="mb-1 text-base font-semibold text-stone-900">Confidential arrangement</h2>
              <p className="mb-4 text-xs text-stone-500">Only fields your role is granted are shown (and editable).</p>
              <DescriptionList
                items={[
                  ...(seller ? [{ label: "Seller / consignor", value: seller.displayName }] : []),
                  ...("purchasePrice" in arrangement && arrangement.purchasePrice != null
                    ? [{ label: "Purchase price", value: `$${Number(arrangement.purchasePrice).toLocaleString()}` }]
                    : []),
                  ...("guaranteedConsignorNet" in arrangement && arrangement.guaranteedConsignorNet != null
                    ? [{ label: "Guaranteed consignor net", value: `$${Number(arrangement.guaranteedConsignorNet).toLocaleString()}` }]
                    : []),
                  ...("minimumAcceptablePrice" in arrangement && arrangement.minimumAcceptablePrice != null
                    ? [{ label: "Minimum acceptable price", value: `$${Number(arrangement.minimumAcceptablePrice).toLocaleString()}` }]
                    : []),
                  ...("ownerNotes" in arrangement && arrangement.ownerNotes != null
                    ? [{ label: "Owner notes", value: String(arrangement.ownerNotes) }]
                    : []),
                ]}
              />
              {canEdit ? (
                <form action={updateArrangementAction} className="mt-4 grid gap-3 border-t border-stone-100 pt-4 sm:grid-cols-2">
                  <input type="hidden" name="episodeId" value={episode.id} />
                  {canViewField(user, "acquisition_cost") ? (
                    <div>
                      <label htmlFor="arr-pp" className="block text-xs font-medium text-stone-500">Purchase price ($)</label>
                      <input id="arr-pp" name="purchasePrice" type="number" step="0.01" min="0" className={inputClass} />
                    </div>
                  ) : null}
                  {canViewField(user, "consignor_terms") ? (
                    <div>
                      <label htmlFor="arr-net" className="block text-xs font-medium text-stone-500">Guaranteed consignor net ($)</label>
                      <input id="arr-net" name="guaranteedConsignorNet" type="number" step="0.01" min="0" className={inputClass} />
                    </div>
                  ) : null}
                  {canViewField(user, "min_price") ? (
                    <div>
                      <label htmlFor="arr-min" className="block text-xs font-medium text-stone-500">Minimum acceptable price ($)</label>
                      <input id="arr-min" name="minimumAcceptablePrice" type="number" step="0.01" min="0" className={inputClass} />
                    </div>
                  ) : null}
                  {canViewField(user, "owner_notes") ? (
                    <div>
                      <label htmlFor="arr-notes" className="block text-xs font-medium text-stone-500">Owner notes</label>
                      <input id="arr-notes" name="ownerNotes" className={inputClass} />
                    </div>
                  ) : null}
                  <div className="sm:col-span-2">
                    <button type="submit" className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">
                      Save arrangement (only filled fields change)
                    </button>
                  </div>
                </form>
              ) : null}
            </Card>
          ) : null}

          {episode.intake ? (
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-stone-900">Intake</h2>
                <Badge tone={episode.intake.status === "complete" ? "green" : "amber"}>{episode.intake.status}</Badge>
              </div>
              <DescriptionList
                items={[
                  { label: "Received", value: episode.intake.receivedAt ? new Date(episode.intake.receivedAt).toLocaleDateString() : null },
                  { label: "Arrival method", value: episode.intake.arrivalMethod },
                  { label: "Odometer", value: episode.intake.odometerReading?.toLocaleString() },
                  { label: "Runs / drives", value: [episode.intake.starts && "starts", episode.intake.runs && "runs", episode.intake.drives && "drives", episode.intake.stops && "stops"].filter(Boolean).join(", ") || "—" },
                  { label: "Keys received", value: episode.intake.keysReceived },
                  { label: "Documents", value: episode.intake.documentsReceived },
                  { label: "Accessories", value: episode.intake.accessoriesReceived },
                  { label: "Safety concerns", value: episode.intake.safetyConcerns },
                ]}
              />
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 text-base font-semibold text-stone-900">History</h2>
            {history.length === 0 ? (
              <p className="text-sm text-stone-500">No changes recorded yet.</p>
            ) : (
              <ol className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="border-l-2 border-stone-200 pl-3 text-sm">
                    <p className="text-stone-900">
                      <span className="font-medium">{h.dimension.replace(/_/g, " ")}</span>
                      {": "}
                      {h.fromValue ? `${pretty(h.fromValue)} → ` : ""}
                      {h.dimension === "asking_price" ? `$${Number(h.toValue).toLocaleString()}` : pretty(h.toValue)}
                    </p>
                    {h.reason ? <p className="text-xs text-stone-500">{h.reason}</p> : null}
                    <p className="text-xs text-stone-400">{new Date(h.createdAt).toLocaleString()}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
