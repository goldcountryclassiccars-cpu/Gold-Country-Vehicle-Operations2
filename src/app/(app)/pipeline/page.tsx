import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { episodeWhereForUser } from "@/modules/episodes/service";
import { displayStage, STAGE_ORDER, type DisplayStage } from "@/modules/episodes/stage";
import { vehicleLabel } from "@/modules/vehicles/service";
import { EmptyState, PageHeader } from "@/components/ui";

/** Tailwind can only see literal class names, so the stage's badge tone is
 * mapped to a matching literal dot color here rather than built dynamically. */
const STAGE_DOT: Record<DisplayStage, string> = {
  Expected: "bg-slate-400",
  Intake: "bg-cyan-400",
  Reconditioning: "bg-orange-400",
  Media: "bg-violet-400",
  "Ready to List": "bg-indigo-400",
  Listed: "bg-blue-400",
  "Deal in Progress": "bg-amber-400",
  Closing: "bg-brand-600",
  "Delivered / Settling": "bg-teal-400",
  Closed: "bg-green-400",
  Inactive: "bg-stone-400",
};

const STAGE_BORDER: Record<DisplayStage, string> = {
  Expected: "border-l-slate-400",
  Intake: "border-l-cyan-400",
  Reconditioning: "border-l-orange-400",
  Media: "border-l-violet-400",
  "Ready to List": "border-l-indigo-400",
  Listed: "border-l-blue-400",
  "Deal in Progress": "border-l-amber-400",
  Closing: "border-l-brand-600",
  "Delivered / Settling": "border-l-teal-400",
  Closed: "border-l-green-400",
  Inactive: "border-l-stone-400",
};

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "episodes");

  const episodes = await db.inventoryEpisode.findMany({
    where: { AND: [episodeWhereForUser(user), { active: true }] },
    include: { vehicle: true },
    orderBy: { createdAt: "asc" },
  });

  const byStage = new Map<DisplayStage, typeof episodes>();
  for (const e of episodes) {
    const stage = displayStage(e);
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage)!.push(e);
  }
  const stages = STAGE_ORDER.filter((s) => s !== "Closed" && s !== "Inactive" && byStage.has(s));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Pipeline"
        subtitle="Active inventory grouped by computed stage. Each vehicle's six status dimensions are on its episode page."
      />
      {episodes.length === 0 ? (
        <EmptyState title="No active inventory" hint="Vehicles appear here from acceptance through financial close." />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <section key={stage} className="w-72 shrink-0">
              <h2 className="mb-2 flex items-center justify-between rounded-md bg-white px-2.5 py-2 text-sm font-semibold text-stone-700 shadow-sm">
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STAGE_DOT[stage]}`} aria-hidden="true" />
                  {stage}
                </span>
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
                  {byStage.get(stage)!.length}
                </span>
              </h2>
              <div className="space-y-2">
                {byStage.get(stage)!.map((e) => (
                  <Link
                    key={e.id}
                    href={`/episodes/${e.id}`}
                    className={`block rounded-lg border border-stone-200 border-l-4 bg-white p-3 shadow-sm transition-shadow hover:shadow-md ${STAGE_BORDER[stage]}`}
                  >
                    <p className="text-sm font-medium text-stone-900">{vehicleLabel(e.vehicle)}</p>
                    <p className="mt-0.5 text-xs text-stone-500">
                      {e.stockNumber} · {e.dealType === "CONSIGNMENT" ? "Consignment" : "Dealer-owned"}
                    </p>
                    {e.askingPrice ? (
                      <p className="mt-1 text-xs font-medium text-stone-700">${Number(e.askingPrice).toLocaleString()}</p>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
