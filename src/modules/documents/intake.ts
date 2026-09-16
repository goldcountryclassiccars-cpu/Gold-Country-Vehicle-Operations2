/**
 * Intake-timed document readiness, shown on the vehicle page before any sale
 * exists.
 *
 * The consignment agreement, the NMVTIS report and a REG 227 for a missing
 * California title are all supposed to be done *before* the car is offered for
 * sale. Surfacing them only on the deal page would mean discovering at closing
 * that something needed doing weeks earlier — which is precisely when it is
 * most expensive to find out.
 *
 * This deliberately does not create requirement rows: there is no sale to hang
 * them on yet. It answers the narrower question "is this car ready to sell?"
 * from the same registry, so the two views cannot disagree.
 */
import { db } from "@/lib/db";
import { evaluateRules, type RequirementState, type Rule, type RuleTemplate } from "./rules";

export interface IntakeReadinessItem {
  key: string;
  name: string;
  state: RequirementState;
  reason: string;
  notes: string | null;
  /** True when a sale already exists and the checklist there is authoritative. */
  trackedOnSale: boolean;
  /** Category 1 and 2 documents have a blank the app can print. */
  canProduce: boolean;
  /** The dealership's own approved copy is loaded (vs the DEMO stand-in). */
  hasApprovedTemplate: boolean;
  /** Latest produced or filed copy for this car, openable via /api/files. */
  latestFileId: string | null;
  latestStatus: "GENERATED" | "SENT" | "PARTIALLY_SIGNED" | "SIGNED" | "VOIDED" | "FILED" | null;
  /** The signed document is on file for this car — the requirement is met. */
  onFile: boolean;
}

export interface IntakeReadiness {
  items: IntakeReadinessItem[];
  blockers: IntakeReadinessItem[];
  ready: boolean;
}

/**
 * Evaluates only the INTAKE-timed templates against what is known about the
 * car, with no sale.
 *
 * Sale-time facts are genuinely absent here, so anything that depends on them
 * comes back UNKNOWN and is reported as "cannot answer yet" rather than as a
 * blocker — an intake question must not be blocked on a buyer who does not
 * exist. Only a definite REQUIRED counts against readiness.
 */
export async function intakeReadiness(episodeId: string): Promise<IntakeReadiness> {
  const episode = await db.inventoryEpisode.findUniqueOrThrow({
    where: { id: episodeId },
    include: { vehicle: true, arrangement: true },
  });

  const templates = await db.documentTemplate.findMany({
    where: { active: true, timing: "INTAKE" },
    orderBy: { sortOrder: "asc" },
  });

  const context: Record<string, unknown> = {
    "vehicle.year": episode.vehicle.year,
    "vehicle.mileageStatus": episode.vehicle.mileageStatus,
    "vehicle.isMotorcycle": episode.vehicle.isMotorcycle,
    "episode.dealType": episode.dealType,
  };
  if (episode.vehicle.titleBrand != null) context["vehicle.titleBrand"] = episode.vehicle.titleBrand;
  if (episode.vehicle.fuelType != null) context["vehicle.fuelType"] = episode.vehicle.fuelType;
  if (episode.arrangement?.titleStatus) context["arrangement.titleStatus"] = episode.arrangement.titleStatus;
  if (episode.arrangement?.titleState) context["arrangement.titleState"] = episode.arrangement.titleState;
  if (episode.arrangement?.lienStatus) context["arrangement.lienStatus"] = episode.arrangement.lienStatus;
  // A car with no buyer has no agreed price. Several intake rules are written
  // as "applies to any sale", so a nominal price keeps them from reading as
  // unanswerable — the asking price is the honest stand-in.
  if (episode.askingPrice != null) context["sale.agreedPrice"] = Number(episode.askingPrice);

  const ruleTemplates: RuleTemplate[] = templates.map((t) => ({
    key: t.key,
    appliesWhen: (t.appliesWhen ?? null) as Rule | null,
    effectiveFrom: t.effectiveFrom,
    effectiveTo: t.effectiveTo,
  }));
  const results = evaluateRules(context, ruleTemplates);

  // Anything already tracked on a live deal belongs to that checklist.
  const sales = await db.saleTransaction.findMany({
    where: { episodeId, status: { notIn: ["CANCELED", "UNWOUND"] } },
    select: { id: true },
  });
  const tracked = sales.length
    ? new Set(
        (
          await db.saleDocumentRequirement.findMany({
            where: { saleId: { in: sales.map((s) => s.id) }, complete: true },
            include: { template: { select: { key: true } } },
          })
        ).map((r) => r.template.key),
      )
    : new Set<string>();

  // What has already been printed or filed for this car (no sale attached).
  // Latest version per template wins; VOIDED copies are superseded history.
  const instances = await db.documentInstance.findMany({
    where: { episodeId, saleId: null, templateId: { in: templates.map((t) => t.id) }, status: { not: "VOIDED" } },
    orderBy: { version: "asc" },
  });
  const latestByTemplate = new Map(instances.map((i) => [i.templateId, i]));

  const byKey = new Map(templates.map((t) => [t.key, t]));
  const items: IntakeReadinessItem[] = results.map((r) => {
    const template = byKey.get(r.key);
    const latest = template ? (latestByTemplate.get(template.id) ?? null) : null;
    return {
      key: r.key,
      name: template?.name ?? r.key,
      state: r.state,
      reason: r.reason,
      notes: template?.notes ?? null,
      trackedOnSale: tracked.has(r.key),
      canProduce: template != null && (template.category === 1 || template.category === 2),
      hasApprovedTemplate: Boolean(template?.approvedFileId),
      latestFileId: latest?.fileId ?? null,
      latestStatus: latest?.status ?? null,
      onFile: latest != null && (latest.status === "SIGNED" || latest.status === "FILED"),
    };
  });

  const blockers = items.filter((i) => i.state === "REQUIRED" && !i.trackedOnSale && !i.onFile);
  return { items, blockers, ready: blockers.length === 0 };
}
