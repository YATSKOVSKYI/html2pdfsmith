import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { PdfBundledFontFace, PdfFallbackFontPath, PdfFontOptions } from "./types";

export interface PdfFontManifestFace {
  family: string;
  regularPath: string;
  boldPath?: string;
  italicPath?: string;
  boldItalicPath?: string;
  source?: string;
  license?: string;
}

export interface PdfFontManifest {
  version: 1;
  generatedBy?: string;
  generatedAt?: string;
  defaultFamily?: string;
  fallbackFamilies?: string[];
  cssPath?: string;
  fonts: PdfFontManifestFace[];
}

export interface LoadFontManifestOptions {
  defaultFamily?: string;
  fallbackFonts?: string[];
}

function resolveManifestFile(baseDir: string, filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  return isAbsolute(filePath) ? filePath : resolve(baseDir, filePath);
}

function fontFaceFromManifest(baseDir: string, face: PdfFontManifestFace): PdfBundledFontFace {
  const out: PdfBundledFontFace = {
    family: face.family,
    regularPath: resolve(baseDir, face.regularPath),
  };
  const boldPath = resolveManifestFile(baseDir, face.boldPath);
  const italicPath = resolveManifestFile(baseDir, face.italicPath);
  const boldItalicPath = resolveManifestFile(baseDir, face.boldItalicPath);
  if (boldPath) out.boldPath = boldPath;
  if (italicPath) out.italicPath = italicPath;
  if (boldItalicPath) out.boldItalicPath = boldItalicPath;
  if (face.license) out.license = face.license;
  if (face.source) out.source = face.source;
  return out;
}

function fallbackFaceFromBundled(face: PdfBundledFontFace): PdfFallbackFontPath {
  const out: PdfFallbackFontPath = {
    family: face.family,
    regularPath: face.regularPath,
  };
  if (face.boldPath) out.boldPath = face.boldPath;
  if (face.italicPath) out.italicPath = face.italicPath;
  if (face.boldItalicPath) out.boldItalicPath = face.boldItalicPath;
  return out;
}

function normalizeFamily(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function fontOptionsFromManifest(
  manifest: PdfFontManifest,
  manifestDir = process.cwd(),
  options: LoadFontManifestOptions = {},
): PdfFontOptions {
  const faces = manifest.fonts
    .filter((face) => face.family?.trim() && face.regularPath?.trim())
    .map((face) => fontFaceFromManifest(manifestDir, face));
  if (faces.length === 0) {
    throw new Error("html2pdfsmith font manifest does not contain any usable fonts.");
  }

  const defaultFamily = normalizeFamily(options.defaultFamily ?? manifest.defaultFamily);
  const bundled = defaultFamily
    ? faces.find((face) => normalizeFamily(face.family) === defaultFamily) ?? faces[0]!
    : faces[0]!;
  const fallbackFamilies = (options.fallbackFonts ?? manifest.fallbackFamilies ?? [])
    .map((family) => normalizeFamily(family))
    .filter((family): family is string => Boolean(family));
  const fallbackFontPaths = faces
    .filter((face) => fallbackFamilies.includes(normalizeFamily(face.family) ?? ""))
    .map(fallbackFaceFromBundled);

  const result: PdfFontOptions = {
    bundled,
    bundledFonts: faces,
  };
  if (fallbackFontPaths.length > 0) result.fallbackFontPaths = fallbackFontPaths;
  return result;
}

export async function loadFontManifest(
  manifestPath: string,
  options: LoadFontManifestOptions = {},
): Promise<PdfFontOptions> {
  const absoluteManifestPath = resolve(manifestPath);
  const raw = await readFile(absoluteManifestPath, "utf8");
  const manifest = JSON.parse(raw) as PdfFontManifest;
  return fontOptionsFromManifest(manifest, dirname(absoluteManifestPath), options);
}
