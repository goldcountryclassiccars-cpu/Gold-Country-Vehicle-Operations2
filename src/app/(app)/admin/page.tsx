import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import {
  createUserAction,
  resetPasswordAction,
  resetRoleToTemplateAction,
  toggleUserActiveAction,
  updateDealerConfigAction,
  updateSettingsAction,
} from "@/modules/admin/actions";
import { Badge, Card, PageHeader, inputClass } from "@/components/ui";
import { DataTable, type Column } from "@/components/data-table";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "manage_config", "admin");

  const [users, roles, departments, stockSetting, settlementSetting, dealerSettings, registrySetting, activeTemplateCount] =
    await Promise.all([
    db.user.findMany({
      include: { roles: { include: { role: true } }, departments: { include: { department: true } } },
      orderBy: { name: "asc" },
    }),
    db.role.findMany({ include: { _count: { select: { permissions: true, fieldGrants: true, users: true } } }, orderBy: { key: "asc" } }),
    db.department.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.appSetting.findUnique({ where: { key: "stock_number" } }),
    db.appSetting.findUnique({ where: { key: "settlement_deadline_days" } }),
    db.appSetting.findMany({ where: { key: { startsWith: "dealer." } } }),
    db.appSetting.findUnique({ where: { key: "documents.registry" } }),
    db.documentTemplate.count({ where: { active: true } }),
  ]);
  const stock = { prefix: "GC", nextNumber: 1001, ...((stockSetting?.value as object) ?? {}) } as { prefix: string; nextNumber: number };
  const settlementDays = typeof settlementSetting?.value === "number" ? settlementSetting.value : 14;
  const dealer = Object.fromEntries(
    dealerSettings.map((row) => [row.key.replace("dealer.", ""), typeof row.value === "string" ? row.value : ""]),
  ) as Record<string, string>;
  // Whether the document registry actually loaded. Without this the only way to
  // tell a seeded database from one still holding the five old demo templates
  // is to count rows and guess.
  const registry = (registrySetting?.value ?? null) as
    | { version?: string; templates?: number; verifyWithCounsel?: number; loadedAt?: string }
    | null;

  const DEALER_FIELDS = [
    { name: "legalName", label: "Legal name", hint: "As it appears on the dealer license." },
    { name: "dba", label: "Doing business as", hint: "The trading name customers see." },
    { name: "address", label: "Address", hint: "Goes on the Buyers Guide and the REG 51." },
    { name: "dealerLicenseNo", label: "Dealer license number", hint: "Required on the REG 51." },
    { name: "sellersPermitNo", label: "Seller's permit number", hint: "CDTFA permit, required on the REG 51." },
  ];

  const userColumns: Column<(typeof users)[number]>[] = [
    { key: "name", header: "Name", phone: "title", className: "font-medium text-stone-900", cell: (u) => u.name },
    {
      key: "status",
      header: "Status",
      phone: "meta",
      cell: (u) => <Badge tone={u.active ? "green" : "red"}>{u.active ? "active" : "disabled"}</Badge>,
    },
    { key: "email", header: "Email", className: "text-stone-600", cell: (u) => u.email },
    {
      key: "roles",
      header: "Roles",
      className: "text-stone-600",
      cell: (u) => u.roles.map((r) => r.role.name).join(", ") || "—",
    },
    {
      key: "departments",
      header: "Departments",
      className: "text-stone-600",
      cell: (u) => u.departments.map((d) => d.department.name).join(", ") || "—",
    },
    {
      key: "actions",
      header: "Actions",
      cell: (u) =>
        u.id === user.id ? (
          <span className="text-xs text-stone-400">you</span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <form action={toggleUserActiveAction}>
              <input type="hidden" name="userId" value={u.id} />
              <button type="submit" className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                {u.active ? "Disable" : "Enable"}
              </button>
            </form>
            <form action={resetPasswordAction} className="flex items-center gap-1">
              <input type="hidden" name="userId" value={u.id} />
              <label htmlFor={`pw-${u.id}`} className="sr-only">
                New password for {u.name}
              </label>
              <input
                id={`pw-${u.id}`}
                name="password"
                type="password"
                placeholder="new password"
                minLength={10}
                className="w-28 rounded-md border border-stone-300 px-2 py-1 text-xs"
              />
              <button type="submit" className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                Reset
              </button>
            </form>
          </div>
        ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Administration"
        subtitle="Users, roles, and dealership configuration. Every change here is audited."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/import"
              className="min-h-11 rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-800"
            >
              Import inventory
            </Link>
            <Link href="/admin/audit" className="min-h-11 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
              Audit log
            </Link>
          </div>
        }
      />

      <div className="space-y-6">
        <Card accent="stone">
          <h2 className="mb-3 text-base font-semibold text-stone-900">Users</h2>
          <DataTable
            bare
            caption="User accounts"
            columns={userColumns}
            rows={users}
            rowKey={(u) => u.id}
          />

          <form action={createUserAction} className="mt-4 grid gap-2 border-t border-stone-100 pt-4 sm:grid-cols-6">
            <div>
              <label htmlFor="nu-name" className="block text-xs font-medium text-stone-500">Name</label>
              <input id="nu-name" name="name" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="nu-email" className="block text-xs font-medium text-stone-500">Email</label>
              <input id="nu-email" name="email" type="email" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="nu-pass" className="block text-xs font-medium text-stone-500">Password (10+ chars)</label>
              <input id="nu-pass" name="password" type="password" required minLength={10} className={inputClass} />
            </div>
            <div>
              <label htmlFor="nu-role" className="block text-xs font-medium text-stone-500">Role</label>
              <select id="nu-role" name="roleKey" className={inputClass}>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="nu-dept" className="block text-xs font-medium text-stone-500">Department</label>
              <select id="nu-dept" name="departmentId" className={inputClass} defaultValue="">
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button type="submit" className="w-full rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                Add user
              </button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="mb-1 text-base font-semibold text-stone-900">Roles</h2>
          <p className="mb-3 text-xs text-stone-500">
            Role grants are data. Fine-grained grant editing lands with a later admin iteration; for now a role can be
            reset to its shipped template (the owner role is always full access).
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {roles.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-md border border-stone-200 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-stone-900">{r.name}</span>
                  <span className="block text-xs text-stone-500">
                    {r._count.users} user{r._count.users === 1 ? "" : "s"} · {r._count.permissions} grants · {r._count.fieldGrants} field grants
                  </span>
                </span>
                <form action={resetRoleToTemplateAction}>
                  <input type="hidden" name="roleKey" value={r.key} />
                  <button type="submit" className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                    Reset to template
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-stone-900">Sale-document registry</h2>
          {registry?.version ? (
            <p className="text-sm text-stone-700">
              Registry <strong>{registry.version}</strong> loaded — {registry.templates} document templates,{" "}
              {activeTemplateCount} active.{" "}
              {registry.verifyWithCounsel ? (
                <span className="text-amber-800">
                  {registry.verifyWithCounsel} rules are still flagged for review with counsel.
                </span>
              ) : null}
            </p>
          ) : (
            <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              The document registry has not been loaded. Sale checklists will be empty or wrong until it is. It loads
              automatically on deploy; if this message persists after a deploy, check the Vercel build log for
              <code className="mx-1">seed-document-registry</code>.
            </p>
          )}
          <p className="mt-2 text-xs text-stone-500">
            Which documents a sale needs is decided by <code>prisma/document-registry.json</code>. Editing that file and
            deploying is how a rule changes — no code change, and the seed re-runs on every deploy.
          </p>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-stone-900">Dealer details on documents</h2>
          <p className="mb-3 text-xs text-stone-500">
            These print on the Buyers Guide, the REG 51 and every generated document. Enter them here rather than
            anywhere in code — the license and permit numbers should not live in the repository or in a chat
            transcript. Admins edit; the front desk can read them while filling in a form.
          </p>
          <form action={updateDealerConfigAction} className="grid gap-3 sm:grid-cols-2">
            {DEALER_FIELDS.map((field) => (
              <div key={field.name}>
                <label htmlFor={`dealer-${field.name}`} className="block text-xs font-medium text-stone-500">
                  {field.label}
                </label>
                <input
                  id={`dealer-${field.name}`}
                  name={field.name}
                  defaultValue={dealer[field.name] ?? ""}
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-stone-400">{field.hint}</p>
              </div>
            ))}
            <div className="sm:col-span-2">
              <button type="submit" className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-stone-50">
                Save dealer details
              </button>
            </div>
          </form>
        </Card>

        <Card accent="stone">
          <h2 className="mb-3 text-base font-semibold text-stone-900">Settings</h2>
          <form action={updateSettingsAction} className="grid gap-2 sm:grid-cols-4">
            <div>
              <label htmlFor="set-prefix" className="block text-xs font-medium text-stone-500">Stock number prefix</label>
              <input id="set-prefix" name="stockPrefix" defaultValue={stock.prefix} required maxLength={6} className={inputClass} />
            </div>
            <div>
              <label htmlFor="set-next" className="block text-xs font-medium text-stone-500">Next stock number</label>
              <input id="set-next" name="stockNext" type="number" min="1" defaultValue={stock.nextNumber} required className={inputClass} />
            </div>
            <div>
              <label htmlFor="set-days" className="block text-xs font-medium text-stone-500">Settlement deadline (days)</label>
              <input id="set-days" name="settlementDays" type="number" min="1" max="120" defaultValue={settlementDays} required className={inputClass} />
            </div>
            <div className="flex items-end">
              <button type="submit" className="rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-800">
                Save settings
              </button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
