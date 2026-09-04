"use client";

import { useActionState, useState } from "react";
import { MileageStatus } from "@prisma/client";
import { Field, inputClass } from "@/components/ui";
import { updateVehicleAction, type EditVehicleState } from "@/modules/vehicles/actions";

export interface EditableVehicle {
  id: string;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  bodyStyle: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  engineDescription: string | null;
  transmission: string | null;
  drivetrain: string | null;
  mileage: number | null;
  mileageStatus: MileageStatus;
  generalDescription: string | null;
}

const MILEAGE_STATUS_LABEL: Record<MileageStatus, string> = {
  ACTUAL: "Actual",
  EXEMPT: "Exempt",
  NOT_ACTUAL: "Not actual",
  TMU: "True mileage unknown (TMU)",
  BROKEN_ODOMETER: "Broken odometer",
  UNKNOWN: "Unknown",
};

/**
 * Collapsed by default. The vehicle page is mostly a reading surface — someone
 * checking a car's details on a phone should not have to scroll past a wall of
 * inputs to reach the episodes.
 */
export function EditVehicleForm({ vehicle }: { vehicle: EditableVehicle }) {
  const [state, formAction, pending] = useActionState<EditVehicleState, FormData>(updateVehicleAction, {});
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-stone-900">Correct these details</h2>
          <p className="text-sm text-stone-600">
            Fix anything entered wrong or left blank — including mileage status, which is the odometer disclosure. Every change is audited.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="min-h-11 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium hover:bg-stone-50"
        >
          {open ? "Cancel" : "Edit"}
        </button>
      </div>

      {state.saved && !open ? <p className="mt-3 text-sm text-emerald-700">Saved.</p> : null}

      {open ? (
        <form action={formAction} className="mt-4 grid gap-3 border-t border-stone-100 pt-4 sm:grid-cols-2">
          <input type="hidden" name="vehicleId" value={vehicle.id} />

          <Field label="Year" htmlFor="year">
            <input id="year" name="year" type="number" defaultValue={vehicle.year ?? ""} className={inputClass} />
          </Field>
          <Field label="Make" htmlFor="make">
            <input id="make" name="make" required defaultValue={vehicle.make} className={inputClass} />
          </Field>
          <Field label="Model" htmlFor="model">
            <input id="model" name="model" required defaultValue={vehicle.model} className={inputClass} />
          </Field>
          <Field label="Trim" htmlFor="trim">
            <input id="trim" name="trim" defaultValue={vehicle.trim ?? ""} className={inputClass} />
          </Field>
          <Field label="Body style" htmlFor="bodyStyle">
            <input id="bodyStyle" name="bodyStyle" defaultValue={vehicle.bodyStyle ?? ""} className={inputClass} />
          </Field>
          <Field label="Exterior color" htmlFor="exteriorColor">
            <input id="exteriorColor" name="exteriorColor" defaultValue={vehicle.exteriorColor ?? ""} className={inputClass} />
          </Field>
          <Field label="Interior color" htmlFor="interiorColor">
            <input id="interiorColor" name="interiorColor" defaultValue={vehicle.interiorColor ?? ""} className={inputClass} />
          </Field>
          <Field label="Engine" htmlFor="engineDescription">
            <input id="engineDescription" name="engineDescription" defaultValue={vehicle.engineDescription ?? ""} className={inputClass} />
          </Field>
          <Field label="Transmission" htmlFor="transmission">
            <input id="transmission" name="transmission" defaultValue={vehicle.transmission ?? ""} className={inputClass} />
          </Field>
          <Field label="Drivetrain" htmlFor="drivetrain">
            <input id="drivetrain" name="drivetrain" defaultValue={vehicle.drivetrain ?? ""} className={inputClass} />
          </Field>
          <Field label="Mileage" htmlFor="mileage">
            <input id="mileage" name="mileage" type="number" defaultValue={vehicle.mileage ?? ""} className={inputClass} />
          </Field>
          <Field label="Mileage status" htmlFor="mileageStatus">
            <select id="mileageStatus" name="mileageStatus" defaultValue={vehicle.mileageStatus} className={inputClass}>
              {Object.values(MileageStatus).map((v) => (
                <option key={v} value={v}>
                  {MILEAGE_STATUS_LABEL[v]}
                </option>
              ))}
            </select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="Description" htmlFor="generalDescription">
              <textarea
                id="generalDescription"
                name="generalDescription"
                rows={5}
                defaultValue={vehicle.generalDescription ?? ""}
                className={inputClass}
              />
            </Field>
          </div>

          {state.error ? (
            <p role="alert" className="sm:col-span-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {state.error}
            </p>
          ) : null}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="min-h-11 rounded-md bg-brand-700 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-800 disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
