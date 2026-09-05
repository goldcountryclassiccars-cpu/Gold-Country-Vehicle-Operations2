/**
 * Sale-document requirements: turning rule results into tracked rows, and
 * answering "can this sale be closed yet?".
 *
 * Two properties carry the design:
 *
 * 1. **Rows are never deleted.** A document that stops applying is marked
 *    NOT_REQUIRED and keeps its history. Deleting would make the file unable to
 *    answer "was a CDTFA-448 ever considered on this deal?", which is exactly
 *    the question an audit asks.
 * 2. **A manual override survives re-evaluation.** An employee who overrode a
 *    row is recording something the rules cannot see. Re-running the engine
 *    updates the computed answer underneath but never silently discards the
 *    human one — and the override itself is audited.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/authz/types";
import { requirePermission } from "@/lib/authz/engine";
import { buildSaleContext } from "./context";
import { evaluateRules, type RequirementState, type Rule, type RuleTemplate } from "./rules";

export class RequirementError extends Error {}

/** Template fields the completion logic reads. */
export interface CompletionTemplate {
  category: number;
  signers: string[];
  physicalOriginal: boolean;
  buyerCopy: boolean;
  retain: boolean;
  submitTo: string | null;
}

/** Requirement fields the completion logic reads. */
export interface CompletionProgress {
  buyerSigned: boolean;
  dealerSigned: boolean;
  consignorSigned: boolean;
  originalReceived: boolean;
  submittedAt: Date | null;
  buyerCopyProvidedAt: Date | null;
  filedAt: Date | null;
  lookupAt: Date | null;
  fileId: string | null;
  documentInstanceId: string | null;
}

/**
 * What is still missing on one requirement, in the words used on the checklist.
 *
 * Pure, and the single definition of "done" — the sticky summary, the row pill
 * and the completion gate all read this rather than each deciding for itself.
 */
export function outstandingSteps(template: CompletionTemplate, p: CompletionProgress): string[] {
  const steps: string[] = [];
  const signers = new Set(template.signers);

  // Category 4 is produced by someone else — a smog station, a lender, NMVTIS.
  // "Done" means we hold the artifact, not that we signed anything.
  if (template.category === 4 && !p.fileId && !p.lookupAt) {
    steps.push("not collected");
  }

  if ((signers.has("BUYER") || signers.has("CO_BUYER")) && !p.buyerSigned) steps.push("buyer signature");
  if (signers.has("DEALER") && !p.dealerSigned) steps.push("dealer signature");
  if (signers.has("CONSIGNOR") && !p.consignorSigned) steps.push("consignor signature");
  if (template.physicalOriginal && !p.originalReceived) steps.push("original not received");
  if (template.submitTo && !p.submittedAt) steps.push("not submitted");
  if (template.buyerCopy && !p.buyerCopyProvidedAt) steps.push("buyer copy not given");
  if (template.retain && !p.filedAt) steps.push("not filed");

  return steps;
}

export function isRequirementComplete(template: CompletionTemplate, p: CompletionProgress): boolean {
  return outstandingSteps(template, p).length === 0;
}

interface StoredTemplate extends RuleTemplate, CompletionTemplate {
  id: string;
  name: string;
  notes: string | null;
  verifyWithCounsel: boolean;
  worksheetFields: string[];
  timing: string;
  authority: string | null;
  eSign: boolean;
}

async function activeTemplates(): Promise<StoredTemplate[]> {
  const rows = await db.documentTemplate.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  return rows.map((t) => ({
    id: t.id,
    key: t.key,
    name: t.name,
    appliesWhen: (t.appliesWhen ?? null) as Rule | null,
    effectiveFrom: t.effectiveFrom,
    effectiveTo: t.effectiveTo,
    category: t.category,
    signers: t.signers,
    physicalOriginal: t.physicalOriginal,
    buyerCopy: t.buyerCopy,
    retain: t.retain,
    submitTo: t.submitTo,
    notes: t.notes,
    verifyWithCounsel: t.verifyWithCounsel,
    worksheetFields: t.worksheetFields,
    timing: t.timing,
    authority: t.authority,
    eSign: t.eSign,
  }));
}

