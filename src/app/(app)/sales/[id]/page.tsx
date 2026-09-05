import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { authorize, canViewField, hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { releaseGate } from "@/modules/sales/service";
import { saleComplianceSummary } from "@/modules/documents/requirements";
import { completeSaleAction } from "@/modules/documents/actions";
import { SaleDocInputs } from "./sale-doc-inputs";
import { DocChecklist } from "./doc-checklist";
import {
  cancelSaleAction,
  deliverVehicleAction,
  fileDocumentAction,
  generateDocumentAction,
  markContractedAction,
  markDocumentSignedAction,
  recordPaymentAction,
  releaseVehicleAction,
  sendDocumentAction,
  setPaymentStatusAction,
} from "@/modules/sales/actions";
import { sanitizePartyForUser } from "@/modules/vehicles/sanitize";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, DescriptionList, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Deal" };

const docTone = { GENERATED: "blue", SENT: "amber", PARTIALLY_SIGNED: "amber", SIGNED: "green", VOIDED: "neutral", FILED: "green" } as const;
const payTone = { EXPECTED: "neutral", RECEIVED: "blue", CLEARED: "green", REFUNDED: "amber", FAILED: "red" } as const;

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "sales");
  const { id } = await params;

  const sale = await db.saleTransaction.findUnique({
    where: { id },
    include: { payments: { orderBy: { createdAt: "asc" } }, documents: { include: { template: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!sale) notFound();
  if (!authorize(user, "view", "sales", { assignedUserIds: [sale.salespersonId, sale.createdById].filter(Boolean) as string[] })) {
    notFound();
  }

  const [episode, buyerRaw, templates] = await Promise.all([
    db.inventoryEpisode.findUniqueOrThrow({ where: { id: sale.episodeId }, include: { vehicle: true } }),
    db.party.findUniqueOrThrow({ where: { id: sale.buyerPartyId } }),
    db.documentTemplate.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const buyer = sanitizePartyForUser(user, buyerRaw as unknown as Record<string, unknown>, "buyer_pii");
  const [gate, compliance] = await Promise.all([releaseGate(sale.id), saleComplianceSummary(sale.id)]);

  const canEdit = hasPermission(user, "sales", "edit");
  const canPay = hasPermission(user, "payments", "create");
  const canPayEdit = hasPermission(user, "payments", "edit");
  const canGenDocs = hasPermission(user, "documents", "generate");
  const canSendDocs = hasPermission(user, "documents", "send");
  const canEditDocs = hasPermission(user, "documents", "edit");
  const canSeePaymentInfo = canViewField(user, "payment_info");
  // Front Desk enters sale data and marks steps done; only Admin overrides a
  // requirement or declares the file finished.
  const canOverrideDocs = hasPermission(user, "documents", "override_gate");
  const canCompleteSale = hasPermission(user, "sales", "complete");
  const open = !["CANCELED", "UNWOUND", "COMPLETE", "DELIVERED"].includes(sale.status);
  const applicableTemplates = templates.filter((t) => t.appliesTo === "all" || t.appliesTo === episode.dealType);

  const clearedTotal = sale.payments.filter((p) => p.status === "CLEARED" && p.kind !== "REFUND").reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Deal — ${episode.stockNumber}`}
        subtitle={`${vehicleLabel(episode.vehicle)} · $${Number(sale.agreedPrice).toLocaleString()} agreed`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/episodes/${episode.id}`} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
              Episode
            </Link>
            <Badge tone="brand">{sale.status.toLowerCase().replace(/_/g, " ")}</Badge>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-4 text-base font-semibold text-stone-900">Buyer</h2>
            <DescriptionList
              items={[
                { label: "Name", value: String(("displayName" in buyer ? buyer.displayName : buyerRaw.displayName) ?? "") },
                ...("email" in buyer ? [{ label: "Email", value: buyer.email as string | null }] : []),
                ...("phone" in buyer ? [{ label: "Phone", value: buyer.phone as string | null }] : []),
                ...("state" in buyer ? [{ label: "State", value: buyer.state as string | null }] : []),
              ]}
            />
            {!("email" in buyer) ? (
              <p className="mt-2 text-xs text-stone-400">Buyer contact details are restricted to roles with buyer-PII access.</p>
            ) : null}
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-stone-900">Payments</h2>
              <span className="text-xs text-stone-500">
                Cleared ${clearedTotal.toLocaleString()} of ${Number(sale.agreedPrice).toLocaleString()}
              </span>
            </div>
            {sale.payments.length === 0 ? (
              <p className="text-sm text-stone-500">No payments recorded.</p>
            ) : (
              <ul className="space-y-2">
                {sale.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium text-stone-900">${Number(p.amount).toLocaleString()}</span>{" "}
                      <span className="text-stone-500">{p.kind.toLowerCase().replace(/_/g, " ")} · {p.method.toLowerCase()}</span>
                      {canSeePaymentInfo && p.reference ? <span className="block text-xs text-stone-400">ref: {p.reference}</span> : null}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge tone={payTone[p.status]}>{p.status.toLowerCase()}</Badge>
                      {canPayEdit && open && (p.status === "EXPECTED" || p.status === "RECEIVED") ? (
                        <form action={setPaymentStatusAction} className="flex gap-1">
                          <input type="hidden" name="paymentId" value={p.id} />
                          <input type="hidden" name="saleId" value={sale.id} />
                          {p.status === "EXPECTED" ? (
                            <button name="status" value="RECEIVED" className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">Received</button>
                          ) : null}
                          <button name="status" value="CLEARED" className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">Cleared</button>
                        </form>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canPay && open ? (
              <form action={recordPaymentAction} className="mt-4 grid gap-2 border-t border-stone-100 pt-4 sm:grid-cols-5">
                <input type="hidden" name="saleId" value={sale.id} />
                <div>
                  <label htmlFor="p-amount" className="block text-xs font-medium text-stone-500">Amount ($)</label>
                  <input id="p-amount" name="amount" type="number" min="0.01" step="0.01" required className={inputClass} />
                </div>
                <div>
                  <label htmlFor="p-kind" className="block text-xs font-medium text-stone-500">Kind</label>
                  <select id="p-kind" name="kind" className={inputClass}>
                    <option value="DEPOSIT">Deposit</option>
                    <option value="DOWN_PAYMENT">Down payment</option>
                    <option value="FINAL">Final</option>
                    <option value="REFUND">Refund</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="p-method" className="block text-xs font-medium text-stone-500">Method</label>
                  <select id="p-method" name="method" className={inputClass}>
                    <option value="WIRE">Wire</option>
                    <option value="CHECK">Check</option>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="FINANCING">Financing</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="p-status" className="block text-xs font-medium text-stone-500">Status</label>
                  <select id="p-status" name="status" className={inputClass} defaultValue="RECEIVED">
                    <option value="EXPECTED">Expected</option>
                    <option value="RECEIVED">Received</option>
                    <option value="CLEARED">Cleared</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button type="submit" className="w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                    Record
                  </button>
                </div>
              </form>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-base font-semibold text-stone-900">Documents</h2>
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Demonstration templates only — every PDF is watermarked. Configure approved legal documents per SALES_DOCUMENT_SETUP.md.
            </p>
            {sale.documents.length === 0 ? (
              <p className="text-sm text-stone-500">No documents generated.</p>
            ) : (
              <ul className="space-y-2">
                {sale.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 px-3 py-2 text-sm">
                    <span>
                      <a href={`/api/files/${d.fileId}`} target="_blank" className="font-medium text-brand-700 hover:underline">
                        {d.template.name} v{d.version}
                      </a>
                    </span>
                    <span className="flex items-center gap-1">
                      <Badge tone={docTone[d.status]}>{d.status.toLowerCase().replace(/_/g, " ")}</Badge>
                      {open ? (
                        <>
                          {d.status === "GENERATED" && canSendDocs ? (
                            <form action={sendDocumentAction}>
                              <input type="hidden" name="documentId" value={d.id} />
                              <input type="hidden" name="saleId" value={sale.id} />
                              <button className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">Send</button>
                            </form>
                          ) : null}
                          {d.status === "SENT" && canEditDocs ? (
                            <form action={markDocumentSignedAction}>
                              <input type="hidden" name="documentId" value={d.id} />
                              <input type="hidden" name="saleId" value={sale.id} />
                              <button className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">Mark signed (mock)</button>
                            </form>
                          ) : null}
                          {d.status === "SIGNED" && canEditDocs ? (
                            <form action={fileDocumentAction}>
                              <input type="hidden" name="documentId" value={d.id} />
                              <input type="hidden" name="saleId" value={sale.id} />
                              <button className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">File</button>
                            </form>
                          ) : null}
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canGenDocs && open ? (
              <form action={generateDocumentAction} className="mt-4 flex items-end gap-2 border-t border-stone-100 pt-4">
                <input type="hidden" name="saleId" value={sale.id} />
                <div className="flex-1">
                  <label htmlFor="d-template" className="block text-xs font-medium text-stone-500">Template</label>
                  <select id="d-template" name="templateId" className={inputClass}>
                    {applicableTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">
                  Generate
                </button>
              </form>
            ) : null}
          </Card>

          {canEdit && open ? (
            <Card>
              <h2 className="mb-3 text-base font-semibold text-stone-900">Deal progression</h2>
              <div className="space-y-3">
                {["DEPOSIT_REQUESTED", "DEPOSIT_RECEIVED", "DRAFT"].includes(sale.status) ? (
                  <form action={markContractedAction}>
                    <input type="hidden" name="saleId" value={sale.id} />
                    <button type="submit" className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                      Mark contracted
                    </button>
                  </form>
                ) : null}

                {["CONTRACTED", "FUNDS_PENDING", "FUNDED"].includes(sale.status) ? (
                  <div className="rounded-md border border-stone-200 p-3">
                    <p className="text-sm font-medium text-stone-900">Release gate</p>
                    <ul className="mt-1 text-sm text-stone-600">
                      <li>{gate.funded ? "✓" : "○"} Fully funded (cleared payments cover agreed price)</li>
                      <li>{gate.docsSigned ? "✓" : "○"} All documents signed or filed</li>
                    </ul>
                    <form action={releaseVehicleAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="saleId" value={sale.id} />
                      {!gate.ok && user.isOwner ? (
                        <div className="flex-1">
                          <label htmlFor="r-reason" className="block text-xs font-medium text-stone-500">Owner override reason (required, audited)</label>
                          <input id="r-reason" name="overrideReason" className={inputClass} />
                        </div>
                      ) : null}
                      {gate.ok || user.isOwner ? (
                        <button type="submit" className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                          {gate.ok ? "Release vehicle" : "Release with owner override"}
                        </button>
                      ) : (
                        <p className="text-xs text-stone-500">Release requires the gate above (or an owner).</p>
                      )}
                    </form>
                  </div>
                ) : null}

                {sale.status === "RELEASED" ? (
                  <form action={deliverVehicleAction}>
                    <input type="hidden" name="saleId" value={sale.id} />
                    <button type="submit" className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                      Mark delivered
                    </button>
                  </form>
                ) : null}

                <form action={cancelSaleAction} className="flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
                  <input type="hidden" name="saleId" value={sale.id} />
                  <div className="flex-1">
                    <label htmlFor="c-reason" className="block text-xs font-medium text-stone-500">Cancel reason</label>
                    <input id="c-reason" name="reason" className={inputClass} />
                  </div>
                  <button type="submit" className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50">
                    Cancel deal
                  </button>
                </form>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <section id="sale-docs" className="mt-8 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-200 pb-3">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-stone-900">Sale documents</h2>
            <p className="mt-0.5 text-sm text-stone-500">
              Everything this particular sale needs, why it needs it, and what is still outstanding.
            </p>
          </div>
          {compliance.rows.length > 0 && sale.status === "DELIVERED" && canCompleteSale ? (
            <form action={completeSaleAction}>
              <input type="hidden" name="saleId" value={sale.id} />
              <button
                disabled={!compliance.ok}
                title={compliance.ok ? undefined : "Every required and unknown row has to be complete first."}
                className="min-h-11 rounded-lg border border-brand-800 bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:pointer-events-none disabled:opacity-50"
              >
                Mark sale complete
              </button>
            </form>
          ) : null}
        </div>

        <SaleDocInputs sale={sale} canEdit={canEdit && open} />
        <DocChecklist
          saleId={sale.id}
          summary={compliance}
          canEdit={canEditDocs && open}
          canOverride={canOverrideDocs && open}
        />
      </section>
    </div>
  );
}
