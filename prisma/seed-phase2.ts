/**
 * Phase 2 seed — acquisition sources, locations, parties, demo vehicles,
 * identifiers, episodes across the pipeline, arrangements, status history,
 * and one intake example. Idempotent: keyed by stock number / unique keys.
 */
import { PrismaClient, type Prisma } from "@prisma/client";

const db = new PrismaClient();

const SOURCES = [
  { key: "google_ppc", name: "Google PPC (seller campaigns)" },
  { key: "website", name: "Website inquiry" },
  { key: "print", name: "Print advertising" },
  { key: "word_of_mouth", name: "Word of mouth" },
  { key: "repeat_seller", name: "Repeat seller" },
  { key: "referral", name: "Referral" },
  { key: "car_club", name: "Local car club" },
  { key: "car_show", name: "Car show / event" },
  { key: "direct_outreach", name: "Direct outreach" },
  { key: "auction", name: "Auction" },
  { key: "other", name: "Other" },
];

const LOCATIONS = [
  { key: "showroom", name: "Showroom", kind: "on_site" },
  { key: "back_lot", name: "Back lot", kind: "on_site" },
  { key: "detail_bay", name: "Detail bay", kind: "on_site" },
  { key: "mech_shop", name: "Mechanical shop", kind: "on_site" },
  { key: "body_vendor", name: "Sierra Body & Paint (vendor)", kind: "vendor" },
  { key: "photo_studio", name: "Photo area", kind: "on_site" },
];

