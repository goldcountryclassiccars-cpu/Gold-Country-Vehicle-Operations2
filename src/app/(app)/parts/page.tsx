import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PackageCheck, PackageOpen } from "lucide-react";
import { getSessionUser } from "@/lib/auth/current-user";
import { hasPermission, requirePermission } from "@/lib/authz/engine";
import { DEALERSHIP_TIME_ZONE } from "@/lib/dealership-date";
import { listPartRequests, ORDERED_VISIBLE_DAYS } from "@/modules/parts/service";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { AddPartForm, PartRow, type PartRowData } from "./parts-forms";

export const metadata: Metadata = { title: "Parts & Supplies" };

const SHORT_DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: DEALERSHIP_TIME_ZONE });

export default async function PartsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "view", "parts");

  const canAdd = hasPermission(user, "parts", "create");
  const canEdit = hasPermission(user, "parts", "edit");
  const { needed, ordered } = await listPartRequests();

  // The shop iPad is one shared login — prefilling its account name would put
  // "Shop" on every request. Everyone else gets their own name filled in.
  const onSharedAccount = (user.previewRoleKey ?? user.roleKeys[0]) === "shop";
  const defaultName = onSharedAccount ? "" : user.name.replace(/ \(Demo\)$/, "");

  const toRow = (r: (typeof needed)[number]): PartRowData => ({
    id: r.id,
    description: r.description,
    requestedByName: r.requestedByName,
    requestedOn: SHORT_DATE.format(r.createdAt),
    orderedLine: r.orderedAt
      ? `Ordered ${SHORT_DATE.format(r.orderedAt)}${r.orderedByName ? ` by ${r.orderedByName.replace(/ \(Demo\)$/, "")}` : ""}`
      : null,
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Parts & Supplies"
        subtitle="Need a part, a tool, or detail supplies? Add it here. Whoever orders it ticks the box."
      />

      {canAdd ? (
        <Card accent="lime" className="mb-6">
          <AddPartForm defaultName={defaultName} />
        </Card>
      ) : null}

      <section aria-labelledby="needed-heading" className="mb-8">
        <h2 id="needed-heading" className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-600">
          <PackageOpen className="h-4 w-4" aria-hidden="true" /> Still needed ({needed.length})
        </h2>
        {needed.length === 0 ? (
          <EmptyState title="Nothing waiting to be ordered." hint="New requests show up here." />
        ) : (
          <Card className="py-1">
            <ul className="divide-y divide-stone-100">
              {needed.map((r) =>
                canEdit ? <PartRow key={r.id} item={toRow(r)} /> : <ReadOnlyRow key={r.id} item={toRow(r)} />,
              )}
            </ul>
          </Card>
        )}
      </section>

      {ordered.length > 0 ? (
        <section aria-labelledby="ordered-heading">
          <h2 id="ordered-heading" className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-600">
            <PackageCheck className="h-4 w-4" aria-hidden="true" /> Ordered — last {ORDERED_VISIBLE_DAYS} days
          </h2>
          <Card className="py-1">
            <ul className="divide-y divide-stone-100">
              {ordered.map((r) =>
                canEdit ? <PartRow key={r.id} item={toRow(r)} /> : <ReadOnlyRow key={r.id} item={toRow(r)} />,
              )}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function ReadOnlyRow({ item }: { item: PartRowData }) {
  return (
    <li className="py-3">
      <p className="whitespace-pre-wrap break-words text-sm font-medium text-stone-900">{item.description}</p>
      <p className="mt-0.5 text-xs text-stone-500">
        {item.requestedByName} · {item.requestedOn}
      </p>
      {item.orderedLine ? <p className="mt-0.5 text-xs font-medium text-green-700">{item.orderedLine}</p> : null}
    </li>
  );
}
