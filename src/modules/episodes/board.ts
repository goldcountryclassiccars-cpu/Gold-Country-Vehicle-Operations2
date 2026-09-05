/**
 * The Pipeline board: six columns, and one move per card.
 *
 * WHY THIS EXISTS. `displayStage` computes eleven fine-grained stages from the
 * six parallel status dimensions, and the Pipeline drew one column per stage.
 * That is a faithful picture of the data and a useless control surface: to move
 * a car one column to the right, somebody had to know which of six fields to
 * change and which of its ~12 values produced the column they wanted. Nothing
 * in the UI said. In practice cars never moved.
 *
 * So this module adds the missing direction. `boardStage` folds the eleven
 * display stages into the six a person at the dealership actually talks about,
 * and `nextMove` says — for a car sitting in one of them — what the single
 * forward step is and exactly which fields it writes.
 *
 * Two properties are load-bearing:
 *
 * - **The six status dimensions stay the source of truth.** Nothing here stores
 *   a stage. Reports, the release gate, the consignor payout clock and the
 *   sale-document rules all read the underlying fields, and a stored stage
 *   would be a second truth to drift from them.
 * - **Every move is declared as status writes, and the result is asserted.**
 *   `boardStage(apply(writes))` must equal the advertised target; the tests
 *   check that for every column. A button that claims a destination it does not
 *   reach is worse than no button, because the board then lies quietly.
 *
 * Once a deal is open the right-hand side of the board moves ITSELF: createSale,
 * markContracted, releaseVehicle and deliverVehicle already call
 * changeEpisodeStatus. So `nextMove` hands those stages a link to the screen
 * that does the real work rather than a status write that would fake it.
 */
import type { InventoryEpisode } from "@prisma/client";
import type { BadgeTone } from "@/components/ui";
import { displayStage, type DisplayStage } from "./stage";
import type { StatusDimension } from "./service";

export type BoardStage =
  | "Expected"
  | "In Prep"
  | "Photos & Listing"
  | "For Sale"
  | "Sold — Closing"
  | "Delivered"
  | "Closed"
  | "Inactive";

/** The columns drawn on the Pipeline, left to right. */
export const BOARD_COLUMNS: BoardStage[] = [
  "Expected",
  "In Prep",
  "Photos & Listing",
  "For Sale",
  "Sold — Closing",
  "Delivered",
];

/** The prep-side columns, which a person drives by hand. */
const PREP_COLUMNS: BoardStage[] = ["Expected", "In Prep", "Photos & Listing", "For Sale"];

const FROM_DISPLAY: Record<DisplayStage, BoardStage> = {
  Expected: "Expected",
  Intake: "In Prep",
  Reconditioning: "In Prep",
  Media: "Photos & Listing",
  "Ready to List": "Photos & Listing",
  Listed: "For Sale",
  "Deal in Progress": "Sold — Closing",
  Closing: "Sold — Closing",
  "Delivered / Settling": "Delivered",
  Closed: "Closed",
  Inactive: "Inactive",
};

/** One line under each column heading, so nobody has to guess what it means. */
export const BOARD_BLURB: Record<BoardStage, string> = {
  Expected: "Bought or consigned, not here yet.",
  "In Prep": "On the lot. Inspection and any work.",
  "Photos & Listing": "Prep done. Photos and listing copy.",
  "For Sale": "Live and taking inquiries.",
  "Sold — Closing": "Buyer committed. Deposit, contract, funds.",
  Delivered: "Handed over. Settling up.",
  Closed: "Financially closed.",
  Inactive: "Archived.",
};

export const BOARD_TONE: Record<BoardStage, BadgeTone> = {
  Expected: "slate",
  "In Prep": "orange",
  "Photos & Listing": "violet",
  "For Sale": "blue",
  "Sold — Closing": "amber",
  Delivered: "teal",
  Closed: "green",
  Inactive: "neutral",
};

