"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createSaleAction, type NewSaleState } from "@/modules/sales/actions";
import { inputClass } from "@/components/ui";

/**
 * The New Deal form. Client-side only so a refused deal can say why, right
 * here above the button — the server-rendered version swallowed refusals
 * (the odometer-status gate above all) and "Open deal" looked dead.
 */
export function NewDealForm({
  episodes,
  preselect,
}: {
  episodes: { id: string; label: string }[];
  preselect?: string;
}) {
  const [state, formAction, pending] = useActionState<NewSaleState, FormData>(createSaleAction, {});

  return (
    <form action={formAction} className="grid gap-2 sm:grid-cols-6">
      {state.error ? (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 sm:col-span-6"
        >
          <p className="font-medium">This deal was not opened.</p>
          <p className="mt-0.5">{state.error}</p>
          {state.fixHref ? (
            <Link href={state.fixHref} className="mt-1 inline-block font-semibold text-red-900 underline">
              {state.fixLabel ?? "Fix it"}
            </Link>
          ) : null}
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <label htmlFor="s-episode" className="block text-xs font-medium text-stone-500">Vehicle</label>
        <select id="s-episode" name="episodeId" defaultValue={preselect} required className={inputClass}>
          {episodes.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="s-price" className="block text-xs font-medium text-stone-500">Agreed price ($)</label>
        <input id="s-price" name="agreedPrice" type="number" min="0" step="0.01" required className={inputClass} />
      </div>
      <div>
        <label htmlFor="s-deposit" className="block text-xs font-medium text-stone-500">Deposit ($)</label>
        <input id="s-deposit" name="depositAmount" type="number" min="0" step="0.01" className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="s-buyer" className="block text-xs font-medium text-stone-500">Buyer name</label>
        <input id="s-buyer" name="buyerName" required className={inputClass} />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="s-email" className="block text-xs font-medium text-stone-500">Buyer email</label>
        <input id="s-email" name="buyerEmail" type="email" className={inputClass} />
      </div>
      <div>
        <label htmlFor="s-phone" className="block text-xs font-medium text-stone-500">Buyer phone</label>
        <input id="s-phone" name="buyerPhone" className={inputClass} />
      </div>
      <div>
        <label htmlFor="s-state" className="block text-xs font-medium text-stone-500">Buyer state</label>
        <input id="s-state" name="buyerState" maxLength={2} className={inputClass} placeholder="CA" />
      </div>
      <div className="flex items-end sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-60"
        >
          {pending ? "Opening…" : "Open deal"}
        </button>
      </div>
    </form>
  );
}
