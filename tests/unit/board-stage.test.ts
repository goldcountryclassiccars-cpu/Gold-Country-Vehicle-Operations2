import { describe, expect, it } from "vitest";
import {
  applyWrites,
  BOARD_COLUMNS,
  boardStage,
  hasOpenDeal,
  nextMove,
  reachableColumns,
  writesToReach,
  type BoardStage,
} from "@/modules/episodes/board";

const base = {
  custodyStatus: "ON_SITE",
  reconditioningStatus: "NOT_ASSESSED",
  marketingStatus: "NOT_READY",
  salesStatus: "AVAILABLE",
  documentStatus: "NOT_STARTED",
  financialCloseStatus: "ESTIMATING",
  active: true,
} as const;

type Input = Parameters<typeof boardStage>[0];
const make = (over: Partial<Record<keyof typeof base, string | boolean>>): Input =>
  ({ ...base, ...over }) as Input;

const EPISODE_ID = "11111111-1111-1111-1111-111111111111";

/** One representative car sitting in each column. */
const IN_COLUMN: Record<BoardStage, Input> = {
  Expected: make({ custodyStatus: "EXPECTED" }),
  "In Prep": make({ reconditioningStatus: "WORK_IN_PROGRESS" }),
  "Photos & Listing": make({ reconditioningStatus: "COMPLETE", marketingStatus: "MEDIA_PENDING" }),
  "For Sale": make({ reconditioningStatus: "COMPLETE", marketingStatus: "LIVE" }),
  "Sold — Closing": make({ marketingStatus: "LIVE", salesStatus: "CONTRACTED" }),
  Delivered: make({ marketingStatus: "MARKED_SOLD", salesStatus: "DELIVERED" }),
  Closed: make({ financialCloseStatus: "FINANCIALLY_CLOSED" }),
  Inactive: make({ active: false }),
};

describe("boardStage", () => {
  it("folds the eleven display stages onto the six columns", () => {
    expect(boardStage(make({ custodyStatus: "EXPECTED" }))).toBe("Expected");
    expect(boardStage(make({ custodyStatus: "INBOUND_TRANSPORT" }))).toBe("Expected");
    // Intake and Reconditioning are one column.
    expect(boardStage(make({}))).toBe("In Prep");
    expect(boardStage(make({ reconditioningStatus: "AWAITING_PARTS" }))).toBe("In Prep");
    // Media and Ready to List are one column.
    expect(boardStage(make({ reconditioningStatus: "COMPLETE", marketingStatus: "MEDIA_IN_PROGRESS" }))).toBe(
      "Photos & Listing",
    );
    expect(boardStage(make({ reconditioningStatus: "COMPLETE", marketingStatus: "READY_FOR_LISTING" }))).toBe(
      "Photos & Listing",
    );
    // Deal in Progress and Closing are one column.
    expect(boardStage(make({ salesStatus: "DEPOSIT_RECEIVED" }))).toBe("Sold — Closing");
    expect(boardStage(make({ salesStatus: "FUNDED" }))).toBe("Sold — Closing");
  });

  it("every fixture really sits in the column it is filed under", () => {
    for (const [stage, episode] of Object.entries(IN_COLUMN)) {
      expect(boardStage(episode)).toBe(stage);
    }
  });
});

