/**
 * The DEMONSTRATION stand-in served while a template has no approved copy
 * loaded. Watermarked on its face; never sent through a live provider.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export async function renderDemoPdf(input: {
  templateName: string;
  stockNumber: string;
  vehicle: string;
  buyerName?: string;
  agreedPrice?: number | null;
  dealType: string;
}): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Watermark
  page.drawText("DEMONSTRATION — NOT AN APPROVED LEGAL DOCUMENT", {
    x: 40,
    y: 380,
    size: 22,
    font: bold,
    color: rgb(0.85, 0.2, 0.2),
    rotate: degrees(30),
    opacity: 0.35,
  });

  page.drawText("Gold Country Classic Cars — Vehicle Operations", { x: 50, y: 740, size: 10, font, color: rgb(0.4, 0.35, 0.25) });
  page.drawText(input.templateName, { x: 50, y: 705, size: 20, font: bold, color: rgb(0.11, 0.11, 0.1) });

  const lines = [
    `Stock number: ${input.stockNumber}`,
    `Vehicle: ${input.vehicle}`,
    `Deal type: ${input.dealType === "CONSIGNMENT" ? "Consignment" : "Dealer-owned"}`,
    input.buyerName ? `Buyer: ${input.buyerName}` : null,
    input.agreedPrice != null ? `Agreed price: $${input.agreedPrice.toLocaleString()}` : null,
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "This demonstration document shows the generation, versioning, signature",
    "and filing workflow. Replace with the dealership's legally reviewed",
    "template before any real use (see SALES_DOCUMENT_SETUP.md).",
  ].filter((l): l is string => l !== null);

  let y = 660;
  for (const line of lines) {
    page.drawText(line, { x: 50, y, size: 12, font, color: rgb(0.15, 0.15, 0.14) });
    y -= 22;
  }
  page.drawText("Signature: ____________________________    Date: ____________", { x: 50, y: 120, size: 12, font });

  return Buffer.from(await pdf.save());
}
