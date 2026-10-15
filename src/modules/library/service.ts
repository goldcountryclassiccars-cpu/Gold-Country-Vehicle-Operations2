/**
 * The Document Library: every document the dealership uses, titled plainly
 * and grouped by where it falls in a buyer's or consignor's journey, with a
 * "Send" that works before any deal exists.
 *
 * The deal page (modules/esign) sends the closing packet to a buyer. This is
 * the earlier and looser case — an Intent to Purchase to someone who called
 * about a car, a title addendum to a consignor dropping off a title — so it
 * takes a vehicle (optional for some documents) and a contact, pre-fills what
 * the app knows, and either sends one e-signature envelope or emails the PDF.
 *
 * Rules that hold whoever is sending (Jade decided 2026-10-15 that Front Desk
 * may send every document here):
 *   - never a DEMO-watermarked stand-in, never an inactive (draft) template;
 *   - Wire Instructions only to a contact with a deposit requested on a deal;
 *   - the envelope and the produced copy hang on the car and the contact, and
 *     are adopted by the deal checklist if a sale opens later.
 */
import { z } from "zod";
import type { JourneyStage } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import { storage } from "@/lib/adapters/storage";
import { email, emailIsPracticeMode } from "@/lib/adapters/email";
import { signingProvider, SigningProviderError, type PacketSigner, type SignerRole } from "@/lib/adapters/signing";
import { requirePermission } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";
import { vehicleLabel } from "@/modules/vehicles/service";
import { renderDemoPdf } from "@/modules/documents/demo-pdf";
import { applyPrefill, prefillForEpisode } from "@/modules/esign/prefill";
import { buildPacket, PacketError } from "@/modules/esign/packet";
import { dealerSigners, readSigners, type EnvelopeSigner } from "@/modules/esign/service";

export class LibraryError extends Error {}

const emailSchema = z.string().trim().email();

export const JOURNEY_STAGE_LABEL: Record<JourneyStage, string> = {
  LEAD: "Interested / holding a car",
  HOLD_DEPOSIT: "Deposit",
  CONTRACT: "Contract signing",
  CLOSING: "Closing & DMV",
  DELIVERY: "Delivery",
  CONSIGN_INTAKE: "Consignment intake",
  CONSIGN_SETTLEMENT: "Consignor settlement",
};

export const JOURNEY_STAGE_ORDER: JourneyStage[] = [
  "LEAD",
  "HOLD_DEPOSIT",
  "CONTRACT",
  "CLOSING",
  "DELIVERY",
  "CONSIGN_INTAKE",
  "CONSIGN_SETTLEMENT",
];

/** Who the document goes to, from its signer list. */
export function recipientRoleOf(signers: string[]): "BUYER" | "CONSIGNOR" {
  return signers.includes("CONSIGNOR") ? "CONSIGNOR" : "BUYER";
}

export interface LibraryEntry {
  key: string;
  name: string;
  category: number;
  journeyStage: JourneyStage;
  signers: string[];
  recipientRole: "BUYER" | "CONSIGNOR";
  eSign: boolean;
  wetSignature: boolean;
  sendableStandalone: boolean;
  /** Needs a vehicle to pre-fill (everything except e.g. wire instructions). */
  needsVehicle: boolean;
  hasApprovedTemplate: boolean;
  approvedFileId: string | null;
  verifyWithCounsel: boolean;
  notes: string | null;
  /** Why it cannot be sent from here, in words; null when it can. */
  blocked: string | null;
}

