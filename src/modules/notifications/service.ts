/**
 * Phase 8 in-app notifications. Callers are responsible for sending only
 * content the recipient is allowed to see (no sensitive fields in titles or
 * bodies). Email delivery uses the (dev: log) adapter per user preference.
 */
import { db } from "@/lib/db";
import { email } from "@/lib/adapters/email";

export async function notifyUsers(
  userIds: string[],
  input: { title: string; body?: string; href?: string },
) {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return;
  await db.notification.createMany({
    data: unique.map((userId) => ({ userId, title: input.title, body: input.body ?? null, href: input.href ?? null })),
  });
  // Development email adapter logs without sending; content stays minimal.
  const users = await db.user.findMany({ where: { id: { in: unique }, active: true }, select: { email: true } });
  await Promise.all(users.map((u) => email().send({ to: u.email, subject: input.title, text: input.body ?? input.title })));
}

/** All active users holding a given role key (e.g. owners for approvals). */
export async function userIdsWithRole(roleKey: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { active: true, roles: { some: { role: { key: roleKey } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function markNotificationRead(userId: string, notificationId: string) {
  await db.notification.updateMany({ where: { id: notificationId, userId }, data: { readAt: new Date() } });
}

export async function markAllNotificationsRead(userId: string) {
  await db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}
