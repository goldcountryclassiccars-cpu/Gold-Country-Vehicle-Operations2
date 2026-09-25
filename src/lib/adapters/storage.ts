/**
 * File storage abstraction. Development uses the local filesystem; production
 * uses the S3-compatible adapter (any S3 API: Supabase Storage, Cloudflare R2,
 * MinIO, AWS S3). Files are private by default — downloads go through an
 * authorized endpoint that checks permissions and (for sensitive files) the
 * matching field grant. Bucket paths / storage keys are never exposed as URLs.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { config } from "@/lib/config";

export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Size of the stored object, or null if it does not exist. */
  head(key: string): Promise<{ sizeBytes: number } | null>;
  /**
   * A URL the browser can PUT the file to directly, bypassing the app server
   * (and its request-size limit), or null when the adapter has no such URL
   * (local dev) — the caller then uses the app's own upload route.
   */
  presignPut(key: string, contentType: string): Promise<string | null>;
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
  async head(key: string) {
    try {
      const s = await stat(this.resolve(key));
      return { sizeBytes: s.size };
    } catch {
      return null;
    }
  }
  async presignPut() {
    return null; // local dev has no direct URL — uploads go through the app route
  }
}

/**
 * S3-compatible adapter. Works against any S3 API implementation — Supabase
 * Storage, Cloudflare R2, MinIO, AWS S3 itself. Objects are written with no
 * public ACL: the bucket stays private and every read goes back through
 * /api/files/[id], which checks the permission and field grant first. That is
 * the whole point of returning a Buffer here rather than handing out a URL.
 */
class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const c = config();
    this.bucket = c.S3_BUCKET!;
    this.client = new S3Client({
      region: c.S3_REGION,
      endpoint: c.S3_ENDPOINT,
      forcePathStyle: c.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: c.S3_ACCESS_KEY_ID!,
        secretAccessKey: c.S3_SECRET_ACCESS_KEY!,
      },
    });
  }

  async put(key: string, data: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!res.Body) throw new Error(`Storage object ${key} has no body`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async head(key: string) {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { sizeBytes: res.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  async presignPut(key: string, contentType: string): Promise<string> {
    // 15 minutes is enough for a photo set on a slow cell connection; the
    // signature covers key and content type, so the URL can't write elsewhere.
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: 15 * 60 },
    );
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

// ---------------------------------------------------------------------------
// Signed upload tokens — authorize ONE browser PUT of ONE storage key through
// the app's own upload route. Used as the whole path in local dev (no S3), and
// as the small-file fallback in production if a direct-to-storage PUT fails.
// The token pins key, content type, uploader and expiry, so a leaked token
// can't write anything else, and the route never trusts client-chosen keys.
// ---------------------------------------------------------------------------

export interface UploadTokenPayload {
  key: string;
  contentType: string;
  userId: string;
  maxBytes: number;
  exp: number; // unix seconds
}

function uploadTokenMac(body: string): string {
  return createHmac("sha256", config().SESSION_SECRET).update(body).digest("base64url");
}

export function signUploadToken(payload: UploadTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${uploadTokenMac(body)}`;
}

export function verifyUploadToken(token: string): UploadTokenPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = uploadTokenMac(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as UploadTokenPayload;
    if (typeof payload.key !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
