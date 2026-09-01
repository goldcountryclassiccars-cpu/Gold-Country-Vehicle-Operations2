import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { authorize, hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { commentVisibilityFilter, workflowRecordContext } from "@/modules/workflow/service";
import { addCommentAction, requestApprovalAction, setWorkOrderStatusAction } from "@/modules/workflow/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, DescriptionList, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Work Order" };

const NEXT_STATUSES: Record<string, { value: string; label: string }[]> = {
  DRAFT: [
    { value: "IN_PROGRESS", label: "Start work" },
    { value: "CANCELED", label: "Cancel" },
  ],
  AWAITING_APPROVAL: [],
  APPROVED: [
    { value: "IN_PROGRESS", label: "Start work" },
    { value: "CANCELED", label: "Cancel" },
  ],
  DECLINED: [{ value: "DRAFT", label: "Back to draft" }],
  IN_PROGRESS: [
    { value: "QUALITY_CONTROL", label: "Send to QC" },
    { value: "COMPLETE", label: "Complete" },
  ],
  QUALITY_CONTROL: [
    { value: "COMPLETE", label: "Pass QC / complete" },
    { value: "IN_PROGRESS", label: "Back to work" },
  ],
  COMPLETE: [],
  CANCELED: [],
};

export default async function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "work_orders");
  const { id } = await params;

  const wo = await db.workOrder.findUnique({
    where: { id },
    include: {
      comments: { where: commentVisibilityFilter(user), orderBy: { createdAt: "asc" } },
      approvals: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!wo) notFound();
  const ctx = await workflowRecordContext(wo);
  if (!authorize(user, "view", "work_orders", ctx)) notFound();

  const [episode, assignee, vendorParty] = await Promise.all([
    db.inventoryEpisode.findUnique({ where: { id: wo.episodeId }, include: { vehicle: true } }),
    wo.assigneeId ? db.user.findUnique({ where: { id: wo.assigneeId }, select: { name: true } }) : null,
    wo.vendorPartyId ? db.party.findUnique({ where: { id: wo.vendorPartyId }, select: { displayName: true } }) : null,
  ]);

  const canEdit = authorize(user, "edit", "work_orders", ctx);
  const canComplete = authorize(user, "complete", "work_orders", ctx);
  const canRequestApproval = hasPermission(user, "approvals", "create");
  const isVendorOnly = user.roleKeys.length === 1 && user.roleKeys[0] === "vendor";
  const pendingApproval = wo.approvals.find((a) => a.status === "PENDING");

  const transitions = (NEXT_STATUSES[wo.status] ?? []).filter((t) =>
    t.value === "COMPLETE" ? canComplete : canEdit,
  );

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={wo.title}
        subtitle={episode ? `${episode.stockNumber} — ${vehicleLabel(episode.vehicle)}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            {episode && !isVendorOnly ? (
              <Link href={`/episodes/${episode.id}`} className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
                Episode
              </Link>
            ) : null}
            <Badge tone={wo.status === "COMPLETE" ? "green" : wo.status === "IN_PROGRESS" ? "amber" : "neutral"}>
              {wo.status.toLowerCase().replace(/_/g, " ")}
            </Badge>
          </div>
        }
      />

      <div className="space-y-6">
        <Card>
          <DescriptionList
            items={[
              { label: "Description", value: wo.description },
              { label: "Assignee", value: assignee?.name },
              { label: "Vendor", value: vendorParty?.displayName },
              { label: "Estimated cost", value: wo.estimatedCost ? `$${Number(wo.estimatedCost).toLocaleString()}` : null },
              { label: "Actual cost", value: wo.actualCost ? `$${Number(wo.actualCost).toLocaleString()}` : null },
              { label: "Started", value: wo.startedAt ? new Date(wo.startedAt).toLocaleDateString() : null },
              { label: "Completed", value: wo.completedAt ? new Date(wo.completedAt).toLocaleDateString() : null },
            ]}
          />

          {transitions.length > 0 ? (
            <form action={setWorkOrderStatusAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-4">
              <input type="hidden" name="workOrderId" value={wo.id} />
              {(wo.status === "IN_PROGRESS" || wo.status === "QUALITY_CONTROL") && canComplete ? (
                <div>
                  <label htmlFor="wo-actual" className="block text-xs font-medium text-stone-500">Actual cost ($, on completion)</label>
                  <input id="wo-actual" name="actualCost" type="number" min="0" step="0.01" className={inputClass} />
                </div>
              ) : null}
              <div className="flex gap-2">
                {transitions.map((t) => (
                  <button
                    key={t.value}
                    type="submit"
                    name="status"
                    value={t.value}
                    className={
                      t.value === "COMPLETE"
                        ? "rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800"
                        : "rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50"
                    }
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </form>
          ) : null}

          {wo.status === "DRAFT" && canRequestApproval && !isVendorOnly ? (
            <form action={requestApprovalAction} className="mt-4 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-4">
              <input type="hidden" name="workOrderId" value={wo.id} />
              <div className="flex-1">
                <label htmlFor="ap-reason" className="block text-xs font-medium text-stone-500">Request approval — reason</label>
                <input id="ap-reason" name="reason" required className={inputClass} />
              </div>
              <div>
                <label htmlFor="ap-amount" className="block text-xs font-medium text-stone-500">Amount ($)</label>
                <input id="ap-amount" name="amount" type="number" min="0" step="0.01" defaultValue={wo.estimatedCost ? String(wo.estimatedCost) : ""} className={inputClass} />
              </div>
              <button type="submit" className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">
                Request approval
              </button>
            </form>
          ) : null}

          {pendingApproval && !isVendorOnly ? (
            <p className="mt-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
              Approval pending: {pendingApproval.reason}
              {hasPermission(user, "approvals", "approve") ? (
                <Link href="/approvals" className="ml-2 font-medium underline">Review in Approvals →</Link>
              ) : null}
            </p>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-stone-900">Comments</h2>
          {wo.comments.length === 0 ? (
            <p className="text-sm text-stone-500">No comments.</p>
          ) : (
            <ul className="space-y-3">
              {wo.comments.map((c) => (
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
            <form action={addCommentAction} className="mt-4 border-t border-stone-100 pt-4">
              <input type="hidden" name="workOrderId" value={wo.id} />
              <div className="flex gap-2">
                <label htmlFor="wo-comment" className="sr-only">Add comment</label>
                <input id="wo-comment" name="body" required placeholder="Add a comment…" className={inputClass + " mt-0 flex-1"} />
                <button type="submit" className="rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-50">
                  Post
                </button>
              </div>
              {!isVendorOnly && (wo.vendorPartyId || wo.assigneeId) ? (
                <label className="mt-2 flex items-center gap-2 text-xs text-stone-600">
                  <input type="checkbox" name="visibility" value="VENDOR_VISIBLE" className="h-4 w-4 rounded border-stone-300" />
                  Visible to external vendor
                </label>
              ) : null}
            </form>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
