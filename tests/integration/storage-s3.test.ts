/**
 * Exercises the S3 storage adapter against a real S3 API implementation
 * (s3rver, in-process) rather than a mock of our own code. This is the adapter
 * that runs in production, so the round-trip — put, get, delete, and the
 * "missing object" failure — is worth testing for real.
 */
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 4569;
const BUCKET = "gccc-test";

let server: { close: (cb: () => void) => void };
let dataDir: string;
let storage: () => {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
};

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "s3rver-"));
  const S3rver = (await import("s3rver")).default;
  server = await new Promise((resolve, reject) => {
    const s = new S3rver({
      port: PORT,
      address: "127.0.0.1",
      silent: true,
      directory: dataDir,
      configureBuckets: [{ name: BUCKET, configs: [] }],
    });
    s.run((err: Error | null) => (err ? reject(err) : resolve(s)));
  });

  // config() validates the whole environment, so supply the unrelated required
  // values too. The adapter never reads them; keeping them local makes the test
  // independent of whatever is in a developer's .env.
  process.env.DATABASE_URL ??= "postgresql://unused/unused";
  process.env.SESSION_SECRET ??= "test-secret-value-not-used-here";
  process.env.STORAGE_ADAPTER = "s3";
  process.env.S3_ENDPOINT = `http://127.0.0.1:${PORT}`;
  process.env.S3_BUCKET = BUCKET;
  process.env.S3_ACCESS_KEY_ID = "S3RVER";
  process.env.S3_SECRET_ACCESS_KEY = "S3RVER";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_FORCE_PATH_STYLE = "true";

  // Imported after the env is set — config() caches on first read.
  ({ storage } = await import("@/lib/adapters/storage"));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dataDir, { recursive: true, force: true });
});

describe("S3 storage adapter", () => {
  it("round-trips a binary object byte-for-byte", async () => {
    const key = "media/2026-09-01/photo.jpg";
    const data = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    await storage().put(key, data);
    const out = await storage().get(key);
    expect(out.equals(data)).toBe(true);
  });

  it("stores a document large enough to span chunks", async () => {
    const key = "documents/bill-of-sale.pdf";
    const data = Buffer.alloc(1024 * 512, 7);
    await storage().put(key, data);
    const out = await storage().get(key);
    expect(out.length).toBe(data.length);
    expect(out.equals(data)).toBe(true);
  });

  it("overwrites an existing key rather than appending", async () => {
    const key = "media/overwrite.bin";
    await storage().put(key, Buffer.from("first"));
    await storage().put(key, Buffer.from("second"));
    expect((await storage().get(key)).toString()).toBe("second");
  });

  it("deletes an object so it can no longer be read", async () => {
    const key = "media/temporary.bin";
    await storage().put(key, Buffer.from("bye"));
    await storage().delete(key);
    await expect(storage().get(key)).rejects.toThrow();
  });

  it("raises rather than returning empty for a key that was never written", async () => {
    await expect(storage().get("media/never-existed.bin")).rejects.toThrow();
  });
});
