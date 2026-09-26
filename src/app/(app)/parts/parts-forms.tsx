"use client";

import { useActionState } from "react";
import {
  createPartRequestAction,
  removePartRequestAction,
  setPartOrderedAction,
  type PartsFormState,
} from "@/modules/parts/actions";
import { inputClass } from "@/components/ui";

function Alert({ state }: { state: PartsFormState }) {
  if (!state.error) return null;
  return (
    <p role="status" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
      {state.error}
    </p>
  );
}

export function AddPartForm({ defaultName }: { defaultName: string }) {
  const [state, formAction, pending] = useActionState<PartsFormState, FormData>(createPartRequestAction, {});
  return (
    <form key={state.saved ?? 0} action={formAction} className="space-y-3">
      <Alert state={state} />
      {state.saved ? (
        <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">Added to the list.</p>
      ) : null}
      <div>
        <label htmlFor="part-desc" className="block text-sm font-medium text-stone-700">What&rsquo;s needed</label>
        <textarea
          id="part-desc"
          name="description"
          required
          rows={2}
          maxLength={500}
          placeholder="e.g. Fuel pump for the '65 Mustang, or clay bars for detail"
          className={inputClass}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <label htmlFor="part-who" className="block text-sm font-medium text-stone-700">Requested by</label>
          <input
            id="part-who"
            name="requestedByName"
            required
            maxLength={80}
            defaultValue={defaultName}
            placeholder="Your name"
            autoComplete="off"
            className={inputClass}
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 shrink-0 rounded-md bg-brand-700 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:opacity-60"
        >
          {pending ? "Adding…" : "Add to list"}
        </button>
      </div>
    </form>
  );
}

export interface PartRowData {
  id: string;
  description: string;
  requestedByName: string;
  requestedOn: string;
  orderedLine: string | null; // "Ordered Sep 26 by Jade" when ticked
}

/**
 * One item. The whole left side is the checkbox's tap target — on the shop
 * iPad a 16px box is too small to hit reliably with a greasy thumb.
 */
export function PartRow({ item }: { item: PartRowData }) {
  const [toggleState, toggleAction, toggling] = useActionState<PartsFormState, FormData>(setPartOrderedAction, {});
  const [removeState, removeAction, removing] = useActionState<PartsFormState, FormData>(removePartRequestAction, {});
  const ordered = item.orderedLine !== null;

  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <form action={toggleAction} className="min-w-0 flex-1">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="ordered" value={ordered ? "0" : "1"} />
          <button
            type="submit"
            disabled={toggling}
            aria-pressed={ordered}
            aria-label={ordered ? `Mark "${item.description}" as not ordered` : `Mark "${item.description}" as ordered`}
            className="flex w-full items-start gap-3 rounded-md p-1 text-left hover:bg-stone-50 disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className={
                ordered
                  ? "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 border-green-600 bg-green-600 text-white"
                  : "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 border-stone-400 bg-white"
              }
            >
              {ordered ? (
                <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                  <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" />
                </svg>
              ) : null}
            </span>
            <span className="min-w-0">
              <span className={ordered ? "block whitespace-pre-wrap break-words text-sm text-stone-500 line-through" : "block whitespace-pre-wrap break-words text-sm font-medium text-stone-900"}>
                {item.description}
              </span>
              <span className="mt-0.5 block text-xs text-stone-500">
                {item.requestedByName} · {item.requestedOn}
                {toggling ? " · Saving…" : ""}
              </span>
              {item.orderedLine ? <span className="mt-0.5 block text-xs font-medium text-green-700">{item.orderedLine}</span> : null}
            </span>
          </button>
        </form>
        <form
          action={removeAction}
          onSubmit={(e) => {
            if (!window.confirm(`Take "${item.description}" off the list?`)) e.preventDefault();
          }}
        >
          <input type="hidden" name="id" value={item.id} />
          <button
            type="submit"
            disabled={removing}
            aria-label={`Remove "${item.description}"`}
            className="min-h-11 min-w-11 rounded-md px-2 text-sm text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-60"
          >
            ✕
          </button>
        </form>
      </div>
      {toggleState.error || removeState.error ? (
        <div className="mt-2">
          <Alert state={toggleState.error ? toggleState : removeState} />
        </div>
      ) : null}
    </li>
  );
}
