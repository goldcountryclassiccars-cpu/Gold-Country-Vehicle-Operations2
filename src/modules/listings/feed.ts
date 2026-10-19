/**
 * Listing feeds — pure functions, no database.
 *
 * One shape (FeedListing) rendered three ways: JSON for our own website, XML
 * and CSV for the marketplaces. Dealer listing sites ingest inventory as a
 * file they fetch on a schedule; each one maps columns a little differently,
 * so the field names here are plain and complete rather than tuned to any
 * one site, and the CSV is the format a platform's onboarding team can map
 * without a developer on either side.
 */

export type Availability = "available" | "pending" | "sold";

export interface FeedPhoto {
  url: string;
  thumbUrl: string;
  caption: string | null;
  position: number; // 1 = cover
}

export interface FeedVideo {
  url: string;
  kind: "youtube" | "vimeo" | "link" | "file";
  label: string | null;
}

export interface FeedListing {
  id: string; // listing id — stable for the life of the listing
  stockNumber: string;
  vin: string | null;
  year: number | null;
  make: string;
  model: string;
  trim: string | null;
  bodyStyle: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  mileage: number | null;
  mileageNote: string | null; // "Exempt", "Not actual", … — what the odometer figure means
  price: number | null; // null when "call for price"
  priceLabel: string; // "$79,900" or "Call for price"
  availability: Availability;
  title: string;
  headline: string | null;
  highlights: string[];
  sections: { heading: string; body: string }[];
  descriptionText: string;
  descriptionHtml: string;
  photos: FeedPhoto[];
  videos: FeedVideo[];
  updatedAt: string; // ISO
  version: number;
}

export interface FeedDealer {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  website: string;
  dealerLicense: string;
}

export const DEALER_PHONE = "(530) 955-0404";

export const DEALER: Omit<FeedDealer, "phone"> = {
  name: "Gold Country Classic Cars",
  address: "422 Henderson Street",
  city: "Grass Valley",
  state: "CA",
  zip: "95945",
  website: "https://www.goldcountryclassiccars.com",
  dealerLicense: "44497",
};

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export function availabilityFor(salesStatus: string, active: boolean): Availability {
  if (!active) return "sold";
  if (["CONTRACTED", "FUNDS_PENDING", "FUNDED", "READY_FOR_RELEASE", "RELEASED", "DELIVERED"].includes(salesStatus)) {
    return "sold";
  }
  if (["HOLD", "DEPOSIT_REQUESTED", "DEPOSIT_RECEIVED"].includes(salesStatus)) return "pending";
  return "available"; // AVAILABLE, INQUIRY_ACTIVITY, and a CANCELED/UNWOUND deal puts it back
}

export function mileageNoteFor(status: string): string | null {
  switch (status) {
    case "EXEMPT":
      return "Exempt";
    case "NOT_ACTUAL":
      return "Not actual mileage";
    case "TMU":
      return "True mileage unknown";
    case "BROKEN_ODOMETER":
      return "Odometer inoperative";
    default:
      return null;
  }
}

export function videoKind(url: string): FeedVideo["kind"] {
  try {
    const host = new URL(url).host.replace(/^www\./, "");
    if (host === "youtu.be" || host.endsWith("youtube.com")) return "youtube";
    if (host.endsWith("vimeo.com")) return "vimeo";
  } catch {
    /* fall through */
  }
  return "link";
}

