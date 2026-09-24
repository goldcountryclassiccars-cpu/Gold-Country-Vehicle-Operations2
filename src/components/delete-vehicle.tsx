import { archiveEpisodeAction } from "@/modules/episodes/actions";
import { inputClass } from "@/components/ui";

/**
 * The "Delete vehicle" control at the top of a vehicle's page.
 *
 * "Delete" here is the archive: the car comes off Vehicles, the Pipeline and
 * the dashboard immediately, but its record and history are kept and an Admin
 * can bring it back (Vehicles → Show archived → open the car → Restore).
 * A dealership record is never destroyed — a car "deleted" by mistake, or a
 * consignment that comes back next year, must still have its history.
 *
 * Rendered only for users holding episodes:archive (Admin), and never for a
 * car with a deal in progress — hiding a live sale would be the expensive
 * kind of tidy.
 */
export function DeleteVehicleControl({ episodeId, stockNumber }: { episodeId: string; stockNumber: string }) {
  return (
    <details className="relative">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 [&::-webkit-details-marker]:hidden">
        Delete vehicle
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-80 max-w-[88vw] rounded-lg border border-stone-200 bg-white p-4 shadow-lg">
        <p className="text-sm font-semibold text-stone-900">Delete {stockNumber}?</p>
        <p className="mt-1 text-xs text-stone-600">
          It comes off Vehicles, the Pipeline and the dashboard right away. Its history is kept, and
          an Admin can bring it back later under Vehicles → Show archived.
        </p>
        <form action={archiveEpisodeAction} className="mt-3 space-y-2">
          <input type="hidden" name="episodeId" value={episodeId} />
          <label htmlFor={`delete-reason-${episodeId}`} className="block text-xs font-medium text-stone-700">
            Why? (required)
          </label>
          <input
            id={`delete-reason-${episodeId}`}
            name="reason"
            required
            placeholder="e.g. Demo car, or consignor withdrew"
            className={inputClass + " mt-0"}
          />
          <button
            type="submit"
            className="min-h-11 w-full rounded-md border border-red-800 bg-red-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-800 active:bg-red-900"
          >
            Yes, delete it
          </button>
        </form>
      </div>
    </details>
  );
}
