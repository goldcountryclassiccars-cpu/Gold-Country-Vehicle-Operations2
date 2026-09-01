import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission, canViewField } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { NewVehicleForm } from "./new-vehicle-form";

export const metadata: Metadata = { title: "New vehicle" };

export default async function NewVehiclePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "create", "vehicles");
  requirePermission(user, "create", "episodes");

  const sources = await db.acquisitionSource.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="New vehicle"
        subtitle="Creates the permanent vehicle record and its first inventory episode."
      />
      <NewVehicleForm
        sources={sources}
        canSeeAcquisitionCost={canViewField(user, "acquisition_cost")}
        canSeeMinPrice={canViewField(user, "min_price")}
        canSeeOwnerNotes={canViewField(user, "owner_notes")}
      />
    </div>
  );
}