/**
 * Re-runs the rule engine for one sale and writes the results.
 *
 * Called after any change to the sale, the vehicle, the arrangement or the
 * payments — the four things the rules read. Cheap enough to run eagerly;
 * getting it wrong the other way (a stale checklist that says a deal is clean)
 * is the expensive failure.
 */
export async function evaluateSaleRequirements(user: SessionUser | null, saleId: string) {
  const [context, templates] = await Promise.all([buildSaleContext(saleId), activeTemplates()]);
  const results = evaluateRules(context, templates);
  const byKey = new Map(templates.map((t) => [t.key, t]));
  const existing = await db.saleDocumentRequirement.findMany({ where: { saleId } });
  const existingByTemplate = new Map(existing.map((r) => [r.templateId, r]));

  const changes: { key: string; from: string | null; to: RequirementState }[] = [];

  for (const result of results) {
    const template = byKey.get(result.key);
    if (!template) continue;
    const prior = existingByTemplate.get(template.id);

    // The override wins for the state the checklist enforces, but the computed
    // answer is still stored so the row can show both: "Admin marked this not
    // required — the rules say it is".
    const effectiveState: RequirementState =
      prior?.manualOverride && prior.overrideState ? prior.overrideState : result.state;

    const progress: CompletionProgress = {
      buyerSigned: prior?.buyerSigned ?? false,
      dealerSigned: prior?.dealerSigned ?? false,
      consignorSigned: prior?.consignorSigned ?? false,
      originalReceived: prior?.originalReceived ?? false,
      submittedAt: prior?.submittedAt ?? null,
      buyerCopyProvidedAt: prior?.buyerCopyProvidedAt ?? null,
      filedAt: prior?.filedAt ?? null,
      lookupAt: prior?.lookupAt ?? null,
      fileId: prior?.fileId ?? null,
      documentInstanceId: prior?.documentInstanceId ?? null,
    };

    const data = {
      state: effectiveState,
      reason: result.reason,
      complete: isRequirementComplete(template, progress),
    };

    if (!prior) {
      await db.saleDocumentRequirement.create({ data: { saleId, templateId: template.id, ...data } });
      changes.push({ key: result.key, from: null, to: effectiveState });
      continue;
    }
    if (prior.state !== data.state || prior.reason !== data.reason || prior.complete !== data.complete) {
      await db.saleDocumentRequirement.update({ where: { id: prior.id }, data });
      if (prior.state !== data.state) changes.push({ key: result.key, from: prior.state, to: effectiveState });
    }
  }

  if (changes.length > 0) {
    await audit(user, {
      action: "sale_documents.evaluate",
      resourceType: "sale",
      resourceId: saleId,
      newValues: { changes },
    });
  }
  return changes;
}

/** Re-evaluates every open sale on an episode — for vehicle/arrangement edits. */
export async function reevaluateEpisodeSales(user: SessionUser | null, episodeId: string) {
  const sales = await db.saleTransaction.findMany({
    where: { episodeId, status: { notIn: ["CANCELED", "UNWOUND"] } },
    select: { id: true },
  });
  for (const sale of sales) {
    await evaluateSaleRequirements(user, sale.id).catch(() => {
      // A checklist refresh must never take down the edit that triggered it.
    });
  }
}

export interface ComplianceRow {
  id: string;
  templateId: string;
  key: string;
  name: string;
  category: number;
  authority: string | null;
  timing: string;
  state: RequirementState;
  reason: string;
  manualOverride: boolean;
  overrideReason: string | null;
  computedState: RequirementState;
  complete: boolean;
  outstanding: string[];
  worksheetFields: string[];
  notes: string | null;
  verifyWithCounsel: boolean;
  signers: string[];
  eSign: boolean;
  physicalOriginal: boolean;
  buyerCopy: boolean;
  retain: boolean;
  submitTo: string | null;
  progress: CompletionProgress;
}

