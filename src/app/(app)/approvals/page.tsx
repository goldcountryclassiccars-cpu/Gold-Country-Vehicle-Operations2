import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { decideApprovalAction } from "@/modules/workflow/actions";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "approve", "approvals");

  const [pending, decided] = await Promise.all([
    db.approval.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { workOrder: true },
    }),
    db.approval.findMany({
      where: { status: { in: ["APPROVED", "DECLINED"] } },
      orderBy: { decidedAt: "desc" },
      take: 10,
      include: { workOrder: true },
    }),
  ]);

  const episodeIds = [...new Set([...pending, ...decided].map((a) => a.episodeId).filter(Boolean))] as string[];
  const episodes = await db.inventoryEpisode.findMany({
    where: { id: { in: episodeIds } },
    include: { vehicle: true },
  });
  const epById = new Map(episodes.map((e) => [e.id, e]));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Approvals" subtitle="Spending and work requests awaiting a decision." />

      {pending.length === 0 ? (
        <EmptyState title="Nothing awaiting approval" />
      ) : (
        <div className="space-y-3">
          {pending.map((a) => {
            const ep = a.episodeId ? epById.get(a.episodeId) : null;
            return (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {a.workOrder ? (
                        <Link href={`/work-orders/${a.workOrder.id}`} className="text-brand-700 hover:underline">
                          {a.workOrder.title}
                        </Link>
                      ) : ("Approval request")}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {ep ? `${ep.stockNumber} — ${vehicleLabel(ep.vehicle)}` : ""}
                    </p>
                    <p className="mt-2 text-sm text-stone-700">{a.reason}</p>
                  </div>
                  <div className="text-right">
                    {a.amount ? <p className="text-lg font-semibold text-stone-900">${Number(a.amount).toLocaleString()}</p> : null}
                    <p className="text-xs text-stone-400">{new Date(a.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <form action={decideApprovalAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
                  <input type="hidden" name="approvalId" value={a.id} />
                  <div className="flex-1">
                    <label htmlFor={`note-${a.id}`} className="block text-xs font-medium text-stone-500">Decision note</label>
                    <input id={`note-${a.id}`} name="note" className={inputClass} />
                  </div>
                  <button type="submit" name="decision" value="APPROVED" className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800">
                    Approve
                  </button>
                  <button type="submit" name="decision" value="DECLINED" className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800">
                    Decline
                  </button>
                </form>
              </Card>
            );
          })}
        </div>
      )}

      {decided.length > 0 ? (
        <div className="mt-8">
          <h2 className="mb-3 text-base font-semibold text-stone-900">Recent decisions</h2>
          <ul className="space-y-2">
            {decided.map((a) => (
              <li key={a.id} className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-4 py-2 text-sm">
                <span className="text-stone-700">{a.workOrder?.title ?? a.reason}</span>
                <span className="flex items-center gap-2">
                  {a.amount ? <span className="text-xs text-stone-500">${Number(a.amount).toLocaleString()}</span> : null}
                  <Badge tone={a.status === "APPROVED" ? "green" : "red"}>{a.status.toLowerCase()}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
