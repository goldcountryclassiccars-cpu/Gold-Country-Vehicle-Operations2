/**
 * Packet e-signature providers: one envelope per deal, holding every
 * e-signable document merged into one PDF, with signature boxes placed for
 * each signer.
 *
 * Two implementations:
 *   - MockSigningProvider: offline and deterministic (development and tests).
 *   - BoldSignProvider: https://developers.boldsign.com — selected with
 *     ESIGN_ADAPTER="boldsign" and BOLDSIGN_API_KEY.
 *
 * The provider's own status is the source of truth. A webhook only tells the
 * app to go and re-read it (see modules/esign/service.ts), so a forged or
 * replayed webhook body can never mark a document signed by itself.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";

export type SignerRole = "BUYER" | "CO_BUYER" | "DEALER";

export type FieldType = "Signature" | "DateSigned" | "Initial";

/** A box on the merged packet. Points, origin at the page's TOP-left, pages from 1. */
export interface PlacedField {
  type: FieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PacketSigner {
  role: SignerRole;
  name: string;
  email: string;
  /** Signing order: buyers sign first (1), the dealer countersigns (2). */
  order: number;
  fields: PlacedField[];
}

export interface PacketRequest {
  title: string;
  message: string;
  fileName: string;
  pdf: Buffer;
  signers: PacketSigner[];
  /** Round-trips to the provider so an envelope can be traced to its deal. */
  metadata: Record<string, string>;
}

export type EnvelopeState = "in_progress" | "completed" | "declined" | "revoked" | "expired";

export interface ProviderStatus {
  state: EnvelopeState;
  signers: { email: string; signed: boolean; declined: boolean }[];
}

export interface SigningProvider {
  readonly name: "mock" | "boldsign";
  send(req: PacketRequest): Promise<{ externalId: string }>;
  status(externalId: string): Promise<ProviderStatus>;
  downloadSigned(externalId: string): Promise<Buffer>;
  downloadAuditTrail(externalId: string): Promise<Buffer>;
  revoke(externalId: string, reason: string): Promise<void>;
}

/** A provider refused or could not be reached. `message` is safe to show staff. */
export class SigningProviderError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

/**
 * Offline stand-in. Nothing leaves the building: envelopes live in memory and
 * move only when a test (or a developer) calls `simulateSigned` / `simulate`.
 */
export class MockSigningProvider implements SigningProvider {
  readonly name = "mock" as const;
  readonly sent: PacketRequest[] = [];
  private envelopes = new Map<string, { req: PacketRequest; state: EnvelopeState; signed: Set<string> }>();

  async send(req: PacketRequest) {
    const externalId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sent.push(req);
    this.envelopes.set(externalId, { req, state: "in_progress", signed: new Set() });
    return { externalId };
  }

  async status(externalId: string): Promise<ProviderStatus> {
    const env = this.envelopes.get(externalId);
    if (!env) throw new SigningProviderError("That signature request no longer exists at the provider.", 404);
    return {
      state: env.state,
      signers: env.req.signers.map((s) => ({
        email: s.email,
        signed: env.signed.has(s.email.toLowerCase()),
        declined: env.state === "declined",
      })),
    };
  }

  /** Test helper: one signer finishes. The envelope completes when all have. */
  simulateSigned(externalId: string, email: string) {
    const env = this.envelopes.get(externalId);
    if (!env) throw new Error(`no mock envelope ${externalId}`);
    env.signed.add(email.toLowerCase());
    if (env.req.signers.every((s) => env.signed.has(s.email.toLowerCase()))) env.state = "completed";
  }

  /** Test helper: force a terminal state. */
  simulate(externalId: string, state: EnvelopeState) {
    const env = this.envelopes.get(externalId);
    if (!env) throw new Error(`no mock envelope ${externalId}`);
    env.state = state;
  }

  async downloadSigned(externalId: string) {
    return Buffer.from(`%PDF-1.4\n% MOCK SIGNED PACKET ${externalId} — DEMONSTRATION ONLY\n`);
  }

  async downloadAuditTrail(externalId: string) {
    return Buffer.from(`%PDF-1.4\n% MOCK AUDIT TRAIL ${externalId} — DEMONSTRATION ONLY\n`);
  }

  async revoke(externalId: string, _reason: string) {
    const env = this.envelopes.get(externalId);
    if (env) env.state = "revoked";
  }
}

// ---------------------------------------------------------------------------
// BoldSign
// ---------------------------------------------------------------------------

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * BoldSign REST client. `fetchImpl` is injectable because the build container
 * cannot reach external hosts — tests hand it a fake that records requests.
 */
export class BoldSignProvider implements SigningProvider {
  readonly name = "boldsign" as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = "https://api.boldsign.com",
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {
    if (!apiKey) throw new Error("BoldSign API key is not set");
  }

