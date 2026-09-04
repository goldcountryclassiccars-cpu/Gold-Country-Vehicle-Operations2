import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { COLUMNS } from "@/modules/import/columns";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import inventory" };

export default async function ImportPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "manage_config", "admin");
  requirePermission(user, "create", "vehicles");
  requirePermission(user, "create", "episodes");

  const [sources, activeCount] = await Promise.all([
    db.acquisitionSource.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { name: true } }),
    db.inventoryEpisode.count({ where: { active: true } }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Import inventory"
        subtitle="Load many vehicles at once from a spreadsheet. Nothing is written until you have seen the preview and pressed Import."
        actions={
          <Link href="/admin" className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
            Back to Administration
          </Link>
        }
      />

      <div className="space-y-6">
        <Card accent="stone">
          <ol className="grid gap-3 text-sm text-stone-700 sm:grid-cols-3">
            <li className="rounded-md border border-stone-200 bg-stone-50 p-3">
              <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">Step 1</span>
              <Link href="/admin/import/template" className="font-medium text-brand-700 underline">
                Download the template
              </Link>{" "}
              and fill one row per vehicle. Delete the example row before you upload.
            </li>
            <li className="rounded-md border border-stone-200 bg-stone-50 p-3">
              <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">Step 2</span>
              Upload it here. Every row is checked and shown back to you — errors, duplicates and all.
            </li>
            <li className="rounded-md border border-stone-200 bg-stone-50 p-3">
              <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">Step 3</span>
              Press Import. Each car gets a stock number and appears in Vehicles and Pipeline.
            </li>
          </ol>
          <p className="mt-3 text-xs text-stone-500">
            There are {activeCount} active {activeCount === 1 ? "vehicle" : "vehicles"} in the app now. Re-uploading the same file is safe — rows whose
            VIN already exists are reported and skipped, never entered twice.
          </p>
        </Card>

        <ImportWizard />

        <Card accent="stone">
          <details>
            <summary className="cursor-pointer text-base font-semibold text-stone-900">Column guide</summary>
            <p className="mt-2 text-sm text-stone-600">
              Only <strong>make</strong>, <strong>model</strong> and <strong>deal type</strong> are required. Everything else can be filled in later on the
              vehicle&apos;s own page — it is better to get the cars in and add detail than to wait for a perfect spreadsheet.
            </p>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {COLUMNS.map((c) => (
                <div key={c.key} className="rounded-md border border-stone-200 p-3">
                  <dt className="text-sm font-medium text-stone-900">
                    {c.label}{" "}
                    <code className="rounded bg-stone-100 px-1 text-xs text-stone-600">{c.key}</code>
                    {c.required ? <span className="ml-1 text-xs font-semibold text-red-700">required</span> : null}
                  </dt>
                  <dd className="mt-1 text-xs text-stone-600">{c.help}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-xs text-stone-500">
              Acquisition sources currently configured: {sources.length > 0 ? sources.map((s) => s.name).join(", ") : "none yet — leave that column blank."}
            </p>
          </details>
        </Card>
      </div>
    </div>
  );
}
