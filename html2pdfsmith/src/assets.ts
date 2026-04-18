import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import type { PDFDocument } from "pdf-lib";
import type { WarningSink } from "./warnings";

export interface LoadedImage {
  bytes: Uint8Array;
  kind: "png" | "jpg" | "svg" | "unsupported";
  mime: string;
}

function parseDataUrl(src: string): LoadedImage | null {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/is.exec(src);
  if (!match) return null;
  const mime = (match[1] || "application/octet-stream").toLowerCase();
  const payload = match[2] ?? "";
  const isBase64 = /^data:[^,]*;base64,/i.test(src);
  const bytes = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { bytes, kind: imageKind(mime, bytes), mime };
}

function imageKind(mime: string, bytes: Uint8Array): LoadedImage["kind"] {
  if (mime.includes("png") || bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg") || bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (mime.includes("svg") || Buffer.from(bytes.subarray(0, 128)).toString("utf8").includes("<svg")) return "svg";
  return "unsupported";
}

export async function loadImage(src: string, warnings: WarningSink): Promise<LoadedImage | null> {
  const trimmed = src.trim();
  if (!trimmed) return null;

  const data = parseDataUrl(trimmed);
  if (data) return data;

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const response = await fetch(trimmed, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { bytes, kind: imageKind(contentType, bytes), mime: contentType || "application/octet-stream" };
    }

    const filePath = trimmed.startsWith("file://") ? new URL(trimmed) : trimmed;
    const bytes = new Uint8Array(await readFile(filePath));
    return { bytes, kind: imageKind("", bytes), mime: "application/octet-stream" };
  } catch (error) {
    warnings.add("image_load_failed", `Failed to load image ${trimmed.slice(0, 120)}: ${String(error)}`);
    return null;
  }
}

export async function embedImage(
  pdfDoc: PDFDocument,
  src: string | undefined,
  warnings: WarningSink,
) {
  if (!src) return null;
  const loaded = await loadImage(src, warnings);
  if (!loaded) return null;
  try {
    if (loaded.kind === "png") return await pdfDoc.embedPng(loaded.bytes);
    if (loaded.kind === "jpg") return await pdfDoc.embedJpg(loaded.bytes);
    if (loaded.kind === "svg") {
      warnings.add("svg_image_unsupported", "SVG image embedding is not supported yet; pass a PNG/JPEG logo or QR image.");
      return null;
    }
    warnings.add("image_type_unsupported", `Unsupported image type: ${loaded.mime}`);
    return null;
  } catch (error) {
    warnings.add("image_embed_failed", `Failed to embed image: ${String(error)}`);
    return null;
  }
}

export function discoverFontPaths(): { regularPath?: string; boldPath?: string } {
  const candidates = [
    {
      regularPath: "C:/Windows/Fonts/NotoSansSC-VF.ttf",
      boldPath: "C:/Windows/Fonts/NotoSansSC-VF.ttf",
    },
    {
      regularPath: "C:/Windows/Fonts/msyh.ttc",
      boldPath: "C:/Windows/Fonts/msyhbd.ttc",
    },
    {
      regularPath: "C:/Windows/Fonts/arial.ttf",
      boldPath: "C:/Windows/Fonts/arialbd.ttf",
    },
    {
      regularPath: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      boldPath: "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    },
    {
      regularPath: "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
      boldPath: "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    },
    {
      regularPath: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      boldPath: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    },
  ];

  for (const item of candidates) {
    if (existsSync(item.regularPath)) {
      const result: { regularPath?: string; boldPath?: string } = { regularPath: item.regularPath };
      if (existsSync(item.boldPath)) result.boldPath = item.boldPath;
      return result;
    }
  }
  return {};
}

export async function loadFontBytes(pathOrBytes: string | Uint8Array | undefined): Promise<Uint8Array | undefined> {
  if (!pathOrBytes) return undefined;
  if (typeof pathOrBytes !== "string") return pathOrBytes;
  return new Uint8Array(await readFile(pathOrBytes));
}
