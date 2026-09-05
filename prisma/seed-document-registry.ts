/**
 * Seeds DocumentTemplate from prisma/document-registry.json.
 *
 * The registry is the source of truth for *which documents apply to a sale and
 * why*. It is not the source of the documents themselves — every template is
 * still DEMO-watermarked until the dealership's approved copy is loaded per
 * SALES_DOCUMENT_SETUP.md.
 *
 * Same shape as migrate-roles.ts: idempotent, keyed on `key`, dry-run by
 * default.
 *
 *   DATABASE_URL="<session pooler uri>" npx tsx prisma/seed-document-registry.ts
 *
 * Pass --apply to write. Without it the script reports what it would do and
 * changes nothing. Safe against production: it only ever upserts templates, and
 * never touches a sale, a requirement row or a generated document.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type DocumentTiming, type Prisma } from "@prisma/client";

const db = new PrismaClient();

interface RegistryVersion {
  templateKey: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  note?: string;
}

interface RegistryDocument {
  key: string;
  name: string;
  category: number;
  authority?: string;
  appliesWhen?: unknown;
  signers?: string[];
  eSign?: boolean;
  wetSignature?: boolean;
  physicalOriginal?: boolean;
  buyerCopy?: boolean;
  retain?: boolean;
  submitTo?: string | null;
  timing?: string;
  sequencing?: string;
  note?: string;
  verify?: boolean;
  versions?: RegistryVersion[];
  prefill?: string[];
  worksheet?: string[];
  tracked?: string[];
  captures?: string[];
  linkedCollect?: string[];
}

interface Registry {
  version: string;
  documents: RegistryDocument[];
}

/**
 * Demo templates that predate the registry. Mapping them onto registry keys
 * keeps their generated DocumentInstances attached — an unmapped key would
 * leave a real signed PDF pointing at a template nothing references.
 */
const LEGACY_KEY_ALIASES: Record<string, string> = {
  title_reassignment: "reg_262_reassignment",
};

/** "INTAKE - must exist before the vehicle is offered for sale" -> [INTAKE, rest]. */
function splitTiming(raw: string | undefined): { timing: DocumentTiming; note: string | null } {
  if (!raw) return { timing: "SALE", note: null };
  const [head, ...rest] = raw.split(/\s+[-–]\s+/);
  const upper = (head ?? "").trim().toUpperCase();
  const timing: DocumentTiming =
    upper === "INTAKE" ? "INTAKE" : upper === "POST_SALE" || upper === "POST SALE" ? "POST_SALE" : "SALE";
  const note = rest.join(" — ").trim();
  return { timing, note: note.length > 0 ? note : timing === "SALE" && upper !== "SALE" ? raw : null };
}

