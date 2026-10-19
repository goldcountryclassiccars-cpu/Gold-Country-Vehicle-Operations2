"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveListingAction, type ListingFormState } from "@/modules/listings/actions";
import { inputClass } from "@/components/ui";

interface Initial {
  title: string;
  headline: string;
  highlights: string;
  description: string;
  equipment: string;
  history: string;
  condition: string;
  documentation: string;
  priceDisplay: "SHOW" | "CALL_FOR_PRICE";
  askingPrice: string;
}

const SECTIONS: { name: keyof Initial; label: string; hint: string; rows: number; placeholder: string }[] = [
  {
    name: "description",
    label: "Overview",
    hint: "The opening a buyer reads first: what the car is, why it matters, how it presents. Required.",
    rows: 8,
    placeholder: "Offered from long-term California ownership, this numbers-matching …",
  },
  {
    name: "equipment",
    label: "Equipment & options",
    hint: "Factory options, upgrades, what's been added.",
    rows: 5,
    placeholder: "Factory air conditioning, power steering, AM/FM radio …",
  },
  {
    name: "history",
    label: "History & provenance",
    hint: "Owners, where it has lived, restoration story, awards.",
    rows: 6,
    placeholder: "Sold new in Sacramento; three owners from new …",
  },
  {
    name: "condition",
    label: "Condition",
    hint: "Honest notes — out-of-state buyers rely on this. Mention flaws plainly.",
    rows: 6,
    placeholder: "Paint presents well with a few small chips on the hood edge …",
  },
  {
    name: "documentation",
    label: "Documentation & records",
    hint: "What comes with the car: build sheet, Marti report, receipts, manuals, keys.",
    rows: 4,
    placeholder: "Original window sticker, Marti report, restoration receipts …",
  },
];

export function WriteupForm({ episodeId, canEdit, initial }: { episodeId: string; canEdit: boolean; initial: Initial }) {
  const [state, formAction, pending] = useActionState<ListingFormState, FormData>(saveListingAction, {});
  const [dirty, setDirty] = useState(false);
  const [priceDisplay, setPriceDisplay] = useState(initial.priceDisplay);
  const formRef = useRef<HTMLFormElement>(null);

  // A successful save clears the "unsaved" marker.
  useEffect(() => {
    if (state.saved) setDirty(false);
  }, [state.saved]);

  // Leaving with unsaved words is the one loss worth a browser warning.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const disabled = !canEdit;

  return (
    <form ref={formRef} action={formAction} onChange={() => setDirty(true)} className="space-y-5">
      <input type="hidden" name="episodeId" value={episodeId} />

      <div>
        <label htmlFor="lt-title" className="block text-sm font-medium text-stone-800">
          Title
        </label>
        <input
          id="lt-title"
          name="title"
          defaultValue={initial.title}
          maxLength={120}
          required
          disabled={disabled}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-stone-500">Year, make, model and the one detail that sells it. Under 120 characters.</p>
      </div>

      <div>
        <label htmlFor="lt-headline" className="block text-sm font-medium text-stone-800">
          Headline <span className="font-normal text-stone-500">(optional)</span>
        </label>
        <input
          id="lt-headline"
          name="headline"
          defaultValue={initial.headline}
          maxLength={160}
          disabled={disabled}
          placeholder="e.g. Numbers-matching 327, fresh frame-off restoration"
          className={inputClass}
        />
      </div>

      <fieldset className="rounded-md border border-stone-200 p-3">
        <legend className="px-1 text-sm font-medium text-stone-800">Price</legend>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="lt-price" className="block text-xs font-medium text-stone-600">
              Asking price
            </label>
            <div className="relative mt-1">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-stone-500">$</span>
              <input
                id="lt-price"
                name="askingPrice"
                inputMode="numeric"
                defaultValue={initial.askingPrice}
                disabled={disabled}
                placeholder="79900"
                className={inputClass + " mt-0 w-40 pl-7"}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="priceDisplay"
                value="SHOW"
                checked={priceDisplay === "SHOW"}
                onChange={() => setPriceDisplay("SHOW")}
                disabled={disabled}
              />
              Show the price
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="priceDisplay"
                value="CALL_FOR_PRICE"
                checked={priceDisplay === "CALL_FOR_PRICE"}
                onChange={() => setPriceDisplay("CALL_FOR_PRICE")}
                disabled={disabled}
              />
              Show “Call for price”
            </label>
          </div>
        </div>
        <p className="mt-2 text-xs text-stone-500">This is the car&rsquo;s asking price everywhere in the app — changing it here is recorded in its price history.</p>
      </fieldset>

      <div>
        <label htmlFor="lt-highlights" className="block text-sm font-medium text-stone-800">
          Highlights <span className="font-normal text-stone-500">(one per line)</span>
        </label>
        <textarea
          id="lt-highlights"
          name="highlights"
          rows={5}
          defaultValue={initial.highlights}
          disabled={disabled}
          placeholder={"Numbers-matching 327/300hp V8\n4-speed Muncie manual\nOriginal California black plate car"}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-stone-500">Short bullet points — three to eight read best. Shown at the top of the listing.</p>
      </div>

      {SECTIONS.map((s) => (
        <div key={s.name}>
          <label htmlFor={`lt-${s.name}`} className="block text-sm font-medium text-stone-800">
            {s.label}
          </label>
          <p className="text-xs text-stone-500">{s.hint}</p>
          <textarea
            id={`lt-${s.name}`}
            name={s.name}
            rows={s.rows}
            defaultValue={initial[s.name]}
            disabled={disabled}
            placeholder={s.placeholder}
            className={inputClass}
          />
        </div>
      ))}

      {canEdit ? (
        // Sticky so Save is always in reach on a phone, however long the write-up gets.
        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center gap-3 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
          <button
            type="submit"
            disabled={pending}
            className="min-h-11 rounded-md bg-brand-700 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save write-up"}
          </button>
          {state.error ? (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-900">
              {state.error}
            </p>
          ) : dirty ? (
            <span className="text-sm text-amber-700">Unsaved changes</span>
          ) : state.notice ? (
            <span className="text-sm text-emerald-700">✓ {state.notice}</span>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-stone-500">Only the office can edit the write-up.</p>
      )}
    </form>
  );
}
