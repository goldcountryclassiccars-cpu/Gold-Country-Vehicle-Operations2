import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { workflowWhereForUser } from "@/modules/workflow/service";
import { setTaskStatusAction, createTaskAction } from "@/modules/workflow/actions";
import { Badge, Card, EmptyState, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "My Work" };

const priorityTone = { LOW: "neutral", NORMAL: "blue", HIGH: "amber", URGENT: "red" } as const;

export default async function MyWorkPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "tasks");

  const [tasks, inspections, workOrders, episodes, departments, assignees] = await Promise.all([
    db.task.findMany({
      where: { AND: [workflowWhereForUser(user, "tasks") as never, { status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } }] },
      orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
      take: 50,
    }),
    hasPermission(user, "inspections", "view")
      ? db.inspection.findMany({
          where: { AND: [workflowWhereForUser(user, "inspections") as never, { status: { in: ["SCHEDULED", "IN_PROGRESS"] } }] },
          orderBy: { createdAt: "asc" },
          take: 25,
        })
      : [],
    hasPermission(user, "work_orders", "view")
      ? db.workOrder.findMany({
          where: {
            AND: [
              workflowWhereForUser(user, "work_orders") as never,
              { status: { in: ["DRAFT", "AWAITING_APPROVAL", "APPROVED", "IN_PROGRESS", "QUALITY_CONTROL"] } },
            ],
          },
          orderBy: { createdAt: "asc" },
          take: 25,
        })
      : [],
    db.inventoryEpisode.findMany({ where: { active: true }, select: { id: true, stockNumber: true }, orderBy: { stockNumber: "asc" } }),
    db.department.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    hasPermission(user, "tasks", "assign") ? db.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);

  const episodeLabel = new Map(episodes.map((e) => [e.id, e.stockNumber]));
  const canCreate = hasPermission(user, "tasks", "create");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="My Work" subtitle="Open tasks, inspections, and work orders relevant to you." />

      <div className="space-y-6">
        <Card accent="amber">
          <h2 className="mb-3 text-base font-semibold text-stone-900">Tasks</h2>
          {tasks.length === 0 ? (
            <p className="text-sm text-stone-500">No open tasks.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-sm font-medium text-stone-900">{t.title}</p>
                    <p className="text-xs text-stone-500">
                      {t.episodeId ? (
                        <Link href={`/episodes/${t.episodeId}`} className="text-brand-700 hover:underline">
                          {episodeLabel.get(t.episodeId) ?? "Episode"}
                        </Link>
                      ) : ("General")}
                      {t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={priorityTone[t.priority]}>{t.priority.toLowerCase()}</Badge>
                    <Badge>{t.status.toLowerCase().replace(/_/g, " ")}</Badge>
                    <form action={setTaskStatusAction} className="flex gap-1">
                      <input type="hidden" name="taskId" value={t.id} />
                      {t.status !== "IN_PROGRESS" ? (
                        <button name="status" value="IN_PROGRESS" className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                          Start
                        </button>
                      ) : null}
                      <button name="status" value="DONE" className="rounded-md bg-brand-700 px-2 py-1 text-xs font-medium text-white hover:bg-brand-800">
                        Done
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canCreate ? (
            <form action={createTaskAction} className="mt-4 grid gap-2 border-t border-stone-100 pt-4 sm:grid-cols-6">
              <div className="sm:col-span-2">
                <label htmlFor="task-title" className="block text-xs font-medium text-stone-500">New task</label>
                <input id="task-title" name="title" required placeholder="Title" className={inputClass} />
              </div>
              <div>
                <label htmlFor="task-episode" className="block text-xs font-medium text-stone-500">Vehicle</label>
                <select id="task-episode" name="episodeId" className={inputClass} defaultValue="">
                  <option value="">General</option>
                  {episodes.map((e) => (
                    <option key={e.id} value={e.id}>{e.stockNumber}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="task-dept" className="block text-xs font-medium text-stone-500">Department</label>
                <select id="task-dept" name="departmentId" className={inputClass} defaultValue="">
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              {assignees.length ? (
                <div>
                  <label htmlFor="task-assignee" className="block text-xs font-medium text-stone-500">Assignee</label>
                  <select id="task-assignee" name="assigneeId" className={inputClass} defaultValue="">
                    <option value="">Unassigned</option>
                    {assignees.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="flex items-end">
                <button type="submit" className="w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                  Add
                </button>
              </div>
            </form>
          ) : null}
        </Card>

        {inspections.length > 0 ? (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-stone-900">Inspections</h2>
            <ul className="divide-y divide-stone-100">
              {inspections.map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2">
                  <Link href={`/inspections/${i.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                    {episodeLabel.get(i.episodeId) ?? "Episode"} — inspection
                  </Link>
                  <Badge tone={i.status === "IN_PROGRESS" ? "amber" : "neutral"}>{i.status.toLowerCase().replace(/_/g, " ")}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {workOrders.length > 0 ? (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-stone-900">Work orders</h2>
            <ul className="divide-y divide-stone-100">
              {workOrders.map((w) => (
                <li key={w.id} className="flex items-center justify-between py-2">
                  <div>
                    <Link href={`/work-orders/${w.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                      {w.title}
                    </Link>
                    <p className="text-xs text-stone-500">{episodeLabel.get(w.episodeId) ?? ""}</p>
                  </div>
                  <Badge tone={w.status === "IN_PROGRESS" ? "amber" : w.status === "AWAITING_APPROVAL" ? "blue" : "neutral"}>
                    {w.status.toLowerCase().replace(/_/g, " ")}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {tasks.length === 0 && inspections.length === 0 && workOrders.length === 0 ? (
          <EmptyState title="Nothing assigned right now" hint="Work assigned to you or your department appears here." />
        ) : null}
      </div>
    </div>
  );
}
