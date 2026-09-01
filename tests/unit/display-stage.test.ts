import { describe, expect, it } from "vitest";
import { displayStage } from "@/modules/episodes/stage";

const base = {
  custodyStatus: "ON_SITE",
  reconditioningStatus: "NOT_ASSESSED",
  marketingStatus: "NOT_READY",
  salesStatus: "AVAILABLE",
  documentStatus: "NOT_STARTED",
  financialCloseStatus: "ESTIMATING",
  active: true,
} as const;

type Input = Parameters<typeof displayStage>[0];
const make = (over: Partial<Input>): Input => ({ ...base, ...over } as Input);

describe("displayStage", () => {
  it("expected before arrival", () => {
    expect(displayStage(make({ custodyStatus: "EXPECTED" }))).toBe("Expected");
    expect(displayStage(make({ custodyStatus: "INBOUND_TRANSPORT" }))).toBe("Expected");
  });

  it("intake right after arrival", () => {
    expect(displayStage(make({}))).toBe("Intake");
  });

  it("reconditioning while work is underway", () => {
    expect(displayStage(make({ reconditioningStatus: "WORK_IN_PROGRESS" }))).toBe("Reconditioning");
    expect(displayStage(make({ reconditioningStatus: "AWAITING_CONSIGNOR_APPROVAL" }))).toBe("Reconditioning");
  });

  it("media once reconditioning is resolved", () => {
    expect(displayStage(make({ reconditioningStatus: "COMPLETE", marketingStatus: "MEDIA_PENDING" }))).toBe("Media");
    expect(displayStage(make({ reconditioningStatus: "NO_WORK_REQUIRED", marketingStatus: "MEDIA_IN_PROGRESS" }))).toBe("Media");
  });

  it("ready to list, then listed", () => {
    expect(displayStage(make({ reconditioningStatus: "COMPLETE", marketingStatus: "READY_FOR_LISTING" }))).toBe("Ready to List");
    expect(displayStage(make({ reconditioningStatus: "COMPLETE", marketingStatus: "LIVE" }))).toBe("Listed");
  });

  it("deal progression outranks marketing", () => {
    expect(displayStage(make({ marketingStatus: "LIVE", salesStatus: "DEPOSIT_RECEIVED" }))).toBe("Deal in Progress");
    expect(displayStage(make({ marketingStatus: "MARKED_SOLD", salesStatus: "CONTRACTED" }))).toBe("Closing");
    expect(displayStage(make({ salesStatus: "RELEASED" }))).toBe("Delivered / Settling");
  });

  it("closed and inactive win over everything", () => {
    expect(displayStage(make({ financialCloseStatus: "FINANCIALLY_CLOSED", salesStatus: "DELIVERED" }))).toBe("Closed");
    expect(displayStage(make({ active: false, marketingStatus: "LIVE" }))).toBe("Inactive");
  });
});
