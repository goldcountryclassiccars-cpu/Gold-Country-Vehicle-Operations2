"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { sendFromLibraryAction, type LibraryFormState } from "@/modules/library/actions";
import type { LibraryEntry } from "@/modules/library/service";
import { Badge, Button, Field, inputClass } from "@/components/ui";

export interface LibraryListProps {
  entries: LibraryEntry[];
  stages: { key: string; label: string }[];
  canSend: boolean;
  practiceEsign: boolean;
  practiceEmail: boolean;
  vehicles: { id: string; label: string; dealType: string; consignorPartyId: string | null }[];
  contacts: { id: string; label: string }[];
  dealers: { id: string; name: string }[];
  defaultDealerId: string | null;
  preselect: { doc: string | null; vehicle: string | null };
}

const SIGNER_LABEL: Record<string, string> = {
  BUYER: "Buyer",
  CO_BUYER: "Co-buyer",
  DEALER: "Dealer",
  CONSIGNOR: "Consignor",
  LIENHOLDER: "Lienholder",
  NONE: "No signature",
};

function Messages({ state }: { state: LibraryFormState }) {
  return (
    <>
      {state.error ? (
        <p role="status" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          {state.notice}
        </p>
      ) : null}
    </>
  );
}

/**
 * The library, grouped by journey stage, each row with one Send button that
 * opens a sheet for that document. One sheet at a time; it closes itself on a
 * successful send so the next thing on screen is the confirmation, not a form
 * still holding the last contact's name.
 */