describe("nextMove", () => {
  /**
   * The property that matters: a button must land the car where it says. A
   * button that advertises the wrong destination is worse than no button,
   * because the board then lies quietly.
   */
  it("every advance move reaches the column it advertises", () => {
    for (const stage of BOARD_COLUMNS) {
      const move = nextMove(IN_COLUMN[stage], EPISODE_ID);
      if (!move || move.kind !== "advance") continue;
      expect(boardStage(applyWrites(IN_COLUMN[stage], move.writes)), `${stage} → ${move.to}`).toBe(move.to);
    }
  });

  it("never moves a car backwards or sideways", () => {
    for (const stage of BOARD_COLUMNS) {
      const move = nextMove(IN_COLUMN[stage], EPISODE_ID);
      if (!move) continue;
      expect(BOARD_COLUMNS.indexOf(move.to) > BOARD_COLUMNS.indexOf(stage) || move.to === "Closed").toBe(true);
    }
  });

  it("advances a car with no work order as 'no work required', not 'complete'", () => {
    const move = nextMove(make({}), EPISODE_ID);
    expect(move?.kind).toBe("advance");
    expect(move && move.kind === "advance" && move.writes).toContainEqual({
      dimension: "reconditioning",
      value: "NO_WORK_REQUIRED",
    });
  });

  it("advancing out of prep does not pull down a car that is already listed", () => {
    const listedButUnprepped = make({ reconditioningStatus: "WORK_IN_PROGRESS", marketingStatus: "LIVE" });
    // A listed car reads as For Sale, so the prep move does not apply to it.
    expect(boardStage(listedButUnprepped)).toBe("For Sale");
    const move = nextMove(listedButUnprepped, EPISODE_ID);
    expect(move?.kind).toBe("link");
  });

  it("hands the deal-side stages a link instead of a fake status write", () => {
    for (const stage of ["For Sale", "Sold — Closing", "Delivered"] as BoardStage[]) {
      expect(nextMove(IN_COLUMN[stage], EPISODE_ID)?.kind).toBe("link");
    }
  });

  it("has nothing to press on a closed or archived car", () => {
    expect(nextMove(IN_COLUMN.Closed, EPISODE_ID)).toBeNull();
    expect(nextMove(IN_COLUMN.Inactive, EPISODE_ID)).toBeNull();
  });
});

describe("writesToReach", () => {
  it("lands on every prep column it offers, from every prep column", () => {
    const preps: BoardStage[] = ["Expected", "In Prep", "Photos & Listing", "For Sale"];
    for (const from of preps) {
      for (const to of preps) {
        const writes = writesToReach(IN_COLUMN[from], to);
        expect(writes, `${from} → ${to}`).not.toBeNull();
        expect(boardStage(applyWrites(IN_COLUMN[from], writes!)), `${from} → ${to}`).toBe(to);
      }
    }
  });

  it("pulls the listing when a live car is sent back to prep", () => {
    const writes = writesToReach(IN_COLUMN["For Sale"], "In Prep");
    expect(writes).toContainEqual({ dimension: "marketing", value: "NOT_READY" });
  });

  it("writes nothing for a car already in the target column", () => {
    expect(writesToReach(IN_COLUMN["For Sale"], "For Sale")).toEqual([]);
  });

  it("refuses to fake the deal-side columns", () => {
    for (const to of ["Sold — Closing", "Delivered", "Closed", "Inactive"] as BoardStage[]) {
      expect(writesToReach(IN_COLUMN["For Sale"], to)).toBeNull();
    }
  });

  it("refuses to move a car that has an open deal", () => {
    for (const to of ["Expected", "In Prep", "Photos & Listing", "For Sale"] as BoardStage[]) {
      expect(writesToReach(IN_COLUMN["Sold — Closing"], to)).toBeNull();
    }
    expect(reachableColumns(IN_COLUMN["Sold — Closing"])).toEqual([]);
  });

  it("refuses to move a closed or archived car", () => {
    expect(writesToReach(IN_COLUMN.Closed, "In Prep")).toBeNull();
    expect(writesToReach(IN_COLUMN.Inactive, "In Prep")).toBeNull();
  });

  it("offers every prep column except the one the car is in", () => {
    expect(reachableColumns(IN_COLUMN["Photos & Listing"])).toEqual(["Expected", "In Prep", "For Sale"]);
  });
});

describe("hasOpenDeal", () => {
  it("is false before a buyer and after a cancellation", () => {
    expect(hasOpenDeal(make({ salesStatus: "AVAILABLE" }))).toBe(false);
    expect(hasOpenDeal(make({ salesStatus: "INQUIRY_ACTIVITY" }))).toBe(false);
    expect(hasOpenDeal(make({ salesStatus: "CANCELED" }))).toBe(false);
    expect(hasOpenDeal(make({ salesStatus: "UNWOUND" }))).toBe(false);
  });

  it("is true from the first deposit request onwards", () => {
    for (const s of ["HOLD", "DEPOSIT_REQUESTED", "DEPOSIT_RECEIVED", "CONTRACTED", "FUNDED", "DELIVERED"]) {
      expect(hasOpenDeal(make({ salesStatus: s })), s).toBe(true);
    }
  });
});
