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
import {
  archiveEpisodeAction,
  changeStatusAction,
  restoreEpisodeAction,
  setPriceAction,
  updateArrangementAction,
} from "@/modules/episodes/actions";
import { Badge, Card, DescriptionList, PageHeader, inputClass } from "@/components/ui";
import { intakeReadiness } from "@/modules/documents/intake";
import { consignorPayoutClock } from "@/modules/settlements/service";

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

  const [readiness, payoutClock] = await Promise.all([
    intakeReadiness(episode.id),
    episode.dealType === "CONSIGNMENT" ? consignorPayoutClock(episode.id) : null,
  ]);

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

      {!episode.active ? (
        <p className="mb-4 rounded-md border border-stone-300 bg-stone-100 p-3 text-sm text-stone-700">
          This vehicle is archived — it no longer appears in Vehicles, Pipeline or the dashboard counts. Its record and history are kept.
        </p>
      ) : null}

      {/* Intake paperwork is supposed to be done before the car is listed, so it
          belongs here rather than being discovered at closing. */}
      {readiness.items.length > 0 ? (
        <Card accent={readiness.ready ? "green" : "amber"} className="mb-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-stone-900">Paperwork needed before this car is sold</h2>
            <Badge tone={readiness.ready ? "green" : "amber"}>
              {readiness.ready ? "nothing outstanding" : `${readiness.blockers.length} outstanding`}
            </Badge>
          </div>
          <ul className="space-y-2">
            {readiness.items.map((item) => (
              <li key={item.key} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-stone-200 px-3 py-2">
                <span className="min-w-0">
                  <span className="text-sm font-medium text-stone-900">{item.name}</span>
                  <p className="text-xs text-stone-500">{item.reason}</p>
                </span>
                <Badge
                  tone={
                    item.trackedOnSale
                      ? "green"
                      : item.state === "REQUIRED"
                        ? "amber"
                        : item.state === "UNKNOWN"
                          ? "neutral"
                          : "neutral"
                  }
                >
                  {item.trackedOnSale
                    ? "done on the deal"
                    : item.state === "REQUIRED"
                      ? "needed"
                      : item.state === "UNKNOWN"
                        ? "cannot answer yet"
                        : "not needed"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {payoutClock && (payoutClock.dueBy || payoutClock.blockedBy !== "No active deal") ? (
        <Card accent={payoutClock.overdue ? "rose" : "teal"} className="mb-6">
          <h2 className="text-base font-semibold text-stone-900">Consignor payout</h2>
          {payoutClock.blockedBy ? (
            <p className="mt-1 text-sm text-stone-600">
              On hold — {payoutClock.blockedBy.toLowerCase()}. The clock starts when the buyer&rsquo;s funds clear.
            </p>
          ) : payoutClock.dueBy ? (
            <p className={`mt-1 text-sm ${payoutClock.overdue ? "font-semibold text-red-700" : "text-stone-700"}`}>
              {payoutClock.overdue
                ? `Overdue by ${Math.abs(payoutClock.daysRemaining ?? 0)} day(s) — was due ${payoutClock.dueBy.toLocaleDateString()}.`
                : `${payoutClock.daysRemaining} day(s) left — due ${payoutClock.dueBy.toLocaleDateString()}.`}
            </p>
          ) : null}
          {payoutClock.cancellationWindowEndsAt ? (
            <p className="mt-1 text-xs text-stone-500">
              Buyer cancellation window ends {payoutClock.cancellationWindowEndsAt.toLocaleString()}.
            </p>
          ) : null}
        </Card>
      ) : null}

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

          {canEdit ? (
            <Card accent="violet">
              <h2 className="mb-1 text-base font-semibold text-stone-900">Title and lien</h2>
              <p className="mb-4 text-xs text-stone-500">
                What the paperwork in the folder actually shows. These decide whether the sale needs a REG 227, a
                REG 31, a REG 262 or a lien release — and nothing else in the app records them.
              </p>
              <DescriptionList
                items={[
                  { label: "Title status", value: episode.arrangement?.titleStatus ?? "not recorded" },
                  { label: "Issued in", value: episode.arrangement?.titleState ?? "not recorded" },
                  { label: "Lien", value: episode.arrangement?.lienStatus ?? "not recorded" },
                ]}
              />
              <form action={updateArrangementAction} className="mt-4 grid gap-3 border-t border-stone-100 pt-4 sm:grid-cols-3">
                <input type="hidden" name="episodeId" value={episode.id} />
                <div>
                  <label htmlFor="title-status" className="block text-xs font-medium text-stone-500">Title status</label>
                  <select id="title-status" name="titleStatus" defaultValue={episode.arrangement?.titleStatus ?? ""} className={inputClass}>
                    <option value="">Leave unchanged</option>
                    <option value="present">In hand</option>
                    <option value="missing">Missing</option>
                    <option value="lien">Held by lienholder</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="title-state" className="block text-xs font-medium text-stone-500">Issuing state</label>
                  <input
                    id="title-state"
                    name="titleState"
                    maxLength={2}
                    placeholder="CA"
                    defaultValue={episode.arrangement?.titleState ?? ""}
                    className={`${inputClass} uppercase`}
                  />
                </div>
                <div>
                  <label htmlFor="lien-status" className="block text-xs font-medium text-stone-500">Lien</label>
                  <select id="lien-status" name="lienStatus" defaultValue={episode.arrangement?.lienStatus ?? ""} className={inputClass}>
                    <option value="">Leave unchanged</option>
                    <option value="none">None</option>
                    <option value="lien">Open lien</option>
                    <option value="released">Released</option>
                  </select>
                </div>
                <div className="sm:col-span-3">
                  <button type="submit" className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-stone-50">
                    Save title and lien
                  </button>
                </div>
              </form>
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

          {hasPermission(user, "episodes", "archive") ? (
            <Card>
              <h2 className="text-base font-semibold text-stone-900">{episode.active ? "Archive this vehicle" : "Restore this vehicle"}</h2>
              <p className="mt-1 text-sm text-stone-600">
                {episode.active
                  ? "Takes it out of Vehicles, Pipeline and the dashboard counts. Nothing is deleted and it can be restored."
                  : "Puts it back into active inventory."}
              </p>
              <form action={episode.active ? archiveEpisodeAction : restoreEpisodeAction} className="mt-3 space-y-2">
                <input type="hidden" name="episodeId" value={episode.id} />
                <label htmlFor="archive-reason" className="block text-xs font-medium text-stone-700">
                  Reason (required)
                </label>
                <input
                  id="archive-reason"
                  name="reason"
                  required
                  placeholder={episode.active ? "e.g. Consignor withdrew the car" : "e.g. Back on consignment"}
                  className={inputClass}
                />
                <button
                  type="submit"
                  className="min-h-11 w-full rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 shadow-sm hover:bg-stone-50"
                >
                  {episode.active ? "Archive" : "Restore"}
                </button>
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
