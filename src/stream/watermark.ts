import type { RenderHtmlToPdfOptions, WatermarkLayout } from "../types";
import { safeNumber } from "../units";
import { type LoadedPdfKitAsset, type StreamContext, asOpacity, clamp } from "./layout";
import { drawAsset, imageDimensions } from "./assets";

/* ── Layer selection ──────────────────────────────────────────────── */

export function watermarkLayer(options: RenderHtmlToPdfOptions): "background" | "foreground" | "both" {
  return options.watermarkLayer ?? "background";
}

export function shouldDrawWatermark(ctx: StreamContext, layer: "background" | "foreground"): boolean {
  const configured = watermarkLayer(ctx.options);
  return configured === "both" || configured === layer;
}

/* ── Layout resolution (incl. legacy patternType mapping) ─────────── */

const LAYOUTS: readonly WatermarkLayout[] = ["honeycomb", "grid", "diagonal", "single"];

/**
 * Legacy `patternType` values used to encode both an arrangement and an
 * implicit count of logos. The old SVG generator made triangle/corners/diagonal
 * render the *same* hex tile, so they all collapse onto the closest new layout.
 */
const LEGACY_LAYOUT_MAP: Record<string, WatermarkLayout> = {
  honeycomb: "honeycomb",
  triangle: "honeycomb",
  corners: "honeycomb",
  diagonal: "diagonal",
  grid: "grid",
  minimal: "single",
  single: "single",
};

export function resolveWatermarkLayout(options: RenderHtmlToPdfOptions): WatermarkLayout {
  const explicit = options.watermarkLayout;
  if (explicit && (LAYOUTS as readonly string[]).includes(explicit)) return explicit;
  const legacy = (options.patternType ?? "").toString().trim().toLowerCase();
  return LEGACY_LAYOUT_MAP[legacy] ?? "honeycomb";
}

/* ── Geometry — single source of truth for size & spacing ─────────── */

// Logo size range (pt) mapped from watermarkLogoScale 1..100.
const LOGO_MIN_PT = 26;
const LOGO_MAX_PT = 120;
// Gap-between-tiles range (pt) mapped from watermarkDensity 1..100
// (high density → small gap → tiles packed closer).
const GAP_MIN_PT = 14;
const GAP_MAX_PT = 165;
// √3/2 — vertical compression that turns square cells into a true hex lattice.
const HEX_ROW_RATIO = 0.866_025_4;

