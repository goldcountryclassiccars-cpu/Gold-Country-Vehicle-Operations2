/**
 * Loading the dealership's own approved documents.
 *
 * This is the step that turns the feature on. Until an approved file exists
 * for a template, `generateDocument` renders a DEMONSTRATION-watermarked
 * stand-in; once one is loaded, that document is served as the real thing.
 *
 * Deliberately per-document rather than all-or-nothing. Jade will get these
 * back from counsel a few at a time, and there is no reason the purchase
 * agreement should stay a demo because the Spanish Buyers Guide has not
 * arrived yet.
 *
 * The app does not draft, alter or fill approved legal text. It stores the
 * file, serves it, and records who loaded it and when.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { config } from "@/lib/config";
import { storage } from "@/lib/adapters/storage";
import { requirePermission } from "@/lib/authz/engine";
import type { SessionUser } from "@/lib/authz/types";

export class TemplateError extends Error {}

const ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MAX_BYTES = 15 * 1024 * 1024;

export async function uploadApprovedTemplate(
  user: SessionUser,
  input: {
    templateKey: string;
    originalName: string;
    contentType: string;
    data: Buffer;
    versionNote?: string | null;
  },
) {
  // Loading a legal document that will be handed to buyers is an owner-grade
  // act, not everyday paperwork — `manage_config` is Admin-only.
  requirePermission(user, "manage_config", "admin");

  if (!ALLOWED.has(input.contentType)) {
    throw new TemplateError("Approved templates must be a PDF or Word document.");
  }
  if (input.data.length === 0) throw new TemplateError("That file is empty.");
  if (input.data.length > MAX_BYTES) throw new TemplateError("That file is larger than 15MB.");

  const template = await db.documentTemplate.findUnique({ where: { key: input.templateKey } });
  if (!template) throw new TemplateError("No such document template.");

  // Only documents we produce (1) or government forms we print (2) have a
  // blank master. A REG 51 is serialised and issued by the DMV; a smog
  // certificate belongs to one car and is attached to that sale. Enforced here
  // and not only in the UI — hiding a control is not the same as refusing it.
  if (template.category !== 1 && template.category !== 2) {
    throw new TemplateError(
      template.category === 3
        ? "This is a controlled original issued by the DMV — there is no blank to load."
        : "This document is produced per sale by someone else — attach it on the deal instead.",
    );
  }

  const stamp = Date.now();
  const storageKey = `approved-templates/${template.key}-${stamp}${input.contentType === "application/pdf" ? ".pdf" : ".docx"}`;
  await storage().put(storageKey, input.data);

  const file = await db.fileObject.create({
    data: {
      storageKey,
      adapter: config().STORAGE_ADAPTER,
      originalName: input.originalName,
      contentType: input.contentType,
      sizeBytes: input.data.length,
      uploadedBy: user.id,
      // Not signed_docs: a blank approved template contains no customer data,
      // and the front desk has to be able to print it.
      sensitivity: null,
    },
  });

  const previousFileId = template.approvedFileId;
  const updated = await db.documentTemplate.update({
    where: { id: template.id },
    data: {
      approvedFileId: file.id,
      approvedAt: new Date(),
      approvedById: user.id,
      approvedVersionNote: input.versionNote?.trim() || null,
    },
  });

  await audit(user, {
    action: previousFileId ? "document_template.approved_replaced" : "document_template.approved_loaded",
    resourceType: "document_template",
    resourceId: template.id,
    previousValues: previousFileId ? { approvedFileId: previousFileId } : undefined,
    newValues: { key: template.key, fileId: file.id, versionNote: input.versionNote ?? null },
  });

  return updated;
}

/** Reverts a document to the DEMO stand-in. The file itself is kept. */
export async function clearApprovedTemplate(user: SessionUser, templateKey: string, reason: string) {
  requirePermission(user, "manage_config", "admin");
  if (reason.trim().length < 5) throw new TemplateError("Say why you are removing it — this is audited.");

  const template = await db.documentTemplate.findUnique({ where: { key: templateKey } });
  if (!template) throw new TemplateError("No such document template.");
  if (!template.approvedFileId) return template;

  const updated = await db.documentTemplate.update({
    where: { id: template.id },
    data: { approvedFileId: null, approvedAt: null, approvedById: null, approvedVersionNote: null },
  });
  await audit(user, {
    action: "document_template.approved_cleared",
    resourceType: "document_template",
    resourceId: template.id,
    previousValues: { approvedFileId: template.approvedFileId },
    reason,
  });
  return updated;
}

/** Records an answer to one of the human-judgment setup items. */
export async function setSetupItem(user: SessionUser, key: string, provided: boolean, note: string) {
  requirePermission(user, "manage_config", "admin");
  const data = {
    provided,
    note: note.trim() || null,
    providedById: provided ? user.id : null,
    providedAt: provided ? new Date() : null,
  };
  const row = await db.documentSetupItem.upsert({
    where: { key },
    update: data,
    create: { key, ...data },
  });
  await audit(user, {
    action: "document_setup.answer",
    resourceType: "document_setup",
    resourceId: key,
    newValues: { provided, note: data.note },
  });
  return row;
}
