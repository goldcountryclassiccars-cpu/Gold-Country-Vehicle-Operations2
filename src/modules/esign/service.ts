/**
 * "Send for signature": one e-signature envelope per deal.
 *
 * What goes out is every checklist row that (a) the rules say is REQUIRED,
 * (b) the registry marks e-signable and not wet-signature, (c) someone on
 * this deal signs, and (d) has its document produced — the approved form,
 * pre-filled, or a filled-in copy staff uploaded. Buyers sign first; the
 * chosen Admin countersigns as Dealer.
 *
 * Status comes from the provider, never from a webhook body: the webhook only
 * says "go and look", and `syncEnvelope` reads the provider's answer and moves
 * the checklist — buyer signed, dealer signed, and on completion the signed
 * packet and audit certificate are filed on the deal.
 */
import { z } from "zod";
import type { SignatureEnvelopeStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import { storage } from "@/lib/adapters/storage";
import { requirePermission } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";
import {
  signingProvider,
  SigningProviderError,
  type PacketSigner,
  type ProviderStatus,
  type SignerRole,
} from "@/lib/adapters/signing";
import { buildPacket, PacketError, type PacketDocument } from "./packet";
import { refreshComplete } from "@/modules/documents/requirements";

export class EsignError extends Error {}

export interface EnvelopeSigner {
  role: SignerRole;
  name: string;
  email: string;
  order: number;
  signedAt: string | null;
}

const emailSchema = z.string().trim().email();

const BUYER_SIDE: SignerRole[] = ["BUYER", "CO_BUYER"];

// ---------------------------------------------------------------------------
// What would go out
// ---------------------------------------------------------------------------

export interface PacketCandidate {
  requirementId: string;
  templateKey: string;
  name: string;
  signers: SignerRole[];
  ready: boolean;
  /** Why it can't go yet, in words for the front desk. */
  reason: string | null;
  documentInstanceId: string | null;
  fileId: string | null;
}

/** A filled-in copy staff uploaded is stored under this marker (see the filled-copy route). */
export const FILLED_COPY_MARK = "-filled-";

export async function packetCandidates(saleId: string): Promise<PacketCandidate[]> {
  const rows = await db.saleDocumentRequirement.findMany({
    where: { saleId, state: "REQUIRED" },
    include: { template: true },
    orderBy: [{ template: { sortOrder: "asc" } }],
  });
  const instanceIds = rows.map((r) => r.documentInstanceId).filter((x): x is string => Boolean(x));
  const instances = instanceIds.length
    ? await db.documentInstance.findMany({ where: { id: { in: instanceIds } } })
    : [];
  const files = instances.length
    ? await db.fileObject.findMany({ where: { id: { in: instances.map((i) => i.fileId) } } })
    : [];
  const byInstance = new Map(instances.map((i) => [i.id, i]));
  const byFile = new Map(files.map((f) => [f.id, f]));
  const live = signingProvider().name !== "mock";

  const out: PacketCandidate[] = [];
  for (const r of rows) {
    const t = r.template;
    const signers = t.signers.filter((s): s is SignerRole => s === "BUYER" || s === "CO_BUYER" || s === "DEALER");
    // The buyer's packet holds only what a buyer signs. A consignor's paperwork
    // (consignment agreement, lien payoff authorization) never goes to a buyer.
    if (!t.eSign || t.requiresWetSignature || !signers.some((s) => BUYER_SIDE.includes(s))) continue;
    if (t.signers.some((s) => s === "CONSIGNOR" || s === "LIENHOLDER")) continue;
    const buyerDone = !signers.some((s) => BUYER_SIDE.includes(s)) || r.buyerSigned;
    const dealerDone = !signers.includes("DEALER") || r.dealerSigned;
    if (buyerDone && dealerDone) continue;

    const inst = r.documentInstanceId ? byInstance.get(r.documentInstanceId) : undefined;
    const file = inst ? byFile.get(inst.fileId) : undefined;
    const base = {
      requirementId: r.id,
      templateKey: t.key,
      name: t.name,
      signers,
      documentInstanceId: inst?.id ?? null,
      fileId: inst?.fileId ?? null,
    };
    if (inst && (inst.status === "SENT" || inst.status === "PARTIALLY_SIGNED")) continue; // already out
    if (!inst || !file || inst.status === "VOIDED") {
      out.push({ ...base, ready: false, reason: "Produce it on the checklist first." });
      continue;
    }
    if (file.contentType !== "application/pdf") {
      out.push({ ...base, ready: false, reason: "It's a Word file — load the approved copy as a PDF." });
      continue;
    }
    const isDemo = !t.approvedFileId && !file.storageKey.includes(FILLED_COPY_MARK);
    if (isDemo && live) {
      out.push({
        ...base,
        ready: false,
        reason: "Only the demonstration copy exists — load the approved form in Administration → Documents.",
      });
      continue;
    }
    out.push({ ...base, ready: true, reason: null });
  }
  return out;
}

/** Admins can sign as Dealer (SALES_DOCUMENT_SETUP.md item 5). */
export async function dealerSigners() {
  return db.user.findMany({
    where: { active: true, roles: { some: { role: { key: "admin" } } } },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export async function sendForSignature(
  user: SessionUser,
  saleId: string,
  input: { dealerUserId: string; message?: string },
) {
  requirePermission(user, "send", "documents");
  const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: saleId } });
  if (["COMPLETED", "CANCELED"].includes(sale.status)) throw new EsignError("This deal is closed.");

  const open = await db.signatureEnvelope.findFirst({ where: { saleId, status: "SENT" } });
  if (open) throw new EsignError("A signature request is already out for this deal. Cancel it before sending a new one.");

  const [episode, buyer, coBuyer] = await Promise.all([
    db.inventoryEpisode.findUniqueOrThrow({ where: { id: sale.episodeId } }),
    db.party.findUniqueOrThrow({ where: { id: sale.buyerPartyId } }),
    sale.coBuyerPartyId ? db.party.findUnique({ where: { id: sale.coBuyerPartyId } }) : Promise.resolve(null),
  ]);

  if (!buyer.email || !emailSchema.safeParse(buyer.email).success) {
    throw new EsignError(`Add ${buyer.displayName}'s email address to the buyer's record — that's where the signing link goes.`);
  }
  if (coBuyer && (!coBuyer.email || !emailSchema.safeParse(coBuyer.email).success)) {
    throw new EsignError(`Add the co-buyer's (${coBuyer.displayName}) email address — each signer needs their own link.`);
  }
  if (coBuyer && coBuyer.email!.toLowerCase() === buyer.email.toLowerCase()) {
    throw new EsignError("The buyer and co-buyer need different email addresses — each signs from their own link.");
  }

  const dealer = (await dealerSigners()).find((d) => d.id === input.dealerUserId);
  if (!dealer) throw new EsignError("Choose who signs for the dealership (Jade or Sergio).");
  if ([buyer.email, coBuyer?.email].filter(Boolean).some((e) => e!.toLowerCase() === dealer.email.toLowerCase())) {
    throw new EsignError("The dealer signer's email matches a buyer's — pick a different dealer signer.");
  }

  const candidates = (await packetCandidates(saleId)).filter((c) => c.ready);
  if (candidates.length === 0) {
    throw new EsignError("Nothing is ready to sign yet — produce the documents on the checklist first.");
  }

  const roles = new Set<SignerRole>(["BUYER", "DEALER"]);
  if (coBuyer) roles.add("CO_BUYER");

  const fileRows = await db.fileObject.findMany({ where: { id: { in: candidates.map((c) => c.fileId!) } } });
  const fileById = new Map(fileRows.map((f) => [f.id, f]));
  const docs: PacketDocument[] = [];
  for (const c of candidates) {
    const f = fileById.get(c.fileId!)!;
    docs.push({
      title: c.name,
      bytes: await storage().get(f.storageKey),
      contentType: f.contentType,
      signers: c.signers.filter((s) => roles.has(s)),
      lateValues: { "dealer.printedName": dealer.name },
    });
  }

  let packet;
  try {
    packet = await buildPacket(docs, roles);
  } catch (e) {
    if (e instanceof PacketError) throw new EsignError(e.message);
    throw e;
  }

  const signers: PacketSigner[] = [
    { role: "BUYER", name: buyer.displayName, email: buyer.email, order: 1, fields: packet.fields.BUYER },
    ...(coBuyer
      ? [{ role: "CO_BUYER" as const, name: coBuyer.displayName, email: coBuyer.email!, order: 1, fields: packet.fields.CO_BUYER }]
      : []),
    { role: "DEALER", name: dealer.name, email: dealer.email, order: 2, fields: packet.fields.DEALER },
  ];
  // A signer with no box anywhere would be asked to sign nothing; BoldSign
  // refuses that. Drop them and say so in the audit trail.
  const signing = signers.filter((s) => s.fields.length > 0);
  if (!signing.some((s) => BUYER_SIDE.includes(s.role))) {
    throw new EsignError("None of these documents has a place for the buyer to sign.");
  }

  const title = `${episode.stockNumber} — sale documents for signature`;
  const message =
    input.message?.trim() ||
    "Please review and sign your purchase documents from Gold Country Classic Cars. Questions? Call us at (530) 955-0404.";

  let externalId: string;
  try {
    ({ externalId } = await signingProvider().send({
      title,
      message: message.slice(0, 5000),
      fileName: `${episode.stockNumber}-sale-documents.pdf`,
      pdf: packet.pdf,
      signers: signing,
      metadata: { saleId, stockNumber: episode.stockNumber },
    }));
  } catch (e) {
    if (e instanceof SigningProviderError) throw new EsignError(e.message);
    throw e;
  }

  const stored: EnvelopeSigner[] = signing.map((s) => ({
    role: s.role,
    name: s.name,
    email: s.email.toLowerCase(),
    order: s.order,
    signedAt: null,
  }));
  const envelope = await db.signatureEnvelope.create({
    data: {
      saleId,
      provider: signingProvider().name,
      externalId,
      title,
      requirementIds: candidates.map((c) => c.requirementId),
      documentInstanceIds: candidates.map((c) => c.documentInstanceId!),
      signers: stored as unknown as object,
      sentById: user.id,
    },
  });
  const now = new Date();
  await db.documentInstance.updateMany({
    where: { id: { in: candidates.map((c) => c.documentInstanceId!) } },
    data: { status: "SENT", envelopeExternalId: externalId, sentAt: now },
  });
  await db.saleDocumentRequirement.updateMany({
    where: { id: { in: candidates.map((c) => c.requirementId) } },
    data: { readyForSignature: true },
  });
  await audit(user, {
    action: "esign.send",
    resourceType: "sale",
    resourceId: saleId,
    newValues: {
      envelopeId: envelope.id,
      provider: envelope.provider,
      documents: candidates.map((c) => c.templateKey),
      signers: stored.map((s) => `${s.role}:${s.email}`),
      pages: packet.pageCount,
    },
  });
  return envelope;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function readSigners(json: unknown): EnvelopeSigner[] {
  return Array.isArray(json) ? (json as EnvelopeSigner[]) : [];
}

/**
 * Reads the provider's status and moves the deal forward to match. Safe to
 * call any number of times — every step checks before it writes.
 */
export async function syncEnvelope(envelopeId: string, actor: SessionUser | null) {
  const env = await db.signatureEnvelope.findUniqueOrThrow({ where: { id: envelopeId } });
  if (env.status !== "SENT" && !(env.status === "COMPLETED" && !env.signedFileId)) return env;

  let st: ProviderStatus;
  try {
    st = await signingProvider().status(env.externalId);
  } catch (e) {
    if (e instanceof SigningProviderError) {
      await db.signatureEnvelope.update({ where: { id: env.id }, data: { lastError: e.message, lastSyncedAt: new Date() } });
      throw new EsignError(e.message);
    }
    throw e;
  }

  const now = new Date();
  const signers = readSigners(env.signers).map((s) => {
    const p = st.signers.find((x) => x.email.toLowerCase() === s.email.toLowerCase());
    return p?.signed && !s.signedAt ? { ...s, signedAt: now.toISOString() } : s;
  });
  const completed = st.state === "completed";
  const signedRoles = new Set(signers.filter((s) => s.signedAt || completed).map((s) => s.role));
  const buyerSideDone = signers.filter((s) => BUYER_SIDE.includes(s.role)).every((s) => signedRoles.has(s.role));
  const dealerDone = signers.some((s) => s.role === "DEALER") && signedRoles.has("DEALER");

  // Checklist ticks
  const rows = await db.saleDocumentRequirement.findMany({
    where: { id: { in: env.requirementIds } },
    include: { template: true },
  });
  const ticked: string[] = [];
  for (const r of rows) {
    const data: { buyerSigned?: boolean; dealerSigned?: boolean } = {};
    if (buyerSideDone && !r.buyerSigned && r.template.signers.some((s) => s === "BUYER" || s === "CO_BUYER")) data.buyerSigned = true;
    if (dealerDone && !r.dealerSigned && r.template.signers.includes("DEALER")) data.dealerSigned = true;
    if (Object.keys(data).length) {
      await db.saleDocumentRequirement.update({ where: { id: r.id }, data });
      await refreshComplete(r.id);
      ticked.push(`${r.template.key}:${Object.keys(data).join("+")}`);
    }
  }

  const anySigned = signers.some((s) => s.signedAt);
  let status: SignatureEnvelopeStatus = env.status;
  const update: Record<string, unknown> = { signers: signers as unknown as object, lastSyncedAt: now, lastError: null };

  if (completed) {
    if (!env.signedFileId) {
      const sale = await db.saleTransaction.findUniqueOrThrow({ where: { id: env.saleId } });
      let signed: Buffer, trail: Buffer;
      try {
        [signed, trail] = await Promise.all([
          signingProvider().downloadSigned(env.externalId),
          signingProvider().downloadAuditTrail(env.externalId),
        ]);
      } catch (e) {
        if (e instanceof SigningProviderError) {
          await db.signatureEnvelope.update({
            where: { id: env.id },
            data: { ...update, status: "COMPLETED", completedAt: env.completedAt ?? now, lastError: e.message },
          });
          throw new EsignError(`Everyone signed, but the signed copy couldn't be downloaded yet: ${e.message}`);
        }
        throw e;
      }
      const [signedFile, auditFile] = await Promise.all(
        [
          { data: signed, name: "signed" },
          { data: trail, name: "audit-trail" },
        ].map(async ({ data, name }) => {
          const storageKey = `documents/${sale.episodeId}/esign-${env.id}-${name}.pdf`;
          await storage().put(storageKey, data);
          return db.fileObject.create({
            data: {
              storageKey,
              adapter: config().STORAGE_ADAPTER,
              originalName: `${env.title.replace(/[^A-Za-z0-9 -]/g, "")} (${name}).pdf`,
              contentType: "application/pdf",
              sizeBytes: data.length,
              uploadedBy: actor?.id ?? env.sentById,
              sensitivity: "signed_docs",
            },
          });
        }),
      );
      update.signedFileId = signedFile!.id;
      update.auditFileId = auditFile!.id;
      // Each document that went out now opens as the executed copy.
      await db.documentInstance.updateMany({
        where: { id: { in: env.documentInstanceIds } },
        data: { status: "SIGNED", signedAt: now, fileId: signedFile!.id },
      });
    }
    status = "COMPLETED";
    update.completedAt = env.completedAt ?? now;
  } else if (st.state === "declined" || st.state === "revoked" || st.state === "expired") {
    status = st.state === "declined" ? "DECLINED" : st.state === "expired" ? "EXPIRED" : "CANCELED";
    update.endedAt = now;
    update.endedReason =
      st.state === "declined" ? "A signer declined to sign." : st.state === "expired" ? "The signing link expired." : "Canceled at BoldSign.";
    // Put the documents back so the request can be corrected and sent again.
    await db.documentInstance.updateMany({
      where: { id: { in: env.documentInstanceIds }, status: { in: ["SENT", "PARTIALLY_SIGNED"] } },
      data: { status: "GENERATED", envelopeExternalId: null, sentAt: null },
    });
  } else if (anySigned) {
    await db.documentInstance.updateMany({
      where: { id: { in: env.documentInstanceIds }, status: "SENT" },
      data: { status: "PARTIALLY_SIGNED" },
    });
  }
  update.status = status;

  const saved = await db.signatureEnvelope.update({ where: { id: env.id }, data: update });
  if (status !== env.status || ticked.length) {
    await audit(actor, {
      action: "esign.status",
      resourceType: "sale",
      resourceId: env.saleId,
      newValues: { envelopeId: env.id, status, ticked },
      ...(actor ? {} : { source: "integration" as const, integration: env.provider }),
    });
  }
  return saved;
}

/** Staff pressed "Check status" — same as a webhook, with a person attached. */
export async function refreshEnvelope(user: SessionUser, envelopeId: string) {
  requirePermission(user, "view", "documents");
  return syncEnvelope(envelopeId, user);
}

export async function cancelEnvelope(user: SessionUser, envelopeId: string, reason: string) {
  requirePermission(user, "send", "documents");
  const env = await db.signatureEnvelope.findUniqueOrThrow({ where: { id: envelopeId } });
  if (env.status !== "SENT") throw new EsignError("This request isn't open any more.");
  const why = reason.trim() || "Canceled by the dealership";
  try {
    await signingProvider().revoke(env.externalId, why);
  } catch (e) {
    if (e instanceof SigningProviderError) throw new EsignError(e.message);
    throw e;
  }
  await db.documentInstance.updateMany({
    where: { id: { in: env.documentInstanceIds }, status: { in: ["SENT", "PARTIALLY_SIGNED"] } },
    data: { status: "GENERATED", envelopeExternalId: null, sentAt: null },
  });
  const saved = await db.signatureEnvelope.update({
    where: { id: env.id },
    data: { status: "CANCELED", endedAt: new Date(), endedReason: why },
  });
  await audit(user, { action: "esign.cancel", resourceType: "sale", resourceId: env.saleId, reason: why, newValues: { envelopeId: env.id } });
  return saved;
}

/**
 * A verified webhook arrived. Only the document id is taken from it; the
 * status is read back from the provider. Unknown ids are acknowledged and
 * ignored (BoldSign's "Verify" button sends a test event).
 */
export async function handleProviderEvent(externalId: string | null) {
  if (!externalId) return { handled: false as const };
  const env = await db.signatureEnvelope.findUnique({ where: { externalId } });
  if (!env) return { handled: false as const };
  await syncEnvelope(env.id, null);
  return { handled: true as const };
}

// ---------------------------------------------------------------------------
// For the deal page
// ---------------------------------------------------------------------------

export async function signaturePanel(saleId: string) {
  const [latest, candidates, dealers] = await Promise.all([
    db.signatureEnvelope.findFirst({ where: { saleId }, orderBy: { createdAt: "desc" } }),
    packetCandidates(saleId),
    dealerSigners(),
  ]);
  return {
    provider: signingProvider().name,
    latest: latest ? { ...latest, signers: readSigners(latest.signers) } : null,
    candidates,
    dealers,
  };
}
