/**
 * Google Fonts integration test for Html2PdfSmith.
 *
 * Tests:
 * 1. resolveGoogleFont() — downloads & caches Inter to disk
 * 2. isGoogleFontCached() — verifies cache hit
 * 3. renderHtmlToPdf with googleFont — full pipeline
 * 4. Memory check — RSS before/after should be stable
 * 5. Second render — must use cache (no network)
 *
 * Run: bun run examples/test-google-fonts.ts
 */

import { existsSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import {
  renderHtmlToPdfDetailed,
  resolveGoogleFont,
  isGoogleFontCached,
  getGoogleFontCacheDir,
} from "../src/index";
import { WarningSink } from "../src/warnings";

function rss(): number {
  return Math.round(process.memoryUsage.rss() / 1024 / 1024);
}

const FONT_FAMILY = "Inter";
const html = `<!doctype html><html><body>
  <h1>Google Fonts Test</h1>
  <p>This document uses the "${FONT_FAMILY}" font from Google Fonts.</p>
  <p>Проверка кириллицы: Привет мир!</p>
  <table>
    <thead><tr><th>Feature</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>Download</td><td>✅</td></tr>
      <tr><td>Disk Cache</td><td>✅</td></tr>
      <tr><td>Zero RAM</td><td>✅</td></tr>
    </tbody>
  </table>
</body></html>`;

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

console.log("\n🔤 Html2PdfSmith — Google Fonts Test Suite\n");

// ── Test 1: resolveGoogleFont ──────────────────────────────────
console.log("1️⃣  resolveGoogleFont()");
const rssBefore = rss();
const warnings = new WarningSink();
const result = await resolveGoogleFont(FONT_FAMILY, warnings);
assert("returns non-null", result !== null);
if (result) {
  assert("regularPath exists on disk", existsSync(result.regularPath), result.regularPath);
  assert("boldPath exists on disk", existsSync(result.boldPath), result.boldPath);
  assert("regularPath is .ttf", result.regularPath.endsWith(".ttf"));
  assert("boldPath is .ttf", result.boldPath.endsWith(".ttf"));
}
assert("no warnings", warnings.warnings.length === 0, JSON.stringify(warnings.warnings));

// ── Test 2: isGoogleFontCached ─────────────────────────────────
console.log("\n2️⃣  isGoogleFontCached()");
assert("Inter is cached", isGoogleFontCached(FONT_FAMILY));
assert("NonExistentFont123 is not cached", !isGoogleFontCached("NonExistentFont123"));
console.log(`   Cache dir: ${getGoogleFontCacheDir()}`);

// ── Test 3: Full render pipeline ───────────────────────────────
console.log("\n3️⃣  renderHtmlToPdfDetailed with googleFont");
const renderResult = await renderHtmlToPdfDetailed({
  html,
  font: { googleFont: FONT_FAMILY },
});
assert("pdf is Uint8Array", renderResult.pdf instanceof Uint8Array);
assert("pdf size > 1KB", renderResult.pdf.byteLength > 1024, `${renderResult.pdf.byteLength} bytes`);
assert("pages >= 1", renderResult.pages >= 1, `${renderResult.pages} pages`);

// Validate it's a real PDF
const loaded = await PDFDocument.load(renderResult.pdf);
assert("valid PDF structure", loaded.getPageCount() === renderResult.pages);

// Check no font_fallback warning (means custom font was used, not Helvetica)
const fallbackWarning = renderResult.warnings.find(w => w.code === "font_fallback");
assert("no font_fallback warning (custom font used)", !fallbackWarning, fallbackWarning?.message ?? "");

console.log(`   PDF: ${renderResult.pdf.byteLength} bytes, ${renderResult.pages} page(s)`);
console.log(`   Warnings: ${renderResult.warnings.map(w => w.code).join(", ") || "none"}`);

// ── Test 4: Memory check ───────────────────────────────────────
console.log("\n4️⃣  Memory footprint");
const rssAfter = rss();
const rssDelta = rssAfter - rssBefore;
console.log(`   RSS before: ${rssBefore} MB`);
console.log(`   RSS after:  ${rssAfter} MB`);
console.log(`   Delta:      ${rssDelta > 0 ? "+" : ""}${rssDelta} MB`);
assert("RSS delta < 50 MB", rssDelta < 50, `delta was ${rssDelta} MB`);

// ── Test 5: Second render (cache hit, no network) ──────────────
console.log("\n5️⃣  Second render (cache hit)");
const t0 = performance.now();
const result2 = await renderHtmlToPdfDetailed({
  html,
  font: { googleFont: FONT_FAMILY },
});
const t1 = performance.now();
const ms = Math.round(t1 - t0);
assert("second render succeeds", result2.pdf.byteLength > 1024);
assert("second render < 2000ms (cached)", ms < 2000, `${ms}ms`);
console.log(`   Render time: ${ms}ms`);

// ── Test 6: Invalid font name ──────────────────────────────────
console.log("\n6️⃣  Error handling — invalid font");
const badResult = await renderHtmlToPdfDetailed({
  html: "<html><body><p>Test</p></body></html>",
  font: { googleFont: "ThisFontDoesNotExist999" },
});
// Should gracefully fall back to Helvetica
assert("fallback works for bad font name", badResult.pdf.byteLength > 100);
const hasFallback = badResult.warnings.some(w =>
  w.code === "google_font_not_found" || w.code === "google_font_download_failed" || w.code === "font_fallback"
);
assert("warning emitted for bad font", hasFallback, JSON.stringify(badResult.warnings.map(w => w.code)));

// ── Summary ────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\n💥 Some tests failed!");
  process.exit(1);
} else {
  console.log("\n🎉 All tests passed!\n");
}
