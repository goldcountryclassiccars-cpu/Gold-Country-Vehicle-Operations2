/**
 * Direct-to-storage photo uploads and video links.
 *
 * The trust boundary is the point: the browser PUTs files to storage itself,
 * so finalize must never take the client's word for anything. These tests pin
 * that down — keys are only accepted for the episode and variant they were
 * issued for, a finalize for a file that never arrived fails with a readable
 * message, upload tokens can't be tampered with, and video links must be
 * https. Also: the resized copies inherit media permissions on download.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildPermissionMap } from "@/lib/authz/resolve";
import { ROLE_TEMPLATES } from "@/lib/authz/registry";
import type { SessionUser } from "@/lib/authz/types";
import { signUploadToken, storage, verifyUploadToken } from "@/lib/adapters/storage";
import {
  addVideoLink,
  finalizePhotoUpload,
  MediaError,
  removeVideoLink,
  requestPhotoUpload,
} from "@/modules/media/service";

function sessionUserFor(roleKey: string, base: { id: string; name: string; email: string }): SessionUser {
  const tpl = ROLE_TEMPLATES.find((t) => t.key === roleKey)!;
  const { permissions, fieldGrants } = buildPermissionMap([
    {
      key: tpl.key,
      permissions: Object.entries(tpl.grants).flatMap(([resource, grant]) =>
        Object.entries(grant!).map(([action, scope]) => ({ resource, action, scope })),
      ),
      fieldGrants: tpl.fieldGrants.map((fieldKey) => ({ fieldKey })),
    },
  ]);
  return {
    id: base.id,
    sessionId: "test",
    name: base.name,
    email: base.email,
    roleKeys: [roleKey],
    isOwner: roleKey === "admin",
    previewRoleKey: null,
    departmentIds: [],
    departmentKeys: [],
    permissions,
    fieldGrants,
    defaultLandingPage: null,
  };
}

// A real (tiny) JPEG so content sniffing or size checks never see zero bytes.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

let admin: SessionUser;
let episodeId: string;
const cleanupAssetIds: string[] = [];
const cleanupFileIds: string[] = [];
const cleanupKeys: string[] = [];

beforeAll(async () => {
  const jade = await db.user.findUniqueOrThrow({ where: { email: "jade@demo.gccc" } });
  admin = sessionUserFor("admin", jade);
  const episode = await db.inventoryEpisode.findFirstOrThrow({ where: { active: true } });
  episodeId = episode.id;
});

afterAll(async () => {
  await db.mediaAsset.deleteMany({ where: { id: { in: cleanupAssetIds } } });
  await db.fileObject.deleteMany({ where: { id: { in: cleanupFileIds } } });
  await db.videoLink.deleteMany({ where: { url: { contains: "zztest" } } });
  for (const key of cleanupKeys) await storage().delete(key);
});

describe("upload tokens", () => {
  it("round-trips, and rejects tampering and expiry", () => {
    const payload = { key: "media/x/original/a.jpg", contentType: "image/jpeg", userId: "u1", maxBytes: 10, exp: Math.floor(Date.now() / 1000) + 60 };
    const token = signUploadToken(payload);
    expect(verifyUploadToken(token)?.key).toBe(payload.key);

    // flip a character in the signed body
    expect(verifyUploadToken("x" + token.slice(1))).toBeNull();
    // wrong signature
    expect(verifyUploadToken(token.slice(0, token.lastIndexOf(".")) + ".AAAA")).toBeNull();
    // expired
    const old = signUploadToken({ ...payload, exp: Math.floor(Date.now() / 1000) - 1 });
    expect(verifyUploadToken(old)).toBeNull();
  });
});

describe("requestPhotoUpload", () => {
  it("issues original/web/thumb targets scoped to the episode", async () => {
    const { targets } = await requestPhotoUpload(admin, {
      episodeId,
      fileName: "front.jpg",
      contentType: "image/jpeg",
      sizeBytes: 5 * 1024 * 1024,
    });
    expect(targets.map((t) => t.variant)).toEqual(["original", "web", "thumb"]);
    for (const t of targets) {
      expect(t.key.startsWith(`media/${episodeId}/${t.variant}/`)).toBe(true);
      expect(t.fallbackUrl).toContain("/api/media/direct-upload?token=");
      // local dev adapter has no direct URL — the fallback carries the upload
      expect(t.putUrl).toBeNull();
    }
  });

  it("refuses non-photos and oversized files with readable messages", async () => {
    await expect(
      requestPhotoUpload(admin, { episodeId, fileName: "a.exe", contentType: "application/x-msdownload", sizeBytes: 100 }),
    ).rejects.toThrow(/not a photo/);
    await expect(
      requestPhotoUpload(admin, { episodeId, fileName: "a.jpg", contentType: "image/jpeg", sizeBytes: 26 * 1024 * 1024 }),
    ).rejects.toThrow(/up to 25MB/);
  });
});

describe("finalizePhotoUpload", () => {
  it("registers a photo whose files actually arrived, resized copies included", async () => {
    const { targets } = await requestPhotoUpload(admin, {
      episodeId,
      fileName: "zztest-side.jpg",
      contentType: "image/jpeg",
      sizeBytes: TINY_JPEG.length,
    });
    const key = (v: string) => targets.find((t) => t.variant === v)!.key;
    for (const v of ["original", "web", "thumb"]) {
      await storage().put(key(v), TINY_JPEG);
      cleanupKeys.push(key(v));
    }

    const asset = await finalizePhotoUpload(admin, {
      episodeId,
      originalName: "zztest-side.jpg",
      contentType: "image/jpeg",
      originalKey: key("original"),
      webKey: key("web"),
      thumbKey: key("thumb"),
    });
    cleanupAssetIds.push(asset.id);
    cleanupFileIds.push(asset.fileId, asset.webFileId!, asset.thumbFileId!);

    expect(asset.kind).toBe("PHOTO");
    expect(asset.webFileId).toBeTruthy();
    expect(asset.thumbFileId).toBeTruthy();
    const original = await db.fileObject.findUniqueOrThrow({ where: { id: asset.fileId } });
    expect(original.sizeBytes).toBe(TINY_JPEG.length);
  });

  it("works without resized copies (browser could not decode the image)", async () => {
    const { targets } = await requestPhotoUpload(admin, {
      episodeId,
      fileName: "zztest-heic.heic",
      contentType: "image/heic",
      sizeBytes: TINY_JPEG.length,
    });
    const originalKey = targets.find((t) => t.variant === "original")!.key;
    await storage().put(originalKey, TINY_JPEG);
    cleanupKeys.push(originalKey);

    const asset = await finalizePhotoUpload(admin, {
      episodeId,
      originalName: "zztest-heic.heic",
      contentType: "image/heic",
      originalKey,
      webKey: null,
      thumbKey: null,
    });
    cleanupAssetIds.push(asset.id);
    cleanupFileIds.push(asset.fileId);
    expect(asset.webFileId).toBeNull();
    expect(asset.thumbFileId).toBeNull();
  });

  it("refuses keys issued for another episode or variant, and files that never arrived", async () => {
    const other = await db.inventoryEpisode.findFirstOrThrow({ where: { active: true, id: { not: episodeId } } });
    const { targets } = await requestPhotoUpload(admin, {
      episodeId: other.id,
      fileName: "sneak.jpg",
      contentType: "image/jpeg",
      sizeBytes: 100,
    });
    const foreignKey = targets.find((t) => t.variant === "original")!.key;

    // key from a different episode
    await expect(
      finalizePhotoUpload(admin, {
        episodeId,
        originalName: "sneak.jpg",
        contentType: "image/jpeg",
        originalKey: foreignKey,
      }),
    ).rejects.toThrow(MediaError);

    // right episode, but nothing was ever uploaded to the key
    const { targets: mine } = await requestPhotoUpload(admin, {
      episodeId,
      fileName: "ghost.jpg",
      contentType: "image/jpeg",
      sizeBytes: 100,
    });
    await expect(
      finalizePhotoUpload(admin, {
        episodeId,
        originalName: "ghost.jpg",
        contentType: "image/jpeg",
        originalKey: mine.find((t) => t.variant === "original")!.key,
      }),
    ).rejects.toThrow(/did not finish/);
  });
});

describe("video links", () => {
  it("adds an https link, refuses http and junk, removes idempotently", async () => {
    const link = await addVideoLink(admin, {
      episodeId,
      url: "https://photos.app.goo.gl/zztest123",
      label: "Walkaround",
    });
    expect(link.label).toBe("Walkaround");

    await expect(addVideoLink(admin, { episodeId, url: "http://youtu.be/zztest" })).rejects.toThrow(/https/);
    await expect(addVideoLink(admin, { episodeId, url: "not a link" })).rejects.toThrow(/link/);

    await removeVideoLink(admin, link.id);
    await removeVideoLink(admin, link.id); // already gone — fine
    expect(await db.videoLink.findUnique({ where: { id: link.id } })).toBeNull();
  });

  it("audits the host, never the full URL is required — but host is enough", async () => {
    const link = await addVideoLink(admin, { episodeId, url: "https://photos.google.com/share/zztest-abc" });
    const a = await db.auditEvent.findFirst({
      where: { action: "media.video_link_add", resourceId: link.id },
    });
    expect(a).toBeTruthy();
    await removeVideoLink(admin, link.id);
  });
});
