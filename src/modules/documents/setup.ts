/**
 * The sale-document setup checklist, as live status rather than a document.
 *
 * SALES_DOCUMENT_SETUP.md has always opened by promising "an owner-only setup
 * checklist inside the application mirrors this list and remains visible until
 * configuration is complete". It never existed, so the app's own answer to
 * "how do I turn on real documents?" was a pointer at a markdown file inside
 * the code repository — useless to the person who actually has to gather the
 * paperwork.
 *
 * This is that checklist. Two kinds of item:
 *
 *  - **detected** — the app can see the answer (is the registry loaded? is the
 *    dealer address filled in? how many templates have an approved file?).
 *    These can never be marked done by hand, because a tick that disagrees
 *    with reality is worse than no tick.
 *  - **answered** — only a person can close it ("counsel reviewed this", "we
 *    picked this e-signature vendor"). These are stored in DocumentSetupItem
 *    with a note and an audit trail.
 */
import { db } from "@/lib/db";

export type SetupStatus = "done" | "partial" | "todo";

export interface SetupItem {
  key: string;
  /** Matches the numbering in SALES_DOCUMENT_SETUP.md so the two can be read together. */
  number: number;
  title: string;
  /** What is actually needed, in the words of someone who has to go and get it. */
  need: string;
  status: SetupStatus;
  /** What the app currently sees, or what the person recorded. */
  detail: string;
  /** True when only a person can close this — shows the note field. */
  answerable: boolean;
  note?: string | null;
  providedAt?: Date | null;
  /** Where in the app this gets done, when there is somewhere. */
  href?: string;
  hrefLabel?: string;
}

export interface SetupState {
  items: SetupItem[];
  done: number;
  total: number;
  /** True once nothing is outstanding — the banner can come down. */
  complete: boolean;
  /** Documents that can hold a blank master — categories 1 and 2 only. */
  templatesTotal: number;
  templatesApproved: number;
  counselFlags: number;
}

/** Items only a person can close. */
export const ANSWERABLE_KEYS = [
  "document_list",
  "required_fields",
  "signing_order",
  "signature_methods",
  "filing_retention",
  "compliance_review",
  "esign_vendor",
  "cars_act",
] as const;

