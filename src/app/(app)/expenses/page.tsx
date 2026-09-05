import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { effectiveAmount } from "@/modules/finance/service";
import { createExpenseAction, setExpenseStatusAction } from "@/modules/finance/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader, inputClass } from "@/components/ui";
import { DataTable, type Column } from "@/components/data-table";

export const metadata: Metadata = { title: "Expenses" };

const statusTone = {
  ESTIMATED: "neutral",
  SUBMITTED: "blue",
  APPROVED: "brand",
  DECLINED: "red",
  COMMITTED: "blue",
  INCURRED: "amber",
  PAID: "green",
  REIMBURSED: "green",
  VOIDED: "neutral",
} as const;

const NEXT: Record<string, { value: string; label: string }[]> = {
  ESTIMATED: [{ value: "SUBMITTED", label: "Submit" }, { value: "VOIDED", label: "Void" }],
  SUBMITTED: [{ value: "APPROVED", label: "Approve" }, { value: "DECLINED", label: "Decline" }],
  APPROVED: [{ value: "COMMITTED", label: "Commit" }, { value: "INCURRED", label: "Incurred" }],
  DECLINED: [{ value: "SUBMITTED", label: "Resubmit" }],
  COMMITTED: [{ value: "INCURRED", label: "Incurred" }],
  INCURRED: [{ value: "PAID", label: "Mark paid" }],
  PAID: [],
  REIMBURSED: [],
  VOIDED: [],
};

const RESPONSIBILITIES = [
  ["DEALERSHIP", "Dealership"],
  ["CONSIGNOR", "Consignor"],
  ["BUYER_PASS_THROUGH", "Buyer pass-through"],
  ["SHARED", "Shared"],
  ["REIMBURSABLE", "Reimbursable"],
  ["PENDING", "Pending"],
] as const;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ episode?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "expenses");
  const { episode: episodeFilter } = await searchParams;

  const [expenses, episodes, categories] = await Promise.all([
    db.expenseEntry.findMany({
      where: episodeFilter ? { episodeId: episodeFilter } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { category: true },
    }),
    db.inventoryEpisode.findMany({ where: { active: true }, include: { vehicle: true }, orderBy: { stockNumber: "asc" } }),
    db.expenseCategory.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const epById = new Map(episodes.map((e) => [e.id, e]));
  const canCreate = hasPermission(user, "expenses", "create");
  const canEdit = hasPermission(user, "expenses", "edit");
  const canApprove = hasPermission(user, "expenses", "approve") || user.isOwner;

  const total = expenses.filter((e) => !["VOIDED", "DECLINED"].includes(e.status)).reduce((s, e) => s + effectiveAmount(e), 0);

  const columns: Column<(typeof expenses)[number]>[] = [
    {
      key: "description",
      header: "Expense",
      phone: "title",
      className: "text-stone-900",
      cell: (e) => (
        <>
          {e.description}
          {e.workOrderId ? (
            <Link href={`/work-orders/${e.workOrderId}`} className="block text-xs text-brand-700 hover:underline">
              from work order →
            </Link>
          ) : null}
        </>
      ),
    },
    {
      key: "status",
      header: "Status",
      phone: "meta",
      cell: (e) => <Badge tone={statusTone[e.status]}>{e.status.toLowerCase()}</Badge>,
    },
    {
      key: "vehicle",
      header: "Vehicle",
      cell: (e) => {
        const ep = epById.get(e.episodeId);
        return (
          <>
            {ep ? (
              <Link href={`/episodes/${ep.id}`} className="text-brand-700 hover:underline">
                {ep.stockNumber}
              </Link>
            ) : (
              "—"
            )}
            <p className="text-xs text-stone-400">{ep ? vehicleLabel(ep.vehicle) : ""}</p>
          </>
        );
      },
    },
    { key: "category", header: "Category", className: "text-stone-600", cell: (e) => e.category.name },
    {
      key: "responsibility",
      header: "Responsibility",
      className: "text-stone-600",
      cell: (e) => e.responsibility.toLowerCase().replace(/_/g, " "),
    },
    {
      key: "estimated",
      header: "Est.",
      className: "text-right text-stone-700",
      headerClassName: "text-right",
      cell: (e) => (e.estimatedAmount ? `$${Number(e.estimatedAmount).toLocaleString()}` : "—"),
    },
    {
      key: "actual",
      header: "Actual",
      className: "text-right text-stone-900",
      headerClassName: "text-right",
      cell: (e) => (e.actualAmount ? `$${Number(e.actualAmount).toLocaleString()}` : "—"),
    },
    ...(canEdit || canApprove
      ? [
          {
            key: "actions",
            header: "Actions",
            cell: (e: (typeof expenses)[number]) => {
              const transitions = (NEXT[e.status] ?? []).filter((t) =>
                t.value === "APPROVED" || t.value === "DECLINED" ? canApprove : canEdit,
              );
              if (!transitions.length) return null;
              return (
                <form action={setExpenseStatusAction} className="flex flex-wrap gap-1">
                  <input type="hidden" name="expenseId" value={e.id} />
                  {e.status === "COMMITTED" || e.status === "APPROVED" ? (
                    <input
                      name="actualAmount"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="actual $"
                      aria-label="Actual amount"
                      className="w-20 rounded-md border border-stone-300 px-1 py-0.5 text-xs"
                    />
                  ) : null}
                  {transitions.map((t) => (
                    <button
                      key={t.value}
                      type="submit"
                      name="status"
                      value={t.value}
                      className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50"
                    >
                      {t.label}
                    </button>
                  ))}
                </form>
              );
            },
          } satisfies Column<(typeof expenses)[number]>,
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Expenses"
        subtitle={`Vehicle cost ledger — every amount keeps its estimate/approved/committed/actual history. Shown total: $${total.toLocaleString()}`}
      />

      {canCreate ? (
        <Card className="mb-6" accent="rose">
          <h2 className="mb-3 text-sm font-semibold text-stone-900">New expense</h2>
          <form action={createExpenseAction} className="grid gap-2 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label htmlFor="ex-desc" className="block text-xs font-medium text-stone-500">Description</label>
              <input id="ex-desc" name="description" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="ex-episode" className="block text-xs font-medium text-stone-500">Vehicle</label>
              <select id="ex-episode" name="episodeId" required className={inputClass} defaultValue={episodeFilter ?? undefined}>
                {episodes.map((e) => (
                  <option key={e.id} value={e.id}>{e.stockNumber}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ex-cat" className="block text-xs font-medium text-stone-500">Category</label>
              <select id="ex-cat" name="categoryId" required className={inputClass}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ex-resp" className="block text-xs font-medium text-stone-500">Responsibility</label>
              <select id="ex-resp" name="responsibility" className={inputClass} defaultValue="DEALERSHIP">
                {RESPONSIBILITIES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ex-est" className="block text-xs font-medium text-stone-500">Estimate ($)</label>
              <input id="ex-est" name="estimatedAmount" type="number" min="0" step="0.01" className={inputClass} />
            </div>
            <div className="sm:col-span-6">
              <button type="submit" className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                Add expense
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      <DataTable
        caption="Expense entries"
        columns={columns}
        rows={expenses}
        rowKey={(e) => e.id}
        empty={<EmptyState title="No expenses recorded" />}
      />
    </div>
  );
}
