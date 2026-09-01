import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { workflowWhereForUser } from "@/modules/workflow/service";
import { createInspectionAction } from "@/modules/workflow/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Inspections" };

export default async function InspectionsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "inspections");

  const inspections = await db.inspection.findMany({
    where: workflowWhereForUser(user, "inspections") as never,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
    include: { findings: { select: { id: true, severity: true } } },
  });

  const [episodes, departments, users] = await Promise.all([
    db.inventoryEpisode.findMany({ where: { active: true }, include: { vehicle: true }, orderBy: { stockNumber: "asc" } }),
    db.department.findMany({ where: { active: true, key: { in: ["mechanical", "body", "detailing"] } }, orderBy: { name: "asc" } }),
    hasPermission(user, "inspections", "assign")
      ? db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
      : [],
  ]);
  const episodeById = new Map(episodes.map((e) => [e.id, e]));
  const canCreate = hasPermission(user, "inspections", "create");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Inspections" subtitle="Condition assessments feeding estimates, approvals, and work orders." />

      {canCreate ? (
        <Card className="mb-6">
          <h2 className="mb-3 text-sm font-semibold text-stone-900">Schedule inspection</h2>
          <form action={createInspectionAction} className="grid gap-2 sm:grid-cols-4">
            <div>
              <label htmlFor="insp-episode" className="block text-xs font-medium text-stone-500">Vehicle</label>
              <select id="insp-episode" name="episodeId" required className={inputClass}>
                {episodes.map((e) => (
                  <option key={e.id} value={e.id}>{e.stockNumber} — {vehicleLabel(e.vehicle)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="insp-dept" className="block text-xs font-medium text-stone-500">Department</label>
              <select id="insp-dept" name="departmentId" required className={inputClass}>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            {users.length ? (
              <div>
                <label htmlFor="insp-assignee" className="block text-xs font-medium text-stone-500">Assignee</label>
                <select id="insp-assignee" name="assigneeId" className={inputClass} defaultValue="">
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="flex items-end">
              <button type="submit" className="w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                Schedule
              </button>
            </div>
          </form>
        </Card>
      ) : null}

      {inspections.length === 0 ? (
        <EmptyState title="No inspections in your scope" />
      ) : (
        <div className="space-y-2">
          {inspections.map((i) => {
            const ep = episodeById.get(i.episodeId);
            const safety = i.findings.filter((f) => f.severity === "SAFETY").length;
            return (
              <Link
                key={i.id}
                href={`/inspections/${i.id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white p-4 shadow-sm hover:border-brand-600"
              >
                <div>
                  <p className="text-sm font-medium text-stone-900">
                    {ep ? `${ep.stockNumber} — ${vehicleLabel(ep.vehicle)}` : "Episode"}
                  </p>
                  <p className="text-xs text-stone-500">
                    {i.findings.length} finding{i.findings.length === 1 ? "" : "s"}
                    {safety ? ` · ${safety} safety` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  {safety ? <Badge tone="red">safety</Badge> : null}
                  <Badge tone={i.status === "COMPLETE" ? "green" : i.status === "IN_PROGRESS" ? "amber" : "neutral"}>
                    {i.status.toLowerCase().replace(/_/g, " ")}
                  </Badge>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
