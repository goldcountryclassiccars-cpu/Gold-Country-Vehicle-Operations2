import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { commentVisibilityFilter, workflowWhereForUser } from "@/modules/workflow/service";
import {
  addTaskNoteAction,
  completeTaskWithNoteAction,
  setTaskStatusAction,
  createTaskAction,
} from "@/modules/workflow/actions";
import { dealershipTimeString } from "@/lib/dealership-date";
import { Badge, Card, EmptyState, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "My Work" };

const priorityTone = { LOW: "neutral", NORMAL: "blue", HIGH: "amber", URGENT: "red" } as const;

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  episodeId: string | null;
  assigneeId: string | null;
  status: string;
  priority: keyof typeof priorityTone;
  dueAt: Date | null;
  completedAt: Date | null;
};

type NoteRow = { id: string; taskId: string | null; authorName: string; body: string; createdAt: Date };

/**
 * The notes thread on a task, behind a disclosure so the list stays scannable.
 * "Done" is rarely the whole story — this is where staff say what was actually
 * done, what's left, or why something is stuck.
 */
function TaskNotes({
  task,
  notes,
  canComment,
  canComplete,
}: {
  task: TaskRow;
  notes: NoteRow[];
  canComment: boolean;
  /** Show the "save note & mark done" button (open tasks only). */
  canComplete: boolean;
}) {
  if (!canComment && notes.length === 0) return null;
  return (
    <details className="mt-1">
      <summary className="inline-flex min-h-8 cursor-pointer items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
        {notes.length > 0 ? `Notes (${notes.length})` : "Add a note"}
      </summary>
      <div className="mt-2 space-y-2 rounded-md bg-stone-50 p-3">
        {notes.map((n) => (
          <div key={n.id} className="text-sm">
            <p className="text-xs text-stone-500">
              <span className="font-medium text-stone-700">{n.authorName}</span>
              {" · "}
              {dealershipTimeString(n.createdAt)}
            </p>
            <p className="whitespace-pre-line text-stone-800">{n.body}</p>
          </div>
        ))}
        {canComment ? (
          <form action={addTaskNoteAction} className="border-t border-stone-200 pt-2">
            <input type="hidden" name="taskId" value={task.id} />
            <label htmlFor={`note-${task.id}`} className="sr-only">
              Add a note to {task.title}
            </label>
            <textarea
              id={`note-${task.id}`}
              name="body"
              required
              rows={2}
              maxLength={4000}
              placeholder="What did you do, or what's in the way? Sign your name if you're on the shared iPad."
              className={inputClass + " mt-0"}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="submit"
                className="min-h-9 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-50"
              >
                Add note
              </button>
              {canComplete ? (
                <button
                  type="submit"
                  formAction={completeTaskWithNoteAction}
                  className="min-h-9 rounded-md bg-brand-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-800"
                >
                  Save note & mark done
                </button>
              ) : null}
            </div>
          </form>
        ) : null}
      </div>
    </details>
  );
}