function collectNotes(doc: RegistryDocument, timingNote: string | null): string | null {
  const parts = [
    doc.note,
    doc.sequencing ? `Sequencing: ${doc.sequencing}` : null,
    timingNote ? `Timing: ${timingNote}` : null,
    doc.linkedCollect?.length ? `Also collect: ${doc.linkedCollect.join(", ")}` : null,
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length ? parts.join("\n\n") : null;
}

/** Worksheet fields come under four different names in the registry. */
function worksheetFields(doc: RegistryDocument): string[] {
  return [...(doc.worksheet ?? []), ...(doc.prefill ?? []), ...(doc.tracked ?? []), ...(doc.captures ?? [])];
}

/**
 * A rule whose top level is exactly "this is a consignment" also sets the
 * legacy `appliesTo` column, so the older template dropdown on the deal page
 * does not offer a consignment agreement on a dealer-owned car.
 */
function legacyAppliesTo(rule: unknown): string {
  if (rule && typeof rule === "object" && !Array.isArray(rule)) {
    const r = rule as { field?: string; op?: string; value?: unknown; all?: unknown[] };
    if (r.field === "episode.dealType" && r.op === "eq" && typeof r.value === "string") return r.value;
    if (Array.isArray(r.all)) {
      for (const child of r.all) {
        const c = child as { field?: string; op?: string; value?: unknown };
        if (c.field === "episode.dealType" && c.op === "eq" && typeof c.value === "string") return c.value;
      }
    }
  }
  return "all";
}

function asDate(v: string | null | undefined): Date | null {
  return v ? new Date(`${v}T00:00:00.000Z`) : null;
}

interface PlannedTemplate {
  key: string;
  data: Omit<Prisma.DocumentTemplateCreateInput, "key">;
}

/** Expands the registry into one template row per effective version. */
export function planTemplates(registry: Registry): PlannedTemplate[] {
  const planned: PlannedTemplate[] = [];

  registry.documents.forEach((doc, index) => {
    const { timing, note: timingNote } = splitTiming(doc.timing);
    const base = {
      name: doc.name,
      appliesTo: legacyAppliesTo(doc.appliesWhen),
      requiresWetSignature: doc.wetSignature ?? false,
      active: true,
      sortOrder: doc.category * 100 + index,
      category: doc.category,
      authority: doc.authority ?? null,
      appliesWhen: (doc.appliesWhen ?? null) as Prisma.InputJsonValue,
      signers: doc.signers ?? [],
      eSign: doc.eSign ?? false,
      physicalOriginal: doc.physicalOriginal ?? false,
      buyerCopy: doc.buyerCopy ?? false,
      retain: doc.retain ?? true,
      submitTo: doc.submitTo ?? null,
      timing,
      worksheetFields: worksheetFields(doc),
      notes: collectNotes(doc, timingNote),
      verifyWithCounsel: doc.verify ?? false,
    };

    if (!doc.versions || doc.versions.length === 0) {
      planned.push({ key: doc.key, data: { ...base, effectiveFrom: null, effectiveTo: null } });
      return;
    }

    // Versioned documents become one template per window. The FIRST version
    // keeps the document's own key so the existing demo template — and any
    // DocumentInstance already generated from it — stays attached.
    doc.versions.forEach((version, vIndex) => {
      const key = vIndex === 0 ? doc.key : version.templateKey;
      const suffix = version.effectiveFrom
        ? ` (from ${version.effectiveFrom})`
        : version.effectiveTo
          ? ` (through ${version.effectiveTo})`
          : "";
      planned.push({
        key,
        data: {
          ...base,
          name: `${doc.name}${suffix}`,
          sortOrder: base.sortOrder,
          effectiveFrom: asDate(version.effectiveFrom),
          effectiveTo: asDate(version.effectiveTo),
          notes: [base.notes, version.note].filter(Boolean).join("\n\n") || null,
        },
      });
    });
  });

  return planned;
}

export function loadRegistry(file = path.join(__dirname, "document-registry.json")): Registry {
  return JSON.parse(readFileSync(file, "utf8")) as Registry;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`\n=== Document registry seed — ${apply ? "APPLYING" : "DRY RUN (pass --apply to write)"} ===\n`);

  const registry = loadRegistry();
  const planned = planTemplates(registry);
  console.log(`registry version ${registry.version}: ${registry.documents.length} documents -> ${planned.length} templates\n`);

  // Retire the legacy demo keys onto their registry equivalents first, so the
  // upsert below updates one row rather than creating a duplicate.
  for (const [oldKey, newKey] of Object.entries(LEGACY_KEY_ALIASES)) {
    const old = await db.documentTemplate.findUnique({ where: { key: oldKey } });
    if (!old) continue;
    const target = await db.documentTemplate.findUnique({ where: { key: newKey } });
    if (target) {
      const moved = await db.documentInstance.count({ where: { templateId: old.id } });
      console.log(`alias "${oldKey}" -> "${newKey}": ${moved} document(s) ${apply ? "moved" : "would move"}, then deactivate`);
      if (!apply) continue;
      await db.documentInstance.updateMany({ where: { templateId: old.id }, data: { templateId: target.id } });
      await db.documentTemplate.update({ where: { id: old.id }, data: { active: false } });
    } else {
      console.log(`alias "${oldKey}" -> "${newKey}": ${apply ? "renamed" : "would rename"} in place`);
      if (!apply) continue;
      await db.documentTemplate.update({ where: { id: old.id }, data: { key: newKey } });
    }
  }

  let created = 0;
  let updated = 0;
  for (const { key, data } of planned) {
    const existing = await db.documentTemplate.findUnique({ where: { key } });
    if (existing) {
      updated++;
      console.log(`  update  ${key.padEnd(36)} cat ${data.category} ${data.verifyWithCounsel ? "· verify with counsel" : ""}`);
    } else {
      created++;
      console.log(`  create  ${key.padEnd(36)} cat ${data.category} ${data.verifyWithCounsel ? "· verify with counsel" : ""}`);
    }
    if (!apply) continue;
    await db.documentTemplate.upsert({ where: { key }, update: data, create: { key, ...data } });
  }

  console.log(`\n${created} to create, ${updated} to update.`);

  // Anything active that the registry no longer describes would sit in the
  // template dropdown forever with no rule behind it. Report, never delete —
  // a signed instance may still point at it.
  const plannedKeys = new Set(planned.map((p) => p.key));
  const orphans = await db.documentTemplate.findMany({ where: { active: true } });
  const stray = orphans.filter((t) => !plannedKeys.has(t.key));
  if (stray.length) {
    console.log(`\nActive templates not in the registry (left alone): ${stray.map((t) => t.key).join(", ")}`);
  }

  const needsCounsel = planned.filter((p) => p.data.verifyWithCounsel).length;
  console.log(`\n${needsCounsel} template(s) marked verifyWithCounsel — rules and thresholds need confirming before production use.`);
}

if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
