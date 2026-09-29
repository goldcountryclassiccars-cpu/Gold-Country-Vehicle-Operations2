/**
 * Builds the one PDF a deal's signers receive, and works out where each of
 * them signs.
 *
 * Signature boxes come from named form fields in the dealership's own PDFs —
 * the convention (see SALES_DOCUMENT_SETUP.md):
 *
 *   SIG_BUYER · SIG_COBUYER · SIG_DEALER     a signature line
 *   DATE_BUYER · DATE_COBUYER · DATE_DEALER  the date beside it (auto-filled at signing)
 *   INIT_BUYER · INIT_BUYER_2 · …            an initials box
 *
 * A trailing `_2`, `_3` allows more than one of a kind. A document with no
 * such fields (the demonstration stand-ins, or a PDF built without them) gets
 * a plain signature page appended, so nothing goes out without a place to sign.
 *
 * Every form is flattened before sending: the values staff filled in become
 * part of the page and the buyer cannot edit a price in the signing screen.
 */
import { PDFArray, PDFDocument, PDFName, StandardFonts, rgb, type PDFPage } from "pdf-lib";
import type { FieldType, PlacedField, SignerRole } from "@/lib/adapters/signing";

export class PacketError extends Error {}

export interface PacketDocument {
  /** Shown on an appended signature page. */
  title: string;
  bytes: Buffer;
  contentType: string;
  /** Who signs this document, from the registry (co-buyer only when there is one). */
  signers: SignerRole[];
  /** Filled into empty fields just before flattening, e.g. the dealer signer's printed name. */
  lateValues?: Record<string, string>;
}

export interface Packet {
  pdf: Buffer;
  pageCount: number;
  fields: Record<SignerRole, PlacedField[]>;
}

const FIELD_NAME = /^(SIG|DATE|INIT)_(BUYER|COBUYER|CO_BUYER|DEALER)(?:_\d+)?$/;

const TYPE_OF: Record<string, FieldType> = { SIG: "Signature", DATE: "DateSigned", INIT: "Initial" };

/** Minimum box sizes a signer can comfortably use on a phone. */
const MIN_HEIGHT: Record<FieldType, number> = { Signature: 28, DateSigned: 18, Initial: 24 };
const MIN_WIDTH: Record<FieldType, number> = { Signature: 120, DateSigned: 70, Initial: 40 };

function roleOf(token: string): SignerRole {
  return token === "DEALER" ? "DEALER" : token === "BUYER" ? "BUYER" : "CO_BUYER";
}

/**
 * Converts a widget rectangle (PDF points, bottom-left origin) to a provider
 * box (top-left origin), grown to a usable size while keeping its bottom edge
 * on the printed signature line.
 */
export function toTopLeftBox(
  rect: { x: number; y: number; width: number; height: number },
  pageHeight: number,
  type: FieldType,
): Omit<PlacedField, "page" | "type"> {
  const height = Math.max(rect.height, MIN_HEIGHT[type]);
  const width = Math.max(rect.width, MIN_WIDTH[type]);
  const bottomFromTop = pageHeight - rect.y;
  return { x: rect.x, y: Math.max(0, bottomFromTop - height), width, height };
}

function pageIndexOfWidget(pdf: PDFDocument, pages: PDFPage[], widgetDict: unknown): number {
  const ref = pdf.context.getObjectRef(widgetDict as never);
  if (!ref) return -1;
  return pages.findIndex((p) => {
    const annots = p.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) return false;
    for (let i = 0; i < annots.size(); i++) {
      if (annots.get(i).toString() === ref.toString()) return true;
    }
    return false;
  });
}

/** Signature/date/initials boxes named by the convention, per role, pages from 1. */
export function findSignatureFields(pdf: PDFDocument): { role: SignerRole; field: PlacedField }[] {
  const pages = pdf.getPages();
  const out: { role: SignerRole; field: PlacedField }[] = [];
  let fields;
  try {
    fields = pdf.getForm().getFields();
  } catch {
    return out;
  }
  for (const f of fields) {
    const m = FIELD_NAME.exec(f.getName());
    if (!m) continue;
    const type = TYPE_OF[m[1]!]!;
    const role = roleOf(m[2]!);
    for (const w of f.acroField.getWidgets()) {
      const idx = pageIndexOfWidget(pdf, pages, w.dict);
      if (idx < 0) continue;
      const box = toTopLeftBox(w.getRectangle(), pages[idx]!.getHeight(), type);
      out.push({ role, field: { type, page: idx + 1, ...box } });
    }
  }
  return out;
}

