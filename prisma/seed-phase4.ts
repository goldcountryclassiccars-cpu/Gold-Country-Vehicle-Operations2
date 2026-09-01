/**
 * Phase 4 seed — expense categories + demo ledger entries. Idempotent.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const CATEGORIES = [
  { key: "transport_in", name: "Inbound transport" },
  { key: "detailing", name: "Detailing" },
  { key: "mechanical", name: "Mechanical" },
  { key: "body", name: "Body & paint" },
  { key: "parts", name: "Parts" },
  { key: "media", name: "Photography & media" },
  { key: "listing_fees", name: "Listing fees" },
  { key: "storage", name: "Storage" },
  { key: "misc", name: "Miscellaneous" },
];

export async function seedPhase4() {
  const catByKey = new Map<string, string>();
  for (const c of CATEGORIES) {
    const row = await db.expenseCategory.upsert({ where: { key: c.key }, update: { name: c.name }, create: c });
    catByKey.set(c.key, row.id);
  }

  const ep1001 = await db.inventoryEpisode.findUnique({ where: { stockNumber: "GC-1001" } });
  const ep1002 = await db.inventoryEpisode.findUnique({ where: { stockNumber: "GC-1002" } });
  if (!ep1001 || !ep1002) {
    console.log("Phase 4 seed skipped (episodes missing).");
    return;
  }
  const existing = await db.expenseEntry.findFirst({ where: { episodeId: ep1001.id } });
  if (existing) {
    console.log("Phase 4 seed already present.");
    return;
  }
  const ops = (await db.user.findUniqueOrThrow({ where: { email: "ops@demo.gccc" } })).id;
  const brakeWo = await db.workOrder.findFirst({ where: { title: { startsWith: "Replace brake master" } } });

  await db.expenseEntry.createMany({
    data: [
      // GC-1001 Camaro (dealer-owned) — mostly paid
      {
        episodeId: ep1001.id, categoryId: catByKey.get("transport_in")!, createdById: ops,
        description: "Enclosed transport from Sacramento", status: "PAID", responsibility: "DEALERSHIP",
        estimatedAmount: 450, actualAmount: 425, paidAt: new Date(Date.now() - 26 * 86400_000),
      },
      {
        episodeId: ep1001.id, categoryId: catByKey.get("detailing")!, createdById: ops,
        description: "Full detail + engine bay", status: "PAID", responsibility: "DEALERSHIP",
        estimatedAmount: 400, actualAmount: 400, paidAt: new Date(Date.now() - 18 * 86400_000),
      },
      {
        episodeId: ep1001.id, categoryId: catByKey.get("mechanical")!, createdById: ops,
        description: "Carb tune + fluid service", status: "PAID", responsibility: "DEALERSHIP",
        estimatedAmount: 350, actualAmount: 385, paidAt: new Date(Date.now() - 15 * 86400_000),
      },
      {
        episodeId: ep1001.id, categoryId: catByKey.get("media")!, createdById: ops,
        description: "Photo + video shoot", status: "INCURRED", responsibility: "DEALERSHIP",
        estimatedAmount: 300, actualAmount: 300,
      },
      {
        episodeId: ep1001.id, categoryId: catByKey.get("misc")!, createdById: ops,
        description: "Upholstery repair (vendor)", status: "COMMITTED", responsibility: "DEALERSHIP",
        estimatedAmount: 275, committedAmount: 275,
      },
      // GC-1002 T-Bird (consignment) — mixed responsibility
      {
        episodeId: ep1002.id, categoryId: catByKey.get("detailing")!, createdById: ops,
        description: "Arrival wash + interior refresh", status: "PAID", responsibility: "DEALERSHIP",
        estimatedAmount: 180, actualAmount: 180, paidAt: new Date(Date.now() - 17 * 86400_000),
      },
      {
        episodeId: ep1002.id, categoryId: catByKey.get("mechanical")!, workOrderId: brakeWo?.id, createdById: ops,
        description: "Brake master cylinder replacement (awaiting approval)", status: "SUBMITTED",
        responsibility: "CONSIGNOR", estimatedAmount: 480,
      },
      {
        episodeId: ep1002.id, categoryId: catByKey.get("storage")!, createdById: ops,
        description: "Monthly indoor storage (per consignment agreement)", status: "ESTIMATED",
        responsibility: "CONSIGNOR", estimatedAmount: 150,
      },
    ],
  });

  console.log(`Seeded ${CATEGORIES.length} expense categories + 8 demo expenses.`);
}

export async function runPhase4Seed() {
  try {
    await seedPhase4();
  } finally {
    await db.$disconnect();
  }
}
