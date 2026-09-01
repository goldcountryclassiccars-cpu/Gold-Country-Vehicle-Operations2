import { cache } from "react";
import { db } from "@/lib/db";
import { resolveSession } from "./session";
import { buildPermissionMap, type RoleGrantsShape } from "@/lib/authz/resolve";
import type { SessionUser } from "@/lib/authz/types";

type RoleWithGrants = RoleGrantsShape;

/**
 * The authenticated user with fully resolved, preview-aware permissions.
 * Cached per request. Returns null when unauthenticated, expired, or disabled.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await resolveSession();
  if (!session) return null;

  const realRoles = session.user.roles.map((ur) => ur.role);
  const roleKeys = realRoles.map((r) => r.key);
  const isOwner = roleKeys.includes("owner");

  let effectiveRoles: RoleWithGrants[] = realRoles as unknown as RoleWithGrants[];
  let previewRoleKey: string | null = null;

  // "Preview as Role" is owner-only and narrows the effective permission set.
  if (isOwner && session.previewRoleKey && session.previewRoleKey !== "owner") {
    const previewRole = await db.role.findUnique({
      where: { key: session.previewRoleKey },
      include: { permissions: true, fieldGrants: true },
    });
    if (previewRole) {
      effectiveRoles = [previewRole as unknown as RoleWithGrants];
      previewRoleKey = previewRole.key;
    }
  }

  const { permissions, fieldGrants } = buildPermissionMap(effectiveRoles);

  return {
    id: session.user.id,
    sessionId: session.id,
    name: session.user.name,
    email: session.user.email,
    roleKeys,
    isOwner,
    previewRoleKey,
    departmentIds: session.user.departments.map((d) => d.departmentId),
    departmentKeys: session.user.departments.map((d) => d.department.key),
    permissions,
    fieldGrants,
    defaultLandingPage: session.user.defaultLandingPage,
  };
});
