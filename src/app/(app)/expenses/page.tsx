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

      {expenses.length === 0 ? (
        <EmptyState title="No expenses recorded" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-4 py-3">Vehicle</th>
                <th scope="col" className="px-4 py-3">Expense</th>
                <th scope="col" className="px-4 py-3">Category</th>
                <th scope="col" className="px-4 py-3">Responsibility</th>
                <th scope="col" className="px-4 py-3 text-right">Est.</th>
                <th scope="col" className="px-4 py-3 text-right">Actual</th>
                <th scope="col" className="px-4 py-3">Status</th>
                {canEdit || canApprove ? <th scope="col" className="px-4 py-3">Actions</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {expenses.map((e) => {
                const ep = epById.get(e.episodeId);
                const transitions = (NEXT[e.status] ?? []).filter((t) =>
                  t.value === "APPROVED" || t.value === "DECLINED" ? canApprove : canEdit,
                );
                return (
                  <tr key={e.id} className="align-top hover:bg-stone-50">
                    <td className="px-4 py-3">
                      {ep ? (
                        <Link href={`/episodes/${ep.id}`} className="text-brand-700 hover:underline">
                          {ep.stockNumber}
                        </Link>
                      ) : ("—")}
                      <p className="text-xs text-stone-400">{ep ? vehicleLabel(ep.vehicle) : ""}</p>
                    </td>
                    <td className="px-4 py-3 text-stone-900">
                      {e.description}
                      {e.workOrderId ? (
                        <Link href={`/work-orders/${e.workOrderId}`} className="block text-xs text-brand-700 hover:underline">
                          from work order →
                        </Link>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-stone-600">{e.category.name}</td>
                    <td className="px-4 py-3 text-stone-600">{e.responsibility.toLowerCase().replace(/_/g, " ")}</td>
                    <td className="px-4 py-3 text-right text-stone-700">{e.estimatedAmount ? `$${Number(e.estimatedAmount).toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-3 text-right text-stone-900">{e.actualAmount ? `$${Number(e.actualAmount).toLocaleString()}` : "—"}</td>
                    <td className="px-4 py-3"><Badge tone={statusTone[e.status]}>{e.status.toLowerCase()}</Badge></td>
                    {canEdit || canApprove ? (
                      <td className="px-4 py-3">
                        {transitions.length ? (
                          <form action={setExpenseStatusAction} className="flex flex-wrap gap-1">
                            <input type="hidden" name="expenseId" value={e.id} />
                            {e.status === "COMMITTED" || e.status === "APPROVED" ? (
                              <input name="actualAmount" type="number" min="0" step="0.01" placeholder="actual $" className="w-20 rounded-md border border-stone-300 px-1 py-0.5 text-xs" />
                            ) : null}
                            {transitions.map((t) => (
                              <button key={t.value} type="submit" name="status" value={t.value} className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                                {t.label}
                              </button>
                            ))}
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
