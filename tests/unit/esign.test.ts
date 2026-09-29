/**
 * The e-signature building blocks that don't touch the database: webhook
 * signature checks, the BoldSign request shape (against a fake server — the
 * build container can't reach BoldSign), signature-box placement, pre-fill.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  BoldSignProvider,
  boldSignState,
  SigningProviderError,
  verifyBoldSignSignature,
  type PacketRequest,
} from "@/lib/adapters/signing";
import { buildPacket, PacketError, toTopLeftBox } from "@/modules/esign/packet";
import { applyPrefill, prefillValues, restockingFee, type PrefillInput } from "@/modules/esign/prefill";

// ---------------------------------------------------------------------------

describe("BoldSign webhook signatures", () => {
  const secret = "whsec_test";
  const body = '{"event":{"eventType":"Signed"},"data":{"object":"document","documentId":"d1"}}';
  const now = 1_790_700_000;
  const sig = (t: number, b = body, key = secret, enc: "hex" | "base64" = "hex") =>
    createHmac("sha256", key).update(`${t}.${b}`).digest(enc);

  it("accepts a correct hex or base64 signature", () => {
    expect(verifyBoldSignSignature(body, `t=${now}, s0=${sig(now)}`, secret, now)).toBe(true);
    expect(verifyBoldSignSignature(body, `t=${now}, s0=${sig(now, body, secret, "base64")}`, secret, now)).toBe(true);
  });

  it("accepts the old secret's signature in s1 while a secret is being rolled", () => {
    expect(verifyBoldSignSignature(body, `t=${now}, s0=${sig(now, body, "other")}, s1=${sig(now)}`, secret, now)).toBe(true);
  });

  it("rejects a changed body, a wrong secret, a stale timestamp, and a missing header", () => {
    expect(verifyBoldSignSignature(body.replace("d1", "d2"), `t=${now}, s0=${sig(now)}`, secret, now)).toBe(false);
    expect(verifyBoldSignSignature(body, `t=${now}, s0=${sig(now, body, "wrong")}`, secret, now)).toBe(false);
    expect(verifyBoldSignSignature(body, `t=${now - 600}, s0=${sig(now - 600)}`, secret, now)).toBe(false);
    expect(verifyBoldSignSignature(body, null, secret, now)).toBe(false);
    expect(verifyBoldSignSignature(body, `t=${now}, s0=${sig(now)}`, "", now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

function fakeFetch(responses: Array<{ status: number; body?: unknown; binary?: Buffer }>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const r = responses.shift() ?? { status: 500, body: { error: "unexpected call" } };
    if (r.binary) return new Response(new Uint8Array(r.binary), { status: r.status });
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fn, calls };
}

const request: PacketRequest = {
  title: "GC-1 — sale documents",
  message: "Please sign",
  fileName: "x.pdf",
  pdf: Buffer.from("%PDF-1.4 test"),
  metadata: { saleId: "s1" },
  signers: [
    {
      role: "BUYER",
      name: "Pat Buyer",
      email: "pat@example.com",
      order: 1,
      fields: [{ type: "Signature", page: 6, x: 64.6, y: 565.3, width: 264, height: 28 }],
    },
    {
      role: "DEALER",
      name: "Jade",
      email: "jade@example.com",
      order: 2,
      fields: [{ type: "DateSigned", page: 7, x: 377.65, y: 50.59, width: 120, height: 18 }],
    },
  ],
};

describe("the BoldSign client", () => {
  it("sends one envelope with the key header, signing order, and each signer's boxes", async () => {
    const { fn, calls } = fakeFetch([{ status: 201, body: { documentId: "doc-123" } }]);
    const p = new BoldSignProvider("key-abc", "https://api.boldsign.com", fn);
    await expect(p.send(request)).resolves.toEqual({ externalId: "doc-123" });

    expect(calls[0]!.url).toBe("https://api.boldsign.com/v1/document/send");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["X-API-KEY"]).toBe("key-abc");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.enableSigningOrder).toBe(true);
    expect(body.files[0]).toMatch(/^data:application\/pdf;base64,/);
    expect(body.metaData).toEqual({ saleId: "s1" });
    expect(body.signers).toHaveLength(2);
    expect(body.signers[0]).toMatchObject({ name: "Pat Buyer", emailAddress: "pat@example.com", signerOrder: 1, signerType: "Signer" });
    expect(body.signers[0].formFields[0]).toMatchObject({
      fieldType: "Signature",
      pageNumber: 6,
      isRequired: true,
      bounds: { x: 64.6, y: 565.3, width: 264, height: 28 },
    });
    expect(body.signers[1].signerOrder).toBe(2);
  });

  it("explains a rejected key without echoing it", async () => {
    const { fn } = fakeFetch([{ status: 401, body: { error: "Unauthorized" } }]);
    const p = new BoldSignProvider("secret-key-value", "https://api.boldsign.com", fn);
    const err = await p.send(request).catch((e) => e);
    expect(err).toBeInstanceOf(SigningProviderError);
    expect(err.message).toMatch(/API key/);
    expect(err.message).not.toContain("secret-key-value");
  });

  it("passes BoldSign's validation message through", async () => {
    const { fn } = fakeFetch([{ status: 400, body: { errors: { "Signers[0].EmailAddress": ["Invalid email address."] } } }]);
    const p = new BoldSignProvider("k", "https://api.boldsign.com", fn);
    await expect(p.send(request)).rejects.toThrow(/Invalid email address/);
  });

  it("reads status per signer and maps BoldSign's words", async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: {
          status: "InProgress",
          signerDetails: [
            { signerEmail: "Pat@Example.com", status: "Completed" },
            { signerEmail: "jade@example.com", status: "NotCompleted" },
          ],
        },
      },
    ]);
    const p = new BoldSignProvider("k", "https://api.boldsign.com", fn);
    const st = await p.status("doc-123");
    expect(calls[0]!.url).toBe("https://api.boldsign.com/v1/document/properties?documentId=doc-123");
    expect(st.state).toBe("in_progress");
    expect(st.signers).toEqual([
      { email: "pat@example.com", signed: true, declined: false },
      { email: "jade@example.com", signed: false, declined: false },
    ]);
    expect(boldSignState("Completed")).toBe("completed");
    expect(boldSignState("Revoked")).toBe("revoked");
    expect(boldSignState("WaitingForOthers")).toBe("in_progress");
  });

  it("downloads the signed file and audit trail, and revokes", async () => {
    const { fn, calls } = fakeFetch([
      { status: 200, binary: Buffer.from("%PDF signed") },
      { status: 200, binary: Buffer.from("%PDF trail") },
      { status: 204 },
    ]);
    const p = new BoldSignProvider("k", "https://api.boldsign.com", fn);
    expect((await p.downloadSigned("d")).toString()).toBe("%PDF signed");
    expect((await p.downloadAuditTrail("d")).toString()).toBe("%PDF trail");
    await p.revoke("d", "Fixing the price");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.boldsign.com/v1/document/download?documentId=d",
      "https://api.boldsign.com/v1/document/downloadAuditLog?documentId=d",
      "https://api.boldsign.com/v1/document/revoke?documentId=d",
    ]);
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({ message: "Fixing the price" });
  });
});

// ---------------------------------------------------------------------------

/** A two-page fillable PDF laid out like the dealership's forms. */
async function formPdf(fields: Array<{ name: string; page: number; x: number; y: number; w?: number; h?: number; value?: string }>) {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  pdf.addPage([612, 792]);
  const form = pdf.getForm();
  for (const f of fields) {
    const tf = form.createTextField(f.name);
    if (f.value) tf.setText(f.value);
    tf.addToPage(pdf.getPage(f.page - 1), { x: f.x, y: f.y, width: f.w ?? 200, height: f.h ?? 17 });
  }
  return Buffer.from(await pdf.save());
}

