// src/errors.ts
var Html2PdfError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "Html2PdfError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var ResourcePolicyError = class extends Html2PdfError {
  constructor(message) {
    super(message);
    this.name = "ResourcePolicyError";
  }
};
var ResourceLoadError = class extends Html2PdfError {
  constructor(message) {
    super(message);
    this.name = "ResourceLoadError";
  }
};
var FontLoadError = class extends Html2PdfError {
  constructor(message) {
    super(message);
    this.name = "FontLoadError";
  }
};
var PdfProtectionError = class extends Html2PdfError {
  constructor(message) {
    super(message);
    this.name = "PdfProtectionError";
  }
};

// src/google-fonts.ts
import { existsSync, mkdirSync, readFileSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { homedir, platform } from "os";
function cacheDir() {
  if (process.env.HTML2PDFSMITH_CACHE_DIR) {
    return join(process.env.HTML2PDFSMITH_CACHE_DIR, "fonts");
  }
  const os = platform();
  if (os === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "html2pdfsmith", "fonts");
  }
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "html2pdfsmith", "fonts");
}
function ensureCacheDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
function slugify(family) {
  return family.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "");
}
var CSS_API = "https://fonts.googleapis.com/css";
var TTF_USER_AGENT = "Mozilla/5.0";
async function fetchCssAndParseUrls(family, weights) {
  const params = new URLSearchParams({
    family: `${family}:${weights.join(",")},400italic,700italic`,
    display: "swap"
  });
  const response = await fetch(`${CSS_API}?${params}`, {
    headers: { "User-Agent": TTF_USER_AGENT },
    signal: AbortSignal.timeout(15e3)
  });
  if (!response.ok) {
    throw new FontLoadError(`Google Fonts CSS API returned HTTP ${response.status} for "${family}"`);
  }
  const css = await response.text();
  const variants = [];
  const blocks = css.split("@font-face");
  for (const block of blocks) {
    const urlMatch = /url\(([^)]+)\)/i.exec(block);
    const weightMatch = /font-weight:\s*(\d+)/i.exec(block);
    const styleMatch = /font-style:\s*([a-z]+)/i.exec(block);
    if (urlMatch?.[1]) {
      variants.push({
        style: styleMatch?.[1] ?? "normal",
        weight: weightMatch?.[1] ?? "400",
        url: urlMatch[1].replace(/['"]/g, "")
      });
    }
  }
  return variants;
}
function isSupportedFontBytes(bytes) {
  if (bytes.length < 4) return false;
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];
  return b0 === 0 && b1 === 1 && b2 === 0 && b3 === 0 || b0 === 79 && b1 === 84 && b2 === 84 && b3 === 79 || b0 === 116 && b1 === 114 && b2 === 117 && b3 === 101 || b0 === 116 && b1 === 116 && b2 === 99 && b3 === 102;
}
function isSupportedFontFile(path) {
  try {
    return isSupportedFontBytes(readFileSync(path).subarray(0, 4));
  } catch {
    return false;
  }
}
function assertTrustedFontUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new FontLoadError(`Invalid font URL: "${url}"`);
  }
  if (parsed.protocol !== "https:") {
    throw new FontLoadError(`Font URL must use HTTPS: "${url}"`);
  }
  const trusted = ["fonts.gstatic.com", "fonts.googleapis.com"];
  if (!trusted.includes(parsed.hostname)) {
    throw new FontLoadError(`Font URL is not from a trusted Google domain: "${url}"`);
  }
}
async function downloadToCache(url, dest) {
  assertTrustedFontUrl(url);
  const response = await fetch(url, { signal: AbortSignal.timeout(3e4) });
  if (!response.ok) throw new FontLoadError(`HTTP ${response.status} downloading font`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!isSupportedFontBytes(bytes)) {
    throw new FontLoadError("Google Fonts returned a non-TTF/OTF font format that PDFKit cannot register");
  }
  await writeFile(dest, bytes);
}
async function readManifest(dir, slug) {
  const path = join(dir, `${slug}.json`);
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}
async function writeManifest(dir, slug, manifest) {
  await writeFile(join(dir, `${slug}.json`), JSON.stringify(manifest, null, 2));
}
async function resolveGoogleFont(family, warnings) {
  const slug = slugify(family);
  if (!slug) {
    warnings.add("google_font_invalid", `Invalid Google Font family name: "${family}"`);
    return null;
  }
  const dir = cacheDir();
  ensureCacheDir(dir);
  const regularFile = join(dir, `${slug}-regular.ttf`);
  const boldFile = join(dir, `${slug}-bold.ttf`);
  const italicFile = join(dir, `${slug}-italic.ttf`);
  const boldItalicFile = join(dir, `${slug}-bold-italic.ttf`);
  const manifest = await readManifest(dir, slug);
  if (manifest && existsSync(regularFile) && existsSync(boldFile) && existsSync(italicFile) && existsSync(boldItalicFile) && isSupportedFontFile(regularFile) && isSupportedFontFile(boldFile) && isSupportedFontFile(italicFile) && isSupportedFontFile(boldItalicFile)) {
    return { regularPath: regularFile, boldPath: boldFile, italicPath: italicFile, boldItalicPath: boldItalicFile };
  }
  try {
    const variants = await fetchCssAndParseUrls(family, ["400", "700"]);
    if (variants.length === 0) {
      warnings.add("google_font_not_found", `Google Fonts returned no variants for "${family}". Check the family name.`);
      return null;
    }
    const regular = variants.find((v) => v.style === "normal" && v.weight === "400") ?? variants.find((v) => v.weight === "400") ?? variants[0];
    const bold = variants.find((v) => v.style === "normal" && v.weight === "700") ?? variants.find((v) => v.weight === "700") ?? regular;
    const italic = variants.find((v) => v.style === "italic" && v.weight === "400") ?? regular;
    const boldItalic = variants.find((v) => v.style === "italic" && v.weight === "700") ?? bold ?? italic;
    await Promise.all([
      downloadToCache(regular.url, regularFile),
      downloadToCache(bold.url, boldFile),
      downloadToCache(italic.url, italicFile),
      downloadToCache(boldItalic.url, boldItalicFile)
    ]);
    await writeManifest(dir, slug, {
      family,
      regular: `${slug}-regular.ttf`,
      bold: `${slug}-bold.ttf`,
      italic: `${slug}-italic.ttf`,
      boldItalic: `${slug}-bold-italic.ttf`,
      cachedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { regularPath: regularFile, boldPath: boldFile, italicPath: italicFile, boldItalicPath: boldItalicFile };
  } catch (error) {
    warnings.add("google_font_download_failed", `Failed to download Google Font "${family}": ${String(error)}`);
    return null;
  }
}
function isGoogleFontCached(family) {
  const slug = slugify(family);
  const dir = cacheDir();
  return existsSync(join(dir, `${slug}-regular.ttf`)) && existsSync(join(dir, `${slug}-bold.ttf`));
}
function getGoogleFontCacheDir() {
  return cacheDir();
}

// src/warnings.ts
var WarningSink = class {
  constructor(handler) {
    this.handler = handler;
  }
  handler;
  warnings = [];
  add(code, message) {
    const warning = { code, message };
    this.warnings.push(warning);
    this.handler?.(warning);
  }
};

export {
  Html2PdfError,
  ResourcePolicyError,
  ResourceLoadError,
  FontLoadError,
  PdfProtectionError,
  resolveGoogleFont,
  isGoogleFontCached,
  getGoogleFontCacheDir,
  WarningSink
};
