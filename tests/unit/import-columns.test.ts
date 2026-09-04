/**
 * Value coercion tests.
 *
 * The import has to accept what a person types into a spreadsheet, not what a
 * database wants: "$49,900", "On site", "consignment". Equally important, it
 * must refuse junk loudly rather than coercing it to zero — a price silently
 * read as 0 would flow straight into profitability.
 */
import { describe, expect, it } from "vitest";
import {
  COLUMNS,
  TEMPLATE_EXAMPLE,
  TEMPLATE_HEADER,
  normalizeIdentifier,
  parseCustodyStatus,
  parseDate,
  parseDealType,
  parseIdentifierType,
  parseInteger,
  parseMarketingStatus,
  parseMileageStatus,
  parseMoney,
} from "@/modules/import/columns";

describe("the template", () => {
  it("has an example value for every column", () => {
    expect(TEMPLATE_EXAMPLE).toHaveLength(TEMPLATE_HEADER.length);
  });

  it("uses unique column keys", () => {
    expect(new Set(TEMPLATE_HEADER).size).toBe(TEMPLATE_HEADER.length);
  });

  it("documents every column", () => {
    for (const c of COLUMNS) expect(c.help.length).toBeGreaterThan(10);
  });
});

describe("parseMoney", () => {
  it("accepts what people actually type", () => {
    expect(parseMoney("$49,900")).toBe(49900);
    expect(parseMoney("49900.50")).toBe(49900.5);
    expect(parseMoney(" 2,900 ")).toBe(2900);
  });

  it("treats blank as absent, not zero", () => {
    expect(parseMoney("")).toBeUndefined();
  });

  it("refuses junk rather than reading it as zero", () => {
    expect(parseMoney("call for price")).toBeNull();
    expect(parseMoney("-500")).toBeNull();
  });
});

describe("parseInteger", () => {
  it("accepts thousands separators", () => {
    expect(parseInteger("61,233")).toBe(61233);
  });

  it("refuses decimals and text", () => {
    expect(parseInteger("61.5")).toBeNull();
    expect(parseInteger("about 60k")).toBeNull();
  });
});

describe("parseDate", () => {
  it("accepts ISO and US formats", () => {
    expect(parseDate("2026-06-14")?.toISOString()).toBe("2026-06-14T00:00:00.000Z");
    expect(parseDate("6/14/2026")?.toISOString()).toBe("2026-06-14T00:00:00.000Z");
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseDate("2026-02-31")).toBeNull();
    expect(parseDate("June 14")).toBeNull();
  });
});

describe("enum matching", () => {
  it("is forgiving about case, spaces and punctuation", () => {
    expect(parseDealType("consignment")).toBe("CONSIGNMENT");
    expect(parseDealType("Consignment")).toBe("CONSIGNMENT");
    expect(parseDealType("dealer-owned")).toBe("DEALER_PURCHASE");
    expect(parseDealType("DEALER_PURCHASE")).toBe("DEALER_PURCHASE");
    expect(parseCustodyStatus("on site")).toBe("ON_SITE");
    expect(parseCustodyStatus("Onsite")).toBe("ON_SITE");
    expect(parseMarketingStatus("Listed")).toBe("LIVE");
    expect(parseMileageStatus("Broken odometer")).toBe("BROKEN_ODOMETER");
  });

  it("keeps the classic-car identifier types distinct", () => {
    expect(parseIdentifierType("VIN")).toBe("VIN");
    expect(parseIdentifierType("Short VIN")).toBe("SHORT_VIN");
    expect(parseIdentifierType("chassis")).toBe("CHASSIS_NUMBER");
    expect(parseIdentifierType("Serial Number")).toBe("SERIAL_NUMBER");
    expect(parseIdentifierType("cowl tag")).toBe("COWL_TAG");
  });

  it("returns undefined for a value it does not know, so the row can error", () => {
    expect(parseDealType("floorplan")).toBeUndefined();
    expect(parseMarketingStatus("sort of listed")).toBeUndefined();
  });
});

describe("normalizeIdentifier", () => {
  it("matches the same chassis number typed three different ways", () => {
    const forms = ["AN5L4702", "an5l-4702", " AN5L 4702 "];
    const normalized = new Set(forms.map(normalizeIdentifier));
    expect(normalized.size).toBe(1);
    expect([...normalized][0]).toBe("AN5L4702");
  });

  it("does not collapse genuinely different numbers", () => {
    expect(normalizeIdentifier("AN5L4702")).not.toBe(normalizeIdentifier("AN5L4703"));
  });
});