export async function documentSetupState(): Promise<SetupState> {
  const [templates, dealerSettings, registrySetting, payoutSetting, answers] = await Promise.all([
    db.documentTemplate.findMany({
      where: { active: true },
      select: { key: true, name: true, approvedFileId: true, verifyWithCounsel: true, category: true },
    }),
    db.appSetting.findMany({ where: { key: { startsWith: "dealer." } } }),
    db.appSetting.findUnique({ where: { key: "documents.registry" } }),
    db.appSetting.findUnique({ where: { key: "settlement_deadline_days" } }),
    db.documentSetupItem.findMany(),
  ]);

  const answerBy = new Map(answers.map((a) => [a.key, a]));
  // Only categories 1 and 2 can hold a blank master, so those are the
  // denominator. Counting against all 36 would make this item impossible to
  // finish, and an item that can never go green is worse than no item.
  const loadable = templates.filter((t) => t.category === 1 || t.category === 2);
  const templatesApproved = loadable.filter((t) => t.approvedFileId).length;
  const counselFlags = templates.filter((t) => t.verifyWithCounsel).length;

  const dealerFilled = new Set(
    dealerSettings.filter((d) => typeof d.value === "string" && d.value.trim() !== "").map((d) => d.key),
  );
  const DEALER_REQUIRED: [string, string][] = [
    ["dealer.legalName", "legal name"],
    ["dealer.address", "address"],
    ["dealer.dealerLicenseNo", "dealer license number"],
    ["dealer.sellersPermitNo", "seller's permit number"],
  ];
  const dealerMissing = DEALER_REQUIRED.filter(([k]) => !dealerFilled.has(k)).map(([, label]) => label);

  const registry = (registrySetting?.value ?? null) as { version?: string } | null;

  /** Builds an item whose answer comes from a person. */
  const answered = (
    key: (typeof ANSWERABLE_KEYS)[number],
    number: number,
    title: string,
    need: string,
    todoDetail: string,
  ): SetupItem => {
    const a = answerBy.get(key);
    return {
      key,
      number,
      title,
      need,
      status: a?.provided ? "done" : "todo",
      detail: a?.provided ? (a.note?.trim() || "Recorded as provided.") : todoDetail,
      answerable: true,
      note: a?.note ?? null,
      providedAt: a?.providedAt ?? null,
    };
  };

  const items: SetupItem[] = [
    answered(
      "document_list",
      1,
      "Confirm the document list",
      `Check the ${templates.length} documents the app knows about against what you actually use, for both consignment and dealer-owned deals, and tell us about anything missing.`,
      "Nobody has confirmed the list is complete.",
    ),
    {
      key: "approved_templates",
      number: 2,
      title: "Load the approved templates",
      need: "The current, legally reviewed version of each document you sign, plus the blank of each government form you print. Upload each one and that document stops being a demo.",
      status: templatesApproved === 0 ? "todo" : templatesApproved >= loadable.length ? "done" : "partial",
      detail:
        templatesApproved === 0
          ? `None loaded. All ${loadable.length} loadable documents generate a DEMONSTRATION watermark. (The other ${templates.length - loadable.length} are controlled originals or arrive per sale.)`
          : `${templatesApproved} of ${loadable.length} loaded. The rest still generate a watermark.`,
      answerable: false,
      href: "/admin/documents",
      hrefLabel: "Load templates",
    },
    {
      key: "applicability_rules",
      number: 3,
      title: "Applicability rules",
      need: "Which documents apply to which sale. Already built — what is left is confirming the rules with counsel.",
      status: registry?.version ? (counselFlags > 0 ? "partial" : "done") : "todo",
      detail: registry?.version
        ? `Registry ${registry.version} loaded. ${counselFlags} rules still flagged for counsel.`
        : "The registry has not loaded. Sale checklists will be empty until it does.",
      answerable: false,
      href: "/admin",
      hrefLabel: "Registry status",
    },
    answered(
      "required_fields",
      4,
      "Field map for the government forms",
      "For each DMV form, which box each piece of data goes in. Needed before the app can fill a PDF rather than print a worksheet to copy from.",
      "Worksheets work today. Automatic filling is blocked on this.",
    ),
    answered(
      "signing_order",
      5,
      "Signing order",
      "Who signs first when a document has several signers. Who signs is already recorded; the order is not.",
      "Confirmed 2026-09-05: any Admin signs as Dealer, Front Desk never signs. Order between buyer, co-buyer and consignor is still open.",
    ),
    answered(
      "signature_methods",
      6,
      "Signature method per document",
      "Which documents may be signed electronically, which need wet ink, which need the original, which need a notary.",
      "The registry carries a first pass from the statutes. Nobody has confirmed it.",
    ),
    answered(
      "filing_retention",
      7,
      "Filing and retention",
      "Where each finished document is filed and how long it has to be kept.",
      "Submission destinations are recorded per document. Retention periods are not.",
    ),
    answered(
      "compliance_review",
      8,
      "California compliance review",
      "Sign-off from your legal or compliance resource that this package satisfies current CA DMV and dealer requirements.",
      `Not done. ${counselFlags} rules carry a "verify with counsel" flag and say so on every deal.`,
    ),
    answered(
      "esign_vendor",
      9,
      "E-signature vendor",
      "Which provider to use, if any. The app ships with a mock and a provider-neutral interface.",
      "Still the mock adapter — it never contacts a real service.",
    ),
    {
      key: "payout_days",
      number: 10,
      title: "Consignor payout deadline",
      need: "How many days after the buyer's funds clear a consignor must be paid.",
      status: typeof payoutSetting?.value === "number" ? "done" : "todo",
      detail:
        typeof payoutSetting?.value === "number"
          ? `${payoutSetting.value} days after funds clear. Payout is also blocked until any cancellation window closes.`
          : "Not set — the app falls back to 14 days.",
      answerable: false,
      href: "/admin",
      hrefLabel: "Settings",
    },
    {
      key: "dealer_identity",
      number: 11,
      title: "Dealer details on documents",
      need: "Legal name, address, dealer license number and seller's permit number — these print on the Buyers Guide and the REG 51.",
      status: dealerMissing.length === 0 ? "done" : dealerMissing.length < DEALER_REQUIRED.length ? "partial" : "todo",
      detail:
        dealerMissing.length === 0
          ? "All entered."
          : `Missing: ${dealerMissing.join(", ")}.`,
      answerable: false,
      href: "/admin",
      hrefLabel: "Enter details",
    },
    answered(
      "cars_act",
      12,
      "CARS Act cut-over",
      "Confirm the 2026-10-01 swap: price ceilings, and whether the 3-day cancellation window skips weekends and holidays. The statutory notice text has to come from counsel — the app will not draft it.",
      "Weekend and holiday handling is unconfirmed, and the 3-Day notice text does not exist yet.",
    ),
  ];

  const done = items.filter((i) => i.status === "done").length;
  return {
    items,
    done,
    total: items.length,
    complete: done === items.length,
    templatesTotal: loadable.length,
    templatesApproved,
    counselFlags,
  };
}
