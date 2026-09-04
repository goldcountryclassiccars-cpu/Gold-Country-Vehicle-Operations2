import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { config } from "@/lib/config";

export const SESSION_COOKIE = "gccc_session";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a DB session and returns the opaque token to set as a cookie. */
export async function createSession(userId: string, meta?: { ip?: string; userAgent?: string }) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config().SESSION_TTL_HOURS * 3600 * 1000);
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ip: meta?.ip,
      userAgent: meta?.userAgent?.slice(0, 255),
    },
  });
  return { token, expiresAt };
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * Resolves the session record (with user, roles, departments) for the current
 * request's cookie. Returns null for missing/expired sessions or disabled users.
 * Expired and disabled-user sessions are deleted on sight.
 */
export async function resolveSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  // relationLoadStrategy: "join" collapses this nested include into a single
  // query with LATERAL joins. Prisma's default ("query") issues one statement
  // per relation level -- session, user, userRole, role, rolePermission,
  // roleFieldGrant, userDepartment, department -- which is eight sequential
  // round trips on EVERY request, before the page has fetched any of its own
  // data. Cheap on localhost; the dominant cost of a page load in production.
  const session = await db.session.findUnique({
    relationLoadStrategy: "join",
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          roles: { include: { role: { include: { permissions: true, fieldGrants: true } } } },
          departments: { include: { department: true } },
        },
      },
    },
  });
  if (!session) return null;

  if (session.expiresAt < new Date() || !session.user.active) {
    await db.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session;
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  await clearSessionCookie();
}

/** Deletes every session for a user (e.g., when an account is disabled). */
export async function destroyAllSessionsForUser(userId: string) {
  await db.session.deleteMany({ where: { userId } });
}

export async function setPreviewRole(sessionId: string, roleKey: string | null) {
  await db.session.update({ where: { id: sessionId }, data: { previewRoleKey: roleKey } });
}