/** The library: active templates that have a blank the app can produce (category 1 and 2). */
export async function libraryEntries(): Promise<LibraryEntry[]> {
  const templates = await db.documentTemplate.findMany({
    where: { active: true, category: { in: [1, 2] } },
    orderBy: [{ journeyStage: "asc" }, { sortOrder: "asc" }],
  });
  const live = signingProvider().name !== "mock";
  return templates
    .map((t): LibraryEntry => {
      let blocked: string | null = null;
      if (!t.sendableStandalone) blocked = "Sent from the deal page once a sale is open.";
      else if (!t.approvedFileId && live) blocked = "Needs the approved PDF — load it in Administration → Documents.";
      return {
        key: t.key,
        name: t.name,
        category: t.category,
        journeyStage: t.journeyStage,
        signers: t.signers,
        recipientRole: recipientRoleOf(t.signers),
        eSign: t.eSign && !t.requiresWetSignature,
        wetSignature: t.requiresWetSignature,
        sendableStandalone: t.sendableStandalone,
        needsVehicle: t.key !== "wire_instructions",
        hasApprovedTemplate: Boolean(t.approvedFileId),
        approvedFileId: t.approvedFileId,
        verifyWithCounsel: t.verifyWithCounsel,
        notes: t.notes,
        blocked,
      };
    })
    .sort(
      (a, b) =>
        JOURNEY_STAGE_ORDER.indexOf(a.journeyStage) - JOURNEY_STAGE_ORDER.indexOf(b.journeyStage) ||
        a.name.localeCompare(b.name),
    );
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface LibrarySendInput {
  templateKey: string;
  episodeId: string | null;
  /** An existing contact, or a new one typed in on the spot. */
  partyId?: string | null;
  newParty?: { displayName: string; email: string; phone?: string | null } | null;
  method: "ESIGN" | "EMAIL_PDF";
  /** Required for ESIGN when the document carries a DEALER signature line. */
  dealerUserId?: string | null;
  message?: string | null;
}

async function resolveParty(user: SessionUser, input: LibrarySendInput) {
  if (input.partyId) {
    const p = await db.party.findUnique({ where: { id: input.partyId } });
    if (!p || p.archivedAt) throw new LibraryError("That contact no longer exists.");
    return p;
  }
  const np = input.newParty;
  if (!np || np.displayName.trim().length < 2) throw new LibraryError("Who is this going to? Pick a contact or type a name and email.");
  if (!emailSchema.safeParse(np.email).success) throw new LibraryError("Enter a valid email address for the contact — that's where the document goes.");
  // Reuse a contact with the same email rather than creating a twin.
  const existing = await db.party.findFirst({
    where: { email: { equals: np.email.trim(), mode: "insensitive" }, archivedAt: null },
  });
  if (existing) return existing;
  return db.party.create({
    data: {
      kind: "PERSON",
      displayName: np.displayName.trim(),
      email: np.email.trim(),
      phone: np.phone?.trim() || null,
      createdById: user.id,
    },
  });
}

/** Wire instructions carry bank details: only to someone with a deposit requested on a deal. */
async function assertDepositRequested(party: { id: string; email: string | null }) {
  const partyIds = [party.id];
  if (party.email) {
    const twins = await db.party.findMany({
      where: { email: { equals: party.email, mode: "insensitive" }, archivedAt: null },
      select: { id: true },
    });
    partyIds.push(...twins.map((t) => t.id));
  }
  const count = await db.saleTransaction.count({
    where: {
      status: { notIn: ["DRAFT", "CANCELED", "UNWOUND"] },
      OR: [{ buyerPartyId: { in: partyIds } }, { coBuyerPartyId: { in: partyIds } }],
    },
  });
  if (count > 0) return;
  throw new LibraryError(
    "Wire instructions contain the dealership's bank details. Open a deal and request a deposit from this buyer first, then send them.",
  );
}

export async function sendFromLibrary(user: SessionUser, input: LibrarySendInput) {
  requirePermission(user, "send", "documents");

  const template = await db.documentTemplate.findUnique({ where: { key: input.templateKey } });
  if (!template || !template.active) throw new LibraryError("That document isn't available — it may be a draft awaiting counsel.");
  if (!template.sendableStandalone) throw new LibraryError("That document is sent from the deal page once a sale is open.");
  if (template.category !== 1 && template.category !== 2) throw new LibraryError("That document is issued elsewhere — it can't be sent from here.");

  const live = signingProvider().name !== "mock";
  const approved = template.approvedFileId
    ? await db.fileObject.findUnique({ where: { id: template.approvedFileId } })
    : null;
  if (!approved) {
    if (live || input.method === "EMAIL_PDF") {
      throw new LibraryError(`Only the demonstration copy of "${template.name}" exists — load the approved PDF in Administration → Documents before sending it to anyone.`);
    }
  } else if (approved.contentType !== "application/pdf") {
    throw new LibraryError(`"${template.name}" is loaded as a Word file. Load the approved copy as a PDF to send it.`);
  }

  if (input.method === "ESIGN" && (!template.eSign || template.requiresWetSignature)) {
    throw new LibraryError(`"${template.name}" is signed in ink — email the PDF or print it instead.`);
  }

  const needsVehicle = template.key !== "wire_instructions";
  const episode = input.episodeId
    ? await db.inventoryEpisode.findUniqueOrThrow({ where: { id: input.episodeId }, include: { vehicle: true, arrangement: true } })
    : null;
  if (needsVehicle && !episode) throw new LibraryError("Pick the vehicle this document is about.");
  if (episode && template.appliesTo !== "all" && template.appliesTo !== episode.dealType) {
    throw new LibraryError(`"${template.name}" is for ${template.appliesTo === "CONSIGNMENT" ? "consignment" : "dealer-owned"} vehicles, and this one isn't.`);
  }

  const party = await resolveParty(user, input);
  if (!party.email || !emailSchema.safeParse(party.email).success) {
    throw new LibraryError(`Add ${party.displayName}'s email address to their contact record — that's where the document goes.`);
  }
  if (template.key === "wire_instructions") await assertDepositRequested(party);

  const recipientRole = recipientRoleOf(template.signers);

  // Build the document: the approved blank, pre-filled from the car and the contact.
  let data: Buffer;
  if (approved) {
    data = await storage().get(approved.storageKey);
    if (episode) {
      const { values, mileageStatus } = await prefillForEpisode(episode.id, { id: party.id, role: recipientRole });
      data = await applyPrefill(data, values, null, mileageStatus);
    }
  } else {
    // Mock provider only (refused above when live): the watermarked stand-in.
    data = await renderDemoPdf({
      templateName: template.name,
      stockNumber: episode?.stockNumber ?? "—",
      vehicle: episode ? vehicleLabel(episode.vehicle) : "No vehicle",
      buyerName: recipientRole === "BUYER" ? party.displayName : undefined,
      dealType: episode?.dealType ?? "OTHER",
    });
  }

  const episodeId = episode?.id ?? null;
  const prior = episodeId
    ? await db.documentInstance.findFirst({
        where: { episodeId, saleId: null, partyId: party.id, templateId: template.id },
        orderBy: { version: "desc" },
      })
    : null;
  const version = (prior?.version ?? 0) + 1;
  const storageKey = `documents/${episodeId ?? "no-vehicle"}/library-${template.key}-${party.id.slice(0, 8)}-v${version}.pdf`;
  await storage().put(storageKey, data);
  const file = await db.fileObject.create({
    data: {
      storageKey,
      adapter: config().STORAGE_ADAPTER,
      originalName: `${episode?.stockNumber ?? "GCCC"}-${template.key}-v${version}.pdf`,
      contentType: "application/pdf",
      sizeBytes: data.length,
      uploadedBy: user.id,
      sensitivity: "signed_docs", // carries the contact's details once pre-filled
    },
  });
  // Library instances need an episode to hang on; a wire-instructions send with
  // no car is recorded on the audit trail only.
  const instance = episodeId
    ? await db.documentInstance.create({
        data: {
          episodeId,
          saleId: null,
          partyId: party.id,
          templateId: template.id,
          version,
          fileId: file.id,
          generatedById: user.id,
          sentVia: input.method,
        },
      })
    : null;
  if (prior && prior.status === "GENERATED") {
    await db.documentInstance.update({ where: { id: prior.id }, data: { status: "VOIDED" } });
  }

  const subjectVehicle = episode ? `${episode.vehicle.year ?? ""} ${episode.vehicle.make} ${episode.vehicle.model}`.trim() : null;
  const title = subjectVehicle ? `${template.name} — ${subjectVehicle}` : template.name;

  if (input.method === "EMAIL_PDF") {
    await email().send({
      to: party.email,
      subject: `Gold Country Classic Cars — ${title}`,
      text:
        (input.message?.trim() || `Hi ${party.displayName},\n\nAttached is the ${template.name}${subjectVehicle ? ` for the ${subjectVehicle}` : ""} from Gold Country Classic Cars.`) +
        "\n\nQuestions? Call us at (530) 955-0404.\n\nGold Country Classic Cars LLC\n422 Henderson Street, Grass Valley, CA 95945",
      attachments: [{ filename: `${title.replace(/[^A-Za-z0-9 .-]/g, "")}.pdf`, contentType: "application/pdf", data }],
    });
    if (instance) {
      await db.documentInstance.update({ where: { id: instance.id }, data: { status: "SENT", sentAt: new Date() } });
    }
    await audit(user, {
      action: "library.email",
      resourceType: episodeId ? "episode" : "party",
      resourceId: episodeId ?? party.id,
      newValues: { template: template.key, partyId: party.id, to: party.email, practice: emailIsPracticeMode() },
    });
    return { kind: "EMAIL_PDF" as const, instanceId: instance?.id ?? null, practice: emailIsPracticeMode() };
  }

  // ----- E-signature: one envelope, the contact first, then (if the document has a line for it) the dealer.
  const wantsDealer = template.signers.includes("DEALER");
  const dealer = wantsDealer ? (await dealerSigners()).find((d) => d.id === input.dealerUserId) : null;
  if (wantsDealer && !dealer) throw new LibraryError("Choose who signs for the dealership (Jade or Sergio).");
  if (dealer && dealer.email.toLowerCase() === party.email.toLowerCase()) {
    throw new LibraryError("The dealer signer's email matches the contact's — pick a different dealer signer.");
  }

  const roles = new Set<SignerRole>([recipientRole]);
  if (dealer) roles.add("DEALER");
  let packet;
  try {
    packet = await buildPacket(
      [
        {
          title: template.name,
          bytes: data,
          contentType: "application/pdf",
          signers: template.signers.filter((s): s is SignerRole => roles.has(s as SignerRole)),
          lateValues: dealer ? { "dealer.printedName": dealer.name } : undefined,
        },
      ],
      roles,
    );
  } catch (e) {
    if (e instanceof PacketError) throw new LibraryError(e.message);
    throw e;
  }

  const signers: PacketSigner[] = [
    { role: recipientRole, name: party.displayName, email: party.email, order: 1, fields: packet.fields[recipientRole] },
    ...(dealer ? [{ role: "DEALER" as const, name: dealer.name, email: dealer.email, order: 2, fields: packet.fields.DEALER }] : []),
  ].filter((s) => s.fields.length > 0);
  if (!signers.some((s) => s.role === recipientRole)) {
    throw new LibraryError(`"${template.name}" has no place for the ${recipientRole === "CONSIGNOR" ? "consignor" : "buyer"} to sign. Check the PDF's signature fields.`);
  }

  const message =
    input.message?.trim() ||
    `Please review and sign the ${template.name} from Gold Country Classic Cars. Questions? Call us at (530) 955-0404.`;
  let externalId: string;
  try {
    ({ externalId } = await signingProvider().send({
      title,
      message: message.slice(0, 5000),
      fileName: `${(episode?.stockNumber ?? "GCCC").replace(/[^A-Za-z0-9-]/g, "")}-${template.key}.pdf`,
      pdf: packet.pdf,
      signers,
      metadata: { templateKey: template.key, partyId: party.id, ...(episodeId ? { episodeId, stockNumber: episode!.stockNumber } : {}) },
    }));
  } catch (e) {
    if (e instanceof SigningProviderError) throw new LibraryError(e.message);
    throw e;
  }

  const stored: EnvelopeSigner[] = signers.map((s) => ({ role: s.role, name: s.name, email: s.email.toLowerCase(), order: s.order, signedAt: null }));
  const envelope = await db.signatureEnvelope.create({
    data: {
      saleId: null,
      episodeId,
      partyId: party.id,
      provider: signingProvider().name,
      externalId,
      title,
      requirementIds: [],
      documentInstanceIds: instance ? [instance.id] : [],
      signers: stored as unknown as object,
      sentById: user.id,
    },
  });
  if (instance) {
    await db.documentInstance.update({
      where: { id: instance.id },
      data: { status: "SENT", envelopeExternalId: externalId, sentAt: new Date() },
    });
  }
  await audit(user, {
    action: "library.esign",
    resourceType: episodeId ? "episode" : "party",
    resourceId: episodeId ?? party.id,
    newValues: { template: template.key, envelopeId: envelope.id, provider: envelope.provider, signers: stored.map((s) => `${s.role}:${s.email}`) },
  });
  return { kind: "ESIGN" as const, instanceId: instance?.id ?? null, envelopeId: envelope.id, practice: envelope.provider === "mock" };
}

// ---------------------------------------------------------------------------
// Linking to a later deal
// ---------------------------------------------------------------------------

/**
 * A sale just opened for a car. Anything sent to this buyer from the Library
 * for the same car (matched on the contact, or the same email — the deal form
 * creates a fresh Party) now belongs to the deal, so the checklist can count a
 * signed Intent to Purchase instead of asking for it again.
 */
export async function adoptLibraryDocuments(saleId: string, episodeId: string, buyer: { id: string; email: string | null }) {
  const partyIds = [buyer.id];
  if (buyer.email) {
    const twins = await db.party.findMany({
      where: { email: { equals: buyer.email, mode: "insensitive" }, archivedAt: null },
      select: { id: true },
    });
    partyIds.push(...twins.map((t) => t.id));
  }
  const res = await db.documentInstance.updateMany({
    where: { episodeId, saleId: null, partyId: { in: partyIds }, status: { not: "VOIDED" } },
    data: { saleId },
  });
  return res.count;
}

// ---------------------------------------------------------------------------
// What has gone out
// ---------------------------------------------------------------------------

export interface LibrarySentItem {
  instanceId: string | null;
  envelopeId: string | null;
  templateName: string;
  templateKey: string;
  episodeId: string | null;
  stockNumber: string | null;
  vehicle: string | null;
  party: { id: string; name: string; email: string | null } | null;
  sentVia: "ESIGN" | "EMAIL_PDF" | "PRINTED" | null;
  status: string;
  sentAt: string;
  fileId: string | null;
  signedFileId: string | null;
  signers: EnvelopeSigner[];
  practice: boolean;
}

/** Recent Library sends, newest first — for the library page and a vehicle's "Documents sent" list. */
export async function librarySent(opts: { episodeId?: string; take?: number } = {}): Promise<LibrarySentItem[]> {
  const instances = await db.documentInstance.findMany({
    where: { partyId: { not: null }, ...(opts.episodeId ? { episodeId: opts.episodeId } : {}), status: { not: "VOIDED" } },
    include: { template: true },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 50,
  });
  const episodeIds = [...new Set(instances.map((i) => i.episodeId))];
  const partyIds = [...new Set(instances.map((i) => i.partyId!).filter(Boolean))];
  const externalIds = instances.map((i) => i.envelopeExternalId).filter((x): x is string => Boolean(x));
  const [episodes, parties, envelopes] = await Promise.all([
    db.inventoryEpisode.findMany({ where: { id: { in: episodeIds } }, include: { vehicle: true } }),
    db.party.findMany({ where: { id: { in: partyIds } } }),
    externalIds.length ? db.signatureEnvelope.findMany({ where: { externalId: { in: externalIds } } }) : Promise.resolve([]),
  ]);
  const epById = new Map(episodes.map((e) => [e.id, e]));
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const envByExternal = new Map(envelopes.map((e) => [e.externalId, e]));
  return instances.map((i) => {
    const ep = epById.get(i.episodeId);
    const p = i.partyId ? partyById.get(i.partyId) : undefined;
    const env = i.envelopeExternalId ? envByExternal.get(i.envelopeExternalId) : undefined;
    return {
      instanceId: i.id,
      envelopeId: env?.id ?? null,
      templateName: i.template.name,
      templateKey: i.template.key,
      episodeId: i.episodeId,
      stockNumber: ep?.stockNumber ?? null,
      vehicle: ep ? vehicleLabel(ep.vehicle) : null,
      party: p ? { id: p.id, name: p.displayName, email: p.email } : null,
      sentVia: i.sentVia,
      status: env ? env.status : i.status,
      sentAt: (i.sentAt ?? i.createdAt).toISOString(),
      fileId: i.fileId,
      signedFileId: env?.signedFileId ?? null,
      signers: env ? readSigners(env.signers) : [],
      practice: env ? env.provider === "mock" : i.sentVia === "EMAIL_PDF" && emailIsPracticeMode(),
    };
  });
}
