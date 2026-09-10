import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { getScope, hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { vehicleLabel } from "@/modules/vehicles/service";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { documentSetupState } from "@/modules/documents/setup";

export const metadata: Metadata = { title: "Documents" };

const docTone = { GENERATED: "blue", SENT: "amber", PARTIALLY_SIGNED: "amber", SIGNED: "green", VOIDED: "neutral", FILED: "green" } as const;

export default async function DocumentsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "documents");

  const canManage = hasPermission(user, "admin", "manage_config");
  const setup = await documentSetupState();

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

      <Card className="mb-6" accent={setup.templatesApproved > 0 ? "green" : "amber"}>
        {setup.templatesApproved === 0 ? (
          <p className="text-sm text-stone-700">
            Every document here is a <strong>demonstration template</strong> — watermarked and not legally sufficient.
            To produce real documents, load your approved copies.
          </p>
        ) : (
          <p className="text-sm text-stone-700">
            <strong>
              {setup.templatesApproved} of {setup.templatesTotal} documents
            </strong>{" "}
            have an approved copy loaded and generate without a watermark. The rest are still demonstration templates.
          </p>
        )}
        <p className="mt-1 text-sm text-stone-600">
          {setup.done} of {setup.total} setup items are done.
        </p>
        {canManage ? (
          <Link
            href="/admin/documents"
            className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline"
          >
            Sale document setup — see what is still needed and load approved templates →
          </Link>
        ) : (
          <p className="mt-2 text-xs text-stone-500">An admin can load approved templates in Administration.</p>
        )}
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
