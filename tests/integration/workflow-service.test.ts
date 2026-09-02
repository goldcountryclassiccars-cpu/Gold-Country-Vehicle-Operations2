/**
 * Integration tests for Phase 3 workflow: tasks, inspections, findings,
 * work orders, approvals — against the local development database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import {
  addFinding,
  completeInspection,
  createInspection,
  createTask,
  createWorkOrder,
  decideApproval,
  requestApproval,
  setTaskStatus,
  setWorkOrderStatus,
  WorkflowError,
} from "@/modules/workflow/service";

function sessionUserFor(roleKey: string, base: { id: string; name: string; email: string }): SessionUser {
  const tpl = ROLE_TEMPLATES.find((t) => t.key === roleKey)!;
  const { permissions, fieldGrants } = buildPermissionMap([
    {
      key: tpl.key,
      permissions: Object.entries(tpl.grants).flatMap(([resource, grant]) =>
        Object.entries(grant!).map(([action, scope]) => ({ resource, action, scope })),
      ),
      fieldGrants: tpl.fieldGrants.map((fieldKey) => ({ fieldKey })),
    },
  ]);
  return {
    id: base.id,
    sessionId: "test",
    name: base.name,
    email: base.email,
    roleKeys: [roleKey],
    isOwner: roleKey === "admin",
    previewRoleKey: null,
    departmentIds: [],
    departmentKeys: [],
    permissions,
    fieldGrants,
    defaultLandingPage: null,
  };
}

let owner: SessionUser;
let ops: SessionUser;
let vehicleId: string;
let episodeId: string;
let deptId: string;
const cleanup: { inspections: string[]; workOrders: string[]; tasks: string[] } = {
  inspections: [],
  workOrders: [],
  tasks: [],
};

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  const olivia = await db.user.findUniqueOrThrow({ where: { email: "ops@demo.gccc" } });
  owner = sessionUserFor("admin", jade);
  ops = sessionUserFor("front_desk", olivia);
  deptId = (await db.department.findUniqueOrThrow({ where: { key: "mechanical" } })).id;
  const vehicle = await db.vehicle.create({ data: { make: "WfTest", model: "Wf" } });
  vehicleId = vehicle.id;
  const episode = await db.inventoryEpisode.create({
    data: { vehicleId, stockNumber: `WF-${Date.now()}`, dealType: "DEALER_PURCHASE" },
  });
  episodeId = episode.id;
});

afterAll(async () => {
  await db.approval.deleteMany({ where: { episodeId } });
  await db.comment.deleteMany({ where: { workOrderId: { in: cleanup.workOrders } } });
  await db.inspectionFinding.deleteMany({ where: { inspectionId: { in: cleanup.inspections } } });
  await db.workOrder.deleteMany({ where: { id: { in: cleanup.workOrders } } });
  await db.inspection.deleteMany({ where: { id: { in: cleanup.inspections } } });
  await db.task.deleteMany({ where: { id: { in: cleanup.tasks } } });
  await db.inventoryEpisode.delete({ where: { id: episodeId } });
  await db.vehicle.delete({ where: { id: vehicleId } });
  await db.$disconnect();
});

describe("tasks", () => {
  it("creates and completes a task", async () => {
    const task = await createTask(ops, { title: "Test task", episodeId });
    cleanup.tasks.push(task.id);
    expect(task.status).toBe("OPEN");
    const done = await setTaskStatus(ops, task.id, "DONE");
    expect(done.status).toBe("DONE");
    expect(done.completedAt).not.toBeNull();
  });
});

describe("inspection → finding → work order → approval flow", () => {
  let inspectionId: string;
  let findingId: string;
  let workOrderId: string;
  let approvalId: string;

  it("creates an inspection and adds a finding", async () => {
    const inspection = await createInspection(ops, { episodeId, departmentId: deptId });
    inspectionId = inspection.id;
    cleanup.inspections.push(inspectionId);
    const finding = await addFinding(ops, inspectionId, {
      title: "Leaky wheel cylinder",
      severity: "SAFETY",
      estimatedCost: 300,
    });
    findingId = finding.id;
    const refreshed = await db.inspection.findUniqueOrThrow({ where: { id: inspectionId } });
    expect(refreshed.status).toBe("IN_PROGRESS");
  });

  it("creates a work order from the finding", async () => {
    const wo = await createWorkOrder(ops, {
      episodeId,
      title: "Replace wheel cylinder",
      departmentId: deptId,
      estimatedCost: 300,
      findingId,
    });
    workOrderId = wo.id;
    cleanup.workOrders.push(workOrderId);
    const finding = await db.inspectionFinding.findUniqueOrThrow({ where: { id: findingId } });
    expect(finding.workOrderId).toBe(workOrderId);
  });

  it("requests approval (moves WO to AWAITING_APPROVAL)", async () => {
    const approval = await requestApproval(ops, { workOrderId, reason: "Safety repair over threshold" });
    approvalId = approval.id;
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
    expect(wo.status).toBe("AWAITING_APPROVAL");
    expect(Number(approval.amount)).toBe(300);
  });

  it("owner approval moves the WO to APPROVED and records the decider", async () => {
    const decided = await decideApproval(owner, approvalId, "APPROVED", "Go ahead");
    expect(decided.status).toBe("APPROVED");
    expect(decided.approverId).toBe(owner.id);
    const wo = await db.workOrder.findUniqueOrThrow({ where: { id: workOrderId } });
    expect(wo.status).toBe("APPROVED");
  });

  it("rejects double decisions and invalid transitions", async () => {
    await expect(decideApproval(owner, approvalId, "DECLINED")).rejects.toThrow(WorkflowError);
    await expect(setWorkOrderStatus(ops, workOrderId, "DRAFT")).rejects.toThrow(WorkflowError);
  });

  it("runs work to completion with actual cost", async () => {
    await setWorkOrderStatus(ops, workOrderId, "IN_PROGRESS");
    const done = await setWorkOrderStatus(ops, workOrderId, "COMPLETE", { actualCost: 285 });
    expect(done.status).toBe("COMPLETE");
    expect(Number(done.actualCost)).toBe(285);
    expect(done.completedAt).not.toBeNull();
  });

  it("completes the inspection", async () => {
    const done = await completeInspection(ops, inspectionId, "One safety item, repaired.");
    expect(done.status).toBe("COMPLETE");
  });
});
