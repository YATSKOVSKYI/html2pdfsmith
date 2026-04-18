/**
 * Google Fonts resolver with disk cache.
 *
 * Downloads .ttf files from the Google Fonts CSS API and caches them to disk.
 * Returns **file paths**, not byte arrays, so the PDF renderer reads from disk
 * and the module itself adds zero persistent memory pressure.
 *
 * Cache directory: `~/.cache/html2pdfsmith/fonts/`
 * (or `LOCALAPPDATA/html2pdfsmith/fonts/` on Windows)
 */

import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import type { WarningSink } from "./warnings";

/* ---------- cache location ---------- */

function cacheDir(): string {
  const os = platform();
  if (os === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "html2pdfsmith", "fonts");
  }
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "html2pdfsmith", "fonts");
}

function ensureCacheDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/* ---------- filename helpers ---------- */

/**
 * Turn a Google Fonts family name into a safe file-system slug.
 * "Noto Sans" → "noto-sans", "Inter" → "inter"
 */
function slugify(family: string): string {
  return family.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
}

/* ---------- CSS API ---------- */

/**
 * The Google Fonts CSS2 API returns a stylesheet with `@font-face` rules.
 * We request `.ttf` by spoofing a user-agent that only supports TrueType.
 * This keeps the font files small and universally compatible with PDFKit.
 */
const CSS_API = "https://fonts.googleapis.com/css2";
const TTF_USER_AGENT = "Mozilla/4.0 (compatible; MSIE 8.0)"; // forces .ttf

interface FontVariant {
  weight: string;
  url: string;
}

async function fetchCssAndParseUrls(family: string, weights: string[]): Promise<FontVariant[]> {
  const params = new URLSearchParams({
    family: `${family}:wght@${weights.join(";")}`,
    display: "swap",
  });
  const response = await fetch(`${CSS_API}?${params}`, {
    headers: { "User-Agent": TTF_USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Google Fonts CSS API returned HTTP ${response.status} for "${family}"`);
  }
  const css = await response.text();

  // Extract url(...) and font-weight from each @font-face block
  const variants: FontVariant[] = [];
  const blocks = css.split("@font-face");
  for (const block of blocks) {
    const urlMatch = /url\(([^)]+)\)/i.exec(block);
    const weightMatch = /font-weight:\s*(\d+)/i.exec(block);
    if (urlMatch?.[1]) {
      variants.push({
        weight: weightMatch?.[1] ?? "400",
        url: urlMatch[1].replace(/['"]/g, ""),
      });
    }
  }
  return variants;
}

/* ---------- download with disk cache ---------- */

async function downloadToCache(url: string, dest: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading font`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(dest, bytes);
}

/* ---------- manifest for staleness check ---------- */

interface CacheManifest {
  family: string;
  regular: string;
  bold: string;
  cachedAt: string;
}

async function readManifest(dir: string, slug: string): Promise<CacheManifest | null> {
  const path = join(dir, `${slug}.json`);
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as CacheManifest;
  } catch {
    return null;
  }
}

async function writeManifest(dir: string, slug: string, manifest: CacheManifest): Promise<void> {
  await writeFile(join(dir, `${slug}.json`), JSON.stringify(manifest, null, 2));
}

/* ---------- public API ---------- */

export interface GoogleFontPaths {
  regularPath: string;
  boldPath: string;
}

/**
 * Resolve a Google Fonts family name to local .ttf file paths.
 *
 * - First render: downloads regular (400) + bold (700) TTFs → saves to disk cache.
 * - Subsequent renders: returns cached paths instantly, zero network, zero extra RAM.
 *
 * @param family  Google Fonts family name, e.g. "Inter", "Roboto", "Noto Sans"
 * @param warnings  Warning sink for non-fatal issues
 * @returns File paths to cached .ttf files
 */
export async function resolveGoogleFont(
  family: string,
  warnings: WarningSink,
): Promise<GoogleFontPaths | null> {
  const slug = slugify(family);
  if (!slug) {
    warnings.add("google_font_invalid", `Invalid Google Font family name: "${family}"`);
    return null;
  }

  const dir = cacheDir();
  ensureCacheDir(dir);

  const regularFile = join(dir, `${slug}-regular.ttf`);
  const boldFile = join(dir, `${slug}-bold.ttf`);

  // Check manifest for existing cache
  const manifest = await readManifest(dir, slug);
  if (manifest && existsSync(regularFile) && existsSync(boldFile)) {
    return { regularPath: regularFile, boldPath: boldFile };
  }

  // Download from Google Fonts
  try {
    const variants = await fetchCssAndParseUrls(family, ["400", "700"]);
    if (variants.length === 0) {
      warnings.add("google_font_not_found", `Google Fonts returned no variants for "${family}". Check the family name.`);
      return null;
    }

    const regular = variants.find((v) => v.weight === "400") ?? variants[0]!;
    const bold = variants.find((v) => v.weight === "700") ?? regular;

    await Promise.all([
      downloadToCache(regular.url, regularFile),
      downloadToCache(bold.url, boldFile),
    ]);

    await writeManifest(dir, slug, {
      family,
      regular: `${slug}-regular.ttf`,
      bold: `${slug}-bold.ttf`,
      cachedAt: new Date().toISOString(),
    });

    return { regularPath: regularFile, boldPath: boldFile };
  } catch (error) {
    warnings.add("google_font_download_failed", `Failed to download Google Font "${family}": ${String(error)}`);
    return null;
  }
}

/**
 * Check if a Google Font is already cached (no network call).
 */
export function isGoogleFontCached(family: string): boolean {
  const slug = slugify(family);
  const dir = cacheDir();
  return existsSync(join(dir, `${slug}-regular.ttf`)) && existsSync(join(dir, `${slug}-bold.ttf`));
}

/**
 * Get the cache directory path (for diagnostics / cleanup).
 */
export function getGoogleFontCacheDir(): string {
  return cacheDir();
}
