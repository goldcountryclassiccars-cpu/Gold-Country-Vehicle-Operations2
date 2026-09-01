import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { vehicleLabel } from "@/modules/vehicles/service";
import { saveIntakeAction } from "@/modules/intake/actions";
import { PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Intake" };

const MILEAGE_STATUSES = ["UNKNOWN", "ACTUAL", "EXEMPT", "NOT_ACTUAL", "TMU", "BROKEN_ODOMETER"];

export default async function IntakePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "create", "intake");
  const { id } = await params;

  const episode = await db.inventoryEpisode.findUnique({
    where: { id },
    include: { vehicle: true, intake: true },
  });
  if (!episode) notFound();
  const intake = episode.intake;
  const locations = await db.location.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={`Intake — ${episode.stockNumber}`}
        subtitle={`${vehicleLabel(episode.vehicle)}. Save a draft anytime; completing intake marks the vehicle on-site.`}
      />

      <form action={saveIntakeAction} className="space-y-6">
        <input type="hidden" name="episodeId" value={episode.id} />

        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-stone-900">Arrival</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="arrivalMethod" className="block text-sm font-medium text-stone-700">Arrival method</label>
              <select id="arrivalMethod" name="arrivalMethod" defaultValue={intake?.arrivalMethod ?? ""} className={inputClass}>
                <option value="">— Select —</option>
                <option value="carrier">Carrier</option>
                <option value="driven">Driven in</option>
                <option value="towed">Towed</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="initialLocationId" className="block text-sm font-medium text-stone-700">Initial location</label>
              <select id="initialLocationId" name="initialLocationId" defaultValue={intake?.initialLocationId ?? ""} className={inputClass}>
                <option value="">— Select —</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="odometerReading" className="block text-sm font-medium text-stone-700">Odometer reading</label>
              <input id="odometerReading" name="odometerReading" type="number" inputMode="numeric" min="0" defaultValue={intake?.odometerReading ?? ""} className={inputClass} />
            </div>
            <div>
              <label htmlFor="mileageStatus" className="block text-sm font-medium text-stone-700">Mileage status</label>
              <select id="mileageStatus" name="mileageStatus" defaultValue={intake?.mileageStatus ?? ""} className={inputClass}>
                <option value="">— Select —</option>
                {MILEAGE_STATUSES.map((m) => (
                  <option key={m} value={m}>{m.toLowerCase().replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="fuelLevel" className="block text-sm font-medium text-stone-700">Fuel level</label>
              <input id="fuelLevel" name="fuelLevel" defaultValue={intake?.fuelLevel ?? ""} className={inputClass} placeholder="e.g. 1/2" />
            </div>
            <div>
              <label htmlFor="keysReceived" className="block text-sm font-medium text-stone-700">Keys received</label>
              <input id="keysReceived" name="keysReceived" type="number" inputMode="numeric" min="0" defaultValue={intake?.keysReceived ?? ""} className={inputClass} />
            </div>
          </div>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-stone-700">Basic function check</legend>
            <div className="mt-2 flex flex-wrap gap-4">
              {(["identityVerified", "starts", "runs", "drives", "stops"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm text-stone-700">
                  <input type="checkbox" name={k} defaultChecked={Boolean(intake?.[k])} className="h-4 w-4 rounded border-stone-300" />
                  {k === "identityVerified" ? "Identity verified" : k.charAt(0).toUpperCase() + k.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-stone-900">Condition</h2>
          <div className="mt-4 grid gap-4">
            {([
              ["exteriorDamageNotes", "Exterior damage notes"],
              ["interiorDamageNotes", "Interior damage notes"],
              ["tireCondition", "Tire condition"],
              ["transportDamageNotes", "Transport damage (if carrier)"],
              ["sellerReportedIssues", "Seller-reported issues"],
              ["safetyConcerns", "Safety concerns"],
              ["documentsReceived", "Documents received"],
              ["accessoriesReceived", "Accessories received"],
              ["notes", "Other notes"],
            ] as const).map(([name, label]) => (
              <div key={name}>
                <label htmlFor={name} className="block text-sm font-medium text-stone-700">{label}</label>
                <textarea id={name} name={name} rows={2} defaultValue={(intake?.[name] as string | null) ?? ""} className={inputClass} />
              </div>
            ))}
          </div>
        </section>

        <div className="flex gap-3">
          <button type="submit" name="mode" value="draft" className="rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50">
            Save draft
          </button>
          <button type="submit" name="mode" value="complete" className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
            Complete intake
          </button>
        </div>
      </form>
    </div>
  );
}