const ROLE_LABEL: Record<SignerRole, string> = { BUYER: "Buyer", CO_BUYER: "Co-Buyer", DEALER: "Dealer" };

/** A plain page with a signature and date line per role, for documents that have none. */
async function appendSignaturePage(pdf: PDFDocument, title: string, roles: SignerRole[]) {
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Signature page", { x: 54, y: 730, size: 18, font: bold, color: rgb(0.1, 0.1, 0.1) });
  page.drawText(`for: ${title}`.slice(0, 90), { x: 54, y: 708, size: 11, font, color: rgb(0.25, 0.25, 0.25) });
  const found: { role: SignerRole; field: PlacedField }[] = [];
  let y = 640;
  for (const role of roles) {
    page.drawText(ROLE_LABEL[role], { x: 54, y: y + 34, size: 11, font: bold });
    page.drawLine({ start: { x: 54, y }, end: { x: 330, y }, thickness: 0.8 });
    page.drawText("Signature", { x: 54, y: y - 12, size: 8, font });
    page.drawLine({ start: { x: 370, y }, end: { x: 520, y }, thickness: 0.8 });
    page.drawText("Date", { x: 370, y: y - 12, size: 8, font });
    const pageNo = pdf.getPageCount();
    found.push({ role, field: { type: "Signature", page: pageNo, ...toTopLeftBox({ x: 54, y, width: 276, height: 20 }, 792, "Signature") } });
    found.push({ role, field: { type: "DateSigned", page: pageNo, ...toTopLeftBox({ x: 370, y, width: 150, height: 18 }, 792, "DateSigned") } });
    y -= 110;
  }
  return found;
}

/**
 * Merges the documents in order into one flattened PDF and returns each
 * signer's boxes on it. `roles` is who is actually signing this envelope: a
 * co-buyer line on a deal with no co-buyer is left blank, not assigned.
 */
export async function buildPacket(docs: PacketDocument[], roles: Set<SignerRole>): Promise<Packet> {
  if (docs.length === 0) throw new PacketError("There are no documents to send.");
  const merged = await PDFDocument.create();
  const fields: Record<SignerRole, PlacedField[]> = { BUYER: [], CO_BUYER: [], DEALER: [] };

  for (const doc of docs) {
    if (doc.contentType !== "application/pdf") {
      throw new PacketError(
        `"${doc.title}" is a Word file. E-signature needs the PDF version — load the approved copy as a PDF, or upload a filled-in PDF on the checklist.`,
      );
    }
    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(doc.bytes);
    } catch {
      throw new PacketError(`"${doc.title}" couldn't be read as a PDF. Re-upload it and try again.`);
    }

    const all = findSignatureFields(pdf);
    let found = all.filter((f) => roles.has(f.role));

    // Late values (the dealer's printed name) go into still-empty text fields.
    if (doc.lateValues) {
      const form = pdf.getForm();
      for (const [name, value] of Object.entries(doc.lateValues)) {
        try {
          const tf = form.getTextField(name);
          if (!tf.getText()) tf.setText(value);
        } catch {
          /* the document doesn't have that field */
        }
      }
    }
    try {
      pdf.getForm().flatten();
    } catch {
      throw new PacketError(`"${doc.title}" has a form that couldn't be flattened. Save it again as a PDF and re-upload it.`);
    }

    // A document that names its own signature lines is trusted as drawn — it
    // decides who signs it. Only a document with none at all gets a signature
    // page, for the signers the registry lists.
    if (all.length === 0) {
      const wanted = doc.signers.filter((r) => roles.has(r));
      found = found.concat(await appendSignaturePage(pdf, doc.title, wanted));
    }

    const offset = merged.getPageCount();
    const copied = await merged.copyPages(pdf, pdf.getPageIndices());
    copied.forEach((p) => merged.addPage(p));
    for (const f of found) fields[f.role].push({ ...f.field, page: f.field.page + offset });
  }

  const pdf = Buffer.from(await merged.save());
  return { pdf, pageCount: merged.getPageCount(), fields };
}
