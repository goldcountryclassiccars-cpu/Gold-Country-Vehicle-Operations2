/**
 * The compliance checklist.
 *
 * Built for the answer to one question, asked standing at the counter with a
 * phone in one hand: *what is still missing?* So the blockers come first, the
 * reason is always visible next to the badge, and every row offers one obvious
 * next action rather than a row of equally-weighted buttons.
 *
 * Uses DataTable, so the full status columns appear at `lg` — the shop iPad in
 * landscape and a desk — and collapse to a progress pill below that.
 */
import { Badge, Card, EmptyState, type BadgeTone } from "@/components/ui";
import { DataTable, type Column } from "@/components/data-table";
import {
  overrideRequirementAction,
  reevaluateSaleAction,
  setRequirementStepAction,
} from "@/modules/documents/actions";
import type { ComplianceRow, ComplianceSummary } from "@/modules/documents/requirements";

const CATEGORY_LABEL: Record<number, string> = {
  1: "1 · We produce and sign these",
  2: "2 · Government forms we fill in and print",
  3: "3 · Controlled originals — worksheet only",
  4: "4 · Someone else produces these; we collect them",
};

const CATEGORY_HINT: Record<number, string> = {
  1: "Generated from an approved template, signed, buyer gets a copy.",
  2: "Prefilled where we can, then wet-signed on the printed form.",
  3: "Serialised or original documents. The app tracks them and gives you a worksheet to read off — it never prints one.",
  4: "A smog station, a lender, NMVTIS or a carrier produces these. Upload what arrives.",
};

const STATE_TONE: Record<string, BadgeTone> = {
  REQUIRED: "amber",
  NOT_REQUIRED: "neutral",
  UNKNOWN: "red",
};

const STATE_LABEL: Record<string, string> = {
  REQUIRED: "Required",
  NOT_REQUIRED: "Not required",
  UNKNOWN: "Unknown",
};

/** The single next thing to do on this row, or null when it is finished. */
function primaryStep(row: ComplianceRow): { step: string; label: string } | null {
  if (row.complete) return null;
  if (row.category === 4 && !row.progress.fileId && !row.progress.lookupAt) {
    return { step: "lookup", label: row.key === "smog_certificate" || row.key === "nmvtis_report" ? "Record date" : "Mark received" };
  }
  if ((row.signers.includes("BUYER") || row.signers.includes("CO_BUYER")) && !row.progress.buyerSigned) {
    return { step: "buyerSigned", label: "Buyer signed" };
  }
  if (row.signers.includes("DEALER") && !row.progress.dealerSigned) return { step: "dealerSigned", label: "Dealer signed" };
  if (row.signers.includes("CONSIGNOR") && !row.progress.consignorSigned) {
    return { step: "consignorSigned", label: "Consignor signed" };
  }
  if (row.physicalOriginal && !row.progress.originalReceived) return { step: "originalReceived", label: "Original received" };
  if (row.submitTo && !row.progress.submittedAt) return { step: "submitted", label: "Mark submitted" };
  if (row.buyerCopy && !row.progress.buyerCopyProvidedAt) return { step: "buyerCopyProvided", label: "Buyer copy given" };
  if (row.retain && !row.progress.filedAt) return { step: "filed", label: "Mark filed" };
  return null;
}

function Tick({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={on ? "text-emerald-700" : "text-stone-300"} title={label} aria-label={`${label}: ${on ? "done" : "not done"}`}>
      {on ? "✓" : "○"}
    </span>
  );
}

