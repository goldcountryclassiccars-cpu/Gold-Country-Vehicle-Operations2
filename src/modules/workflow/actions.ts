"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { db } from "@/lib/db";
import {
  addComment,
  addFinding,
  completeInspection,
  createInspection,
  createTask,
  createWorkOrder,
  decideApproval,
  requestApproval,
  setTaskStatus,
  setWorkOrderStatus,
  workflowRecordContext,
  WorkflowError,
} from "./service";

const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

function revalidateWorkflow(episodeId?: string | null) {
  revalidatePath("/my-work");
  revalidatePath("/work-orders");
  revalidatePath("/inspections");
  revalidatePath("/approvals");
  if (episodeId) revalidatePath(`/episodes/${episodeId}`);
}

// ---- Tasks ----------------------------------------------------------------

const taskSchema = z.object({
  title: z.string().trim().min(1),
  description: z.preprocess(emptyToUndef, z.string().optional()),
  episodeId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  departmentId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  assigneeId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  dueAt: z.preprocess(emptyToUndef, z.coerce.date().optional()),
});

export async function createTaskAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "tasks");
  const parsed = taskSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await createTask(user, parsed.data);
  revalidateWorkflow(parsed.data.episodeId);
}

const taskStatusSchema = z.object({
  taskId: z.string().uuid(),
  status: z.enum(["OPEN", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELED"]),
});

export async function setTaskStatusAction(formData: FormData) {
  const user = await getSessionUser();
  const parsed = taskStatusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const task = await db.task.findUniqueOrThrow({ where: { id: parsed.data.taskId } });
  const action = parsed.data.status === "DONE" ? "complete" : parsed.data.status === "OPEN" ? "reopen" : "edit";
  requirePermission(user, action, "tasks", await workflowRecordContext(task));
  await setTaskStatus(user, parsed.data.taskId, parsed.data.status);
  revalidateWorkflow(task.episodeId);
}

// ---- Comments -------------------------------------------------------------

const commentSchema = z.object({
  body: z.string().trim().min(1),
  visibility: z.enum(["INTERNAL", "VENDOR_VISIBLE"]).default("INTERNAL"),
  taskId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  workOrderId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  inspectionId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  episodeId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
});

export async function addCommentAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "comments");
  const parsed = commentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const { body, visibility, ...parent } = parsed.data;
  // Vendors can only write vendor-visible comments.
  const isVendorOnly = user.roleKeys.length === 1 && user.roleKeys[0] === "vendor";
  await addComment(user, parent, body, isVendorOnly ? "VENDOR_VISIBLE" : visibility);
  revalidateWorkflow(parent.episodeId);
  if (parent.workOrderId) revalidatePath(`/work-orders/${parent.workOrderId}`);
  if (parent.inspectionId) revalidatePath(`/inspections/${parent.inspectionId}`);
}

// ---- Inspections ----------------------------------------------------------

const inspectionSchema = z.object({
  episodeId: z.string().uuid(),
  departmentId: z.string().uuid(),
  assigneeId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  summary: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function createInspectionAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "inspections");
  const parsed = inspectionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await createInspection(user, parsed.data);
  revalidateWorkflow(parsed.data.episodeId);
}

const findingSchema = z.object({
  inspectionId: z.string().uuid(),
  title: z.string().trim().min(1),
  severity: z.enum(["INFO", "MINOR", "MAJOR", "SAFETY"]).default("MINOR"),
  description: z.preprocess(emptyToUndef, z.string().optional()),
  recommendation: z.preprocess(emptyToUndef, z.string().optional()),
  estimatedCost: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
});

export async function addFindingAction(formData: FormData) {
  const user = await getSessionUser();
  const parsed = findingSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const inspection = await db.inspection.findUniqueOrThrow({ where: { id: parsed.data.inspectionId } });
  requirePermission(user, "edit", "inspections", await workflowRecordContext(inspection));
  const { inspectionId, ...input } = parsed.data;
  await addFinding(user, inspectionId, input);
  revalidatePath(`/inspections/${inspectionId}`);
}

