/**
 * One responsive table.
 *
 * Renders a real `<table>` at `lg` and up, and a card per row below it. Both
 * come from the same column definitions and are both rendered server-side, so
 * there is no second data path, no JS, and no layout shift — CSS swaps them.
 *
 * **The breakpoint is `lg`, not `sm`, and that is deliberate.** `sm` passes a
 * phone audit and leaves the shared shop iPad broken: 820px minus the 256px
 * sidebar is under 500px of content, which is not enough for a six-column
 * table. Only `lg` guarantees room for the real table.
 *
 * Columns declare a `phone` role so the card lays itself out instead of
 * guessing which value is the heading:
 *
 *   title        the card's heading (usually the link to the record)
 *   meta         a chip on the heading row — statuses, badges, short numbers
 *   line         a label/value row in the card body
 *   desktop-only rendered in the table, omitted from the card
 *
 * Declare columns as `Column<(typeof rows)[number]>[]` inside the component
 * rather than writing a row interface by hand — the hand-written type drifts
 * from the query result and is wrong within minutes.
 */
import { clsx } from "clsx";
import type { ReactNode } from "react";

export type PhoneRole = "title" | "meta" | "line" | "desktop-only";

export interface Column<T> {
  /** Stable key — also the React key for the cell. */
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** How this column appears on a phone card. Defaults: first column `title`, the rest `line`. */
  phone?: PhoneRole;
  /** Extra classes for the table `<td>`. */
  className?: string;
  /** Extra classes for the table `<th>`. */
  headerClassName?: string;
}

export interface PhonePartition<T> {
  title: Column<T> | null;
  meta: Column<T>[];
  lines: Column<T>[];
  hidden: Column<T>[];
}

/**
 * Sorts columns into the four card buckets.
 *
 * Pure and exported because every failure mode here is *silent*: a column that
 * lands in no bucket still renders a perfectly plausible card that has quietly
 * dropped someone's asking price. Nothing throws, so only tests catch it.
 *
 * Guarantee: every input column appears in exactly one bucket, once.
 */
export function partitionColumns<T>(columns: Column<T>[]): PhonePartition<T> {
  let title: Column<T> | null = null;
  const meta: Column<T>[] = [];
  const lines: Column<T>[] = [];
  const hidden: Column<T>[] = [];

  for (const [i, column] of columns.entries()) {
    let role: PhoneRole = column.phone ?? (i === 0 ? "title" : "line");
    // A card has one heading. A second declared title would otherwise replace
    // the first and take its value off the screen; demote it to a line so the
    // value is still shown, just lower down.
    if (role === "title" && title !== null) role = "line";

    if (role === "title") title = column;
    else if (role === "meta") meta.push(column);
    else if (role === "desktop-only") hidden.push(column);
    else lines.push(column);
  }

  return { title, meta, lines, hidden };
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
  className,
  bare = false,
}: {
  columns: Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
  /** Accessible description of the table, visually hidden. */
  caption?: string;
  className?: string;
  /** Drops the outer border and shadow — use when the table already sits inside a <Card>. */
  bare?: boolean;
}) {
  if (rows.length === 0) return <>{empty ?? null}</>;
  const { title, meta, lines } = partitionColumns(columns);

  return (
    <div className={className}>
      {/* Real table — iPad landscape and up. */}
      <div
        className={clsx(
          "hidden overflow-x-auto lg:block",
          bare ? null : "rounded-lg border border-stone-200 bg-white shadow-sm",
        )}
      >
        <table className="w-full text-left text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={clsx("px-4 py-3 font-medium", c.headerClassName)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-stone-50">
                {columns.map((c) => (
                  <td key={c.key} className={clsx("px-4 py-3 align-top", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Card per row — phone and iPad portrait. */}
      <ul className="space-y-3 lg:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className={clsx(
              "rounded-lg border border-stone-200 p-4",
              bare ? "bg-stone-50/60" : "bg-white shadow-sm",
            )}
          >
            {title || meta.length > 0 ? (
              <div className="flex flex-wrap items-start justify-between gap-2">
                {title ? <div className="min-w-0 font-medium text-stone-900">{title.cell(row)}</div> : null}
                {meta.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {meta.map((c) => (
                      <span key={c.key}>{c.cell(row)}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {lines.length > 0 ? (
              <dl className="mt-3 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
                {lines.map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-xs uppercase tracking-wide text-stone-500">{c.header}</dt>
                    <dd className="text-stone-800">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