/** Tailwind's scanner cannot see interpolated class names — keep these literal. */
export const BOARD_DOT: Record<BoardStage, string> = {
  Expected: "bg-slate-400",
  "In Prep": "bg-orange-400",
  "Photos & Listing": "bg-violet-400",
  "For Sale": "bg-blue-400",
  "Sold — Closing": "bg-amber-400",
  Delivered: "bg-teal-400",
  Closed: "bg-green-400",
  Inactive: "bg-stone-400",
};

export const BOARD_BORDER: Record<BoardStage, string> = {
  Expected: "border-l-slate-400",
  "In Prep": "border-l-orange-400",
  "Photos & Listing": "border-l-violet-400",
  "For Sale": "border-l-blue-400",
  "Sold — Closing": "border-l-amber-400",
  Delivered: "border-l-teal-400",
  Closed: "border-l-green-400",
  Inactive: "border-l-stone-400",
};

type StageInput = Parameters<typeof displayStage>[0];

export function boardStage(e: StageInput): BoardStage {
  return FROM_DISPLAY[displayStage(e)];
}

export interface StatusWrite {
  dimension: StatusDimension;
  value: string;
}

/** A move that writes statuses directly. */
export interface AdvanceMove {
  kind: "advance";
  to: BoardStage;
  /** Button text. Says the destination, because that is what is being decided. */
  label: string;
  /** Plain-English consequence, shown under the button. */
  explains: string;
  writes: StatusWrite[];
}

/** A move that belongs to another screen, because it needs more than a status. */
export interface LinkMove {
  kind: "link";
  to: BoardStage;
  label: string;
  explains: string;
  href: string;
}

export type BoardMove = AdvanceMove | LinkMove;

const RECON_DONE = ["COMPLETE", "NO_WORK_REQUIRED", "WORK_DECLINED"];
const MARKETING_PUBLIC = ["READY_FOR_LISTING", "SUBMITTED_TO_LISTING_SYSTEM", "LIVE", "PAUSED"];

/** True once a buyer is engaged, at which point the deal owns the stage. */
export function hasOpenDeal(e: StageInput): boolean {
  const s = e.salesStatus as string;
  return s !== "AVAILABLE" && s !== "INQUIRY_ACTIVITY" && s !== "CANCELED" && s !== "UNWOUND";
}

/**
 * The single forward step for a car, or null when there is nothing to press.
 *
 * `episodeId` is only used to build hrefs for the deal-side stages.
 */
export function nextMove(e: StageInput, episodeId: string): BoardMove | null {
  const stage = boardStage(e);
  switch (stage) {
    case "Expected":
      return {
        kind: "advance",
        to: "In Prep",
        label: "It's here — move to In Prep",
        explains: "Marks the car on site and stamps today as its arrival date.",
        writes: [{ dimension: "custody", value: "ON_SITE" }],
      };

    case "In Prep": {
      // NOT_ASSESSED means nobody opened a work order, so finishing prep from
      // there is "no work needed" — not "the work we did is complete".
      const recon = e.reconditioningStatus as string;
      const writes: StatusWrite[] = [];
      if (!RECON_DONE.includes(recon)) {
        writes.push({
          dimension: "reconditioning",
          value: recon === "NOT_ASSESSED" ? "NO_WORK_REQUIRED" : "COMPLETE",
        });
      }
      if (!MARKETING_PUBLIC.includes(e.marketingStatus as string)) {
        writes.push({ dimension: "marketing", value: "MEDIA_PENDING" });
      }
      return {
        kind: "advance",
        to: "Photos & Listing",
        label: "Prep done — move to Photos & Listing",
        explains: "Closes out reconditioning and puts the car in the queue for photos.",
        writes,
      };
    }

    case "Photos & Listing":
      return {
        kind: "advance",
        to: "For Sale",
        label: "Photos done — put it up for sale",
        explains: "Marks the listing live and records the date it first went up.",
        writes: [{ dimension: "marketing", value: "LIVE" }],
      };

    case "For Sale":
      // A deal needs a buyer, a price and a deposit — a form, not a status.
      // Opening one moves the car here on its own.
      return {
        kind: "link",
        to: "Sold — Closing",
        label: "Start a deal →",
        explains: "Opening a deal moves the car to Sold — Closing by itself.",
        href: `/sales?episode=${episodeId}`,
      };

    case "Sold — Closing":
      return {
        kind: "link",
        to: "Delivered",
        label: "Open the deal →",
        explains: "Deposit, contract, funds and release all live on the deal. The board follows it.",
        href: `/sales?episode=${episodeId}`,
      };

    case "Delivered":
      return {
        kind: "link",
        to: "Closed",
        label: "Finish settlement →",
        explains: "On consignment the file closes after the consignor is paid.",
        href: "/settlements",
      };

    default:
      return null; // Closed and Inactive have no next step.
  }
}

