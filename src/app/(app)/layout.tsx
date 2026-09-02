import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/auth/current-user";
import { logoutAction, setPreviewRoleAction } from "@/lib/auth/actions";
import { db } from "@/lib/db";
import { navForUser } from "@/lib/navigation";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import { NavIcon } from "@/components/nav-icon";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");

  const nav = navForUser(user);
  const previewableRoles = ROLE_TEMPLATES.filter((r) => r.key !== "admin");
  const unreadCount = await db.notification.count({ where: { userId: user.id, readAt: null } });

  const navLinks = (
    <ul className="space-y-0.5">
      {nav.map((item) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className="flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm text-stone-700 hover:bg-stone-100 hover:text-stone-900"
          >
            <NavIcon name={item.icon} className="h-4 w-4 text-stone-400" />
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/*
        Below the md breakpoint the sidebar is hidden, which previously left a
        phone with no navigation at all. A <details> disclosure gives a working
        menu with no client-side JavaScript.
      */}
      <details className="border-b border-stone-200 bg-white md:hidden">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 py-3">
          <span>
            <span className="block text-xs font-medium uppercase tracking-widest text-brand-700">Gold Country</span>
            <span className="block text-sm font-semibold text-stone-900">Vehicle Operations</span>
          </span>
          <span className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-semibold text-stone-700">
            Menu
          </span>
        </summary>
        <nav aria-label="Primary" className="max-h-[60vh] overflow-y-auto border-t border-stone-200 p-2">
          {navLinks}
          <div className="mt-2 border-t border-stone-200 p-2">
            <p className="truncate text-sm font-medium text-stone-900">{user.name}</p>
            <form action={logoutAction} className="mt-2">
              <button type="submit" className="text-xs text-stone-500 underline hover:text-stone-800">
                Sign out
              </button>
            </form>
          </div>
        </nav>
      </details>

      <aside className="hidden w-60 shrink-0 border-r border-stone-200 bg-white md:flex md:flex-col">
        <div className="border-b border-stone-200 px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-widest text-brand-700">Gold Country</p>
          <p className="text-sm font-semibold text-stone-900">Vehicle Operations</p>
        </div>
        <nav aria-label="Primary" className="flex-1 overflow-y-auto p-2">
          {navLinks}
        </nav>
        <div className="border-t border-stone-200 p-4">
          <Link
            href="/notifications"
            className="mb-2 flex items-center justify-between rounded-md px-1 py-1 text-xs text-stone-600 hover:bg-stone-100"
          >
            Notifications
            {unreadCount > 0 ? (
              <span className="rounded-full bg-brand-700 px-2 py-0.5 text-[10px] font-semibold text-white">{unreadCount}</span>
            ) : null}
          </Link>
          <p className="truncate text-sm font-medium text-stone-900">{user.name}</p>
          <p className="truncate text-xs text-stone-500">{user.email}</p>
          {user.isOwner ? (
            <form action={setPreviewRoleAction} className="mt-3">
              <label htmlFor="preview-role" className="block text-xs font-medium text-stone-500">
                Preview as role
              </label>
              <div className="mt-1 flex gap-1">
                <select
                  id="preview-role"
                  name="roleKey"
                  defaultValue={user.previewRoleKey ?? "off"}
                  className="w-full rounded-md border border-stone-300 px-2 py-1 text-xs"
                >
                  <option value="off">Off (Admin)</option>
                  {previewableRoles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
                >
                  Go
                </button>
              </div>
            </form>
          ) : null}
          <form action={logoutAction} className="mt-3">
            <button type="submit" className="text-xs text-stone-500 underline hover:text-stone-800">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {user.previewRoleKey ? (
          <div
            role="status"
            className="flex items-center justify-between gap-4 bg-amber-400 px-4 py-2 text-sm font-medium text-amber-950"
          >
            <span>
              Preview mode: you are viewing the app as{" "}
              <strong>{previewableRoles.find((r) => r.key === user.previewRoleKey)?.name ?? user.previewRoleKey}</strong>.
              Actions are still recorded as {user.name}.
            </span>
            <form action={setPreviewRoleAction}>
              <input type="hidden" name="roleKey" value="off" />
              <button type="submit" className="rounded-md bg-amber-950 px-3 py-1 text-xs font-medium text-amber-50">
                Exit preview
              </button>
            </form>
          </div>
        ) : null}
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