export interface ComplianceSummary {
  rows: ComplianceRow[];
  requiredCount: number;
  completeCount: number;
  unknownCount: number;
  blockers: ComplianceRow[];
  /** One line for the sticky header. */
  headline: string;
  ok: boolean;
}

/** Reads the stored checklist. Does not re-evaluate — callers do that explicitly. */
export async function saleComplianceSummary(saleId: string): Promise<ComplianceSummary> {
  const rows = await db.saleDocumentRequirement.findMany({
    where: { saleId },
    include: { template: true },
    orderBy: [{ template: { sortOrder: "asc" } }],
  });

  const mapped: ComplianceRow[] = rows.map((r) => {
    const progress: CompletionProgress = {
      buyerSigned: r.buyerSigned,
      dealerSigned: r.dealerSigned,
      consignorSigned: r.consignorSigned,
      originalReceived: r.originalReceived,
      submittedAt: r.submittedAt,
      buyerCopyProvidedAt: r.buyerCopyProvidedAt,
      filedAt: r.filedAt,
      lookupAt: r.lookupAt,
      fileId: r.fileId,
      documentInstanceId: r.documentInstanceId,
    };
    return {
      id: r.id,
      templateId: r.templateId,
      key: r.template.key,
      name: r.template.name,
      category: r.template.category,
      authority: r.template.authority,
      timing: r.template.timing,
      state: r.state,
      reason: r.reason,
      manualOverride: r.manualOverride,
      overrideReason: r.overrideReason,
      computedState: r.state,
      complete: r.complete,
      outstanding: outstandingSteps(r.template, progress),
      worksheetFields: r.template.worksheetFields,
      notes: r.template.notes,
      verifyWithCounsel: r.template.verifyWithCounsel,
      signers: r.template.signers,
      eSign: r.template.eSign,
      physicalOriginal: r.template.physicalOriginal,
      buyerCopy: r.template.buyerCopy,
      retain: r.template.retain,
      submitTo: r.template.submitTo,
      progress,
    };
  });

  // UNKNOWN counts as outstanding. That is the entire reason the engine is
  // three-valued: an unanswered question is not a "no".
  const gating = mapped.filter((r) => r.state === "REQUIRED" || r.state === "UNKNOWN");
  const blockers = gating.filter((r) => !r.complete);
  const unknownCount = mapped.filter((r) => r.state === "UNKNOWN").length;
  const completeCount = gating.length - blockers.length;

  const headline =
    gating.length === 0
      ? "No document requirements evaluated yet."
      : `${completeCount} of ${gating.length} required items complete${summarise(blockers)}`;

  return {
    rows: mapped,
    requiredCount: gating.length,
    completeCount,
    unknownCount,
    blockers,
    headline,
    ok: blockers.length === 0 && gating.length > 0,
  };
}

/**
 * Condenses the blockers into the one line at the top of the checklist.
 *
 * Deliberately grouped and capped. Listing each outstanding step separately
 * produced a header longer than the phone screen it sits on — which defeats the
 * point of a sticky summary. Three groups plus the unknown count is what fits
 * and what someone actually acts on.
 */
function summarise(blockers: ComplianceRow[]): string {
  if (blockers.length === 0) return "";

  const groups = new Map<string, number>();
  const bump = (label: string) => groups.set(label, (groups.get(label) ?? 0) + 1);

  const unknowns = blockers.filter((b) => b.state === "UNKNOWN");
  for (const b of blockers) {
    if (b.state === "UNKNOWN") continue;
    if (b.outstanding.some((s) => s.endsWith("signature"))) bump("missing signatures");
    if (b.outstanding.includes("original not received")) bump("originals not received");
    if (b.outstanding.includes("not collected")) bump("not collected");
    if (b.outstanding.includes("not submitted")) bump("not submitted");
    if (b.outstanding.includes("buyer copy not given")) bump("buyer copies not given");
    if (b.outstanding.includes("not filed")) bump("not filed");
  }

  const parts = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, n]) => `${n} ${label}`);

  if (unknowns.length > 0) {
    // Name the first thing to go and ask, rather than just counting unknowns.
    const first = unknowns[0]!.reason.replace(/^Needs:\s*/i, "");
    parts.push(`${unknowns.length} unknown (needs ${first})`);
  }

  return parts.length ? ` — ${parts.join(", ")}` : "";
}

