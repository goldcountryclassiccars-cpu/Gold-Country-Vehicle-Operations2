/**
 * Listing feeds are what our website and the marketplaces read, so the
 * renderers must be exact: escaping that survives a description pasted from
 * Word, availability that never advertises a sold car on a marketplace, and a
 * CSV a platform's import team can map without surprises.
 */
import { describe, expect, it } from "vitest";
import {
  availabilityFor,
  composeDescription,
  CSV_COLUMNS,
  DEALER,
  formatPrice,
  mileageNoteFor,
  renderCsv,
  renderJson,
  renderXml,
  videoKind,
  type FeedListing,
} from "@/modules/listings/feed";
import { channelCarries, cleanHighlights, checkListing, defaultTitle, prefillFromVehicle } from "@/modules/listings/service";

const dealer = { ...DEALER, phone: "(530) 555-0100" };

function listing(over: Partial<FeedListing> = {}): FeedListing {
  return {
    id: "L1",
    stockNumber: "101526-1234",
    vin: "1G1YY",
    year: 1967,
    make: "Chevrolet",
    model: "Corvette",
    trim: "Sting Ray",
    bodyStyle: "Convertible",
    exteriorColor: "Marina Blue",
    interiorColor: "Bright Blue",
    engine: "327/300hp V8",
    transmission: "4-speed manual",
    drivetrain: "RWD",
    mileage: 54210,
    mileageNote: "Exempt",
    price: 89900,
    priceLabel: "$89,900",
    availability: "available",
    title: "1967 Chevrolet Corvette Sting Ray Convertible",
    headline: "Numbers-matching, \"show\" quality",
    highlights: ["Matching numbers", "Two tops"],
    sections: [{ heading: "Overview", body: "Line one, with a comma.\n\nSecond <para> & more" }],
    descriptionText: 'Says "hello", then\na newline',
    descriptionHtml: "<p>x</p>",
    photos: [
      { url: "https://app/x/1", thumbUrl: "https://app/x/1?size=thumb", caption: null, position: 1 },
      { url: "https://app/x/2", thumbUrl: "https://app/x/2?size=thumb", caption: null, position: 2 },
    ],
    videos: [{ url: "https://youtu.be/abc", kind: "youtube", label: "Walkaround" }],
    updatedAt: "2026-10-19T20:00:00.000Z",
    version: 3,
    ...over,
  };
}

describe("availability", () => {
  it("maps sales statuses to what a buyer should see", () => {
    expect(availabilityFor("AVAILABLE", true)).toBe("available");
    expect(availabilityFor("INQUIRY_ACTIVITY", true)).toBe("available");
    expect(availabilityFor("DEPOSIT_RECEIVED", true)).toBe("pending");
    expect(availabilityFor("CONTRACTED", true)).toBe("sold");
    expect(availabilityFor("DELIVERED", true)).toBe("sold");
    expect(availabilityFor("UNWOUND", true)).toBe("available");
    expect(availabilityFor("AVAILABLE", false)).toBe("sold"); // archived episode never advertises
  });
  it("marketplaces never carry sold cars; our website keeps sold pages", () => {
    expect(channelCarries("hemmings", "sold")).toBe(false);
    expect(channelCarries("classiccars", "sold")).toBe(false);
    expect(channelCarries("hemmings", "pending")).toBe(true);
    expect(channelCarries("website", "sold")).toBe(true);
  });
});

describe("small formatters", () => {
  it("prices and call-for-price", () => {
    expect(formatPrice(79900, false)).toBe("$79,900");
    expect(formatPrice(79900, true)).toBe("Call for price");
    expect(formatPrice(null, false)).toBe("Call for price");
  });
  it("mileage notes follow the odometer status", () => {
    expect(mileageNoteFor("ACTUAL")).toBeNull();
    expect(mileageNoteFor("EXEMPT")).toBe("Exempt");
    expect(mileageNoteFor("TMU")).toBe("True mileage unknown");
    expect(mileageNoteFor("BROKEN_ODOMETER")).toBe("Odometer inoperative");
  });
  it("recognises video hosts", () => {
    expect(videoKind("https://www.youtube.com/watch?v=x")).toBe("youtube");
    expect(videoKind("https://youtu.be/x")).toBe("youtube");
    expect(videoKind("https://vimeo.com/1")).toBe("vimeo");
    expect(videoKind("https://photos.app.goo.gl/x")).toBe("link");
  });
  it("cleans highlight bullets and caps them", () => {
    expect(cleanHighlights(["• One", "- Two", "  ", "* Three"])).toEqual(["One", "Two", "Three"]);
    expect(cleanHighlights(Array.from({ length: 30 }, (_, i) => `h${i}`))).toHaveLength(20);
  });
  it("titles and prefill come from the vehicle record", () => {
    const v = {
      year: 1932, make: "Ford", model: "Roadster", trim: null, bodyStyle: "Highboy",
      generalDescription: "Steel-bodied highboy.", provenance: "Built in 1998.", restorationHistory: "Refreshed 2021.",
      originalityNotes: null, modifications: "Flathead swapped for a 350",
    };
    expect(defaultTitle(v)).toBe("1932 Ford Roadster Highboy");
    const p = prefillFromVehicle(v);
    expect(p.description).toBe("Steel-bodied highboy.");
    expect(p.history).toBe("Built in 1998.\n\nRefreshed 2021.");
    expect(p.condition).toBe("Modifications: Flathead swapped for a 350");
  });
});

