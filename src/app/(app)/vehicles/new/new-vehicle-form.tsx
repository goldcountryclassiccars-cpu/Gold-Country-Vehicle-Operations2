"use client";

import { useActionState } from "react";
import { createVehicleAction, type NewVehicleState } from "@/modules/vehicles/actions";
import { Field, inputClass } from "@/components/ui";

const IDENTIFIER_TYPES = [
  ["VIN", "VIN (modern 17-char)"],
  ["SHORT_VIN", "Short VIN (pre-1981)"],
  ["CHASSIS_NUMBER", "Chassis number"],
  ["SERIAL_NUMBER", "Serial number"],
  ["ENGINE_NUMBER", "Engine number"],
  ["BODY_NUMBER", "Body number"],
  ["COWL_TAG", "Cowl tag"],
  ["OTHER", "Other"],
  ["UNKNOWN_PENDING", "Unknown / pending"],
] as const;

const MILEAGE_STATUSES = [
  ["UNKNOWN", "Unknown"],
  ["ACTUAL", "Actual"],
  ["EXEMPT", "Exempt (age)"],
  ["NOT_ACTUAL", "Not actual"],
  ["TMU", "True mileage unknown"],
  ["BROKEN_ODOMETER", "Broken odometer"],
] as const;

export function NewVehicleForm({
  sources,
  canSeeAcquisitionCost,
  canSeeMinPrice,
  canSeeOwnerNotes,
}: {
  sources: { id: string; name: string }[];
  canSeeAcquisitionCost: boolean;
  canSeeMinPrice: boolean;
  canSeeOwnerNotes: boolean;
}) {
  const [state, formAction, pending] = useActionState<NewVehicleState, FormData>(createVehicleAction, {});
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form action={formAction} className="space-y-8">
      {state.error ? (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {state.error}
        </div>
      ) : null}

      <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-stone-900">Vehicle</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Year" htmlFor="year" error={err("year")}>
            <input id="year" name="year" type="number" inputMode="numeric" className={inputClass} />
          </Field>
          <Field label="Make *" htmlFor="make" error={err("make")}>
            <input id="make" name="make" required className={inputClass} />
          </Field>
          <Field label="Model *" htmlFor="model" error={err("model")}>
            <input id="model" name="model" required className={inputClass} />
          </Field>
          <Field label="Trim" htmlFor="trim">
            <input id="trim" name="trim" className={inputClass} />
          </Field>
          <Field label="Body style" htmlFor="bodyStyle">
            <input id="bodyStyle" name="bodyStyle" className={inputClass} />
          </Field>
          <Field label="Exterior color" htmlFor="exteriorColor">
            <input id="exteriorColor" name="exteriorColor" className={inputClass} />
          </Field>
          <Field label="Interior color" htmlFor="interiorColor">
            <input id="interiorColor" name="interiorColor" className={inputClass} />
          </Field>
          <Field label="Engine" htmlFor="engineDescription">
            <input id="engineDescription" name="engineDescription" className={inputClass} />
          </Field>
          <Field label="Transmission" htmlFor="transmission">
            <input id="transmission" name="transmission" className={inputClass} />
          </Field>
          <Field label="Mileage" htmlFor="mileage" error={err("mileage")}>
            <input id="mileage" name="mileage" type="number" inputMode="numeric" className={inputClass} />
          </Field>
          <Field label="Mileage status" htmlFor="mileageStatus">
            <select id="mileageStatus" name="mileageStatus" className={inputClass} defaultValue="UNKNOWN">
              {MILEAGE_STATUSES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="mt-4">
          <Field label="General description" htmlFor="generalDescription">
            <textarea id="generalDescription" name="generalDescription" rows={3} className={inputClass} />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Primary identifier type" htmlFor="identifierType" hint="Classic cars often have short or nonstandard identifiers — any length is accepted.">
            <select id="identifierType" name="identifierType" className={inputClass} defaultValue="UNKNOWN_PENDING">
              {IDENTIFIER_TYPES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Field>
          <Field label="Identifier value" htmlFor="identifierValue">
            <input id="identifierValue" name="identifierValue" className={inputClass} />
          </Field>
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-stone-900">Inventory episode</h2>
        <p className="mt-1 text-xs text-stone-500">A stock number is assigned automatically.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Deal type *" htmlFor="dealType" error={err("dealType")}>
            <select id="dealType" name="dealType" required className={inputClass}>
              <option value="DEALER_PURCHASE">Dealer purchase (dealer-owned)</option>
              <option value="CONSIGNMENT">Consignment</option>
              <option value="BROKERAGE">Brokerage</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Acquisition source" htmlFor="acquisitionSourceId">
            <select id="acquisitionSourceId" name="acquisitionSourceId" className={inputClass} defaultValue="">
              <option value="">— Select —</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Expected arrival" htmlFor="expectedArrivalAt">
            <input id="expectedArrivalAt" name="expectedArrivalAt" type="date" className={inputClass} />
          </Field>
          <Field label="Asking price ($)" htmlFor="askingPrice" error={err("askingPrice")}>
            <input id="askingPrice" name="askingPrice" type="number" inputMode="decimal" step="0.01" className={inputClass} />
          </Field>
        </div>
      </section>

      {(canSeeAcquisitionCost || canSeeMinPrice || canSeeOwnerNotes) && (
        <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-stone-900">Confidential terms</h2>
          <p className="mt-1 text-xs text-stone-500">Visible only to roles with the matching field grants.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {canSeeAcquisitionCost && (
              <Field label="Purchase price ($)" htmlFor="purchasePrice">
                <input id="purchasePrice" name="purchasePrice" type="number" inputMode="decimal" step="0.01" className={inputClass} />
              </Field>
            )}
            {canSeeMinPrice && (
              <Field label="Minimum acceptable price ($)" htmlFor="minimumAcceptablePrice">
                <input id="minimumAcceptablePrice" name="minimumAcceptablePrice" type="number" inputMode="decimal" step="0.01" className={inputClass} />
              </Field>
            )}
            {canSeeOwnerNotes && (
              <Field label="Owner notes" htmlFor="ownerNotes">
                <input id="ownerNotes" name="ownerNotes" className={inputClass} />
              </Field>
            )}
          </div>
        </section>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-brand-700 px-5 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create vehicle"}
        </button>
      </div>
    </form>
  );
}
