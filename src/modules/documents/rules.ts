/**
 * The sale-document rule engine.
 *
 * Pure: no database, no clock, no I/O. Everything it needs arrives in a flat
 * context built by `buildSaleContext` (see context.ts). That is what makes the
 * compliance answers testable — the interesting cases are dates and dollar
 * thresholds, and none of them should need a database to assert.
 *
 * **Three-valued on purpose.** A rule can come back REQUIRED, NOT_REQUIRED or
 * UNKNOWN, and UNKNOWN is the whole point: if nobody has entered the delivery
 * state yet, the honest answer to "does this sale need a CDTFA-448?" is "we
 * don't know", not "no". A two-valued engine would quietly answer "no" and the
 * checklist would show a complete sale that is missing a tax-exemption
 * document. UNKNOWN rows block completion exactly like required ones.
 *
 * Rule grammar (defined at the top of prisma/document-registry.json):
 *   { all: [...] } | { any: [...] } | { not: {...} }
 *   { field: "<context path>", op: "<op>", value: <v> }
 *   ops: eq neq lt lte gt gte in exists missing
 */

export type RuleOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in" | "exists" | "missing";

export interface RuleLeaf {
  field: string;
  op: RuleOp;
  value?: unknown;
}
export interface RuleAll {
  all: Rule[];
}
export interface RuleAny {
  any: Rule[];
}
export interface RuleNot {
  not: Rule;
}
export type Rule = RuleLeaf | RuleAll | RuleAny | RuleNot;

export type RequirementState = "REQUIRED" | "NOT_REQUIRED" | "UNKNOWN";

/** Flat path -> value. A path that is absent, or null, is "not answered yet". */
export type RuleContext = Readonly<Record<string, unknown>>;

export interface Evaluation {
  state: RequirementState;
  /** Human-readable, shown verbatim on the checklist next to the badge. */
  reason: string;
  /** Context paths still unanswered — drives "Needs: delivery state". */
  missing: string[];
}

/** The subset of a DocumentTemplate the engine reads. */
export interface RuleTemplate {
  key: string;
  appliesWhen: Rule | null;
  effectiveFrom?: Date | string | null;
  effectiveTo?: Date | string | null;
}

// ---------------------------------------------------------------------------
// Labels and formatting — these produce the sentence the employee reads
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  "vehicle.year": "Model year",
  "vehicle.mileageStatus": "Odometer status",
  "vehicle.titleBrand": "Title brand",
  "vehicle.fuelType": "Fuel type",
  "vehicle.isMotorcycle": "Motorcycle",
  "vehicle.ageAtSaleModelYears": "Vehicle age at sale",
  "episode.dealType": "Deal type",
  "arrangement.titleStatus": "Title status",
  "arrangement.lienStatus": "Lien status",
  "arrangement.titleState": "Title issuing state",
  "sale.saleDate": "Sale date",
  "sale.agreedPrice": "Sale price",
  "sale.buyerState": "Buyer state",
  "sale.deliveryState": "Delivery state",
  "sale.deliveryMethod": "Delivery method",
  "sale.registrationState": "Registration state",
  "sale.outsideLender": "Outside lender",
  "sale.negotiatedLanguage": "Language the deal was negotiated in",
  "sale.paymentIncludesCashOver10k": "Cash payments over $10,000",
  "sale.hasDueBillItems": "Promised post-sale work",
  "sale.hasAddOns": "Optional add-ons",
  "odometer.disclosureRequired": "Odometer disclosure",
  "smog.exemptionClaimed": "Smog exemption",
  "title.hasPriceField": "Title has a price field",
  "title.sellerNameMatches": "Title seller name matches",
  "title.reassignmentSpaceAvailable": "Title reassignment space",
  "manual.reg256Needed": "REG 256 needed (manual)",
  "manual.reg135Needed": "REG 135 needed (manual)",
  "manual.consignorPOA": "Consignor power of attorney needed",
  "manual.buyerPOA": "Buyer power of attorney needed",
};