export async function seedPhase2() {
  const sourceByKey = new Map<string, string>();
  for (const s of SOURCES) {
    const row = await db.acquisitionSource.upsert({ where: { key: s.key }, update: { name: s.name }, create: s });
    sourceByKey.set(s.key, row.id);
  }
  const locByKey = new Map<string, string>();
  for (const l of LOCATIONS) {
    const row = await db.location.upsert({ where: { key: l.key }, update: { name: l.name, kind: l.kind }, create: l });
    locByKey.set(l.key, row.id);
  }

  // Parties (sellers/consignors) — idempotent by displayName lookup.
  async function party(data: Prisma.PartyCreateInput): Promise<string> {
    const existing = await db.party.findFirst({ where: { displayName: data.displayName } });
    if (existing) return existing.id;
    return (await db.party.create({ data })).id;
  }
  const consignor1 = await party({
    kind: "PERSON", displayName: "Ray Thompson", firstName: "Ray", lastName: "Thompson",
    email: "ray.thompson@example.com", phone: "530-555-0141", city: "Nevada City", state: "CA",
  });
  // Additional seller party available for later-phase deal seeding.
  await party({
    kind: "PERSON", displayName: "Elaine Fowler", firstName: "Elaine", lastName: "Fowler",
    email: "elaine.f@example.com", phone: "916-555-0192", city: "Auburn", state: "CA",
  });
  const consignor2 = await party({
    kind: "ORGANIZATION", displayName: "Foothill Estate Services", organization: "Foothill Estate Services",
    email: "estates@example.com", phone: "530-555-0177", city: "Grass Valley", state: "CA",
  });

  const users = Object.fromEntries(
    (await db.user.findMany({ select: { id: true, email: true } })).map((u) => [u.email, u.id]),
  );
  const sales = users["sales@demo.gccc"];
  const ops = users["ops@demo.gccc"];
  const jade = users["jade@demo.gccc"];

  interface DemoVehicle {
    stock: string;
    vehicle: Prisma.VehicleCreateInput;
    identifiers: { type: "VIN" | "SHORT_VIN" | "CHASSIS_NUMBER" | "SERIAL_NUMBER" | "ENGINE_NUMBER"; value: string; isPrimary?: boolean }[];
    episode: Partial<Prisma.InventoryEpisodeUncheckedCreateInput>;
    arrangement?: Partial<Prisma.ArrangementUncheckedCreateInput>;
    statusHistory?: { dimension: string; toValue: string }[];
  }

  const demo: DemoVehicle[] = [
    {
      stock: "GC-1001",
      vehicle: {
        year: 1967, make: "Chevrolet", model: "Camaro", trim: "RS/SS", bodyStyle: "Coupe",
        exteriorColor: "Bolero Red", interiorColor: "Black", engineDescription: "350ci V8 (replacement block)",
        transmission: "4-speed manual", drivetrain: "RWD", mileage: 48211, mileageStatus: "TMU",
        matchingNumbers: "no", generalDescription: "Older restoration presenting well; RS grille, SS badging.",
      },
      identifiers: [{ type: "SHORT_VIN", value: "124377N123456", isPrimary: true }, { type: "ENGINE_NUMBER", value: "V0101MO" }],
      episode: {
        dealType: "DEALER_PURCHASE", acquisitionSourceId: sourceByKey.get("google_ppc"),
        custodyStatus: "ON_SITE", reconditioningStatus: "COMPLETE", marketingStatus: "LIVE",
        salesStatus: "AVAILABLE", askingPrice: 62500, salespersonId: sales, operationsOwnerId: ops,
        currentLocationId: locByKey.get("showroom"),
      },
      arrangement: { purchasePrice: 41000, minimumAcceptablePrice: 55000, ownerNotes: "Strong PPC lead; seller motivated. Room at 58." },
      statusHistory: [
        { dimension: "custody", toValue: "ON_SITE" },
        { dimension: "reconditioning", toValue: "COMPLETE" },
        { dimension: "marketing", toValue: "LIVE" },
      ],
    },
    {
      stock: "GC-1002",
      vehicle: {
        year: 1956, make: "Ford", model: "Thunderbird", bodyStyle: "Convertible",
        exteriorColor: "Colonial White", interiorColor: "Red/White", engineDescription: "312ci Y-block V8",
        transmission: "3-speed automatic", drivetrain: "RWD", mileage: 89544, mileageStatus: "EXEMPT",
        matchingNumbers: "yes", generalDescription: "Consignment from long-time local owner; both tops.",
      },
      identifiers: [{ type: "SERIAL_NUMBER", value: "P6FH123456", isPrimary: true }],
      episode: {
        dealType: "CONSIGNMENT", acquisitionSourceId: sourceByKey.get("word_of_mouth"),
        custodyStatus: "MECHANICAL_AREA", reconditioningStatus: "WORK_IN_PROGRESS",
        marketingStatus: "MEDIA_PENDING", salesStatus: "AVAILABLE", askingPrice: 38900,
        salespersonId: sales, operationsOwnerId: ops, currentLocationId: locByKey.get("mech_shop"),
      },
      arrangement: {
        sellerPartyId: consignor1, guaranteedConsignorNet: 32000,
        commissionStructure: { type: "percent", value: 10, minimum: 3000 },
        minimumAcceptablePrice: 36000, titleStatus: "present",
        ownerNotes: "Ray wants it gone by spring; flexible on net if quick.",
      },
      statusHistory: [
        { dimension: "custody", toValue: "ON_SITE" },
        { dimension: "custody", toValue: "MECHANICAL_AREA" },
        { dimension: "reconditioning", toValue: "INSPECTION_IN_PROGRESS" },
        { dimension: "reconditioning", toValue: "WORK_IN_PROGRESS" },
      ],
    },
    {
      stock: "GC-1003",
      vehicle: {
        year: 1972, make: "Datsun", model: "240Z", bodyStyle: "Coupe",
        exteriorColor: "Racing Green", interiorColor: "Black", engineDescription: "2.4L L24 inline-6",
        transmission: "4-speed manual", drivetrain: "RWD", mileage: 112400, mileageStatus: "ACTUAL",
        matchingNumbers: "yes", generalDescription: "Rust-free California car, sale pending.",
      },
      identifiers: [{ type: "CHASSIS_NUMBER", value: "HLS30-56789", isPrimary: true }],
      episode: {
        dealType: "DEALER_PURCHASE", acquisitionSourceId: sourceByKey.get("auction"),
        custodyStatus: "ON_SITE", reconditioningStatus: "COMPLETE", marketingStatus: "MARKED_SOLD",
        salesStatus: "DEPOSIT_RECEIVED", documentStatus: "MISSING_BUYER_DATA",
        askingPrice: 34500, salespersonId: sales, operationsOwnerId: ops,
        currentLocationId: locByKey.get("back_lot"),
      },
      arrangement: { purchasePrice: 24500, minimumAcceptablePrice: 31000 },
      statusHistory: [
        { dimension: "custody", toValue: "ON_SITE" },
        { dimension: "reconditioning", toValue: "COMPLETE" },
        { dimension: "marketing", toValue: "LIVE" },
        { dimension: "sales", toValue: "DEPOSIT_RECEIVED" },
        { dimension: "marketing", toValue: "MARKED_SOLD" },
      ],
    },
    {
      stock: "GC-1004",
      vehicle: {
        year: 1965, make: "Ford", model: "Mustang", trim: "GT", bodyStyle: "Fastback",
        exteriorColor: "Wimbledon White", interiorColor: "Pony Red", engineDescription: "289ci A-code V8",
        transmission: "4-speed manual", drivetrain: "RWD", mileageStatus: "UNKNOWN",
        generalDescription: "Estate consignment, expected next week. Condition unverified.",
      },
      identifiers: [{ type: "SHORT_VIN", value: "5F09A123456", isPrimary: true }],
      episode: {
        dealType: "CONSIGNMENT", acquisitionSourceId: sourceByKey.get("referral"),
        custodyStatus: "EXPECTED", expectedArrivalAt: new Date(Date.now() + 6 * 86400_000),
        operationsOwnerId: ops,
      },
      arrangement: {
        sellerPartyId: consignor2, commissionStructure: { type: "flat", value: 4500 },
        titleStatus: "pending", ownerNotes: "Estate sale — probate paperwork in progress.",
      },
      statusHistory: [],
    },
  ];

  for (const d of demo) {
    const existing = await db.inventoryEpisode.findUnique({ where: { stockNumber: d.stock } });
    if (existing) continue;
    const vehicle = await db.vehicle.create({
      data: { ...d.vehicle, identifiers: { create: d.identifiers } },
    });
    const episode = await db.inventoryEpisode.create({
      data: {
        vehicleId: vehicle.id,
        stockNumber: d.stock,
        dealType: d.episode.dealType ?? "DEALER_PURCHASE",
        acceptedAt: new Date(Date.now() - 30 * 86400_000),
        ...d.episode,
        arrangement: d.arrangement ? { create: d.arrangement } : undefined,
      } as Prisma.InventoryEpisodeUncheckedCreateInput & { arrangement?: never },
    });
    let t = Date.now() - 25 * 86400_000;
    for (const h of d.statusHistory ?? []) {
      await db.statusChange.create({
        data: { episodeId: episode.id, dimension: h.dimension, toValue: h.toValue, changedBy: jade, createdAt: new Date(t) },
      });
      t += 3 * 86400_000;
    }
  }

  // Intake example on GC-1002 (completed).
  const ep1002 = await db.inventoryEpisode.findUnique({ where: { stockNumber: "GC-1002" } });
  if (ep1002) {
    await db.intakeRecord.upsert({
      where: { episodeId: ep1002.id },
      update: {},
      create: {
        episodeId: ep1002.id, status: "complete", receivedAt: new Date(Date.now() - 20 * 86400_000),
        receivedById: ops, arrivalMethod: "driven", odometerReading: 89544, mileageStatus: "EXEMPT",
        identityVerified: true, starts: true, runs: true, drives: true, stops: true, fuelLevel: "1/2",
        exteriorDamageNotes: "Small chip on driver door edge; light patina on trunk lid.",
        tireCondition: "Good — bias-ply, 2019 date codes", keysReceived: 2,
        documentsReceived: "Title (verified), service folder", accessoriesReceived: "Hard top, tonneau",
        initialLocationId: locByKey.get("back_lot"), completedAt: new Date(Date.now() - 20 * 86400_000),
      },
    });
  }

  // Bump the stock-number counter past seeded stock numbers.
  await db.appSetting.upsert({
    where: { key: "stock_number" },
    update: { value: { prefix: "GC", nextNumber: 1005, padding: 4 } },
    create: { key: "stock_number", value: { prefix: "GC", nextNumber: 1005, padding: 4 } },
  });

  console.log(`Seeded ${SOURCES.length} sources, ${LOCATIONS.length} locations, 3 parties, ${demo.length} vehicles/episodes.`);
}

export async function runPhase2Seed() {
  try {
    await seedPhase2();
  } finally {
    await db.$disconnect();
  }
}