describe("placing signature boxes", () => {
  it("converts a field's rectangle to a top-left box whose bottom stays on the line", () => {
    const box = toTopLeftBox({ x: 64, y: 198, width: 264, height: 17 }, 792, "Signature");
    expect(box).toEqual({ x: 64, y: 792 - 198 - 28, width: 264, height: 28 });
  });

  it("finds SIG/DATE/INIT fields, offsets pages across documents, and flattens", async () => {
    const agreement = await formPdf([
      { name: "buyer.name", page: 1, x: 100, y: 700, value: "Pat Buyer" },
      { name: "INIT_BUYER", page: 1, x: 130, y: 440, w: 36 },
      { name: "SIG_BUYER", page: 2, x: 64, y: 198, w: 264 },
      { name: "DATE_BUYER", page: 2, x: 360, y: 198, w: 120 },
      { name: "SIG_COBUYER", page: 2, x: 64, y: 122, w: 264 },
      { name: "SIG_DEALER", page: 2, x: 81, y: 60, w: 264 },
      { name: "dealer.printedName", page: 2, x: 81, y: 30 },
    ]);
    const disclosure = await formPdf([{ name: "SIG_BUYER", page: 2, x: 64, y: 300, w: 264 }]);

    const packet = await buildPacket(
      [
        { title: "Agreement", bytes: agreement, contentType: "application/pdf", signers: ["BUYER", "DEALER"], lateValues: { "dealer.printedName": "Jade" } },
        { title: "3-Day", bytes: disclosure, contentType: "application/pdf", signers: ["BUYER"] },
      ],
      new Set(["BUYER", "DEALER"]), // no co-buyer on this deal
    );

    expect(packet.pageCount).toBe(4);
    expect(packet.fields.CO_BUYER).toEqual([]); // the co-buyer line is left blank, not assigned
    expect(packet.fields.BUYER.map((f) => `${f.type}@${f.page}`).sort()).toEqual(
      ["Initial@1", "Signature@2", "DateSigned@2", "Signature@4"].sort(),
    );
    expect(packet.fields.DEALER.map((f) => `${f.type}@${f.page}`)).toEqual(["Signature@2"]);

    const out = await PDFDocument.load(packet.pdf);
    expect(out.getForm().getFields()).toHaveLength(0); // flattened: nothing editable in the signing screen
  });

  it("appends a signature page to a document that has no signature fields", async () => {
    const bare = await PDFDocument.create();
    bare.addPage([612, 792]);
    const packet = await buildPacket(
      [{ title: "Demo doc", bytes: Buffer.from(await bare.save()), contentType: "application/pdf", signers: ["BUYER", "DEALER"] }],
      new Set(["BUYER", "DEALER"]),
    );
    expect(packet.pageCount).toBe(2);
    expect(packet.fields.BUYER.every((f) => f.page === 2)).toBe(true);
    expect(packet.fields.DEALER.map((f) => f.type).sort()).toEqual(["DateSigned", "Signature"]);
  });

  it("refuses a Word file and an unreadable PDF with words staff can act on", async () => {
    await expect(
      buildPacket([{ title: "PA", bytes: Buffer.from("PK.."), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signers: ["BUYER"] }], new Set(["BUYER"])),
    ).rejects.toThrow(/Word file/);
    await expect(
      buildPacket([{ title: "PA", bytes: Buffer.from("not a pdf"), contentType: "application/pdf", signers: ["BUYER"] }], new Set(["BUYER"])),
    ).rejects.toThrow(PacketError);
  });
});

