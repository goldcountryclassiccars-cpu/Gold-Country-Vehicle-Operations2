/**
 * Phase 3 workflow services: tasks, comments, inspections, work orders,
 * approvals. Callers authorize BEFORE calling (requirePermission with a
 * RecordContext); list reads use the scoped where-clause builders here.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { RecordContext, SessionUser } from "@/lib/authz/types";
import { getScope } from "@/lib/authz/engine";
import type { Resource } from "@/lib/authz/registry";

/** RecordContext for a workflow record (task / inspection / work order). */
export async function workflowRecordContext(record: {
  assigneeId?: string | null;
  createdById?: string | null;
  departmentId?: string | null;
}): Promise<RecordContext> {
  let departmentKeys: string[] = [];
  if (record.departmentId) {
    const dept = await db.department.findUnique({ where: { id: record.departmentId } });
    if (dept) departmentKeys = [dept.key];
  }
  return {
    assignedUserIds: record.assigneeId ? [record.assigneeId] : [],
    createdById: record.createdById ?? undefined,
    departmentKeys,
  };
}

/**
 * Scoped where-clause for workflow list reads. Fields are identical across
 * Task / Inspection / WorkOrder (assigneeId, createdById, departmentId).
 */
export function workflowWhereForUser(user: SessionUser, resource: Resource): Record<string, unknown> {
  const scope = getScope(user, resource, "view");
  if (scope === "ALL") return {};
  if (scope === "NONE") return { id: "__none__" };
  if (scope === "DEPARTMENT") {
    return {
      OR: [
        { assigneeId: user.id },
        { createdById: user.id },
        user.departmentIds.length ? { departmentId: { in: user.departmentIds } } : { id: "__none__" },
      ],
    };
  }
  if (scope === "ASSIGNED") return { OR: [{ assigneeId: user.id }, { createdById: user.id }] };
  // OWN
  return { OR: [{ createdById: user.id }, { assigneeId: user.id }] };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export async function createTask(
  user: SessionUser,
  input: {
    title: string;
    description?: string | null;
    episodeId?: string | null;
    departmentId?: string | null;
    assigneeId?: string | null;
    priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
    dueAt?: Date | null;
  },
) {
  const task = await db.task.create({
    data: {
      title: input.title,
      description: input.description ?? null,
      episodeId: input.episodeId ?? null,
      departmentId: input.departmentId ?? null,
      assigneeId: input.assigneeId ?? null,
      priority: input.priority ?? "NORMAL",
      dueAt: input.dueAt ?? null,
      createdById: user.id,
    },
  });
  await audit(user, { action: "task.create", resourceType: "task", resourceId: task.id, newValues: { title: input.title } });
  if (input.assigneeId && input.assigneeId !== user.id) {
    const { notifyUsers } = await import("@/modules/notifications/service");
    await notifyUsers([input.assigneeId], { title: "Task assigned to you", body: input.title, href: "/my-work" }).catch(() => {});
  }
  return task;
}

export async function setTaskStatus(user: SessionUser, taskId: string, status: "OPEN" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELED") {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const updated = await db.task.update({
    where: { id: taskId },
    data: { status, completedAt: status === "DONE" ? new Date() : null },
  });
  await audit(user, {
    action: "task.status",
    resourceType: "task",
    resourceId: taskId,
    previousValues: { status: task.status },
    newValues: { status },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function addComment(
  user: SessionUser,
  parent: { taskId?: string; workOrderId?: string; inspectionId?: string; episodeId?: string },
  body: string,
  visibility: "INTERNAL" | "VENDOR_VISIBLE" = "INTERNAL",
) {
  const keys = Object.values(parent).filter(Boolean);
  if (keys.length !== 1) throw new Error("A comment must have exactly one parent");
  const comment = await db.comment.create({
    data: { ...parent, authorId: user.id, authorName: user.name, body, visibility },
  });
  await audit(user, { action: "comment.create", resourceType: "comment", resourceId: comment.id });
  return comment;
}

/** Vendors only ever see VENDOR_VISIBLE comments. */
export function commentVisibilityFilter(user: SessionUser): Prisma.CommentWhereInput {
  const isVendorOnly = user.roleKeys.length === 1 && user.roleKeys[0] === "vendor";
  return isVendorOnly ? { visibility: "VENDOR_VISIBLE" } : {};
}

// ---------------------------------------------------------------------------
// Inspections
// ---------------------------------------------------------------------------

export async function createInspection(
  user: SessionUser,
  input: { episodeId: string; departmentId: string; assigneeId?: string | null; summary?: string | null },
) {
  const inspection = await db.inspection.create({
    data: {
      episodeId: input.episodeId,
      departmentId: input.departmentId,
      assigneeId: input.assigneeId ?? null,
      summary: input.summary ?? null,
      createdById: user.id,
    },
  });
  await audit(user, { action: "inspection.create", resourceType: "inspection", resourceId: inspection.id });
  return inspection;
}

export async function addFinding(
  user: SessionUser,
  inspectionId: string,
  input: {
    title: string;
    severity: "INFO" | "MINOR" | "MAJOR" | "SAFETY";
    description?: string | null;
    recommendation?: string | null;
    estimatedCost?: number | null;
  },
) {
  const finding = await db.inspectionFinding.create({
    data: {
      inspectionId,
      title: input.title,
      severity: input.severity,
      description: input.description ?? null,
      recommendation: input.recommendation ?? null,
      estimatedCost: input.estimatedCost ?? null,
    },
  });
  await db.inspection.update({ where: { id: inspectionId }, data: { status: "IN_PROGRESS", startedAt: new Date() } }).catch(() => {});
  await audit(user, {
    action: "inspection.finding.add",
    resourceType: "inspection",
    resourceId: inspectionId,
    newValues: { title: input.title, severity: input.severity },
  });
  return finding;
}

export async function completeInspection(user: SessionUser, inspectionId: string, summary?: string) {
  const updated = await db.inspection.update({
    where: { id: inspectionId },
    data: { status: "COMPLETE", completedAt: new Date(), summary: summary || undefined },
  });
  await audit(user, { action: "inspection.complete", resourceType: "inspection", resourceId: inspectionId });
  return updated;
}

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------

export async function createWorkOrder(
  user: SessionUser,
  input: {
    episodeId: string;
    title: string;
    description?: string | null;
    departmentId?: string | null;
    vendorPartyId?: string | null;
    assigneeId?: string | null;
    estimatedCost?: number | null;
    findingId?: string | null;
  },
) {
  const workOrder = await db.workOrder.create({
    data: {
      episodeId: input.episodeId,
      title: input.title,
      description: input.description ?? null,
      departmentId: input.departmentId ?? null,
      vendorPartyId: input.vendorPartyId ?? null,
      assigneeId: input.assigneeId ?? null,
      estimatedCost: input.estimatedCost ?? null,
      createdById: user.id,
    },
  });
  if (input.findingId) {
    await db.inspectionFinding.update({ where: { id: input.findingId }, data: { workOrderId: workOrder.id } });
  }
  await audit(user, { action: "work_order.create", resourceType: "work_order", resourceId: workOrder.id, newValues: { title: input.title } });
  return workOrder;
}

const WO_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["AWAITING_APPROVAL", "APPROVED", "IN_PROGRESS", "CANCELED"],
  AWAITING_APPROVAL: ["APPROVED", "DECLINED", "CANCELED"],
  APPROVED: ["IN_PROGRESS", "CANCELED"],
  DECLINED: ["DRAFT", "CANCELED"],
  IN_PROGRESS: ["QUALITY_CONTROL", "COMPLETE", "CANCELED"],
  QUALITY_CONTROL: ["COMPLETE", "IN_PROGRESS"],
  COMPLETE: [],
  CANCELED: [],
};

export class WorkflowError extends Error {}

export async function setWorkOrderStatus(
  user: SessionUser,
  workOrderId: string,
  status: keyof typeof WO_TRANSITIONS,
  opts?: { actualCost?: number | null },
) {
  const wo = await db.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
  const allowed = WO_TRANSITIONS[wo.status] ?? [];
  if (!allowed.includes(status)) {
    throw new WorkflowError(`Cannot move work order from ${wo.status} to ${status}`);
  }
  const updated = await db.workOrder.update({
    where: { id: workOrderId },
    data: {
      status: status as never,
      startedAt: status === "IN_PROGRESS" && !wo.startedAt ? new Date() : undefined,
      completedAt: status === "COMPLETE" ? new Date() : undefined,
      actualCost: opts?.actualCost ?? undefined,
    },
  });
  await audit(user, {
    action: "work_order.status",
    resourceType: "work_order",
    resourceId: workOrderId,
    previousValues: { status: wo.status },
    newValues: { status },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function requestApproval(
  user: SessionUser,
  input: { workOrderId: string; amount?: number | null; reason: string },
) {
  const wo = await db.workOrder.findUniqueOrThrow({ where: { id: input.workOrderId } });
  const approval = await db.approval.create({
    data: {
      workOrderId: wo.id,
      episodeId: wo.episodeId,
      requestedById: user.id,
      amount: input.amount ?? wo.estimatedCost,
      reason: input.reason,
    },
  });
  if (wo.status === "DRAFT") await setWorkOrderStatus(user, wo.id, "AWAITING_APPROVAL");
  await audit(user, { action: "approval.request", resourceType: "approval", resourceId: approval.id, newValues: { workOrderId: wo.id } });
  const { notifyUsers, userIdsWithRole } = await import("@/modules/notifications/service");
  await notifyUsers(await userIdsWithRole("owner"), {
    title: "Approval requested",
    body: `${wo.title}${input.amount ? ` — $${input.amount.toLocaleString()}` : ""}`,
    href: "/approvals",
  }).catch(() => {});
  return approval;
}

export async function decideApproval(
  user: SessionUser,
  approvalId: string,
  decision: "APPROVED" | "DECLINED",
  note?: string,
) {
  const approval = await db.approval.findUniqueOrThrow({ where: { id: approvalId } });
  if (approval.status !== "PENDING") throw new WorkflowError("Approval already decided");
  const updated = await db.approval.update({
    where: { id: approvalId },
    data: { status: decision, approverId: user.id, decisionNote: note || null, decidedAt: new Date() },
  });
  if (approval.workOrderId) {
    await setWorkOrderStatus(user, approval.workOrderId, decision === "APPROVED" ? "APPROVED" : "DECLINED");
  }
  await audit(user, {
    action: decision === "APPROVED" ? "approval.approve" : "approval.decline",
    resourceType: "approval",
    resourceId: approvalId,
    reason: note,
  });
  const { notifyUsers } = await import("@/modules/notifications/service");
  await notifyUsers([approval.requestedById], {
    title: `Request ${decision === "APPROVED" ? "approved" : "declined"}`,
    body: note,
    href: approval.workOrderId ? `/work-orders/${approval.workOrderId}` : "/my-work",
  }).catch(() => {});
  return updated;
}
