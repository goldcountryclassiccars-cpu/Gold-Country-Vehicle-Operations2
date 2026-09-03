import { redirect } from "next/navigation";
import Link from "next/link";
import { Car } from "lucide-react";
import { getSessionUser } from "@/lib/auth/current-user";
import { logoutAction, setPreviewRoleAction } from "@/lib/auth/actions";
import { db } from "@/lib/db";
import { navForUser } from "@/lib/navigation";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import { NavLinks } from "@/components/nav-links";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");

  const nav = navForUser(user);
  const previewableRoles = ROLE_TEMPLATES.filter((r) => r.key !== "admin");
  const unreadCount = await db.notification.count({ where: { userId: user.id, readAt: null } });

  const brandMark = (
    <span className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold-400/90 text-brand-950 shadow-sm">
        <Car className="h-5 w-5" aria-hidden="true" />
      </span>
      <span>
        <span className="block text-[11px] font-semibold uppercase tracking-widest text-gold-300">Gold Country</span>
        <span className="block text-sm font-semibold text-white">Vehicle Operations</span>
      </span>
    </span>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/*
        Below the md breakpoint the sidebar is hidden, which previously left a
        phone with no navigation at all. A <details> disclosure gives a working
        menu with no client-side JavaScript.
      */}
      <details className="border-b border-stone-200 bg-brand-950 md:hidden">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 py-3">
          {brandMark}
          <span className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white">
            Menu
          </span>
        </summary>
        <nav aria-label="Primary" className="max-h-[60vh] overflow-y-auto border-t border-stone-200 bg-white p-2">
          <NavLinks items={nav} />
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

      <aside className="hidden w-64 shrink-0 border-r border-stone-200 bg-white md:flex md:flex-col">
        <div className="bg-brand-950 px-4 py-4">{brandMark}</div>
        <nav aria-label="Primary" className="flex-1 overflow-y-auto p-2">
          <NavLinks items={nav} />
        </nav>
        <div className="border-t border-stone-200 p-4">
          <Link
            href="/notifications"
            className="mb-2 flex items-center justify-between rounded-md px-1 py-1 text-xs text-stone-600 hover:bg-stone-100"
          >
            Notifications
            {unreadCount > 0 ? (
              <span className="rounded-full bg-gold-500 px-2 py-0.5 text-[10px] font-semibold text-white">{unreadCount}</span>
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
        <main className="app-shell-bg flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