/** Falls back to humanising the path so a new registry field is never nameless. */
export function fieldLabel(path: string): string {
  const known = FIELD_LABELS[path];
  if (known) return known;
  const last = path.split(".").pop() ?? path;
  const spaced = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

const MONEY_FIELDS = new Set(["sale.agreedPrice", "sale.salesTaxCollected"]);

/** UTC calendar day, so a date never drifts across a timezone boundary. */
function toDayString(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}

function isDateLike(v: unknown): boolean {
  return toDayString(v) !== null;
}

function formatValue(field: string, v: unknown): string {
  if (v === null || v === undefined) return "not set";
  if (Array.isArray(v)) return v.map((x) => formatValue(field, x)).join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v instanceof Date) return toDayString(v) ?? String(v);
  if (typeof v === "number" && MONEY_FIELDS.has(field)) return `$${v.toLocaleString()}`;
  if (typeof v === "string" && MONEY_FIELDS.has(field)) return `$${Number(v).toLocaleString()}`;
  return String(v);
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Internal tri-state: true / false / null (unknown). */
interface Outcome {
  value: boolean | null;
  /** The clause that decided it, already phrased for the value it carries. */
  why: string;
  missing: string[];
}

function isLeaf(rule: Rule): rule is RuleLeaf {
  return typeof (rule as RuleLeaf).field === "string";
}

function compare(op: RuleOp, actual: unknown, expected: unknown): boolean {
  // Dates compare as calendar days, never as timestamps — "before 2026-10-01"
  // must mean the whole of 2026-09-30 regardless of what time the sale was
  // written up.
  if (isDateLike(actual) && isDateLike(expected)) {
    const a = toDayString(actual)!;
    const b = toDayString(expected)!;
    switch (op) {
      case "eq":
        return a === b;
      case "neq":
        return a !== b;
      case "lt":
        return a < b;
      case "lte":
        return a <= b;
      case "gt":
        return a > b;
      case "gte":
        return a >= b;
      default:
        break;
    }
  }

  const a = typeof actual === "string" && typeof expected === "number" ? Number(actual) : actual;

  switch (op) {
    case "eq":
      return a === expected;
    case "neq":
      return a !== expected;
    case "lt":
      return typeof a === "number" && typeof expected === "number" && a < expected;
    case "lte":
      return typeof a === "number" && typeof expected === "number" && a <= expected;
    case "gt":
      return typeof a === "number" && typeof expected === "number" && a > expected;
    case "gte":
      return typeof a === "number" && typeof expected === "number" && a >= expected;
    case "in":
      return Array.isArray(expected) && expected.includes(a as never);
    default:
      return false;
  }
}

const OP_WORDS: Record<string, string> = { lt: "<", lte: "≤", gt: ">", gte: "≥" };

function phraseLeaf(leaf: RuleLeaf, actual: unknown, result: boolean): string {
  const label = fieldLabel(leaf.field);
  const av = formatValue(leaf.field, actual);
  const ev = formatValue(leaf.field, leaf.value);

  switch (leaf.op) {
    case "exists":
      return result ? `${label} is recorded` : `${label} is not set`;
    case "missing":
      return result ? `${label} is not set` : `${label} is recorded`;
    case "eq":
      return result ? `${label} is ${ev}` : `${label} is ${av}, not ${ev}`;
    case "neq":
      return result ? `${label} is ${av}, not ${ev}` : `${label} is ${ev}`;
    case "in":
      return result ? `${label} is ${av}` : `${label} is ${av}, not one of ${ev}`;
    default: {
      const sign = OP_WORDS[leaf.op] ?? leaf.op;
      return result ? `${label} ${av} ${sign} ${ev}` : `${label} ${av} is not ${sign} ${ev}`;
    }
  }
}

function evaluate(rule: Rule, context: RuleContext): Outcome {
  if (isLeaf(rule)) {
    const present = Object.prototype.hasOwnProperty.call(context, rule.field);
    const actual = present ? context[rule.field] : undefined;
    const unset = actual === undefined || actual === null;

    // `exists` / `missing` ask about presence, so an unset value is the answer
    // rather than a gap. Every other operator needs a value to compare, and a
    // gap there is genuinely unknown.
    if (rule.op === "exists" || rule.op === "missing") {
      const result = rule.op === "exists" ? !unset : unset;
      return { value: result, why: phraseLeaf(rule, actual, result), missing: [] };
    }
    if (unset) {
      return { value: null, why: fieldLabel(rule.field), missing: [rule.field] };
    }

    const result = compare(rule.op, actual, rule.value);
    return { value: result, why: phraseLeaf(rule, actual, result), missing: [] };
  }

  if ("all" in rule) {
    const parts = rule.all.map((r) => evaluate(r, context));
    // A single false settles an `all` even when siblings are unknown: false AND
    // unknown is false, and answering the unknown cannot change it.
    const firstFalse = parts.find((p) => p.value === false);
    if (firstFalse) return { value: false, why: firstFalse.why, missing: [] };
    const unknowns = parts.filter((p) => p.value === null);
    if (unknowns.length > 0) {
      return { value: null, why: unknowns.map((u) => u.why).join(", "), missing: unknowns.flatMap((u) => u.missing) };
    }
    return { value: true, why: parts.map((p) => p.why).join(" and "), missing: [] };
  }

  if ("any" in rule) {
    const parts = rule.any.map((r) => evaluate(r, context));
    const firstTrue = parts.find((p) => p.value === true);
    if (firstTrue) return { value: true, why: firstTrue.why, missing: [] };
    const unknowns = parts.filter((p) => p.value === null);
    if (unknowns.length > 0) {
      return { value: null, why: unknowns.map((u) => u.why).join(", "), missing: unknowns.flatMap((u) => u.missing) };
    }
    return { value: false, why: parts.map((p) => p.why).join("; "), missing: [] };
  }

  const inner = evaluate(rule.not, context);
  if (inner.value === null) return inner;
  // The child phrased itself for the value it actually holds, which still reads
  // correctly as the explanation for the inverted result.
  return { value: !inner.value, why: inner.why, missing: [] };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function needsSentence(missing: string[]): string {
  return `Needs: ${dedupe(missing).map((m) => fieldLabel(m).toLowerCase()).join(", ")}`;
}

/**
 * Applies a template's effective window to the sale date.
 *
 * This is how the Contract Cancellation Option (through 2026-09-30) and the
 * 3-Day Right to Cancel (from 2026-10-01) swap over without either rule
 * knowing about the other.
 */
function checkWindow(template: RuleTemplate, context: RuleContext): Evaluation | null {
  const from = template.effectiveFrom ? toDayString(template.effectiveFrom) : null;
  const to = template.effectiveTo ? toDayString(template.effectiveTo) : null;
  if (!from && !to) return null;

  const saleDay = toDayString(context["sale.saleDate"]);
  if (!saleDay) {
    return { state: "UNKNOWN", reason: needsSentence(["sale.saleDate"]), missing: ["sale.saleDate"] };
  }
  if (from && saleDay < from) {
    return { state: "NOT_REQUIRED", reason: `Not in effect until ${from} (sale dated ${saleDay})`, missing: [] };
  }
  if (to && saleDay > to) {
    return { state: "NOT_REQUIRED", reason: `Superseded after ${to} (sale dated ${saleDay})`, missing: [] };
  }
  return null;
}

/** Evaluates one template against one sale context. */
export function evaluateTemplate(template: RuleTemplate, context: RuleContext): Evaluation {
  const window = checkWindow(template, context);
  if (window) return window;

  if (!template.appliesWhen) {
    return { state: "NOT_REQUIRED", reason: "No applicability rule — added manually only", missing: [] };
  }

  const outcome = evaluate(template.appliesWhen, context);
  if (outcome.value === null) {
    return { state: "UNKNOWN", reason: needsSentence(outcome.missing), missing: dedupe(outcome.missing) };
  }
  return {
    state: outcome.value ? "REQUIRED" : "NOT_REQUIRED",
    reason: outcome.why,
    missing: [],
  };
}

/**
 * Two context values are themselves rule results, so they are derived from the
 * registry before the main pass rather than duplicated as hand-written logic
 * that could disagree with the rule it mirrors.
 *
 * `smog.exemptionClaimed` is true whenever the smog rule says no certificate is
 * required. A CA registration with no smog certificate always has to state the
 * exemption somewhere, so defaulting this to "not claimed" would silently drop
 * a REG 256 the DMV expects. An explicit `manual.smogExemptionClaimed` answer
 * overrides it. (Flagged for counsel — see build-state.)
 */
export function deriveRuleBackedValues(context: RuleContext, templates: RuleTemplate[]): RuleContext {
  const derived: Record<string, unknown> = { ...context };

  const odometer = templates.find((t) => t.key === "odometer_disclosure");
  if (odometer && derived["odometer.disclosureRequired"] == null) {
    const e = evaluateTemplate(odometer, context);
    if (e.state !== "UNKNOWN") derived["odometer.disclosureRequired"] = e.state === "REQUIRED";
  }

  const smog = templates.find((t) => t.key === "smog_certificate");
  if (smog && derived["smog.exemptionClaimed"] == null) {
    const manual = context["manual.smogExemptionClaimed"];
    if (typeof manual === "boolean") {
      derived["smog.exemptionClaimed"] = manual;
    } else {
      const e = evaluateTemplate(smog, context);
      if (e.state !== "UNKNOWN") derived["smog.exemptionClaimed"] = e.state === "NOT_REQUIRED";
    }
  }

  return derived;
}

export interface RuleResult extends Evaluation {
  key: string;
}

/**
 * Evaluates every template against one sale.
 *
 * Pure — `context` and `templates` are the whole input. Call
 * `buildSaleContext(saleId)` for the context and pass the seeded templates.
 */
export function evaluateRules<T extends RuleTemplate>(
  context: RuleContext,
  templates: T[],
): RuleResult[] {
  const full = deriveRuleBackedValues(context, templates);
  return templates.map((t) => ({ key: t.key, ...evaluateTemplate(t, full) }));
}