/**
 * Writes that put a car in `target`, for the "move it somewhere else" picker.
 *
 * Only the prep-side columns are offered. The deal-side ones are reachable only
 * by doing the deal, and a status write that jumped a car to "Sold — Closing"
 * with no buyer attached would produce a deal-less sold car that no other
 * screen knows how to finish.
 *
 * Returns null when the target is not reachable this way.
 */
export function writesToReach(e: StageInput, target: BoardStage): StatusWrite[] | null {
  if (!PREP_COLUMNS.includes(target)) return null;
  if (hasOpenDeal(e)) return null;
  if (!e.active) return null;
  if (e.financialCloseStatus === "FINANCIALLY_CLOSED") return null;

  const custody = e.custodyStatus as string;
  const recon = e.reconditioningStatus as string;
  const marketing = e.marketingStatus as string;
  const writes: StatusWrite[] = [];
  const set = (dimension: StatusDimension, value: string, current: string) => {
    if (current !== value) writes.push({ dimension, value });
  };

  if (target === "Expected") {
    // Custody is checked before marketing in displayStage, so this alone wins.
    set("custody", "EXPECTED", custody);
    return writes;
  }

  if (custody === "EXPECTED" || custody === "INBOUND_TRANSPORT") {
    set("custody", "ON_SITE", custody);
  }

  if (target === "In Prep") {
    set("reconditioning", "NOT_ASSESSED", recon);
    // A car cannot be back in prep and still live on the website.
    if (MARKETING_PUBLIC.includes(marketing)) set("marketing", "NOT_READY", marketing);
    return writes;
  }

  if (!RECON_DONE.includes(recon)) {
    set("reconditioning", recon === "NOT_ASSESSED" ? "NO_WORK_REQUIRED" : "COMPLETE", recon);
  }

  if (target === "Photos & Listing") {
    set("marketing", "MEDIA_PENDING", marketing);
    return writes;
  }

  // target === "For Sale"
  set("marketing", "LIVE", marketing);
  return writes;
}

/** The columns the picker should offer for this car, excluding where it is. */
export function reachableColumns(e: StageInput): BoardStage[] {
  const here = boardStage(e);
  return PREP_COLUMNS.filter((s) => s !== here && writesToReach(e, s) !== null);
}

/** Applies writes to a plain status object. Used by the UI preview and tests. */
export function applyWrites<T extends StageInput>(e: T, writes: StatusWrite[]): T {
  const field: Record<StatusDimension, string> = {
    custody: "custodyStatus",
    reconditioning: "reconditioningStatus",
    marketing: "marketingStatus",
    sales: "salesStatus",
    document: "documentStatus",
    financial: "financialCloseStatus",
  };
  const next = { ...e } as Record<string, unknown>;
  for (const w of writes) next[field[w.dimension]] = w.value;
  return next as T;
}

export type BoardEpisode = Pick<
  InventoryEpisode,
  | "custodyStatus"
  | "reconditioningStatus"
  | "marketingStatus"
  | "salesStatus"
  | "documentStatus"
  | "financialCloseStatus"
  | "active"
>;