  private async call(path: string, init: RequestInit & { expect?: "json" | "binary" | "none" } = {}) {
    const { expect = "json", ...rest } = init;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
        ...rest,
        headers: { "X-API-KEY": this.apiKey, accept: "application/json", ...(rest.headers ?? {}) },
      });
    } catch {
      throw new SigningProviderError("Couldn't reach BoldSign. Check the internet connection and try again.");
    }
    if (!res.ok) {
      // BoldSign returns {"error": "..."} or a validation problem document.
      // Show its words (they are about the request, never the key), trimmed.
      let detail = "";
      try {
        const body = (await res.json()) as { error?: string; message?: string; errors?: Record<string, string[]> };
        detail =
          body.error ??
          body.message ??
          Object.values(body.errors ?? {})
            .flat()
            .join(" ");
      } catch {
        /* non-JSON error body */
      }
      const lead =
        res.status === 401 || res.status === 403
          ? "BoldSign rejected the API key — check BOLDSIGN_API_KEY."
          : `BoldSign refused the request (${res.status}).`;
      throw new SigningProviderError(detail ? `${lead} ${detail.slice(0, 300)}` : lead, res.status);
    }
    if (expect === "none") return null;
    if (expect === "binary") return Buffer.from(await res.arrayBuffer());
    return (await res.json()) as unknown;
  }

  async send(req: PacketRequest) {
    const body = {
      title: req.title,
      message: req.message,
      enableSigningOrder: true,
      files: [`data:application/pdf;base64,${req.pdf.toString("base64")}`],
      metaData: req.metadata,
      signers: req.signers.map((s) => ({
        name: s.name,
        emailAddress: s.email,
        signerType: "Signer",
        signerOrder: s.order,
        formFields: s.fields.map((f, i) => ({
          id: `${s.role.toLowerCase()}_${f.type.toLowerCase()}_${i + 1}`,
          fieldType: f.type,
          pageNumber: f.page,
          bounds: { x: round(f.x), y: round(f.y), width: round(f.width), height: round(f.height) },
          isRequired: true,
        })),
      })),
    };
    const out = (await this.call("/v1/document/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })) as { documentId?: string };
    if (!out?.documentId) throw new SigningProviderError("BoldSign accepted the request but returned no document id.");
    return { externalId: out.documentId };
  }

  async status(externalId: string): Promise<ProviderStatus> {
    const out = (await this.call(`/v1/document/properties?documentId=${encodeURIComponent(externalId)}`)) as {
      status?: string;
      signerDetails?: { signerEmail?: string; status?: string }[];
    };
    return {
      state: boldSignState(out.status),
      signers: (out.signerDetails ?? []).map((s) => ({
        email: (s.signerEmail ?? "").toLowerCase(),
        signed: /^completed$/i.test(s.status ?? ""),
        declined: /^declined$/i.test(s.status ?? ""),
      })),
    };
  }

  async downloadSigned(externalId: string) {
    return (await this.call(`/v1/document/download?documentId=${encodeURIComponent(externalId)}`, {
      expect: "binary",
    })) as Buffer;
  }

  async downloadAuditTrail(externalId: string) {
    return (await this.call(`/v1/document/downloadAuditLog?documentId=${encodeURIComponent(externalId)}`, {
      expect: "binary",
    })) as Buffer;
  }

  async revoke(externalId: string, reason: string) {
    await this.call(`/v1/document/revoke?documentId=${encodeURIComponent(externalId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: reason || "Canceled by the dealership" }),
      expect: "none",
    });
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/** BoldSign document status → ours. Anything not terminal is still in progress. */
export function boldSignState(status: string | undefined): EnvelopeState {
  switch ((status ?? "").toLowerCase()) {
    case "completed":
      return "completed";
    case "declined":
      return "declined";
    case "revoked":
      return "revoked";
    case "expired":
      return "expired";
    default:
      return "in_progress";
  }
}

/**
 * Verifies BoldSign's `X-BoldSign-Signature` header: `t=<epoch>, s0=<hex>[, s1=<hex>]`,
 * an HMAC-SHA256 of `${t}.${rawBody}` under the webhook secret. `s1` is present
 * while a rolled secret is still valid. Rejects anything older than `toleranceSec`.
 */
export function verifyBoldSignSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  if (!header || !secret) return false;
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts.set(piece.slice(0, eq).trim(), piece.slice(eq + 1).trim());
  }
  const t = Number(parts.get("t"));
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec) return false;
  const digest = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  // Accept the digest hex- or base64-encoded; compare in constant time.
  const expected = [digest.toString("hex"), digest.toString("base64")].map((s) => Buffer.from(s));
  for (const key of ["s0", "s1"]) {
    const sig = parts.get(key);
    if (!sig) continue;
    const given = Buffer.from(sig);
    if (expected.some((e) => e.length === given.length && timingSafeEqual(e, given))) return true;
  }
  return false;
}

let provider: SigningProvider | null = null;

export function signingProvider(): SigningProvider {
  if (!provider) {
    const c = config();
    provider =
      c.ESIGN_ADAPTER === "boldsign"
        ? new BoldSignProvider(c.BOLDSIGN_API_KEY ?? "", c.BOLDSIGN_BASE_URL)
        : new MockSigningProvider();
  }
  return provider;
}

/** Tests swap in their own provider (a mock, or BoldSign with a fake fetch). */
export function setSigningProviderForTests(p: SigningProvider | null) {
  provider = p;
}
