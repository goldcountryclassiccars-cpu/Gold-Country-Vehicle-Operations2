/**
 * Phase 6 seed — demonstration document templates + a deal on GC-1003
 * (the 240Z already at DEPOSIT_RECEIVED in the Phase 2 seed). Idempotent.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const TEMPLATES = [
  { key: "purchase_agreement", name: "Vehicle Purchase Agreement (DEMO)", appliesTo: "all", sortOrder: 1 },
  { key: "buyers_guide", name: "Buyers Guide / As-Is Disclosure (DEMO)", appliesTo: "all", sortOrder: 2 },
  { key: "odometer_disclosure", name: "Odometer Disclosure (DEMO)", appliesTo: "all", sortOrder: 3 },
  { key: "title_reassignment", name: "Title Reassignment Checklist (DEMO)", appliesTo: "all", requiresWetSignature: true, sortOrder: 4 },
  { key: "consignment_agreement", name: "Consignment Agreement (DEMO)", appliesTo: "CONSIGNMENT", sortOrder: 5 },
];

export async function seedPhase6() {
  for (const t of TEMPLATES) {
    await db.documentTemplate.upsert({
      where: { key: t.key },
      update: { name: t.name, appliesTo: t.appliesTo, sortOrder: t.sortOrder, requiresWetSignature: t.requiresWetSignature ?? false },
      create: t,
    });
  }

  const ep = await db.inventoryEpisode.findUnique({ where: { stockNumber: "GC-1003" } });
  if (!ep) {
    console.log("Phase 6 seed: GC-1003 missing, skipping deal.");
    return;
  }
  const existing = await db.saleTransaction.findFirst({ where: { episodeId: ep.id } });
  if (existing) {
    console.log("Phase 6 seed already present.");
    return;
  }
  const sales = await db.user.findUniqueOrThrow({ where: { email: "sales@demo.gccc" } });

  const buyer = await db.party.create({
    data: {
      kind: "PERSON", displayName: "Walt Emerson", firstName: "Walt", lastName: "Emerson",
      email: "walt.e@example.com", phone: "415-555-0166", city: "San Rafael", state: "CA",
      createdById: sales.id,
    },
  });
  const sale = await db.saleTransaction.create({
    data: {
      episodeId: ep.id,
      buyerPartyId: buyer.id,
      salespersonId: sales.id,
      createdById: sales.id,
      status: "DEPOSIT_RECEIVED",
      agreedPrice: 33500,
      depositAmount: 2000,
      notes: "Buyer flying in next weekend for pickup; wants pre-purchase records.",
    },
  });
  await db.payment.create({
    data: {
      saleId: sale.id, kind: "DEPOSIT", method: "WIRE", status: "CLEARED", amount: 2000,
      reference: "WIRE-8841-DEMO", receivedAt: new Date(Date.now() - 5 * 86400_000),
      clearedAt: new Date(Date.now() - 4 * 86400_000), recordedById: sales.id,
    },
  });
  console.log(`Seeded ${TEMPLATES.length} demo document templates + 1 active deal (GC-1003).`);
}

export async function runPhase6Seed() {
  try {
    await seedPhase6();
  } finally {
    await db.$disconnect();
  }
}
