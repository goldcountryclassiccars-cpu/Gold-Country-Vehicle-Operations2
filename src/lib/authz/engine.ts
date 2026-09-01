/**
 * Central authorization engine. Every server-side read, mutation, download,
 * export, report, search result, and notification decision flows through here.
 * Do not duplicate informal checks in pages or routes.
 */
import { SCOPE_RANK, type Action, type Resource, type Scope, type SensitiveField } from "./registry";
import type { RecordContext, SessionUser } from "./types";

export class AuthzError extends Error {
  status = 403 as const;
  constructor(message = "Not authorized") {
    super(message);
    this.name = "AuthzError";
  }
}

export function permKey(resource: Resource, action: Action): string {
  return `${resource}:${action}`;
}

/** The effective scope for (resource, action), or "NONE". */
export function getScope(user: SessionUser, resource: Resource, action: Action): Scope {
  return user.permissions.get(permKey(resource, action)) ?? "NONE";
}

/** True when the user has the action at any scope. */
export function hasPermission(user: SessionUser, resource: Resource, action: Action): boolean {
  return SCOPE_RANK[getScope(user, resource, action)] > SCOPE_RANK.NONE;
}

/**
 * Record-aware decision. Without a record context, any non-NONE scope passes
 * (callers must then filter reads via scoped where-clauses). With a record
 * context, the record must fall inside the user's scope.
 */
export function authorize(
  user: SessionUser,
  action: Action,
  resource: Resource,
  record?: RecordContext,
): boolean {
  const scope = getScope(user, resource, action);
  if (scope === "NONE") return false;
  if (scope === "ALL" || !record) return true;

  if (scope === "DEPARTMENT") {
    const recordDepts = record.departmentKeys ?? [];
    if (recordDepts.some((d) => user.departmentKeys.includes(d))) return true;
    // Department scope also covers records assigned directly to the user.
    return (record.assignedUserIds ?? []).includes(user.id);
  }
  if (scope === "ASSIGNED") {
    return (record.assignedUserIds ?? []).includes(user.id);
  }
  if (scope === "OWN") {
    return record.createdById === user.id || (record.assignedUserIds ?? []).includes(user.id);
  }
  return false;
}

/** Throwing guard for route handlers, server actions, and services. */
export function requirePermission(
  user: SessionUser | null,
  action: Action,
  resource: Resource,
  record?: RecordContext,
): asserts user is SessionUser {
  if (!user) throw new AuthzError("Not authenticated");
  if (!authorize(user, action, resource, record)) {
    throw new AuthzError(`Missing permission ${resource}:${action}`);
  }
}

/** Sensitive-field visibility. */
export function canViewField(user: SessionUser, fieldKey: SensitiveField): boolean {
  return user.fieldGrants.has(fieldKey);
}

export function requireField(user: SessionUser, fieldKey: SensitiveField): void {
  if (!canViewField(user, fieldKey)) {
    throw new AuthzError(`Missing field access ${fieldKey}`);
  }
}

/**
 * Owner override guard: requires the REAL owner role (a previewed owner role
 * never qualifies) and a non-empty reason. Callers must audit the override.
 */
export function requireOwnerOverride(user: SessionUser | null, reason: string): asserts user is SessionUser {
  if (!user) throw new AuthzError("Not authenticated");
  if (!user.isOwner) throw new AuthzError("Owner override required");
  if (!reason || reason.trim().length < 5) {
    throw new AuthzError("An override reason is required");
  }
}

/**
 * Removes keys the user may not see from a plain object. Field maps are defined
 * per entity in each module's `sanitize.ts` (fieldKey -> protected columns).
 */
export function stripFields<T extends Record<string, unknown>>(
  user: SessionUser,
  data: T,
  protectedFields: Partial<Record<SensitiveField, (keyof T)[]>>,
): Partial<T> {
  const out: Record<string, unknown> = { ...data };
  for (const [fieldKey, columns] of Object.entries(protectedFields) as [SensitiveField, (keyof T)[]][]) {
    if (!canViewField(user, fieldKey)) {
      for (const col of columns) delete out[col as string];
    }
  }
  return out as Partial<T>;
}
