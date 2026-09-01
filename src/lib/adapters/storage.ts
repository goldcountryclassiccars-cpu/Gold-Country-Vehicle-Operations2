/**
 * File storage abstraction. Development uses the local filesystem; production
 * uses an S3-compatible adapter (interface defined, implementation pending
 * credentials). Files are private by default — downloads go through an
 * authorized endpoint that checks permissions and (for sensitive files) the
 * matching field grant. Bucket paths / storage keys are never exposed as URLs.
 */
import { createHash, randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { config } from "@/lib/config";

export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorageAdapter implements StorageAdapter {
  private baseDir: string;
  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }
  private resolve(key: string): string {
    const safe = key.replace(/[^a-zA-Z0-9._/-]/g, "_");
    const full = path.resolve(this.baseDir, safe);
    if (!full.startsWith(path.resolve(this.baseDir))) throw new Error("Invalid storage key");
    return full;
  }
  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
  async delete(key: string) {
    await unlink(this.resolve(key)).catch(() => {});
  }
}

/**
 * S3-compatible adapter interface stub. Wire up with the AWS SDK (or any
 * S3-compatible client) when production credentials exist; see README.
 */
class S3StorageAdapter implements StorageAdapter {
  async put(): Promise<void> {
    throw new Error("S3 adapter not configured. Set STORAGE_ADAPTER=local for development.");
  }
  async get(): Promise<Buffer> {
    throw new Error("S3 adapter not configured.");
  }
  async delete(): Promise<void> {
    throw new Error("S3 adapter not configured.");
  }
}

let adapter: StorageAdapter | null = null;
export function storage(): StorageAdapter {
  if (!adapter) {
    adapter =
      config().STORAGE_ADAPTER === "local"
        ? new LocalStorageAdapter(config().STORAGE_LOCAL_DIR)
        : new S3StorageAdapter();
  }
  return adapter;
}

export const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/heic"],
  video: ["video/mp4", "video/quicktime"],
  document: ["application/pdf", "image/jpeg", "image/png"],
};

export const MAX_UPLOAD_BYTES: Record<string, number> = {
  image: 25 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  document: 25 * 1024 * 1024,
};

export function validateUpload(kind: keyof typeof ALLOWED_UPLOAD_TYPES, contentType: string, sizeBytes: number) {
  const types = ALLOWED_UPLOAD_TYPES[kind];
  if (!types || !types.includes(contentType)) {
    throw new Error(`File type ${contentType} is not allowed for ${kind} uploads`);
  }
  const max = MAX_UPLOAD_BYTES[kind] ?? 0;
  if (sizeBytes <= 0 || sizeBytes > max) {
    throw new Error(`File size exceeds the ${Math.round(max / 1024 / 1024)}MB limit`);
  }
}

export function newStorageKey(prefix: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 10);
  return `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;
}

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
