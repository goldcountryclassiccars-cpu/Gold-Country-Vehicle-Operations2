"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Badge, Card, inputClass, type BadgeTone } from "@/components/ui";
import { commitImportAction, previewImportAction, type ImportState } from "@/modules/import/actions";
import type { PlannedRow, RowStatus } from "@/modules/import/service";

const STATUS_TONE: Record<RowStatus, BadgeTone> = {
  ready: "green",
  duplicate: "slate",
  possible_duplicate: "amber",
  error: "red",
};

const STATUS_LABEL: Record<RowStatus, string> = {
  ready: "Will be imported",
  duplicate: "Already in the app — skipped",
  possible_duplicate: "Possible duplicate",
  error: "Needs fixing",
};

function money(n: number | null): string {
  return n === null ? "—" : `$${n.toLocaleString()}`;
}

export function ImportWizard() {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(previewImportAction, {});

  if (state.plan && !state.result) {
    return <PreviewStep state={state} />;
  }
  if (state.result) {
    return <ResultStep state={state} />;
  }

  return (
    <Card accent="blue">
      <h2 className="text-base font-semibold text-stone-900">Upload your file</h2>
      <form action={formAction} className="mt-4 space-y-4">
        <div>
          <label htmlFor="file" className="block text-sm font-medium text-stone-800">
            CSV file
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="mt-1 block w-full rounded-md border border-stone-300 bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-stone-100 file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="mt-1 text-xs text-stone-500">
            In Excel or Google Sheets: File → Download / Save As → <strong>CSV</strong>.
          </p>
        </div>

        <details>
          <summary className="cursor-pointer text-sm text-stone-600">…or paste the rows instead</summary>
          <textarea
            name="csv"
            rows={6}
            placeholder="Paste the header row and your data rows here"
            className={`${inputClass} mt-2 font-mono text-xs`}
          />
        </details>

        {state.error ? (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-md bg-brand-700 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-800 disabled:opacity-60"
        >
          {pending ? "Checking…" : "Check the file"}
        </button>
      </form>
    </Card>
  );
}

function PreviewStep({ state }: { state: ImportState }) {
  const [result, commitAction, pending] = useActionState<ImportState, FormData>(commitImportAction, {});
  const [forced, setForced] = useState<Set<number>>(new Set());
  const plan = state.plan!;

  if (result.result) return <ResultStep state={result} />;

  const willImport = plan.counts.ready + [...forced].length;

  // A warning that lands on most rows is a fact about the file, not about any
  // one car. Repeating it sixteen times buries the single row-specific problem
  // that is actually stopping the import, so it is hoisted out of the table and
  // said once.
  const warningCounts = new Map<string, number>();
  for (const row of plan.rows) {
    for (const w of new Set(row.warnings)) warningCounts.set(w, (warningCounts.get(w) ?? 0) + 1);
  }
  const fileWideWarnings = [...warningCounts.entries()]
    .filter(([, n]) => n > 1 && n >= plan.rows.length / 2)
    .map(([w]) => w);
  const hoisted = new Set(fileWideWarnings);

  return (
    <Card accent="blue">
      <h2 className="text-base font-semibold text-stone-900">Check this before anything is saved</h2>

      {plan.fatal ? (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {plan.fatal}
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Badge tone="green">{plan.counts.ready} ready</Badge>
            {plan.counts.possibleDuplicate > 0 ? <Badge tone="amber">{plan.counts.possibleDuplicate} possible duplicates</Badge> : null}
            {plan.counts.duplicate > 0 ? <Badge tone="slate">{plan.counts.duplicate} already in the app</Badge> : null}
            {plan.counts.error > 0 ? <Badge tone="red">{plan.counts.error} need fixing</Badge> : null}
          </div>

          {plan.unknownColumns.length > 0 ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Columns the app does not recognize and will ignore: {plan.unknownColumns.join(", ")}.
            </p>
          ) : null}

          {fileWideWarnings.length > 0 ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Applies to most rows in this file:</p>
              <ul className="mt-1 list-disc pl-5">
                {fileWideWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs">
                None of these stop the import — you can fill them in now or edit the cars later.
              </p>
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th scope="col" className="py-2 pr-3">Row</th>
                  <th scope="col" className="py-2 pr-3">Vehicle</th>
                  <th scope="col" className="py-2 pr-3">VIN / number</th>
                  <th scope="col" className="py-2 pr-3">Deal</th>
                  <th scope="col" className="py-2 pr-3">Asking</th>
                  <th scope="col" className="py-2 pr-3">Status</th>
                  <th scope="col" className="py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {plan.rows.map((row) => (
                  <PreviewRow
                    key={row.index}
                    row={row}
                    hoisted={hoisted}
                    forced={forced.has(row.index)}
                    onToggleForce={() =>
                      setForced((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.index)) next.delete(row.index);
                        else next.add(row.index);
                        return next;
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {result.error ? (
        <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {result.error}
        </p>
      ) : null}

      <form action={commitAction} className="mt-5 flex flex-wrap items-center gap-3">
        <input type="hidden" name="csvText" value={state.csvText ?? ""} />
        {[...forced].map((i) => (
          <input key={i} type="hidden" name="force" value={i} />
        ))}
        <button
          type="submit"
          disabled={pending || willImport === 0}
          className="min-h-11 rounded-md bg-brand-700 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-800 disabled:opacity-60"
        >
          {pending ? "Importing…" : `Import ${willImport} ${willImport === 1 ? "vehicle" : "vehicles"}`}
        </button>
        <Link href="/admin/import" className="min-h-11 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-50">
          Start over with a different file
        </Link>
        {plan.counts.error > 0 ? (
          <span className="text-xs text-stone-500">
            Rows that need fixing are left out. Correct them in your spreadsheet and upload again — imported cars will not be duplicated.
          </span>
        ) : null}
      </form>
    </Card>
  );
}

function PreviewRow({
  row,
  forced,
  hoisted,
  onToggleForce,
}: {
  row: PlannedRow;
  forced: boolean;
  /** Warnings already shown once above the table. */
  hoisted: Set<string>;
  onToggleForce: () => void;
}) {
  const rowWarnings = row.warnings.filter((w) => !hoisted.has(w));
  return (
    <tr className={row.status === "error" ? "bg-red-50/40" : undefined}>
      <td className="py-2 pr-3 align-top text-stone-500">{row.index}</td>
      <td className="py-2 pr-3 align-top font-medium text-stone-900">{row.label}</td>
      <td className="py-2 pr-3 align-top font-mono text-xs text-stone-600">{row.identifier ?? "—"}</td>
      <td className="py-2 pr-3 align-top text-stone-600">{row.dealType ? row.dealType.replace("_", " ").toLowerCase() : "—"}</td>
      <td className="py-2 pr-3 align-top text-stone-700">{money(row.askingPrice)}</td>
      <td className="py-2 pr-3 align-top">
        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
      </td>
      <td className="py-2 align-top text-xs">
        {row.errors.map((e, i) => (
          <p key={`e${i}`} className="text-red-700">
            {e}
          </p>
        ))}
        {row.duplicateOf ? <p className="text-stone-600">Matches {row.duplicateOf}.</p> : null}
        {row.status === "possible_duplicate" ? (
          <label className="mt-1 inline-flex items-center gap-2 text-stone-700">
            <input type="checkbox" checked={forced} onChange={onToggleForce} className="h-4 w-4 rounded border-stone-300" />
            This is a different car — import it anyway
          </label>
        ) : null}
        {rowWarnings.map((w, i) => (
          <p key={`w${i}`} className="text-amber-700">
            {w}
          </p>
        ))}
      </td>
    </tr>
  );
}

function ResultStep({ state }: { state: ImportState }) {
  const r = state.result!;
  return (
    <Card accent="green">
      <h2 className="text-base font-semibold text-stone-900">
        {r.created.length} {r.created.length === 1 ? "vehicle" : "vehicles"} imported
      </h2>

      {r.created.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="py-2 pr-4">Stock #</th>
                <th scope="col" className="py-2">Vehicle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {r.created.map((c) => (
                <tr key={c.stockNumber}>
                  <td className="py-2 pr-4 font-mono text-xs text-stone-700">{c.stockNumber}</td>
                  <td className="py-2 text-stone-900">{c.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {r.failed.length > 0 ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-900">{r.failed.length} could not be saved:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-red-800">
            {r.failed.map((f) => (
              <li key={f.index}>
                Row {f.index} — {f.label}: {f.message}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-800">Fix those rows and upload the file again. The cars above will not be entered twice.</p>
        </div>
      ) : null}

      {r.skipped > 0 ? (
        <p className="mt-3 text-sm text-stone-600">{r.skipped} rows were skipped (duplicates, or rows that needed fixing).</p>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <Link href="/vehicles" className="min-h-11 rounded-md bg-brand-700 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-800">
          See them in Vehicles
        </Link>
        <Link href="/admin/import" className="min-h-11 rounded-md border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-50">
          Import another file
        </Link>
      </div>
    </Card>
  );
}
