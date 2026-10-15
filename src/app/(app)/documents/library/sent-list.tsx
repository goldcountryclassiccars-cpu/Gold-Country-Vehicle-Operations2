"use client";

import Link from "next/link";
import { useActionState } from "react";
import { cancelLibraryEnvelopeAction, refreshLibraryEnvelopeAction, type LibraryFormState } from "@/modules/library/actions";
import type { LibrarySentItem } from "@/modules/library/service";
import { Badge, EmptyState, type BadgeTone } from "@/components/ui";

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  SENT: { label: "Out for signature", tone: "amber" },
  PARTIALLY_SIGNED: { label: "Partly signed", tone: "amber" },
  COMPLETED: { label: "Signed by everyone", tone: "green" },
  SIGNED: { label: "Signed", tone: "green" },
  FILED: { label: "On file", tone: "green" },
  DECLINED: { label: "Declined", tone: "red" },
  CANCELED: { label: "Canceled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "red" },
  GENERATED: { label: "Produced", tone: "blue" },
};

const ROLE: Record<string, string> = { BUYER: "Buyer", CO_BUYER: "Co-buyer", CONSIGNOR: "Consignor", DEALER: "Dealer" };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const small = "min-h-9 rounded-md border border-stone-300 bg-white px-2.5 text-xs font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60";

function Row({ item, canSend }: { item: LibrarySentItem; canSend: boolean }) {
  const [refState, refAction, refreshing] = useActionState<LibraryFormState, FormData>(refreshLibraryEnvelopeAction, {});
  const [canState, canAction, canceling] = useActionState<LibraryFormState, FormData>(cancelLibraryEnvelopeAction, {});
  const st = STATUS[item.status] ?? { label: item.status.toLowerCase(), tone: "neutral" as BadgeTone };
  const open = item.envelopeId && item.status === "SENT";
  const err = refState.error ?? canState.error;
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-stone-900">
            {item.signedFileId || item.fileId ? (
              <a href={`/api/files/${item.signedFileId ?? item.fileId}`} target="_blank" className="text-brand-700 hover:underline">
                {item.templateName}
              </a>
            ) : (
              item.templateName
            )}
          </p>
          <p className="text-xs text-stone-500">
            {item.party ? `to ${item.party.name}${item.party.email ? ` · ${item.party.email}` : ""}` : "no contact"}
            {item.vehicle ? (
              <>
                {" · "}
                <Link href={`/episodes/${item.episodeId}`} className="text-brand-700 hover:underline">
                  {item.stockNumber} {item.vehicle}
                </Link>
              </>
            ) : null}
            {" · "}
            {item.sentVia === "EMAIL_PDF" ? "emailed PDF" : "e-signature"} {when(item.sentAt)}
          </p>
          {item.signers.length ? (
            <p className="mt-1 text-xs text-stone-600">
              {item.signers.map((s) => `${ROLE[s.role] ?? s.role}: ${s.signedAt ? "signed" : "waiting"}`).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {item.practice ? <Badge tone="violet">practice</Badge> : null}
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
      </div>
      {open ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <form action={refAction}>
            <input type="hidden" name="envelopeId" value={item.envelopeId!} />
            <button className={small} disabled={refreshing}>
              {refreshing ? "Checking…" : "Check status"}
            </button>
          </form>
          {canSend ? (
            <form action={canAction}>
              <input type="hidden" name="envelopeId" value={item.envelopeId!} />
              <input type="hidden" name="reason" value="Canceled from the Document Library" />
              <button className={small} disabled={canceling}>
                {canceling ? "Canceling…" : "Cancel request"}
              </button>
            </form>
          ) : null}
          {err ? <span className="text-xs text-red-700">{err}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

export function SentList({ items, canSend }: { items: LibrarySentItem[]; canSend: boolean }) {
  if (items.length === 0) {
    return <EmptyState title="Nothing sent from the Library yet" hint="Documents sent from a deal page are listed under Documents." />;
  }
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <Row key={i.instanceId ?? i.envelopeId ?? i.sentAt} item={i} canSend={canSend} />
      ))}
    </ul>
  );
}
