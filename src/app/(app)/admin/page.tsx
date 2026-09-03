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
  updateSettingsAction,
} from "@/modules/admin/actions";
import { Badge, Card, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = { title: "Administration" };

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");
  requirePermission(user, "manage_config", "admin");

  const [users, roles, departments, stockSetting, settlementSetting] = await Promise.all([
    db.user.findMany({
      include: { roles: { include: { role: true } }, departments: { include: { department: true } } },
      orderBy: { name: "asc" },
    }),
    db.role.findMany({ include: { _count: { select: { permissions: true, fieldGrants: true, users: true } } }, orderBy: { key: "asc" } }),
    db.department.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.appSetting.findUnique({ where: { key: "stock_number" } }),
    db.appSetting.findUnique({ where: { key: "settlement_deadline_days" } }),
  ]);
  const stock = { prefix: "GC", nextNumber: 1001, ...((stockSetting?.value as object) ?? {}) } as { prefix: string; nextNumber: number };
  const settlementDays = typeof settlementSetting?.value === "number" ? settlementSetting.value : 14;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Administration"
        subtitle="Users, roles, and dealership configuration. Every change here is audited."
        actions={
          <Link href="/admin/audit" className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
            Audit log
          </Link>
        }
      />

      <div className="space-y-6">
        <Card accent="stone">
          <h2 className="mb-3 text-base font-semibold text-stone-900">Users</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th scope="col" className="py-2 pr-4">Name</th>
                  <th scope="col" className="py-2 pr-4">Email</th>
                  <th scope="col" className="py-2 pr-4">Roles</th>
                  <th scope="col" className="py-2 pr-4">Departments</th>
                  <th scope="col" className="py-2 pr-4">Status</th>
                  <th scope="col" className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2 pr-4 font-medium text-stone-900">{u.name}</td>
                    <td className="py-2 pr-4 text-stone-600">{u.email}</td>
                    <td className="py-2 pr-4 text-stone-600">{u.roles.map((r) => r.role.name).join(", ") || "—"}</td>
                    <td className="py-2 pr-4 text-stone-600">{u.departments.map((d) => d.department.name).join(", ") || "—"}</td>
                    <td className="py-2 pr-4">
                      <Badge tone={u.active ? "green" : "red"}>{u.active ? "active" : "disabled"}</Badge>
                    </td>
                    <td className="py-2">
                      {u.id !== user.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={toggleUserActiveAction}>
                            <input type="hidden" name="userId" value={u.id} />
                            <button type="submit" className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                              {u.active ? "Disable" : "Enable"}
                            </button>
                          </form>
                          <form action={resetPasswordAction} className="flex items-center gap-1">
                            <input type="hidden" name="userId" value={u.id} />
                            <label htmlFor={`pw-${u.id}`} className="sr-only">New password for {u.name}</label>
                            <input id={`pw-${u.id}`} name="password" type="password" placeholder="new password" minLength={10} className="w-28 rounded-md border border-stone-300 px-2 py-1 text-xs" />
                            <button type="submit" className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">
                              Reset
                            </button>
                          </form>
                        </div>
                      ) : (
                        <span className="text-xs text-stone-400">you</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
