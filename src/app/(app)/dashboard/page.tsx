import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClipboardCheck, LayoutGrid, PackageSearch } from "lucide-react";
import { getSessionUser } from "@/lib/auth/current-user";
import { navForUser } from "@/lib/navigation";
import { hasPermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import { episodeWhereForUser } from "@/modules/episodes/service";
import { workflowWhereForUser } from "@/modules/workflow/service";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import { NavIcon } from "@/components/nav-icon";
import { Badge, StatTile } from "@/components/ui";
import { accentFor } from "@/lib/nav-colors";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");

  const nav = navForUser(user);
  const roleKey = user.previewRoleKey ?? user.roleKeys[0];
  const roleName = ROLE_TEMPLATES.find((r) => r.key === roleKey)?.name ?? roleKey;

  const canSeeEpisodes = hasPermission(user, "episodes", "view");
  const canSeeTasks = hasPermission(user, "tasks", "view");

  const [activeInventory, openTasks, unreadCount] = await Promise.all([
    canSeeEpisodes ? db.inventoryEpisode.count({ where: { AND: [episodeWhereForUser(user), { active: true }] } }) : null,
    canSeeTasks
      ? db.task.count({ where: { AND: [workflowWhereForUser(user, "tasks") as never, { status: { in: ["OPEN", "IN_PROGRESS", "BLOCKED"] } }] } })
      : null,
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  const stats = [
    activeInventory !== null
      ? { label: "Active inventory", value: activeInventory, icon: <PackageSearch className="h-5 w-5" />, tone: "blue" as const, href: "/pipeline" }
      : null,
    openTasks !== null
      ? { label: "Open tasks assigned to you", value: openTasks, icon: <ClipboardCheck className="h-5 w-5" />, tone: "amber" as const, href: "/my-work" }
      : null,
    { label: "Unread notifications", value: unreadCount, icon: <LayoutGrid className="h-5 w-5" />, tone: "violet" as const, href: "/notifications" },
  ].filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-stone-900">
          Welcome, {user.name.split(" ")[0]}
        </h1>
        {roleName ? <Badge tone="brand">{roleName}</Badge> : null}
      </div>
      <p className="mt-1 text-sm text-stone-500">
        {user.previewRoleKey
          ? "You are previewing another role's view of the application."
          : "Your dashboard shows the work relevant to your role."}
      </p>

      {stats.length > 0 ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {stats.map((s) => (
            <StatTile key={s.label} label={s.label} value={s.value} icon={s.icon} tone={s.tone} href={s.href} />
          ))}
        </div>
      ) : null}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {nav
          .filter((n) => n.href !== "/dashboard")
          .map((item) => {
            const accent = accentFor(item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                className="group flex items-start gap-3 rounded-lg border border-stone-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md"
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${accent.chipBg} ${accent.chipText}`}>
                  <NavIcon name={item.icon} className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-stone-900">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-stone-500">Open {item.label.toLowerCase()}</span>
                </span>
              </a>
            );
          })}
      </div>
    </div>
  );
}
