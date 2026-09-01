/**
 * E-signature provider abstraction with a development mock. A real provider
 * adapter (e.g., a selected e-signature service) implements the same interface
 * later. The mock never contacts any external service and simulates envelope
 * lifecycle transitions in memory + the database.
 */

export interface EnvelopeRecipient {
  name: string;
  email: string;
  signingOrder: number;
}

export interface EnvelopeInput {
  documentIds: string[]; // DocumentInstance ids
  recipients: EnvelopeRecipient[];
  subject: string;
}

export type EnvelopeStatus = "created" | "sent" | "partially_signed" | "completed" | "canceled" | "declined";

export interface ESignAdapter {
  createEnvelope(input: EnvelopeInput): Promise<{ envelopeExternalId: string }>;
  send(envelopeExternalId: string): Promise<void>;
  checkStatus(envelopeExternalId: string): Promise<EnvelopeStatus>;
  downloadCompleted(envelopeExternalId: string): Promise<Buffer>;
  downloadAuditCertificate(envelopeExternalId: string): Promise<Buffer>;
  cancel(envelopeExternalId: string): Promise<void>;
}

/** Development mock: deterministic, offline, clearly labeled. */
export class MockESignAdapter implements ESignAdapter {
  private statuses = new Map<string, EnvelopeStatus>();

  async createEnvelope(_input: EnvelopeInput) {
    const id = `mock-env-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.statuses.set(id, "created");
    return { envelopeExternalId: id };
  }
  async send(id: string) {
    this.statuses.set(id, "sent");
  }
  async checkStatus(id: string) {
    return this.statuses.get(id) ?? "sent";
  }
  /** Test helper: simulate signing progress. */
  simulate(id: string, status: EnvelopeStatus) {
    this.statuses.set(id, status);
  }
  async downloadCompleted(id: string) {
    return Buffer.from(`MOCK COMPLETED ENVELOPE ${id} — DEMONSTRATION ONLY, NOT A SIGNED LEGAL DOCUMENT`);
  }
  async downloadAuditCertificate(id: string) {
    return Buffer.from(`MOCK AUDIT CERTIFICATE ${id} — DEMONSTRATION ONLY`);
  }
  async cancel(id: string) {
    this.statuses.set(id, "canceled");
  }
}

let adapter: ESignAdapter | null = null;
export function esign(): ESignAdapter {
  if (!adapter) adapter = new MockESignAdapter();
  return adapter;
}
