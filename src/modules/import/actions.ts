"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth/current-user";
import { requirePermission } from "@/lib/authz/engine";
import { commitImport, planImport, MAX_BYTES, type ImportPlan, type ImportResult } from "./service";

export interface ImportState {
  /** The exact file text the plan was built from, carried into the commit. */
  csvText?: string;
  plan?: ImportPlan;
  result?: ImportResult;
  error?: string;
}

/** Importing inventory is creating vehicles in bulk — require exactly that. */
async function requireImporter() {
  const user = await getSessionUser();
  requirePermission(user, "create", "vehicles");
  requirePermission(user, "create", "episodes");
  requirePermission(user, "manage_config", "admin");
  return user;
}

async function readCsv(formData: FormData): Promise<string | { error: string }> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return { error: `${file.name} is larger than ${Math.round(MAX_BYTES / 1000)} KB.` };
    return await file.text();
  }
  const pasted = String(formData.get("csv") ?? "").trim();
  if (pasted) return pasted;
  return { error: "Choose a CSV file or paste the rows into the box." };
}

export async function previewImportAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requireImporter();
  const csv = await readCsv(formData);
  if (typeof csv !== "string") return { error: csv.error };
  try {
    const plan = await planImport(user, csv);
    return { csvText: csv, plan };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read that file." };
  }
}

export async function commitImportAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requireImporter();
  const csvText = String(formData.get("csvText") ?? "");
  if (!csvText) return { error: "The preview expired. Upload the file again." };

  const forceIndexes = new Set(
    formData
      .getAll("force")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n)),
  );

  try {
    // Re-planned rather than trusting a plan round-tripped through the browser:
    // the commit must write what the server decided, not what a form said.
    const plan = await planImport(user, csvText);
    const result = await commitImport(user, plan, forceIndexes);
    revalidatePath("/vehicles");
    revalidatePath("/pipeline");
    revalidatePath("/dashboard");
    return { result, plan };
  } catch (e) {
    return { csvText, error: e instanceof Error ? e.message : "The import failed." };
  }
}
