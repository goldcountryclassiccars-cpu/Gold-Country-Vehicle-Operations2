import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { workflowWhereForUser } from "@/modules/workflow/service";
import { createWorkOrderAction } from "@/modules/workflow/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Work Orders" };

const statusTone = {
  DRAFT: "neutral",
  AWAITING_APPROVAL: "blue",
  APPROVED: "brand",
  DECLINED: "red",
  IN_PROGRESS: "amber",
  QUALITY_CONTROL: "amber",
  COMPLETE: "green",
  CANCELED: "neutral",
} as const;

export default async function WorkOrdersPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "work_orders");

  const workOrders = await db.workOrder.findMany({
    where: workflowWhereForUser(user, "work_orders") as never,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
  });

  const [episodes, departments, users] = await Promise.all([
    db.inventoryEpisode.findMany({ where: { active: true }, include: { vehicle: true }, orderBy: { stockNumber: "asc" } }),
    db.department.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    hasPermission(user, "work_orders", "assign")
      ? db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [],
  ]);
  const episodeById = new Map(episodes.map((e) => [e.id, e]));
  const canCreate = hasPermission(user, "work_orders", "create");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Work Orders" subtitle="Reconditioning and repair work, from estimate to completion." />

      {canCreate ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-stone-900">New work order</h2>
          <form action={createWorkOrderAction} className="grid gap-2 sm:grid-cols-5">
            <div className="sm:col-span-2">
              <label htmlFor="wo-title" className="block text-xs font-medium text-stone-500">Title</label>
              <input id="wo-title" name="title" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="wo-episode" className="block text-xs font-medium text-stone-500">Vehicle</label>
              <select id="wo-episode" name="episodeId" required className={inputClass}>
                {episodes.map((e) => (
                  <option key={e.id} value={e.id}>{e.stockNumber} — {vehicleLabel(e.vehicle)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="wo-dept" className="block text-xs font-medium text-stone-500">Department</label>
              <select id="wo-dept" name="departmentId" className={inputClass} defaultValue="">
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            {users.length ? (
              <div>
                <label htmlFor="wo-assignee" className="block text-xs font-medium text-stone-500">Assignee</label>
                <select id="wo-assignee" name="assigneeId" className={inputClass} defaultValue="">
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <label htmlFor="wo-est" className="block text-xs font-medium text-stone-500">Est. cost ($)</label>
              <input id="wo-est" name="estimatedCost" type="number" min="0" step="0.01" className={inputClass} />
            </div>
            <div className="flex items-end">
              <button type="submit" className="w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                Create
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {workOrders.length === 0 ? (
        <EmptyState title="No work orders in your scope" />
      ) : (
        <div className="space-y-2">
          {workOrders.map((w) => {
            const ep = episodeById.get(w.episodeId);
            return (
              <Link
                key={w.id}
                href={`/work-orders/${w.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white p-4 shadow-sm hover:border-brand-600"
              >
                <div>
                  <p className="text-sm font-medium text-stone-900">{w.title}</p>
                  <p className="text-xs text-stone-500">
                    {ep ? `${ep.stockNumber} — ${vehicleLabel(ep.vehicle)}` : ""}
                    {w.estimatedCost ? ` · est. $${Number(w.estimatedCost).toLocaleString()}` : ""}
                  </p>
                </div>
                <Badge tone={statusTone[w.status]}>{w.status.toLowerCase().replace(/_/g, " ")}</Badge>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
