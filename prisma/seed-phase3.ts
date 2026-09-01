/**
 * Phase 3 seed — demo tasks, inspection with findings, work orders, approval.
 * Idempotent: skips if the demo inspection already exists.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

export async function seedPhase3() {
  const ep1002 = await db.inventoryEpisode.findUnique({ where: { stockNumber: "GC-1002" } });
  const ep1001 = await db.inventoryEpisode.findUnique({ where: { stockNumber: "GC-1001" } });
  if (!ep1002 || !ep1001) {
    console.log("Phase 3 seed skipped (Phase 2 episodes missing).");
    return;
  }
  const existing = await db.inspection.findFirst({ where: { episodeId: ep1002.id } });
  if (existing) {
    console.log("Phase 3 seed already present.");
    return;
  }

  const users = Object.fromEntries(
    (await db.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]),
  );
  const depts = Object.fromEntries(
    (await db.department.findMany({ select: { id: true, key: true } })).map((d) => [d.key, d.id]),
  );
  const ops = users["ops@demo.gccc"]!;
  const mechanic = users["mechanic@demo.gccc"]!;
  const detailer = users["detailer@demo.gccc"]!;
  const vendor = users["vendor@demo.gccc"]!;
  const vendorParty = await db.party.findFirst({ where: { isVendor: true } });

  // Inspection with findings on the Thunderbird (GC-1002)
  const inspection = await db.inspection.create({
    data: {
      episodeId: ep1002.id,
      departmentId: depts["mechanical"]!,
      assigneeId: mechanic,
      createdById: ops,
      status: "IN_PROGRESS",
      startedAt: new Date(Date.now() - 4 * 86400_000),
      summary: "Initial mechanical assessment after intake.",
    },
  });
  await db.inspectionFinding.createMany({
    data: [
      {
        inspectionId: inspection.id,
        title: "Brake master cylinder weeping",
        severity: "SAFETY",
        description: "Fluid seep at rear seal; pedal slowly sinks under sustained pressure.",
        recommendation: "Replace master cylinder; flush system.",
        estimatedCost: 480,
      },
      {
        inspectionId: inspection.id,
        title: "Carburetor idle surge",
        severity: "MINOR",
        description: "Surging at warm idle; likely mixture adjustment.",
        recommendation: "Rebuild/adjust carburetor.",
        estimatedCost: 350,
      },
    ],
  });

  // Work order created from the safety finding — awaiting approval.
  const brakeWo = await db.workOrder.create({
    data: {
      episodeId: ep1002.id,
      departmentId: depts["mechanical"],
      assigneeId: mechanic,
      createdById: ops,
      title: "Replace brake master cylinder + system flush",
      description: "Safety finding from initial inspection. Consignor approval required (consignment vehicle).",
      status: "AWAITING_APPROVAL",
      estimatedCost: 480,
    },
  });
  const safetyFinding = await db.inspectionFinding.findFirst({ where: { inspectionId: inspection.id, severity: "SAFETY" } });
  if (safetyFinding) {
    await db.inspectionFinding.update({ where: { id: safetyFinding.id }, data: { workOrderId: brakeWo.id } });
  }
  await db.approval.create({
    data: {
      workOrderId: brakeWo.id,
      episodeId: ep1002.id,
      requestedById: ops,
      amount: 480,
      reason: "Safety item — brake master cylinder replacement on GC-1002 (consignment; consignor verbal OK, needs owner sign-off).",
    },
  });

  // Vendor upholstery work order on the Camaro — in progress.
  await db.workOrder.create({
    data: {
      episodeId: ep1001.id,
      vendorPartyId: vendorParty?.id,
      assigneeId: vendor,
      createdById: ops,
      title: "Repair driver seat bolster stitching",
      description: "Vendor-visible: match existing black vinyl; photos before/after required.",
      status: "IN_PROGRESS",
      estimatedCost: 275,
      startedAt: new Date(Date.now() - 2 * 86400_000),
    },
  });

  // Tasks
  await db.task.createMany({
    data: [
      {
        episodeId: ep1002.id,
        title: "Order brake master cylinder (1956 T-Bird)",
        departmentId: depts["mechanical"],
        assigneeId: mechanic,
        createdById: ops,
        status: "OPEN",
        priority: "HIGH",
        dueAt: new Date(Date.now() + 2 * 86400_000),
      },
      {
        episodeId: ep1001.id,
        title: "Final detail before showroom photos",
        departmentId: depts["detailing"],
        assigneeId: detailer,
        createdById: ops,
        status: "IN_PROGRESS",
        priority: "NORMAL",
      },
      {
        episodeId: ep1001.id,
        title: "Confirm listing copy specs with media",
        departmentId: depts["media"],
        createdById: ops,
        status: "OPEN",
        priority: "LOW",
      },
    ],
  });

  // Comments
  await db.comment.createMany({
    data: [
      {
        workOrderId: brakeWo.id,
        authorId: mechanic,
        authorName: "Mike Mechanic",
        body: "Master cylinder confirmed weeping at rear seal. Recommend DOT 4 flush while lines are open.",
        visibility: "INTERNAL",
      },
      {
        inspectionId: inspection.id,
        authorId: ops,
        authorName: "Olivia Operations",
        body: "Consignor called — verbally OK on brake work, waiting on owner approval to proceed.",
        visibility: "INTERNAL",
      },
    ],
  });

  console.log("Seeded Phase 3: 1 inspection (2 findings), 2 work orders, 1 pending approval, 3 tasks, 2 comments.");
}

export async function runPhase3Seed() {
  try {
    await seedPhase3();
  } finally {
    await db.$disconnect();
  }
}