// ---------------------------------------------------------------------------

const base: PrefillInput = {
  saleId: "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90",
  saleDay: "2026-10-05",
  agreedPrice: 38500,
  salesTax: 3176.25,
  odometer: 54321,
  stockNumber: "GC-1042",
  salesperson: "Rose",
  isMotorcycle: false,
  vehicle: { year: 1969, make: "Ford", model: "Mustang", trim: "Mach 1", bodyStyle: null, exteriorColor: "Candyapple Red", interiorColor: null, engine: null, vin: "9F02R123456" },
  buyer: { displayName: "Pat Buyer", email: "pat@example.com", phone: "530-555-0100", addressLine1: "1 Main St", addressLine2: null, city: "Nevada City", state: "CA", postalCode: "95959" },
  coBuyer: null,
};

describe("pre-filling the dealership's forms", () => {
  it("computes the restocking fee within the statute's $200–$600 band", () => {
    expect(restockingFee(10000)).toBe(200);
    expect(restockingFee(20000)).toBe(300);
    expect(restockingFee(50000)).toBe(600);
  });

  it("fills buyer, vehicle, price and the 3-day dates for a qualifying sale", () => {
    const v = prefillValues(base);
    expect(v).toMatchObject({
      "sale.date": "10/05/2026",
      "sale.agreementNo": "3F2A9C1E",
      "vehicle.stockNumber": "GC-1042",
      "buyer.name": "Pat Buyer",
      "buyer.zip": "95959",
      "vehicle.model": "Mustang Mach 1",
      "vehicle.vin": "9F02R123456",
      "vehicle.odometer": "54,321",
      "price.cashPrice": "38,500.00",
      "price.salesTax": "3,176.25",
      "cancel3.lastDay": "10/08/2026 by close of business",
      "cancel3.restockingFee": "577.50",
    });
    expect(v["cobuyer.name"]).toBeUndefined();
    expect(v["vehicle.bodyStyle"]).toBeUndefined(); // empty values are dropped, not written as blanks
  });

  it("leaves the 3-day fields out over $50,000, for a motorcycle, and before Oct 1", () => {
    expect(prefillValues({ ...base, agreedPrice: 65000 })["cancel3.lastDay"]).toBeUndefined();
    expect(prefillValues({ ...base, isMotorcycle: true })["cancel3.lastDay"]).toBeUndefined();
    expect(prefillValues({ ...base, saleDay: "2026-09-28" })["cancel3.lastDay"]).toBeUndefined();
  });

  it("writes only into empty fields and keeps the form fillable", async () => {
    const pdf = await formPdf([
      { name: "buyer.name", page: 1, x: 100, y: 700 },
      { name: "vehicle.vin", page: 1, x: 100, y: 650, value: "TYPED-BY-STAFF" },
      { name: "price.docFee", page: 1, x: 100, y: 600 },
    ]);
    const out = await applyPrefill(pdf, prefillValues(base), true);
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField("buyer.name").getText()).toBe("Pat Buyer");
    expect(form.getTextField("vehicle.vin").getText()).toBe("TYPED-BY-STAFF");
    expect(form.getTextField("price.docFee").getText() ?? "").toBe("");
    expect(form.getFields()).toHaveLength(3);
  });

  it("returns a PDF without a form untouched", async () => {
    const bare = await PDFDocument.create();
    bare.addPage();
    const bytes = Buffer.from(await bare.save());
    expect(await applyPrefill(bytes, prefillValues(base), true)).toBe(bytes);
  });
});