export function LibraryList(props: LibraryListProps) {
  const [openKey, setOpenKey] = useState<string | null>(
    props.preselect.doc && props.entries.some((e) => e.key === props.preselect.doc) ? props.preselect.doc : null,
  );
  const grouped = useMemo(() => {
    const m = new Map<string, LibraryEntry[]>();
    for (const e of props.entries) m.set(e.journeyStage, [...(m.get(e.journeyStage) ?? []), e]);
    return m;
  }, [props.entries]);

  return (
    <div className="space-y-8">
      {props.stages.map((stage) => {
        const rows = grouped.get(stage.key) ?? [];
        if (rows.length === 0) return null;
        return (
          <section key={stage.key} aria-labelledby={`stage-${stage.key}`}>
            <h2 id={`stage-${stage.key}`} className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
              {stage.label}
            </h2>
            <ul className="space-y-2">
              {rows.map((e) => (
                <li key={e.key} className="rounded-lg border border-stone-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold text-stone-900">{e.name}</p>
                      {e.notes ? <p className="mt-1 line-clamp-2 text-sm text-stone-600">{e.notes.split("\n")[0]}</p> : null}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {e.signers.map((s) => (
                          <Badge key={s} tone={s === "DEALER" ? "brand" : s === "NONE" ? "neutral" : "blue"}>
                            {SIGNER_LABEL[s] ?? s}
                          </Badge>
                        ))}
                        {e.wetSignature ? <Badge tone="amber">signed in ink — print</Badge> : null}
                        {e.hasApprovedTemplate ? (
                          <Badge tone="green">approved PDF loaded</Badge>
                        ) : (
                          <Badge tone="amber">needs approved PDF</Badge>
                        )}
                        {e.verifyWithCounsel ? <Badge tone="violet">verify with counsel</Badge> : null}
                      </div>
                      {e.blocked ? <p className="mt-2 text-xs text-stone-500">{e.blocked}</p> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {e.approvedFileId ? (
                        <a
                          href={`/api/files/${e.approvedFileId}`}
                          target="_blank"
                          className="inline-flex min-h-11 items-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 hover:bg-stone-50"
                        >
                          Open blank
                        </a>
                      ) : null}
                      {props.canSend && !e.blocked ? (
                        <Button variant={openKey === e.key ? "secondary" : "primary"} onClick={() => setOpenKey(openKey === e.key ? null : e.key)}>
                          {openKey === e.key ? "Close" : "Send"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {openKey === e.key ? (
                    <SendSheet entry={e} {...props} onDone={() => setOpenKey(null)} />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SendSheet({ entry, onDone, ...props }: LibraryListProps & { entry: LibraryEntry; onDone: () => void }) {
  const [state, action, pending] = useActionState<LibraryFormState, FormData>(sendFromLibraryAction, {});
  const [contactMode, setContactMode] = useState<"existing" | "new">(props.contacts.length ? "existing" : "new");
  const [method, setMethod] = useState<"ESIGN" | "EMAIL_PDF">(entry.eSign ? "ESIGN" : "EMAIL_PDF");
  const wantsDealer = entry.signers.includes("DEALER");

  // A successful send closes the sheet after the confirmation has been read.
  useEffect(() => {
    if (state.saved) {
      const t = setTimeout(onDone, 4000);
      return () => clearTimeout(t);
    }
  }, [state.saved, onDone]);

  const who = entry.recipientRole === "CONSIGNOR" ? "consignor" : "buyer";

  return (
    <form action={action} className="space-y-4 border-t border-stone-200 bg-stone-50 p-4" key={state.saved ?? "form"}>
      <input type="hidden" name="templateKey" value={entry.key} />
      <Messages state={state} />
      {state.saved ? null : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {entry.needsVehicle ? (
              <Field label="Vehicle" htmlFor={`veh-${entry.key}`} hint="Pre-fills year/make/model, VIN and stock number.">
                <select id={`veh-${entry.key}`} name="episodeId" required className={inputClass} defaultValue={props.preselect.vehicle ?? ""}>
                  <option value="">Choose a vehicle…</option>
                  {props.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <input type="hidden" name="episodeId" value="" />
            )}

            <div>
              <span className="block text-sm font-medium text-stone-700">Send to ({who})</span>
              <div className="mt-1 flex gap-4 text-sm">
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="contact" value="existing" checked={contactMode === "existing"} onChange={() => setContactMode("existing")} />
                  Existing contact
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name="contact" value="new" checked={contactMode === "new"} onChange={() => setContactMode("new")} />
                  New contact
                </label>
              </div>
              {contactMode === "existing" ? (
                <select name="partyId" required className={inputClass} defaultValue="">
                  <option value="">Choose a contact…</option>
                  {props.contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="mt-1 grid gap-2">
                  <input name="newName" placeholder="Full name" required className={inputClass} autoComplete="off" />
                  <input name="newEmail" type="email" placeholder="Email address" required className={inputClass} autoComplete="off" />
                  <input name="newPhone" placeholder="Phone (optional)" className={inputClass} autoComplete="off" />
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <span className="block text-sm font-medium text-stone-700">How</span>
              <div className="mt-1 space-y-1.5 text-sm">
                {entry.eSign ? (
                  <label className="flex items-center gap-2">
                    <input type="radio" name="method" value="ESIGN" checked={method === "ESIGN"} onChange={() => setMethod("ESIGN")} />
                    <span>
                      Send for e-signature{" "}
                      {props.practiceEsign ? <span className="text-violet-700">(practice mode)</span> : null}
                    </span>
                  </label>
                ) : null}
                <label className="flex items-center gap-2">
                  <input type="radio" name="method" value="EMAIL_PDF" checked={method === "EMAIL_PDF"} onChange={() => setMethod("EMAIL_PDF")} />
                  <span>
                    Email the pre-filled PDF (no signature){" "}
                    {props.practiceEmail ? <span className="text-violet-700">(practice mode)</span> : null}
                  </span>
                </label>
              </div>
            </div>
            {method === "ESIGN" && wantsDealer ? (
              <Field label="Signs for the dealership" htmlFor={`dealer-${entry.key}`}>
                <select id={`dealer-${entry.key}`} name="dealerUserId" required className={inputClass} defaultValue={props.defaultDealerId ?? ""}>
                  <option value="">Choose…</option>
                  {props.dealers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>

          <Field label="Note to the recipient (optional)" htmlFor={`msg-${entry.key}`}>
            <textarea id={`msg-${entry.key}`} name="message" rows={2} className={inputClass} maxLength={2000} />
          </Field>

          <div className="sticky bottom-0 -mx-4 -mb-4 flex items-center justify-end gap-2 border-t border-stone-200 bg-stone-50/95 px-4 py-3 backdrop-blur">
            <Button variant="secondary" onClick={onDone} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Sending…" : method === "ESIGN" ? "Send for signature" : "Email PDF"}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
