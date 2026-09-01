import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/authz/types";

export interface AuditInput {
  action: string; // e.g. "auth.login", "vehicle.update", "release.override"
  resourceType?: string;
  resourceId?: string;
  previousValues?: unknown;
  newValues?: unknown;
  reason?: string;
  source?: "web" | "api" | "system" | "integration";
  integration?: string;
  ip?: string;
}

/**
 * Appends an audit event. The REAL user is always recorded as the actor —
 * preview mode annotates but never substitutes the previewed role's identity.
 */
export async function audit(user: SessionUser | null, input: AuditInput) {
  const actingRoles = user
    ? user.previewRoleKey
      ? `${user.roleKeys.join(",")} (previewing:${user.previewRoleKey})`
      : user.roleKeys.join(",")
    : "anonymous";

  await db.auditEvent.create({
    data: {
      actorId: user?.id ?? null,
      actorName: user?.name ?? "System",
      actingRoles,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      previousValues: input.previousValues === undefined ? undefined : JSON.parse(JSON.stringify(input.previousValues)),
      newValues: input.newValues === undefined ? undefined : JSON.parse(JSON.stringify(input.newValues)),
      reason: input.reason,
      source: input.source ?? "web",
      integration: input.integration,
      ip: input.ip,
    },
  });
}