const completeInspectionSchema = z.object({
  inspectionId: z.string().uuid(),
  summary: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function completeInspectionAction(formData: FormData) {
  const user = await getSessionUser();
  const parsed = completeInspectionSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const inspection = await db.inspection.findUniqueOrThrow({ where: { id: parsed.data.inspectionId } });
  requirePermission(user, "complete", "inspections", await workflowRecordContext(inspection));
  await completeInspection(user, parsed.data.inspectionId, parsed.data.summary);
  revalidateWorkflow(inspection.episodeId);
  revalidatePath(`/inspections/${parsed.data.inspectionId}`);
}

// ---- Work orders ----------------------------------------------------------

const workOrderSchema = z.object({
  episodeId: z.string().uuid(),
  title: z.string().trim().min(1),
  description: z.preprocess(emptyToUndef, z.string().optional()),
  departmentId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  vendorPartyId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  assigneeId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
  estimatedCost: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  findingId: z.preprocess(emptyToUndef, z.string().uuid().optional()),
});

export async function createWorkOrderAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "work_orders");
  const parsed = workOrderSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  await createWorkOrder(user, parsed.data);
  revalidateWorkflow(parsed.data.episodeId);
}

const woStatusSchema = z.object({
  workOrderId: z.string().uuid(),
  status: z.enum(["DRAFT", "AWAITING_APPROVAL", "APPROVED", "DECLINED", "IN_PROGRESS", "QUALITY_CONTROL", "COMPLETE", "CANCELED"]),
  actualCost: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
});

export async function setWorkOrderStatusAction(formData: FormData) {
  const user = await getSessionUser();
  const parsed = woStatusSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const wo = await db.workOrder.findUniqueOrThrow({ where: { id: parsed.data.workOrderId } });
  const action = parsed.data.status === "COMPLETE" ? "complete" : "edit";
  requirePermission(user, action, "work_orders", await workflowRecordContext(wo));
  try {
    await setWorkOrderStatus(user, parsed.data.workOrderId, parsed.data.status, { actualCost: parsed.data.actualCost ?? null });
  } catch (e) {
    if (e instanceof WorkflowError) return;
    throw e;
  }
  if (parsed.data.status === "COMPLETE") {
    // Record the completed work in the expense ledger (idempotent).
    const { ensureExpenseForWorkOrder } = await import("@/modules/finance/service");
    await ensureExpenseForWorkOrder(user, wo.id).catch(() => {});
    revalidatePath("/expenses");
  }
  revalidateWorkflow(wo.episodeId);
  revalidatePath(`/work-orders/${wo.id}`);
}

// ---- Approvals ------------------------------------------------------------

const requestApprovalSchema = z.object({
  workOrderId: z.string().uuid(),
  amount: z.preprocess(emptyToUndef, z.coerce.number().min(0).optional()),
  reason: z.string().trim().min(1),
});

export async function requestApprovalAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "create", "approvals");
  const parsed = requestApprovalSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  const wo = await db.workOrder.findUniqueOrThrow({ where: { id: parsed.data.workOrderId } });
  await requestApproval(user, parsed.data);
  revalidateWorkflow(wo.episodeId);
  revalidatePath(`/work-orders/${wo.id}`);
}

const decideApprovalSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(["APPROVED", "DECLINED"]),
  note: z.preprocess(emptyToUndef, z.string().optional()),
});

export async function decideApprovalAction(formData: FormData) {
  const user = await getSessionUser();
  requirePermission(user, "approve", "approvals");
  const parsed = decideApprovalSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return;
  try {
    await decideApproval(user, parsed.data.approvalId, parsed.data.decision, parsed.data.note);
  } catch (e) {
    if (e instanceof WorkflowError) return;
    throw e;
  }
  revalidateWorkflow();
}
