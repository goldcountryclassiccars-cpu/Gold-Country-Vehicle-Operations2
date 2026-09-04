import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { authorize, hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { vehicleLabel } from "@/modules/vehicles/service";
import { addIdentifierAction } from "@/modules/vehicles/actions";
import { EditVehicleForm } from "./edit-vehicle-form";
import { displayStage, STAGE_TONE } from "@/modules/episodes/stage";
import { Badge, Card, DescriptionList, EmptyState, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Vehicle" };

const IDENTIFIER_LABEL: Record<string, string> = {
  VIN: "VIN",
  SHORT_VIN: "Short VIN",
  CHASSIS_NUMBER: "Chassis #",
  SERIAL_NUMBER: "Serial #",
  ENGINE_NUMBER: "Engine #",
  BODY_NUMBER: "Body #",
  COWL_TAG: "Cowl tag",
  OTHER: "Other",
  UNKNOWN_PENDING: "Unknown/pending",
};

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "vehicles");
  const { id } = await params;

  const vehicle = await db.vehicle.findUnique({
    where: { id },
    include: {
      identifiers: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      episodes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!vehicle) notFound();

  // Record-scope check: non-ALL users must be assigned to at least one episode.
  const assigned = vehicle.episodes.flatMap((e) => [e.salespersonId, e.operationsOwnerId]).filter(Boolean) as string[];
  if (!authorize(user, "view", "vehicles", { assignedUserIds: assigned })) notFound();

  const canEdit = hasPermission(user, "vehicles", "edit");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={vehicleLabel(vehicle)}
        subtitle={vehicle.generalDescription ?? undefined}
        actions={
          hasPermission(user, "episodes", "create") ? (
            <span className="text-xs text-stone-500">
              Repeat acquisition? A new episode can be started from Administration in a later phase.
            </span>
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-base font-semibold text-stone-900">Specifications</h2>
          <DescriptionList
            items={[
              { label: "Year", value: vehicle.year },
              { label: "Make", value: vehicle.make },
              { label: "Model", value: vehicle.model },
              { label: "Trim", value: vehicle.trim },
              { label: "Body style", value: vehicle.bodyStyle },
              { label: "Exterior", value: vehicle.exteriorColor },
              { label: "Interior", value: vehicle.interiorColor },
              { label: "Engine", value: vehicle.engineDescription },
              { label: "Transmission", value: vehicle.transmission },
              { label: "Mileage", value: vehicle.mileage ? `${vehicle.mileage.toLocaleString()} (${vehicle.mileageStatus})` : vehicle.mileageStatus },
              { label: "Matching numbers", value: vehicle.matchingNumbers },
              { label: "Title brand", value: vehicle.titleBrand },
            ]}
          />
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold text-stone-900">VIN &amp; numbers</h2>
          {vehicle.identifiers.length === 0 ? (
            <p className="text-sm text-stone-500">No identifiers recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {vehicle.identifiers.map((i) => (
                <li key={i.id} className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-stone-900">{IDENTIFIER_LABEL[i.type] ?? i.type}:</span>{" "}
                    <span className="font-mono">{i.value}</span>
                  </span>
                  <span className="flex gap-1">
                    {i.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
                    <Badge tone={i.verification === "VERIFIED" ? "green" : i.verification === "MISMATCH" ? "red" : "neutral"}>
                      {i.verification.toLowerCase()}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canEdit ? (
            <form action={addIdentifierAction} className="mt-4 flex flex-wrap items-end gap-2">
              <input type="hidden" name="vehicleId" value={vehicle.id} />
              <div>
                <label htmlFor="ident-type" className="block text-xs font-medium text-stone-500">Type</label>
                <select id="ident-type" name="type" className={inputClass}>
                  {Object.entries(IDENTIFIER_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label htmlFor="ident-value" className="block text-xs font-medium text-stone-500">Value</label>
                <input id="ident-value" name="value" required className={inputClass} />
              </div>
              <button type="submit" className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">
                Add
              </button>
            </form>
          ) : null}
        </Card>
      </div>

      {canEdit ? (
        <div className="mt-6">
          <EditVehicleForm
            vehicle={{
              id: vehicle.id,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              trim: vehicle.trim,
              bodyStyle: vehicle.bodyStyle,
              exteriorColor: vehicle.exteriorColor,
              interiorColor: vehicle.interiorColor,
              engineDescription: vehicle.engineDescription,
              transmission: vehicle.transmission,
              drivetrain: vehicle.drivetrain,
              mileage: vehicle.mileage,
              mileageStatus: vehicle.mileageStatus,
              generalDescription: vehicle.generalDescription,
            }}
          />
        </div>
      ) : null}

      <div className="mt-6">
        <h2 className="mb-3 text-base font-semibold text-stone-900">Inventory episodes</h2>
        {vehicle.episodes.length === 0 ? (
          <EmptyState title="No inventory episodes" />
        ) : (
          <div className="space-y-3">
            {vehicle.episodes.map((e) => (
              <Link
                key={e.id}
                href={`/episodes/${e.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-sm hover:border-brand-600"
              >
                <div>
                  <p className="font-medium text-stone-900">{e.stockNumber}</p>
                  <p className="text-xs text-stone-500">
                    {e.dealType === "CONSIGNMENT" ? "Consignment" : e.dealType === "DEALER_PURCHASE" ? "Dealer-owned" : e.dealType}
                    {" · accepted "}
                    {e.acceptedAt ? new Date(e.acceptedAt).toLocaleDateString() : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {e.askingPrice ? <span className="text-sm text-stone-700">${Number(e.askingPrice).toLocaleString()}</span> : null}
                  <Badge tone={e.active ? STAGE_TONE[displayStage(e)] : "neutral"}>{displayStage(e)}</Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
