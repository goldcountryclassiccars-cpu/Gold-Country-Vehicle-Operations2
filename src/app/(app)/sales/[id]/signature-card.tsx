"use client";

import { useActionState } from "react";
import {
  cancelSignatureAction,
  refreshSignatureAction,
  sendForSignatureAction,
  type EsignFormState,
} from "@/modules/esign/actions";
import { Badge, Card, inputClass } from "@/components/ui";

export interface SignatureCardProps {
  saleId: string;
  provider: "mock" | "boldsign";
  canSend: boolean;
  dealOpen: boolean;
  buyer: { name: string; email: string | null };
  coBuyer: { name: string; email: string | null } | null;
  dealers: { id: string; name: string; email: string }[];
  defaultDealerId: string | null;
  candidates: { requirementId: string; name: string; ready: boolean; reason: string | null }[];
  latest: {
    id: string;
    status: "SENT" | "COMPLETED" | "DECLINED" | "CANCELED" | "EXPIRED";
    sentAt: string;
    completedAt: string | null;
    endedReason: string | null;
    lastError: string | null;
    signedFileId: string | null;
    auditFileId: string | null;
    documentCount: number;
    signers: { role: string; name: string; email: string; signedAt: string | null }[];
  } | null;
}

const ROLE = { BUYER: "Buyer", CO_BUYER: "Co-buyer", DEALER: "Dealer" } as Record<string, string>;
const STATUS = {
  SENT: { label: "Out for signature", tone: "amber" },
  COMPLETED: { label: "Signed by everyone", tone: "green" },
  DECLINED: { label: "Declined", tone: "red" },
  CANCELED: { label: "Canceled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "red" },
} as const;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

function Messages({ state }: { state: EsignFormState }) {
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

const btn = "min-h-11 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm disabled:opacity-60";

export function SignatureCard(props: SignatureCardProps) {
  const [sendState, sendAction, sending] = useActionState<EsignFormState, FormData>(sendForSignatureAction, {});
  const [refState, refAction, refreshing] = useActionState<EsignFormState, FormData>(refreshSignatureAction, {});
  const [canState, canAction, canceling] = useActionState<EsignFormState, FormData>(cancelSignatureAction, {});
  const { latest } = props;
  const open = latest?.status === "SENT";
  const ready = props.candidates.filter((c) => c.ready);
  const blocked = props.candidates.filter((c) => !c.ready);
  const missingEmail = !props.buyer.email || (props.coBuyer && !props.coBuyer.email);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-stone-900">Send for signature</h3>
        {props.provider === "mock" ? (
          <Badge tone="violet" title="ESIGN_ADAPTER is not set to boldsign — nothing leaves the app.">
            practice mode — no emails sent
          </Badge>
        ) : null}
      </div>

      {latest ? (
        <div className="mb-4 space-y-2 rounded-lg border border-stone-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone={STATUS[latest.status].tone}>{STATUS[latest.status].label}</Badge>
            <span className="text-xs text-stone-500">
              {latest.documentCount} document{latest.documentCount === 1 ? "" : "s"} · sent {when(latest.sentAt)}
              {latest.completedAt ? ` · completed ${when(latest.completedAt)}` : ""}
            </span>
          </div>
          <ul className="space-y-1 text-sm">
            {latest.signers.map((s) => (
              <li key={`${s.role}-${s.email}`} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium text-stone-900">{ROLE[s.role] ?? s.role}</span>{" "}
                  <span className="text-stone-600">
                    {s.name} · {s.email}
                  </span>
                </span>
                <span className={s.signedAt ? "text-emerald-700" : "text-stone-500"}>
                  {s.signedAt ? `signed ${when(s.signedAt)}` : latest.status === "SENT" ? "waiting" : "—"}
                </span>
              </li>
            ))}
          </ul>
          {latest.endedReason && latest.status !== "COMPLETED" ? (
            <p className="text-sm text-stone-700">{latest.endedReason}</p>
          ) : null}
          {latest.lastError ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Last check: {latest.lastError}
            </p>
          ) : null}
          {latest.signedFileId ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <a href={`/api/files/${latest.signedFileId}`} target="_blank" className={`${btn} border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800`}>
                Open signed documents
              </a>
              {latest.auditFileId ? (
                <a href={`/api/files/${latest.auditFileId}`} target="_blank" className={`${btn} border border-stone-300 bg-white hover:bg-stone-50`}>
                  Signing certificate
                </a>
              ) : null}
            </div>
          ) : null}

          {open ? (
            <div className="space-y-2 pt-1">
              <Messages state={sendState} />
              <Messages state={refState} />
              <Messages state={canState} />
              <div className="flex flex-wrap items-start gap-2">
                <form action={refAction}>
                  <input type="hidden" name="saleId" value={props.saleId} />
                  <input type="hidden" name="envelopeId" value={latest.id} />
                  <button disabled={refreshing} className={`${btn} border border-stone-300 bg-white hover:bg-stone-50`}>
                    {refreshing ? "Checking…" : "Check status"}
                  </button>
                </form>
                {props.canSend ? (
                  <details className="text-sm">
                    <summary className={`${btn} inline-block cursor-pointer list-none border border-red-300 bg-white text-red-700 hover:bg-red-50`}>
                      Cancel request
                    </summary>
                    <form action={canAction} className="mt-2 space-y-2">
                      <input type="hidden" name="saleId" value={props.saleId} />
                      <input type="hidden" name="envelopeId" value={latest.id} />
                      <label htmlFor="esign-cancel-reason" className="block text-xs font-medium text-stone-600">
                        Reason (the signers see this)
                      </label>
                      <input id="esign-cancel-reason" name="reason" maxLength={500} placeholder="e.g. Correcting the sale price" className={inputClass} />
                      <button disabled={canceling} className={`${btn} border border-red-700 bg-red-700 text-white hover:bg-red-800`}>
                        {canceling ? "Canceling…" : "Cancel the signing links"}
                      </button>
                    </form>
                  </details>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!open && props.canSend && props.dealOpen ? (
        <form key={sendState.saved ?? 0} action={sendAction} className="space-y-3">
          <Messages state={sendState} />
          {props.candidates.length === 0 ? (
            <p className="text-sm text-stone-500">
              Nothing on this deal&rsquo;s checklist needs an e-signature right now.
            </p>
          ) : (
            <>
              <div>
                <p className="text-sm font-medium text-stone-700">
                  {ready.length
                    ? `Goes out as one packet (${ready.length} document${ready.length === 1 ? "" : "s"}):`
                    : "Not ready to send yet:"}
                </p>
                <ul className="mt-1 space-y-1 text-sm">
                  {ready.map((c) => (
                    <li key={c.requirementId} className="text-stone-800">
                      ✓ {c.name}
                    </li>
                  ))}
                  {blocked.map((c) => (
                    <li key={c.requirementId} className="text-stone-500">
                      — {c.name}: <span className="text-amber-800">{c.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="text-sm text-stone-700">
                <p>
                  <span className="font-medium">Signs first:</span> {props.buyer.name}
                  {props.buyer.email ? ` · ${props.buyer.email}` : <span className="text-red-700"> · no email on file</span>}
                  {props.coBuyer ? (
                    <>
                      {" "}and {props.coBuyer.name}
                      {props.coBuyer.email ? ` · ${props.coBuyer.email}` : <span className="text-red-700"> · no email on file</span>}
                    </>
                  ) : null}
                </p>
                {missingEmail ? (
                  <p className="mt-1 text-xs text-red-700">Add the missing email to the buyer&rsquo;s record before sending.</p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="esign-dealer" className="block text-sm font-medium text-stone-700">
                    Then countersigns for the dealership
                  </label>
                  <select id="esign-dealer" name="dealerUserId" defaultValue={props.defaultDealerId ?? ""} required className={inputClass}>
                    <option value="" disabled>
                      Choose…
                    </option>
                    {props.dealers.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="esign-message" className="block text-sm font-medium text-stone-700">
                    Note in the email <span className="font-normal text-stone-400">(optional)</span>
                  </label>
                  <input id="esign-message" name="message" maxLength={2000} placeholder="Thanks for your purchase!" className={inputClass} />
                </div>
              </div>
              <input type="hidden" name="saleId" value={props.saleId} />
              <button
                type="submit"
                disabled={sending || ready.length === 0 || Boolean(missingEmail)}
                className={`${btn} w-full border border-brand-800 bg-brand-700 text-white hover:bg-brand-800 sm:w-auto`}
              >
                {sending ? "Sending…" : `Send for signature${ready.length ? ` (${ready.length})` : ""}`}
              </button>
            </>
          )}
        </form>
      ) : null}
    </Card>
  );
}
