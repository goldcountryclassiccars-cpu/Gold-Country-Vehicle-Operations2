import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { signingProvider } from "@/lib/adapters/signing";
import { emailIsPracticeMode } from "@/lib/adapters/email";
import { vehicleLabel } from "@/modules/vehicles/service";
import { dealerSigners } from "@/modules/esign/service";
import { JOURNEY_STAGE_LABEL, JOURNEY_STAGE_ORDER, libraryEntries, librarySent } from "@/modules/library/service";
import { Badge, Card, PageHeader } from "@/components/ui";
import { LibraryList } from "./library-list";
import { SentList } from "./sent-list";

export const metadata: Metadata = { title: "Document Library" };

export default async function DocumentLibraryPage({ searchParams }: { searchParams: Promise<{ doc?: string; vehicle?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "documents");
  const canSend = hasPermission(user, "documents", "send");
  const canManage = hasPermission(user, "admin", "manage_config");
  const params = await searchParams;

  const [entries, sent, episodes, parties, dealers] = await Promise.all([
    libraryEntries(),
    librarySent({ take: 30 }),
    db.inventoryEpisode.findMany({
      where: { active: true },
      include: { vehicle: true },
      orderBy: { stockNumber: "asc" },
    }),
    db.party.findMany({
      where: { archivedAt: null, isVendor: false, isCarrier: false },
      orderBy: { displayName: "asc" },
      take: 500,
      select: { id: true, displayName: true, email: true, kind: true },
    }),
    dealerSigners(),
  ]);

  const practiceEsign = signingProvider().name === "mock";
  const practiceEmail = emailIsPracticeMode();
  const sendable = entries.filter((e) => !e.blocked).length;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Document Library"
        subtitle="Every form the dealership uses, by stage of the journey. Pick one, choose the car and the person, and send it — no deal required."
        badge={
          practiceEsign || practiceEmail ? (
            <Badge tone="violet" title="ESIGN_ADAPTER / EMAIL_ADAPTER are not set to a live provider — nothing leaves the app.">
              practice mode
            </Badge>
          ) : null
        }
        actions={
          <Link href="/documents" className="text-sm font-medium text-brand-700 hover:underline">
            ← Documents
          </Link>
        }
      />

      <Card className="mb-6" accent={sendable > 0 ? "green" : "amber"}>
        <p className="text-sm text-stone-700">
          <strong>{sendable}</strong> of {entries.length} documents can be sent from here right now.
          {" "}Closing paperwork (purchase agreement, 3-day notice, DMV forms) is sent from the deal page once a sale is open, so it pre-fills with the agreed price.
        </p>
        {canManage ? (
          <Link href="/admin/documents" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">
            Load or replace approved PDFs in Administration → Documents →
          </Link>
        ) : (
          <p className="mt-1 text-xs text-stone-500">An admin loads the approved PDF for each document in Administration.</p>
        )}
      </Card>

      <LibraryList
        entries={entries}
        stages={JOURNEY_STAGE_ORDER.map((s) => ({ key: s, label: JOURNEY_STAGE_LABEL[s] }))}
        canSend={canSend}
        practiceEsign={practiceEsign}
        practiceEmail={practiceEmail}
        vehicles={episodes.map((e) => ({
          id: e.id,
          label: `${e.stockNumber} — ${vehicleLabel(e.vehicle)}`,
          dealType: e.dealType,
          consignorPartyId: null,
        }))}
        contacts={parties.map((p) => ({ id: p.id, label: p.email ? `${p.displayName} · ${p.email}` : `${p.displayName} (no email)` }))}
        dealers={dealers.map((d) => ({ id: d.id, name: d.name }))}
        defaultDealerId={dealers.find((d) => d.id === user.id)?.id ?? dealers[0]?.id ?? null}
        preselect={{ doc: params.doc ?? null, vehicle: params.vehicle ?? null }}
      />

      <h2 className="mb-3 mt-10 text-lg font-semibold text-stone-900">Recently sent from the Library</h2>
      <SentList items={sent} canSend={canSend} />
    </div>
  );
}