function Worksheet({ row }: { row: ComplianceRow }) {
  if (row.category !== 3 && row.category !== 2) return null;
  if (row.worksheetFields.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-medium text-brand-700">Fill worksheet</summary>
      <p className="mt-1 text-xs text-stone-500">
        Read these off while you type onto the form. The app does not print this document.
      </p>
      <ul className="mt-2 grid gap-1 text-xs text-stone-700 sm:grid-cols-2">
        {row.worksheetFields.map((f) => (
          <li key={f} className="rounded border border-stone-200 bg-stone-50 px-2 py-1">
            {f}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RowActions({ row, saleId, canEdit, canOverride }: { row: ComplianceRow; saleId: string; canEdit: boolean; canOverride: boolean }) {
  const next = primaryStep(row);
  const gating = row.state === "REQUIRED" || row.state === "UNKNOWN";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {gating && next && canEdit ? (
        <form action={setRequirementStepAction}>
          <input type="hidden" name="requirementId" value={row.id} />
          <input type="hidden" name="saleId" value={saleId} />
          <input type="hidden" name="step" value={next.step} />
          <input type="hidden" name="done" value="true" />
          <button className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold shadow-sm hover:bg-stone-50">
            {next.label}
          </button>
        </form>
      ) : null}

      {canOverride ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-stone-500 hover:text-stone-800">Override</summary>
          <form action={overrideRequirementAction} className="mt-2 space-y-2 rounded-md border border-stone-200 p-2">
            <input type="hidden" name="requirementId" value={row.id} />
            <input type="hidden" name="saleId" value={saleId} />
            <label htmlFor={`ovr-${row.id}`} className="sr-only">
              Override reason for {row.name}
            </label>
            <input
              id={`ovr-${row.id}`}
              name="reason"
              placeholder="Why (recorded in the audit log)"
              defaultValue={row.overrideReason ?? ""}
              className="w-full rounded border border-stone-300 px-2 py-1 text-xs"
            />
            <div className="flex flex-wrap gap-1">
              <button name="state" value="NOT_REQUIRED" className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-50">
                Not required
              </button>
              <button name="state" value="REQUIRED" className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-50">
                Required
              </button>
              {row.manualOverride ? (
                <button name="state" value="CLEAR" className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-50">
                  Back to the rules
                </button>
              ) : null}
            </div>
          </form>
        </details>
      ) : null}
    </div>
  );
}

function CategoryTable({
  category,
  rows,
  saleId,
  canEdit,
  canOverride,
}: {
  category: number;
  rows: ComplianceRow[];
  saleId: string;
  canEdit: boolean;
  canOverride: boolean;
}) {
  if (rows.length === 0) return null;

  // Blockers first, then required-and-done, then everything that does not
  // apply — the order the question "what is missing?" wants.
  const rank = (r: ComplianceRow) => (r.state === "UNKNOWN" && !r.complete ? 0 : r.complete ? 2 : 1);
  const applies = rows
    .filter((r) => r.state !== "NOT_REQUIRED")
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const notApplicable = rows
    .filter((r) => r.state === "NOT_REQUIRED")
    .sort((a, b) => a.name.localeCompare(b.name));

  const columns: Column<ComplianceRow>[] = [
    {
      key: "name",
      header: "Document",
      phone: "title",
      cell: (r) => (
        <div className="min-w-0">
          <span className="font-medium text-stone-900">{r.name}</span>
          {r.authority ? <p className="text-xs text-stone-400">{r.authority}</p> : null}
          <p className="mt-1 text-xs text-stone-600">{r.reason}</p>
          {r.manualOverride ? (
            <p className="mt-1 text-xs text-violet-700">
              Overridden by an admin{r.overrideReason ? `: ${r.overrideReason}` : ""}
            </p>
          ) : null}
          {r.verifyWithCounsel ? (
            <p className="mt-1 text-xs text-amber-700">Rule not yet confirmed with counsel.</p>
          ) : null}
          <Worksheet row={r} />
        </div>
      ),
    },
    {
      key: "state",
      header: "Applies",
      phone: "meta",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={STATE_TONE[r.state] ?? "neutral"}>{STATE_LABEL[r.state] ?? r.state}</Badge>
          {r.state !== "NOT_REQUIRED" ? (
            <Badge tone={r.complete ? "green" : "neutral"} title={r.outstanding.join(", ")}>
              {r.complete
                ? "complete"
                : `${r.outstanding.length} step${r.outstanding.length === 1 ? "" : "s"} left`}
            </Badge>
          ) : null}
        </span>
      ),
    },
    {
      key: "progress",
      // A legend sits above the table; the header itself stays short so the
      // column does not wrap into three lines and stop lining up with the ticks.
      header: "Progress",
      phone: "desktop-only",
      cell: (r) => (
        <span className="flex items-center gap-2 text-base">
          <Tick on={r.progress.buyerSigned} label="Buyer signed" />
          <Tick on={r.progress.dealerSigned} label="Dealer signed" />
          <Tick on={r.progress.consignorSigned} label="Consignor signed" />
          <span className="text-stone-200">|</span>
          <Tick on={r.progress.originalReceived} label="Original received" />
          <Tick on={Boolean(r.progress.submittedAt)} label="Submitted" />
          <Tick on={Boolean(r.progress.buyerCopyProvidedAt)} label="Buyer copy given" />
          <Tick on={Boolean(r.progress.filedAt)} label="Filed" />
        </span>
      ),
    },
    {
      key: "action",
      header: "Next step",
      cell: (r) => <RowActions row={r} saleId={saleId} canEdit={canEdit} canOverride={canOverride} />,
    },
  ];

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold text-stone-900">{CATEGORY_LABEL[category]}</h3>
      <p className="mb-3 text-xs text-stone-500">
        {CATEGORY_HINT[category]}
        <span className="hidden lg:inline">
          {" "}Progress reads: buyer · dealer · consignor signatures | original · submitted · buyer copy · filed.
        </span>
      </p>
      {applies.length > 0 ? (
        <DataTable caption={CATEGORY_LABEL[category]} columns={columns} rows={applies} rowKey={(r) => r.id} />
      ) : (
        <p className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-600">
          Nothing in this group applies to this sale.
        </p>
      )}

      {notApplicable.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-stone-500 hover:text-stone-800">
            {notApplicable.length} that do not apply — and why
          </summary>
          <ul className="mt-2 space-y-1">
            {notApplicable.map((r) => (
              <li key={r.id} className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-xs">
                <span className="font-medium text-stone-700">{r.name}</span>
                <span className="block text-stone-500">{r.reason}</span>
                {r.manualOverride ? (
                  <span className="block text-violet-700">
                    Overridden by an admin{r.overrideReason ? `: ${r.overrideReason}` : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

export function DocChecklist({
  saleId,
  summary,
  canEdit,
  canOverride,
}: {
  saleId: string;
  summary: ComplianceSummary;
  canEdit: boolean;
  canOverride: boolean;
}) {
  if (summary.rows.length === 0) {
    return (
      <Card accent="amber">
        <EmptyState
          title="No document checklist yet"
          hint="Save the sale details above and the checklist appears here."
        />
        <form action={reevaluateSaleAction} className="mt-3">
          <input type="hidden" name="saleId" value={saleId} />
          <button className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-stone-50">
            Check now
          </button>
        </form>
      </Card>
    );
  }

  return (
    <div>
      {/* Sticky because on a phone the answer to "what is left?" must survive
          scrolling through four categories of rows. */}
      <div className="sticky top-0 z-10 -mx-4 mb-2 border-b border-stone-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-sm font-semibold ${summary.ok ? "text-emerald-800" : "text-stone-900"}`}>
            {summary.headline}
          </p>
          <form action={reevaluateSaleAction}>
            <input type="hidden" name="saleId" value={saleId} />
            <button className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">Re-check</button>
          </form>
        </div>
        {summary.unknownCount > 0 ? (
          <p className="mt-1 text-xs text-red-700">
            {summary.unknownCount} row{summary.unknownCount === 1 ? "" : "s"} cannot be answered yet. An unknown blocks
            completion exactly like a missing signature.
          </p>
        ) : null}
      </div>

      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Tracking only. Generated PDFs stay watermarked DEMONSTRATION until approved templates are loaded per
        SALES_DOCUMENT_SETUP.md, and the rules themselves are not legal advice.
      </p>

      {[1, 2, 3, 4].map((category) => (
        <CategoryTable
          key={category}
          category={category}
          rows={summary.rows.filter((r) => r.category === category)}
          saleId={saleId}
          canEdit={canEdit}
          canOverride={canOverride}
        />
      ))}
    </div>
  );
}