export default async function MyWorkPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "tasks");

  const taskSelect = {
    id: true,
    title: true,
    description: true,
    episodeId: true,
    assigneeId: true,
    status: true,
    priority: true,
    dueAt: true,
    completedAt: true,
  } as const;

  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000);

  const [tasks, doneTasks, inspections, workOrders, episodes, departments, assignees] = await Promise.all([
    db.task.findMany({
      where: { AND: [workflowWhereForUser(user, "tasks") as never, { status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } }] },
      orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
      select: taskSelect,
      take: 50,
    }),
    db.task.findMany({
      where: {
        AND: [
          workflowWhereForUser(user, "tasks") as never,
          { status: "DONE", completedAt: { gte: fourteenDaysAgo } },
        ],
      },
      orderBy: { completedAt: "desc" },
      select: taskSelect,
      take: 15,
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

  const allTasks = [...tasks, ...doneTasks];

  // Notes for every listed task, plus names for the people tasks are assigned
  // to — the shop iPad is one shared login, so people find their work by name.
  const [notes, taskPeople] = await Promise.all([
    allTasks.length
      ? db.comment.findMany({
          where: { AND: [{ taskId: { in: allTasks.map((t) => t.id) } }, commentVisibilityFilter(user)] },
          orderBy: { createdAt: "asc" },
          select: { id: true, taskId: true, authorName: true, body: true, createdAt: true },
        })
      : [],
    db.user.findMany({
      where: { id: { in: [...new Set(allTasks.map((t) => t.assigneeId).filter((v): v is string => !!v))] } },
      select: { id: true, name: true },
    }),
  ]);

  const notesByTask = new Map<string, NoteRow[]>();
  for (const n of notes) {
    if (!n.taskId) continue;
    const list = notesByTask.get(n.taskId) ?? [];
    list.push(n);
    notesByTask.set(n.taskId, list);
  }
  const personName = new Map(taskPeople.map((p) => [p.id, p.name]));
  const episodeLabel = new Map(episodes.map((e) => [e.id, e.stockNumber]));
  const canCreate = hasPermission(user, "tasks", "create");
  const canComment = hasPermission(user, "comments", "create");
  const canComplete = hasPermission(user, "tasks", "complete");

  function taskMeta(t: TaskRow) {
    const assignee = t.assigneeId ? personName.get(t.assigneeId) : null;
    return (
      <p className="text-xs text-stone-500">
        {t.episodeId ? (
          <Link href={`/episodes/${t.episodeId}`} className="text-brand-700 hover:underline">
            {episodeLabel.get(t.episodeId) ?? "Vehicle"}
          </Link>
        ) : (
          "General"
        )}
        {assignee ? ` · for ${assignee}` : ""}
        {t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleDateString()}` : ""}
        {t.completedAt ? ` · done ${dealershipTimeString(t.completedAt)}` : ""}
      </p>
    );
  }

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
                <li key={t.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-900">{t.title}</p>
                      {taskMeta(t)}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={priorityTone[t.priority]}>{t.priority.toLowerCase()}</Badge>
                      <Badge>{t.status.toLowerCase().replace(/_/g, " ")}</Badge>
                      <form action={setTaskStatusAction} className="flex gap-1">
                        <input type="hidden" name="taskId" value={t.id} />
                        {t.status !== "IN_PROGRESS" ? (
                          <button name="status" value="IN_PROGRESS" className="min-h-9 rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                            Start
                          </button>
                        ) : null}
                        <button name="status" value="DONE" className="min-h-9 rounded-md bg-brand-700 px-2 py-1 text-xs font-medium text-white hover:bg-brand-800">
                          Done
                        </button>
                      </form>
                    </div>
                  </div>
                  {t.description ? (
                    <p className="mt-1 whitespace-pre-line text-xs text-stone-600">{t.description}</p>
                  ) : null}
                  <TaskNotes
                    task={t}
                    notes={notesByTask.get(t.id) ?? []}
                    canComment={canComment}
                    canComplete={canComplete}
                  />
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

        {doneTasks.length > 0 ? (
          <Card>
            <h2 className="mb-1 text-base font-semibold text-stone-900">Recently completed</h2>
            <p className="mb-3 text-xs text-stone-500">
              The last two weeks. Notes stay readable here after a task is done.
            </p>
            <ul className="divide-y divide-stone-100">
              {doneTasks.map((t) => (
                <li key={t.id} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-stone-700">{t.title}</p>
                      {taskMeta(t)}
                    </div>
                    <Badge tone="green">done</Badge>
                  </div>
                  <TaskNotes
                    task={t}
                    notes={notesByTask.get(t.id) ?? []}
                    canComment={canComment}
                    canComplete={false}
                  />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

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

        {tasks.length === 0 && doneTasks.length === 0 && inspections.length === 0 && workOrders.length === 0 ? (
          <EmptyState title="Nothing assigned right now" hint="Work assigned to you or your department appears here." />
        ) : null}
      </div>
    </div>
  );
}