interface WatermarkGeometry {
  logoW: number;
  logoH: number;
  stepX: number;
  stepY: number;
  /** Shift odd rows by half a step (brick / hex interlock). */
  rowOffset: boolean;
  angle: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Natural aspect ratio (w/h) of the watermark asset, defaulting to square. */
function resolveAspect(asset: LoadedPdfKitAsset | null): number {
  const dims = asset ? imageDimensions(asset) : null;
  if (dims && dims.width > 0 && dims.height > 0) return dims.width / dims.height;
  return 1;
}

/**
 * Compute the watermark tile box (logo size) and the lattice steps.
 *
 * Size and density are independent: `watermarkLogoScale` only changes the
 * logo box, `watermarkDensity` only changes the gap between tiles. Both fall
 * back to the combined `watermarkScale` so legacy callers keep working.
 */
function computeGeometry(ctx: StreamContext, layout: WatermarkLayout, box: { w: number; h: number }): WatermarkGeometry {
  const o = ctx.options;
  const combined = clamp(o.watermarkScale ?? 50, 1, 100);
  const density = clamp(o.watermarkDensity ?? combined, 1, 100);

  const gap = lerp(GAP_MAX_PT, GAP_MIN_PT, (density - 1) / 99);
  const cellW = box.w + gap;
  const cellH = box.h + gap;

  const defaultAngle = layout === "honeycomb" ? 30 : layout === "diagonal" ? 45 : 0;
  const angle = Number.isFinite(o.watermarkAngle) ? (o.watermarkAngle as number) : defaultAngle;

  const stepY = layout === "honeycomb" ? cellH * HEX_ROW_RATIO : cellH;
  const rowOffset = layout === "honeycomb" || layout === "diagonal";

  return { logoW: box.w, logoH: box.h, stepX: cellW, stepY, rowOffset, angle };
}

/** Logo box (pt) honouring the asset aspect ratio, clamped to the page. */
function logoBox(ctx: StreamContext, asset: LoadedPdfKitAsset): { w: number; h: number } {
  const o = ctx.options;
  const combined = clamp(o.watermarkScale ?? 50, 1, 100);
  const logoScale = clamp(o.watermarkLogoScale ?? combined, 1, 100);
  const aspect = resolveAspect(asset);

  let w = lerp(LOGO_MIN_PT, LOGO_MAX_PT, (logoScale - 1) / 99);
  let h = w / aspect;

  const maxDim = Math.min(ctx.pageWidth, ctx.pageHeight) * 0.5;
  if (w > maxDim) { h *= maxDim / w; w = maxDim; }
  if (h > maxDim) { w *= maxDim / h; h = maxDim; }
  return { w, h };
}

/* ── Drawing ──────────────────────────────────────────────────────── */

/**
 * Minimal view of a pre-opened PDFKit image. Opening the raster once and
 * passing the same object to every `doc.image(...)` call makes PDFKit embed a
 * single XObject and merely reference it per tile — without this the logo PNG
 * is re-embedded for every tile and the file size scales with tile count.
 */
interface OpenedImage { width: number; height: number; obj?: unknown }
interface DocWithOpenImage {
  openImage(src: Buffer): OpenedImage;
  image(src: OpenedImage, x: number, y: number, opts: { width: number; height: number }): unknown;
}

function drawImageTile(
  ctx: StreamContext,
  opened: OpenedImage | null,
  asset: LoadedPdfKitAsset,
  centerX: number,
  centerY: number,
  geom: WatermarkGeometry,
  opacity: number,
): void {
  const x = centerX - geom.logoW / 2;
  const y = centerY - geom.logoH / 2;
  if (opened) {
    // Raster: reuse the single embedded XObject; opacity is inherited from the layer.
    (ctx.doc as unknown as DocWithOpenImage).image(opened, x, y, { width: geom.logoW, height: geom.logoH });
  } else {
    // SVG (vector): draw per tile; no raster duplication to worry about.
    drawAsset(ctx.doc, asset, x, y, geom.logoW, geom.logoH, opacity, "xMidYMid meet");
  }
}

function drawTextTile(ctx: StreamContext, text: string, font: string, fontSize: number, centerX: number, centerY: number, width: number): void {
  // No `width`/wrapping option: a wrapped text run lets PDFKit auto-paginate
  // when the baseline falls outside the page (our over-scan draws past the
  // page edges), which would silently inflate the page count.
  ctx.doc.font(font).fontSize(fontSize).fillColor("#555555").text(text, centerX - width / 2, centerY - fontSize / 2, {
    lineBreak: false,
  });
}

export function drawWatermark(ctx: StreamContext, layer: "background" | "foreground"): void {
  if (!shouldDrawWatermark(ctx, layer)) return;

  const text = ctx.options.watermarkText?.trim();
  const asset = ctx.watermarkAsset;
  if (!text && !asset) return;

  const opacity = asOpacity(ctx.options.watermarkOpacity, 0.22);
  const layout = resolveWatermarkLayout(ctx.options);

  // Resolve the tile box: image keeps its aspect ratio; text is measured.
  let textFont = "";
  let textSize = 0;
  let box: { w: number; h: number };
  if (asset) {
    box = logoBox(ctx, asset);
  } else {
    const combined = clamp(ctx.options.watermarkScale ?? 50, 1, 100);
    const logoScale = clamp(ctx.options.watermarkLogoScale ?? combined, 1, 100);
    textSize = lerp(11, 40, (logoScale - 1) / 99);
    textFont = ctx.fontResolver.resolve({ fallbackFont: ctx.boldFontName, text: text!, defaultBold: true });
    ctx.doc.font(textFont).fontSize(textSize);
    box = { w: Math.max(1, ctx.doc.widthOfString(text!)), h: textSize };
  }

  const geom = computeGeometry(ctx, layout, box);
  if (!Number.isFinite(geom.stepX) || geom.stepX <= 0 || !Number.isFinite(geom.stepY) || geom.stepY <= 0) return;

  const cx = safeNumber(ctx.pageWidth / 2, 0);
  const cy = safeNumber(ctx.pageHeight / 2, 0);

  // Embed a raster logo exactly once, then reference it from every tile.
  let opened: OpenedImage | null = null;
  if (asset && (asset.kind === "png" || asset.kind === "jpg")) {
    try {
      opened = (ctx.doc as unknown as DocWithOpenImage).openImage(asset.bytes);
    } catch {
      opened = null;
    }
  }

  ctx.doc.save();
  ctx.doc.opacity(opacity);
  if (geom.angle) ctx.doc.rotate(geom.angle, { origin: [cx, cy] });

  const draw = (centerX: number, centerY: number): void => {
    if (asset) drawImageTile(ctx, opened, asset, centerX, centerY, geom, opacity);
    else if (text) drawTextTile(ctx, text, textFont, textSize, centerX, centerY, box.w);
  };

  if (layout === "single") {
    draw(cx, cy);
  } else {
    // Over-scan past the page diagonal so the rotated lattice covers every corner.
    const reach = Math.hypot(ctx.pageWidth, ctx.pageHeight) / 2 + Math.max(geom.stepX, geom.stepY);
    let row = 0;
    for (let y = cy - reach; y <= cy + reach; y += geom.stepY, row++) {
      const shift = geom.rowOffset && row % 2 !== 0 ? geom.stepX / 2 : 0;
      for (let x = cx - reach - shift; x <= cx + reach; x += geom.stepX) {
        draw(x + shift, y);
      }
    }
  }

  ctx.doc.restore();
  ctx.doc.opacity(1);
}
