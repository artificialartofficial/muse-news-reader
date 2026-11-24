// Privileged host handlers: host capabilities the sandboxed action worker
// does not have (filesystem reads of the blob store, subprocesses).
//
// Phase 5 (resized list thumbnails): article images are stored at full
// size and list views only ever display them in small slots (inbox rows
// 88-116 CSS px wide, board cards ~284 CSS px wide). resizeThumbnail reads
// one stored blob's bytes from the blob store on disk, downsizes it with
// GraphicsMagick (gm, present on the host) to the thumbnail width, and
// returns the resized bytes base64-encoded; the calling action stores
// them as a new blob through ctx.blobs and records the key, so each image
// is resized at most once. Any failure returns ok:false and the caller
// falls back to serving the original image.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  definePrivilegedContracts,
  definePrivilegedHandlers,
  z,
} from "@hatch/space-sdk";

export const privileged = definePrivilegedContracts({
  resizeThumbnail: {
    request: z.object({
      spaceDir: z.string().min(1).max(2000),
      blobKey: z.string().min(1).max(500),
      maxWidth: z.number().int().min(64).max(1024),
    }),
    response: z.object({
      ok: z.boolean(),
      base64: z.string().nullable(),
      contentType: z.string().nullable(),
      ext: z.string().nullable(),
      originalBytes: z.number(),
      thumbBytes: z.number(),
      originalWidth: z.number().nullable(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      alreadySmall: z.boolean(),
      error: z.string().nullable(),
    }),
    timeoutMs: 60000,
  },
});

type ResizeResult = {
  ok: boolean;
  base64: string | null;
  contentType: string | null;
  ext: string | null;
  originalBytes: number;
  thumbBytes: number;
  originalWidth: number | null;
  width: number | null;
  height: number | null;
  alreadySmall: boolean;
  error: string | null;
};

function fail(error: string, originalBytes = 0): ResizeResult {
  return {
    ok: false, base64: null, contentType: null, ext: null,
    originalBytes, thumbBytes: 0, originalWidth: null, width: null,
    height: null, alreadySmall: false, error,
  };
}

// Minimal dimension readers for the stored formats (mirrors the action
// bundle's imageDimensions so the already-small decision needs no extra
// subprocess).
function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (bytes.length >= 10 && String.fromCharCode(...bytes.slice(0, 6)).startsWith("GIF8")) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1] ?? 0;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      }
      const len = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
      if (len < 2) break;
      i += 2 + len;
    }
    return null;
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP" && String.fromCharCode(...bytes.slice(12, 16)) === "VP8X") {
    const w = (bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16);
    const h = (bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16);
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

function sourceFormat(bytes: Uint8Array): "jpg" | "png" | "gif" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).startsWith("GIF8")) return "gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}

// Blob storage layout (see the runtime's blob client): the object for a
// key lives at <spaceDir>/blobs/objects/<sha256(key)[0:2]>/<sha256(key)>;
// older stores kept it at <spaceDir>/blobs/objects/<key>. Try both.
async function readBlobBytes(spaceDir: string, blobKey: string): Promise<Uint8Array | null> {
  const objectId = createHash("sha256").update(blobKey, "utf8").digest("hex");
  const candidates = [
    join(spaceDir, "blobs", "objects", objectId.slice(0, 2), objectId),
    join(spaceDir, "blobs", "objects", blobKey),
  ];
  for (const path of candidates) {
    try {
      const data = await readFile(path);
      if (data.length) return new Uint8Array(data);
    } catch { /* try the next layout */ }
  }
  return null;
}

function runGm(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("gm", args, { timeout: 45000, maxBuffer: 4 * 1024 * 1024 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export const privilegedHandlers = definePrivilegedHandlers(privileged, {
  async resizeThumbnail(args): Promise<ResizeResult> {
    // Only the app's own image keys may be read: feed lead images and
    // pulled photos. Anything else (traversal, other prefixes) is refused.
    if (!/^(article-images|article-photos)\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(args.blobKey)) {
      return fail("Unsupported blob key");
    }
    const bytes = await readBlobBytes(args.spaceDir, args.blobKey);
    if (!bytes) return fail("Stored image not found on disk");
    const originalBytes = bytes.length;
    const format = sourceFormat(bytes);
    if (!format) return fail("Unrecognized image format", originalBytes);
    const dims = imageDimensions(bytes);
    // Decompression-bomb guard: a tiny stored file can declare enormous
    // dimensions; never hand those to GraphicsMagick to expand.
    if (dims && (dims.width > 16384 || dims.height > 16384 || dims.width * dims.height > 40_000_000)) {
      return fail("Image dimensions too large", originalBytes);
    }
    // Already at or below the thumbnail width: no variant needed; the
    // caller records the original key as its own thumbnail.
    if (dims && dims.width <= args.maxWidth) {
      return {
        ok: true, base64: null, contentType: null, ext: null,
        originalBytes, thumbBytes: originalBytes,
        originalWidth: dims.width, width: dims.width, height: dims.height,
        alreadySmall: true, error: null,
      };
    }
    const isGif = format === "gif";
    const outExt = isGif ? "gif" : "jpg";
    const contentType = isGif ? "image/gif" : "image/jpeg";
    const dir = await mkdtemp(join(tmpdir(), "news-thumb-"));
    try {
      const inPath = join(dir, `in.${format}`);
      const outPath = join(dir, `out.${outExt}`);
      await writeFile(inPath, bytes);
      const gmArgs = isGif
        ? ["convert", inPath, "-resize", `${args.maxWidth}x>`, "-strip", outPath]
        : ["convert", inPath, "-resize", `${args.maxWidth}x>`, "-background", "white", "-flatten", "-strip", "-quality", "82", "-interlace", "Plane", outPath];
      await runGm(gmArgs);
      const out = new Uint8Array(await readFile(outPath));
      if (!out.length) return fail("Resize produced no output", originalBytes);
      const outDims = imageDimensions(out);
      return {
        ok: true,
        base64: Buffer.from(out).toString("base64"),
        contentType, ext: outExt,
        originalBytes, thumbBytes: out.length,
        originalWidth: dims?.width ?? null,
        width: outDims?.width ?? null, height: outDims?.height ?? null,
        alreadySmall: false, error: null,
      };
    } catch (e) {
      return fail(e instanceof Error ? e.message.slice(0, 300) : "Resize failed", originalBytes);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  },
});
