import type { InventoryEpisode } from "@prisma/client";
import type { BadgeTone } from "@/components/ui";

/**
 * Simplified display stage for dashboards/pipeline. COMPUTED from the six
 * parallel status dimensions — never stored as a source of truth.
 */
export type DisplayStage =
  | "Expected"
  | "Intake"
  | "Reconditioning"
  | "Media"
  | "Ready to List"
  | "Listed"
  | "Deal in Progress"
  | "Closing"
  | "Delivered / Settling"
  | "Closed"
  | "Inactive";

export const STAGE_ORDER: DisplayStage[] = [
  "Expected",
  "Intake",
  "Reconditioning",
  "Media",
  "Ready to List",
  "Listed",
  "Deal in Progress",
  "Closing",
  "Delivered / Settling",
  "Closed",
  "Inactive",
];

type StageInput = Pick<
  InventoryEpisode,
  | "custodyStatus"
  | "reconditioningStatus"
  | "marketingStatus"
  | "salesStatus"
  | "documentStatus"
  | "financialCloseStatus"
  | "active"
>;

export function displayStage(e: StageInput): DisplayStage {
  if (!e.active) return "Inactive";
  if (e.financialCloseStatus === "FINANCIALLY_CLOSED") return "Closed";

  // Deal progression outranks preparation once a buyer is engaged.
  switch (e.salesStatus) {
    case "DELIVERED":
    case "RELEASED":
      return "Delivered / Settling";
    case "CONTRACTED":
    case "FUNDS_PENDING":
    case "FUNDED":
    case "READY_FOR_RELEASE":
      return "Closing";
    case "HOLD":
    case "DEPOSIT_REQUESTED":
    case "DEPOSIT_RECEIVED":
      return "Deal in Progress";
    default:
      break;
  }

  if (e.custodyStatus === "EXPECTED" || e.custodyStatus === "INBOUND_TRANSPORT") return "Expected";

  if (e.marketingStatus === "LIVE" || e.marketingStatus === "PAUSED") return "Listed";
  if (e.marketingStatus === "READY_FOR_LISTING" || e.marketingStatus === "SUBMITTED_TO_LISTING_SYSTEM")
    return "Ready to List";

  const reconDone =
    e.reconditioningStatus === "COMPLETE" ||
    e.reconditioningStatus === "NO_WORK_REQUIRED" ||
    e.reconditioningStatus === "WORK_DECLINED";
  if (reconDone && (e.marketingStatus === "MEDIA_PENDING" || e.marketingStatus === "MEDIA_IN_PROGRESS" || e.marketingStatus === "LISTING_PACKAGE_INCOMPLETE"))
    return "Media";
  if (!reconDone && e.reconditioningStatus !== "NOT_ASSESSED") return "Reconditioning";
  if (e.reconditioningStatus === "NOT_ASSESSED") return "Intake";
  return "Media";
}

/**
 * A color per stage so the pipeline and vehicle lists are scannable at a
 * glance instead of every stage rendering as the same neutral badge. Colors
 * run roughly cool-to-warm as a vehicle nears a sale, then land on green at
 * financial close.
 */
export const STAGE_TONE: Record<DisplayStage, BadgeTone> = {
  Expected: "slate",
  Intake: "cyan",
  Reconditioning: "orange",
  Media: "violet",
  "Ready to List": "indigo",
  Listed: "blue",
  "Deal in Progress": "amber",
  Closing: "brand",
  "Delivered / Settling": "teal",
  Closed: "green",
  Inactive: "neutral",
};
