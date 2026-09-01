"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { verifyPassword } from "./password";
import { createSession, destroySession, setPreviewRole, setSessionCookie } from "./session";
import { getSessionUser } from "./current-user";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

// Simple in-memory rate limiting for the login endpoint (per process).
// Production strategy (Redis or reverse-proxy limits) is documented in README.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "Enter a valid email address and password." };

  const { email, password } = parsed.data;
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;

  if (rateLimited(`${ip ?? "unknown"}:${email}`)) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  const user = await db.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;

  if (!user || !valid) {
    await audit(null, { action: "auth.login_failed", newValues: { email }, ip, source: "web" });
    return { error: "Incorrect email or password." };
  }
  if (!user.active) {
    await audit(null, { action: "auth.login_disabled", newValues: { email }, ip, source: "web" });
    return { error: "This account has been disabled. Contact an owner." };
  }

  const { token, expiresAt } = await createSession(user.id, { ip, userAgent: hdrs.get("user-agent") ?? undefined });
  await setSessionCookie(token, expiresAt);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await db.auditEvent.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      actingRoles: "",
      action: "auth.login",
      source: "web",
      ip,
    },
  });

  const next = parsed.data.next && parsed.data.next.startsWith("/") ? parsed.data.next : "/dashboard";
  redirect(next);
}

export async function logoutAction() {
  const user = await getSessionUser();
  if (user) await audit(user, { action: "auth.logout" });
  await destroySession();
  redirect("/login");
}

/** Owner-only: enter or exit "Preview as Role". */
export async function setPreviewRoleAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user || !user.isOwner) redirect("/dashboard");
  const roleKey = String(formData.get("roleKey") ?? "");
  const value = roleKey && roleKey !== "off" ? roleKey : null;
  await setPreviewRole(user.sessionId, value);
  await audit(user, {
    action: value ? "auth.preview_role_start" : "auth.preview_role_end",
    newValues: value ? { roleKey: value } : undefined,
  });
  redirect("/dashboard");
}
