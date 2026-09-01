import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { markAllReadAction, markReadAction } from "@/modules/notifications/actions";
import { EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?expired=1");

  const notifications = await db.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Notifications"
        subtitle={unread ? `${unread} unread` : "You're all caught up."}
        actions={
          unread ? (
            <form action={markAllReadAction}>
              <button type="submit" className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-50">
                Mark all read
              </button>
            </form>
          ) : undefined
        }
      />

      {notifications.length === 0 ? (
        <EmptyState title="No notifications" />
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`flex items-start justify-between gap-3 rounded-lg border p-4 shadow-sm ${n.readAt ? "border-stone-200 bg-white" : "border-brand-200 bg-brand-50/50"}`}
            >
              <div>
                <p className="text-sm font-medium text-stone-900">{n.title}</p>
                {n.body ? <p className="text-sm text-stone-600">{n.body}</p> : null}
                <p className="mt-1 text-xs text-stone-400">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {n.href ? (
                  <Link href={n.href} className="text-xs font-medium text-brand-700 hover:underline">
                    Open
                  </Link>
                ) : null}
                {!n.readAt ? (
                  <form action={markReadAction}>
                    <input type="hidden" name="notificationId" value={n.id} />
                    <button type="submit" className="text-xs text-stone-500 hover:text-stone-800">
                      Mark read
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
