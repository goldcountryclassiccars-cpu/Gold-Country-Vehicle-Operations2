/**
 * Phase 5 seed — media checklist + placeholder photo assets for GC-1001.
 * Generates tiny SVG placeholders through the storage adapter so downloads work.
 */
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const db = new PrismaClient();

const CHECKLIST = [
  { key: "exterior_front", name: "Exterior — front 3/4", required: true, sortOrder: 1 },
  { key: "exterior_rear", name: "Exterior — rear 3/4", required: true, sortOrder: 2 },
  { key: "exterior_sides", name: "Exterior — both sides", required: true, sortOrder: 3 },
  { key: "interior", name: "Interior overview", required: true, sortOrder: 4 },
  { key: "engine_bay", name: "Engine bay", required: true, sortOrder: 5 },
  { key: "odometer", name: "Odometer", required: true, sortOrder: 6 },
  { key: "undercarriage", name: "Undercarriage", required: false, sortOrder: 7 },
  { key: "identifier_tag", name: "Identifier tag / cowl", required: false, sortOrder: 8 },
  { key: "walkaround_video", name: "Walkaround video", required: false, sortOrder: 9 },
];

function svgPlaceholder(label: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="530"><rect width="800" height="530" fill="#d6d0bf"/><text x="400" y="270" font-family="sans-serif" font-size="34" text-anchor="middle" fill="#57492e">${label}</text></svg>`,
  );
}

export async function seedPhase5() {
  for (const c of CHECKLIST) {
    await db.mediaChecklistItem.upsert({
      where: { key: c.key },
      update: { name: c.name, required: c.required, sortOrder: c.sortOrder },
      create: c,
    });
  }

  const ep = await db.inventoryEpisode.findUnique({ where: { stockNumber: "GC-1001" } });
  if (!ep) {
    console.log("Phase 5 seed: GC-1001 missing, skipping assets.");
    return;
  }
  const existing = await db.mediaAsset.findFirst({ where: { episodeId: ep.id } });
  if (existing) {
    console.log("Phase 5 seed already present.");
    return;
  }
  const jade = (await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } })).id;

  const storageDir = process.env.STORAGE_LOCAL_DIR ?? "./storage";
  const categories = ["exterior_front", "exterior_rear", "exterior_sides", "interior", "engine_bay", "odometer"];
  let sort = 1;
  for (const category of categories) {
    const key = `media/${ep.id}/seed/${category}.svg`;
    const full = path.resolve(storageDir, key);
    await mkdir(path.dirname(full), { recursive: true });
    const data = svgPlaceholder(`GC-1001 ${category.replace(/_/g, " ")}`);
    await writeFile(full, data);
    const file = await db.fileObject.create({
      data: {
        storageKey: key,
        adapter: "local",
        originalName: `${category}.svg`,
        contentType: "image/svg+xml",
        sizeBytes: data.length,
        uploadedBy: jade,
      },
    });
    await db.mediaAsset.create({
      data: { episodeId: ep.id, fileId: file.id, kind: "PHOTO", category, sortOrder: sort++, uploadedById: jade },
    });
  }
  console.log(`Seeded ${CHECKLIST.length} checklist items + ${categories.length} placeholder photos for GC-1001.`);
}

export async function runPhase5Seed() {
  try {
    await seedPhase5();
  } finally {
    await db.$disconnect();
  }
}
