import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { getScope, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Documents" };

const docTone = { GENERATED: "blue", SENT: "amber", PARTIALLY_SIGNED: "amber", SIGNED: "green", VOIDED: "neutral", FILED: "green" } as const;

export default async function DocumentsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "documents");

  const scope = getScope(user, "documents", "view");
  const docs = await db.documentInstance.findMany({
    where:
      scope === "ALL"
        ? {}
        : { sale: { OR: [{ salespersonId: user.id }, { createdById: user.id }] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { template: true, sale: true },
  });
  const episodes = await db.inventoryEpisode.findMany({
    where: { id: { in: [...new Set(docs.map((d) => d.episodeId))] } },
    include: { vehicle: true },
  });
  const epById = new Map(episodes.map((e) => [e.id, e]));

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Documents" subtitle="Generated sales documents, their versions and signature status." />

      <Card className="mb-6" accent="slate">
        <p className="text-sm text-amber-900">
          All documents are <strong>demonstration templates</strong> — watermarked and not legally sufficient. The
          owner setup checklist in <code className="rounded bg-stone-100 px-1">SALES_DOCUMENT_SETUP.md</code> lists what the
          dealership must provide before real documents are enabled.
        </p>
      </Card>

      {docs.length === 0 ? (
        <EmptyState title="No documents in your scope" hint="Generate documents from a deal page." />
      ) : (
        <div className="space-y-2">
          {docs.map((d) => {
            const ep = epById.get(d.episodeId);
            return (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
                <div>
                  <a href={`/api/files/${d.fileId}`} target="_blank" className="text-sm font-medium text-brand-700 hover:underline">
                    {d.template.name} v{d.version}
                  </a>
                  <p className="text-xs text-stone-500">
                    {ep ? `${ep.stockNumber} — ${vehicleLabel(ep.vehicle)}` : ""}
                    {d.saleId ? (
                      <>
                        {" · "}
                        <Link href={`/sales/${d.saleId}`} className="text-brand-700 hover:underline">deal</Link>
                      </>
                    ) : null}
                  </p>
                </div>
                <Badge tone={docTone[d.status]}>{d.status.toLowerCase().replace(/_/g, " ")}</Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