export function formatPrice(price: number | null, callForPrice: boolean): string {
  if (callForPrice || price == null) return "Call for price";
  return `$${Math.round(price).toLocaleString("en-US")}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function paragraphsHtml(body: string): string {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** The full write-up as plain text and as simple HTML — what a "description" field on a platform takes. */
export function composeDescription(input: {
  headline: string | null;
  highlights: string[];
  sections: { heading: string; body: string }[];
}): { text: string; html: string } {
  const text: string[] = [];
  const html: string[] = [];
  if (input.headline) {
    text.push(input.headline);
    html.push(`<p><strong>${escapeHtml(input.headline)}</strong></p>`);
  }
  if (input.highlights.length) {
    text.push(["Highlights:", ...input.highlights.map((h) => `• ${h}`)].join("\n"));
    html.push(`<h3>Highlights</h3><ul>${input.highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`);
  }
  for (const s of input.sections) {
    // The overview reads as the opening, not under its own heading.
    if (s.heading === "Overview") {
      text.push(s.body.trim());
      html.push(paragraphsHtml(s.body));
    } else {
      text.push(`${s.heading}:\n${s.body.trim()}`);
      html.push(`<h3>${escapeHtml(s.heading)}</h3>${paragraphsHtml(s.body)}`);
    }
  }
  return { text: text.join("\n\n"), html: html.join("") };
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

export function renderJson(listings: FeedListing[], dealer: FeedDealer, generatedAt: Date) {
  return {
    generatedAt: generatedAt.toISOString(),
    dealer,
    count: listings.length,
    listings,
  };
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Characters XML 1.0 cannot carry at all (stray control codes pasted from Word).
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** Text for a CDATA block: no control characters, and a literal "]]>" split so it cannot end the block. */
function cdata(s: string): string {
  return `<![CDATA[${s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function el(name: string, value: string | number | null | undefined, indent = "    "): string {
  if (value == null || value === "") return `${indent}<${name}/>`;
  return `${indent}<${name}>${xmlEscape(String(value))}</${name}>`;
}

export function renderXml(listings: FeedListing[], dealer: FeedDealer, generatedAt: Date): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  out.push(`<inventory generated="${generatedAt.toISOString()}" count="${listings.length}">`);
  out.push("  <dealer>");
  out.push(el("name", dealer.name));
  out.push(el("address", dealer.address));
  out.push(el("city", dealer.city));
  out.push(el("state", dealer.state));
  out.push(el("zip", dealer.zip));
  out.push(el("phone", dealer.phone));
  out.push(el("website", dealer.website));
  out.push(el("dealerLicense", dealer.dealerLicense));
  out.push("  </dealer>");
  for (const l of listings) {
    out.push(`  <vehicle id="${xmlEscape(l.id)}">`);
    out.push(el("stockNumber", l.stockNumber));
    out.push(el("vin", l.vin));
    out.push(el("year", l.year));
    out.push(el("make", l.make));
    out.push(el("model", l.model));
    out.push(el("trim", l.trim));
    out.push(el("bodyStyle", l.bodyStyle));
    out.push(el("exteriorColor", l.exteriorColor));
    out.push(el("interiorColor", l.interiorColor));
    out.push(el("engine", l.engine));
    out.push(el("transmission", l.transmission));
    out.push(el("drivetrain", l.drivetrain));
    out.push(el("mileage", l.mileage));
    out.push(el("mileageNote", l.mileageNote));
    out.push(el("price", l.price));
    out.push(el("priceLabel", l.priceLabel));
    out.push(el("status", l.availability));
    out.push(el("title", l.title));
    out.push(el("headline", l.headline));
    out.push(`    <description>${cdata(l.descriptionText)}</description>`);
    out.push(`    <descriptionHtml>${cdata(l.descriptionHtml)}</descriptionHtml>`);
    out.push("    <photos>");
    for (const p of l.photos) out.push(`      <photo position="${p.position}">${xmlEscape(p.url)}</photo>`);
    out.push("    </photos>");
    out.push("    <videos>");
    for (const v of l.videos) out.push(`      <video kind="${v.kind}">${xmlEscape(v.url)}</video>`);
    out.push("    </videos>");
    out.push(el("updated", l.updatedAt));
    out.push("  </vehicle>");
  }
  out.push("</inventory>");
  return out.join("\n");
}

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  "StockNumber",
  "VIN",
  "Year",
  "Make",
  "Model",
  "Trim",
  "BodyStyle",
  "ExteriorColor",
  "InteriorColor",
  "Engine",
  "Transmission",
  "Drivetrain",
  "Mileage",
  "MileageNote",
  "Price",
  "Status",
  "Title",
  "Description",
  "PhotoURLs",
  "VideoURL",
  "DealerName",
  "DealerCity",
  "DealerState",
  "DealerZip",
  "DealerPhone",
  "Updated",
] as const;

/** One row per car; photo URLs pipe-separated in cover-first order (the usual dealer-feed convention). */
export function renderCsv(listings: FeedListing[], dealer: FeedDealer): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const l of listings) {
    rows.push(
      [
        l.stockNumber,
        l.vin,
        l.year,
        l.make,
        l.model,
        l.trim,
        l.bodyStyle,
        l.exteriorColor,
        l.interiorColor,
        l.engine,
        l.transmission,
        l.drivetrain,
        l.mileage,
        l.mileageNote,
        l.price,
        l.availability,
        l.title,
        l.descriptionText,
        l.photos.map((p) => p.url).join("|"),
        l.videos.find((v) => v.kind === "youtube")?.url ?? l.videos[0]?.url ?? null,
        dealer.name,
        dealer.city,
        dealer.state,
        dealer.zip,
        dealer.phone,
        l.updatedAt,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return rows.join("\r\n") + "\r\n";
}