describe("description", () => {
  it("composes headline, highlights and sections; escapes HTML", () => {
    const d = composeDescription({
      headline: "Fresh <restoration>",
      highlights: ["A & B"],
      sections: [
        { heading: "Overview", body: "First para.\n\nSecond para." },
        { heading: "Condition", body: "Chip on hood." },
      ],
    });
    expect(d.text).toContain("Highlights:\n• A & B");
    expect(d.text).toContain("Condition:\nChip on hood.");
    expect(d.text.indexOf("First para.")).toBeLessThan(d.text.indexOf("Condition:"));
    expect(d.html).toContain("<strong>Fresh &lt;restoration&gt;</strong>");
    expect(d.html).toContain("<li>A &amp; B</li>");
    expect(d.html).toContain("<p>First para.</p><p>Second para.</p>");
    expect(d.html).not.toContain("<h3>Overview</h3>");
  });
});

describe("renderers", () => {
  it("JSON carries the dealer and the listings", () => {
    const j = renderJson([listing()], dealer, new Date("2026-10-19T20:00:00Z"));
    expect(j.count).toBe(1);
    expect(j.dealer.dealerLicense).toBe("44497");
    expect(j.listings[0]!.photos[0]!.position).toBe(1);
  });

  it("XML escapes text, survives ]]> and strips control characters", () => {
    const x = renderXml(
      [listing({ title: "A & B <C>", descriptionText: "ends ]]> here\u0007" })],
      dealer,
      new Date("2026-10-19T20:00:00Z"),
    );
    expect(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(x).toContain("<title>A &amp; B &lt;C&gt;</title>");
    expect(x).toContain("]]]]><![CDATA[>");
    expect(x).not.toContain("\u0007");
    expect(x).toContain('<photo position="1">https://app/x/1</photo>');
    expect(x).toContain('<video kind="youtube">https://youtu.be/abc</video>');
    expect(x).toContain("<status>available</status>");
  });

  it("CSV has a fixed header, quotes awkward cells, pipes photo URLs", () => {
    const c = renderCsv([listing()], dealer);
    const [header, row] = c.split("\r\n");
    expect(header).toBe(CSV_COLUMNS.join(","));
    expect(row).toContain('"Says ""hello"", then\na newline"');
    expect(row).toContain("https://app/x/1|https://app/x/2");
    expect(row).toContain("https://youtu.be/abc");
    expect(c.endsWith("\r\n")).toBe(true);
  });
});

describe("publish readiness", () => {
  const base = {
    listing: { title: "1967 Corvette", description: "x".repeat(60), highlights: ["a", "b", "c"], priceDisplay: "SHOW" as const },
    askingPrice: 89900,
    photoCount: 40,
    videoCount: 1,
    hasVin: true,
    mileageStatus: "EXEMPT",
  };
  it("passes when the required items are there", () => {
    expect(checkListing(base).canPublish).toBe(true);
  });
  it("needs photos, an overview and a price — call-for-price counts", () => {
    expect(checkListing({ ...base, photoCount: 0 }).canPublish).toBe(false);
    expect(checkListing({ ...base, listing: { ...base.listing, description: "short" } }).canPublish).toBe(false);
    expect(checkListing({ ...base, askingPrice: null }).canPublish).toBe(false);
    expect(checkListing({ ...base, askingPrice: null, listing: { ...base.listing, priceDisplay: "CALL_FOR_PRICE" } }).canPublish).toBe(true);
  });
  it("recommendations never block", () => {
    const r = checkListing({ ...base, photoCount: 5, videoCount: 0, hasVin: false, mileageStatus: "UNKNOWN", listing: { ...base.listing, highlights: [] } });
    expect(r.canPublish).toBe(true);
    expect(r.checks.filter((c) => !c.ok).every((c) => !c.required)).toBe(true);
  });
});
