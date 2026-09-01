import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { authorize, hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { commentVisibilityFilter, workflowRecordContext } from "@/modules/workflow/service";
import { addCommentAction, addFindingAction, completeInspectionAction, createWorkOrderAction } from "@/modules/workflow/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Inspection" };

const severityTone = { INFO: "neutral", MINOR: "blue", MAJOR: "amber", SAFETY: "red" } as const;

export default async function InspectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "inspections");
  const { id } = await params;

  const inspection = await db.inspection.findUnique({
    where: { id },
    include: {
      findings: { orderBy: { createdAt: "asc" } },
      comments: { where: commentVisibilityFilter(user), orderBy: { createdAt: "asc" } },
    },
  });
  if (!inspection) notFound();
  if (!authorize(user, "view", "inspections", await workflowRecordContext(inspection))) notFound();

  const episode = await db.inventoryEpisode.findUnique({ where: { id: inspection.episodeId }, include: { vehicle: true } });
  const canEdit = authorize(user, "edit", "inspections", await workflowRecordContext(inspection));
  const canComplete = authorize(user, "complete", "inspections", await workflowRecordContext(inspection));
  const canCreateWo = hasPermission(user, "work_orders", "create");
  const open = inspection.status === "SCHEDULED" || inspection.status === "IN_PROGRESS";

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`Inspection — ${episode?.stockNumber ?? ""}`}
        subtitle={episode ? vehicleLabel(episode.vehicle) : undefined}
        actions={
          <div className="flex items-center gap-2">
            {episode ? (
              <Link href={`/episodes/${episode.id}`} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
                Episode
              </Link>
            ) : null}
            <Badge tone={inspection.status === "COMPLETE" ? "green" : "amber"}>{inspection.status.toLowerCase().replace(/_/g, " ")}</Badge>
          </div>
        }
      />

      <div className="space-y-6">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-stone-900">Findings</h2>
          {inspection.findings.length === 0 ? (
            <p className="text-sm text-stone-500">No findings recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {inspection.findings.map((f) => (
                <li key={f.id} className="rounded-md border border-stone-200 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-stone-900">{f.title}</p>
                    <div className="flex items-center gap-2">
                      {f.estimatedCost ? <span className="text-xs text-stone-600">est. ${Number(f.estimatedCost).toLocaleString()}</span> : null}
                      <Badge tone={severityTone[f.severity]}>{f.severity.toLowerCase()}</Badge>
                    </div>
                  </div>
                  {f.description ? <p className="mt-1 text-sm text-stone-600">{f.description}</p> : null}
                  {f.recommendation ? <p className="mt-1 text-xs text-stone-500">Recommend: {f.recommendation}</p> : null}
                  {f.workOrderId ? (
                    <Link href={`/work-orders/${f.workOrderId}`} className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">
                      View work order →
                    </Link>
                  ) : canCreateWo && open && episode ? (
                    <form action={createWorkOrderAction} className="mt-2">
                      <input type="hidden" name="episodeId" value={episode.id} />
                      <input type="hidden" name="findingId" value={f.id} />
                      <input type="hidden" name="title" value={f.title} />
                      <input type="hidden" name="description" value={f.recommendation ?? f.description ?? ""} />
                      {inspection.departmentId ? <input type="hidden" name="departmentId" value={inspection.departmentId} /> : null}
                      {f.estimatedCost ? <input type="hidden" name="estimatedCost" value={String(f.estimatedCost)} /> : null}
                      <button type="submit" className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                        Create work order from finding
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canEdit && open ? (
            <form action={addFindingAction} className="mt-4 grid gap-2 border-t border-stone-100 pt-4 sm:grid-cols-6">
              <input type="hidden" name="inspectionId" value={inspection.id} />
              <div className="sm:col-span-2">
                <label htmlFor="f-title" className="block text-xs font-medium text-stone-500">New finding</label>
                <input id="f-title" name="title" required placeholder="Title" className={inputClass} />
              </div>
              <div>
                <label htmlFor="f-sev" className="block text-xs font-medium text-stone-500">Severity</label>
                <select id="f-sev" name="severity" className={inputClass} defaultValue="MINOR">
                  <option value="INFO">Info</option>
                  <option value="MINOR">Minor</option>
                  <option value="MAJOR">Major</option>
                  <option value="SAFETY">Safety</option>
                </select>
              </div>
              <div>
                <label htmlFor="f-cost" className="block text-xs font-medium text-stone-500">Est. cost ($)</label>
                <input id="f-cost" name="estimatedCost" type="number" min="0" step="0.01" className={inputClass} />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="f-rec" className="block text-xs font-medium text-stone-500">Recommendation</label>
                <input id="f-rec" name="recommendation" className={inputClass} />
              </div>
              <div className="sm:col-span-6">
                <button type="submit" className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                  Add finding
                </button>
              </div>
            </form>
          ) : null}
        </Card>

        {canComplete && open ? (
          <Card>
            <form action={completeInspectionAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="inspectionId" value={inspection.id} />
              <div className="flex-1">
                <label htmlFor="i-summary" className="block text-xs font-medium text-stone-500">Completion summary</label>
                <input id="i-summary" name="summary" defaultValue={inspection.summary ?? ""} className={inputClass} />
              </div>
              <button type="submit" className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
                Complete inspection
              </button>
            </form>
          </Card>
        ) : inspection.summary ? (
          <Card>
            <h2 className="mb-1 text-sm font-semibold text-stone-900">Summary</h2>
            <p className="text-sm text-stone-700">{inspection.summary}</p>
          </Card>
        ) : null}

        <Card>
          <h2 className="mb-3 text-base font-semibold text-stone-900">Comments</h2>
          {inspection.comments.length === 0 ? (
            <p className="text-sm text-stone-500">No comments.</p>
          ) : (
            <ul className="space-y-3">
              {inspection.comments.map((c) => (
                <li key={c.id} className="rounded-md bg-stone-50 p-3 text-sm">
                  <p className="text-stone-900">{c.body}</p>
                  <p className="mt-1 text-xs text-stone-500">
                    {c.authorName} · {new Date(c.createdAt).toLocaleString()}
                    {c.visibility === "VENDOR_VISIBLE" ? " · vendor-visible" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {hasPermission(user, "comments", "create") ? (
            <form action={addCommentAction} className="mt-4 flex gap-2 border-t border-stone-100 pt-4">
              <input type="hidden" name="inspectionId" value={inspection.id} />
              <label htmlFor="i-comment" className="sr-only">Add comment</label>
              <input id="i-comment" name="body" required placeholder="Add a comment…" className={inputClass + " mt-0 flex-1"} />
              <button type="submit" className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">
                Post
              </button>
            </form>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