/** Recomputes and stores `complete` for one row after a status change. */
async function refreshComplete(requirementId: string) {
  const row = await db.saleDocumentRequirement.findUniqueOrThrow({
    where: { id: requirementId },
    include: { template: true },
  });
  const complete = isRequirementComplete(row.template, row);
  if (complete !== row.complete) {
    await db.saleDocumentRequirement.update({ where: { id: requirementId }, data: { complete } });
  }
  return complete;
}

export type RequirementStep =
  | "buyerSigned"
  | "dealerSigned"
  | "consignorSigned"
  | "originalReceived"
  | "submitted"
  | "buyerCopyProvided"
  | "filed"
  | "lookup";

/** Marks one step done (or undone) on a requirement. Front Desk may do this. */
export async function setRequirementStep(
  user: SessionUser,
  requirementId: string,
  step: RequirementStep,
  done: boolean,
) {
  requirePermission(user, "edit", "documents");
  const row = await db.saleDocumentRequirement.findUniqueOrThrow({ where: { id: requirementId } });
  const now = done ? new Date() : null;
  const data =
    step === "submitted"
      ? { submittedAt: now }
      : step === "buyerCopyProvided"
        ? { buyerCopyProvidedAt: now }
        : step === "filed"
          ? { filedAt: now }
          : step === "lookup"
            ? { lookupAt: now }
            : { [step]: done };

  await db.saleDocumentRequirement.update({ where: { id: requirementId }, data });
  const complete = await refreshComplete(requirementId);
  await audit(user, {
    action: "sale_document.step",
    resourceType: "sale",
    resourceId: row.saleId,
    newValues: { requirementId, step, done, complete },
  });
}

/** Attaches an uploaded Category-4 document and marks it received. */
export async function attachRequirementFile(user: SessionUser, requirementId: string, fileId: string) {
  requirePermission(user, "edit", "documents");
  const row = await db.saleDocumentRequirement.findUniqueOrThrow({ where: { id: requirementId } });
  await db.saleDocumentRequirement.update({
    where: { id: requirementId },
    data: { fileId, originalReceived: true, lookupAt: row.lookupAt ?? new Date() },
  });
  await refreshComplete(requirementId);
  await audit(user, {
    action: "sale_document.attach",
    resourceType: "sale",
    resourceId: row.saleId,
    newValues: { requirementId, fileId },
  });
}

/**
 * Admin-only override of what the rules concluded.
 *
 * `documents:override_gate` is deliberately not in the Front Desk template —
 * entering sale data and marking an original received is front-desk work;
 * deciding a legally required document does not apply is not.
 */
export async function overrideRequirement(
  user: SessionUser,
  requirementId: string,
  state: RequirementState | null,
  reason: string,
) {
  requirePermission(user, "override_gate", "documents");
  const row = await db.saleDocumentRequirement.findUniqueOrThrow({ where: { id: requirementId } });

  if (state !== null && reason.trim().length < 5) {
    throw new RequirementError("An override reason is required");
  }

  await db.saleDocumentRequirement.update({
    where: { id: requirementId },
    data:
      state === null
        ? { manualOverride: false, overrideState: null, overrideReason: null, overrideById: null, overrideAt: null }
        : {
            manualOverride: true,
            overrideState: state,
            overrideReason: reason.trim(),
            overrideById: user.id,
            overrideAt: new Date(),
            state,
          },
  });
  await audit(user, {
    action: state === null ? "sale_document.override_cleared" : "sale_document.override",
    resourceType: "sale",
    resourceId: row.saleId,
    previousValues: { state: row.state, manualOverride: row.manualOverride },
    newValues: { requirementId, state },
    reason: state === null ? undefined : reason,
  });

  // Clearing an override hands the row back to the rules immediately, rather
  // than leaving a stale human answer showing until something else changes.
  if (state === null) await evaluateSaleRequirements(user, row.saleId);
  return refreshComplete(requirementId);
}
