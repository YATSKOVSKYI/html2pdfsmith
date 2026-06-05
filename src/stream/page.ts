import type { RenderHtmlToPdfOptions } from "../types";
import { safeNumber } from "../units";
import { COLORS, type PdfKitDocument, type StreamContext, clamp, mm, pageLayout } from "./layout";
import { drawAssetInBox, drawAssetSafely } from "./assets";
import { drawWatermark } from "./watermark";

export { drawWatermark, shouldDrawWatermark, watermarkLayer } from "./watermark";

export function pageTemplateHeight(template: RenderHtmlToPdfOptions["pageHeader"] | RenderHtmlToPdfOptions["pageFooter"]): number {
  if (!template?.text) return 0;
  return mm(safeNumber(template.heightMm, 8));
}

/** Largest header-logo nudge accepted, in mm, on either axis. */
export const HEADER_LOGO_MAX_OFFSET_MM = 20;

export interface HeaderLogoBoxInput {
  /** Logo size knob, 1..200 (100 = default). */
  logoScale?: number | undefined;
  /** Content (table) width in pt — the band the logo is anchored within. */
  contentWidthPt: number;
  /** Header band height in pt. */
  headerHeightPt: number;
  /** Page margin in pt — how much room exists left of / above the anchor. */
  marginPt: number;
  /** Horizontal nudge from the left anchor, in mm (clamped to ±{@link HEADER_LOGO_MAX_OFFSET_MM}). */
  offsetXMm?: number | undefined;
  /** Vertical nudge from the header top, in mm (clamped to ±{@link HEADER_LOGO_MAX_OFFSET_MM}). */
  offsetYMm?: number | undefined;
}

export interface HeaderLogoBox {
  /** Horizontal nudge applied to the left anchor, in pt. */
  xOffsetPt: number;
  /** Vertical nudge applied to the top anchor, in pt. */
  yOffsetPt: number;
  /** Logo box width in pt (object-fit: contain inside this box). */
  widthPt: number;
  /** Logo box height in pt. */
  heightPt: number;
}

/**
 * Single source of truth for the header-logo geometry. The PDF renderer and the
 * client preview both derive the logo box from this so what users arrange in the
 * editor matches the generated PDF. The box is anchored at the header's top-left
 * (`margin`, `top`); offsets nudge it from there. At offset 0 the box matches the
 * historical output (`width = 60 + logoScale*1.8`, `height = min(42, header-4)`).
 */
export function headerLogoBox(input: HeaderLogoBoxInput): HeaderLogoBox {
  const logoScale = clamp(safeNumber(input.logoScale, 100), 1, 200);
  // Height is the binding dimension and scales linearly with logoScale, so the
  // knob actually resizes the logo (with `object-fit: contain` a fixed-height box
  // would leave height-limited logos unchanged). 100% ≈ 40pt; clamped 12..84pt.
  // Width is a generous cap (so wide logos are not cropped) but is not the usual
  // constraint, so the logo tracks the box height.
  const k = logoScale / 100;
  const heightPt = clamp(40 * k, 12, 84);
  const widthPt = Math.min(Math.max(0, input.contentWidthPt) * 0.6, heightPt * 8);

  const maxOff = HEADER_LOGO_MAX_OFFSET_MM;
  const offXMm = clamp(safeNumber(input.offsetXMm, 0), -maxOff, maxOff);
  const offYMm = clamp(safeNumber(input.offsetYMm, 0), -maxOff, maxOff);

  // Allow nudging in both directions while keeping the box on the physical page.
  // Anchor sits at (margin, top). Leftward/upward room is the page margin; rightward
  // room runs to the page's right margin; downward the logo may extend past the
  // header band into the content (an explicit user choice), so only the ±20mm cap
  // bounds it there.
  const marginPt = Math.max(0, safeNumber(input.marginPt, 0));
  const xOffsetPt = clamp(mm(offXMm), -marginPt, Math.max(0, input.contentWidthPt - widthPt + marginPt));
  const yOffsetPt = Math.max(mm(offYMm), -marginPt);

  return { xOffsetPt, yOffsetPt, widthPt, heightPt };
}

export function pageNumberSettings(options: RenderHtmlToPdfOptions): { enabled: boolean; format: string; align: "left" | "center" | "right"; fontSize: number; color: string } {
  if (!options.pageNumbers) {
    return { enabled: false, format: "", align: "center", fontSize: 8, color: COLORS.text };
  }
  if (typeof options.pageNumbers === "boolean") {
    return { enabled: options.pageNumbers, format: "Page {page}", align: "center", fontSize: 8, color: COLORS.text };
  }
  return {
    enabled: options.pageNumbers.enabled ?? true,
    format: options.pageNumbers.format ?? "Page {page}",
    align: options.pageNumbers.align ?? "center",
    fontSize: Math.max(1, safeNumber(options.pageNumbers.fontSize, 8)),
    color: options.pageNumbers.color ?? COLORS.text,
  };
}

export function reservedHeaderHeight(options: RenderHtmlToPdfOptions): number {
  return pageTemplateHeight(options.pageHeader);
}

export function reservedFooterHeight(options: RenderHtmlToPdfOptions): number {
  const footer = pageTemplateHeight(options.pageFooter);
  const numbers = pageNumberSettings(options).enabled ? mm(8) : 0;
  return Math.max(footer, numbers);
}

export function drawPageTemplate(ctx: StreamContext, template: RenderHtmlToPdfOptions["pageHeader"] | RenderHtmlToPdfOptions["pageFooter"], y: number, height: number): void {
  const text = template?.text?.trim();
  if (!template || !text || height <= 0) return;
  const fontSize = Math.max(1, safeNumber(template.fontSize, 8));
  const font = ctx.fontResolver.resolve({
    style: template.fontFamily ? { "font-family": template.fontFamily } : {},
    fallbackFont: ctx.regularFontName,
    text,
  });
  ctx.doc.font(font).fontSize(fontSize).fillColor(template.color ?? "#59606b").text(text, ctx.margin, y + Math.max(0, (height - fontSize) / 2) - 1, {
    width: ctx.tableWidth,
    align: template.align ?? "left",
    lineBreak: false,
    ellipsis: true,
  });
}

export function drawPageChrome(ctx: StreamContext): void {
  const headerHeight = reservedHeaderHeight(ctx.options);
  const footerHeight = reservedFooterHeight(ctx.options);
  if (headerHeight > 0) {
    drawPageTemplate(ctx, ctx.options.pageHeader, ctx.margin, headerHeight);
  }
  if (footerHeight > 0) {
    drawPageTemplate(ctx, ctx.options.pageFooter, ctx.pageHeight - ctx.margin - footerHeight, footerHeight);
  }

  const pageNumbers = pageNumberSettings(ctx.options);
  if (!pageNumbers.enabled) return;
  const text = pageNumbers.format.replace(/\{page\}/g, String(ctx.pages)).replace(/\{total\}/g, "?");
  const font = ctx.fontResolver.resolve({ fallbackFont: ctx.regularFontName, text });
  ctx.doc.font(font).fontSize(pageNumbers.fontSize).fillColor(pageNumbers.color).text(text, ctx.margin, ctx.pageHeight - ctx.margin - footerHeight + Math.max(0, (footerHeight - pageNumbers.fontSize) / 2) - 1, {
    width: ctx.tableWidth,
    align: pageNumbers.align,
    lineBreak: false,
    ellipsis: true,
  });
}

export function finishPage(ctx: StreamContext): void {
  drawWatermark(ctx, "foreground");
}

export function addPage(ctx: StreamContext): void {
  finishPage(ctx);
  ctx.doc.addPage({ size: ctx.pageSize, layout: pageLayout(ctx.orientation), margin: 0 });
  ctx.y = ctx.contentTop;
  // Reset the head-avoidance band each page; the table renderer re-sets it once
  // the page's header/price rows are drawn.
  ctx.watermarkClipTop = ctx.contentTop;
  drawWatermark(ctx, "background");
  drawPageChrome(ctx);
}

export function fitFontSize(doc: PdfKitDocument, fontName: string, text: string, size: number, width: number, min = 6): number {
  let current = size;
  doc.font(fontName);
  while (current > min) {
    doc.fontSize(current);
    if (doc.widthOfString(text) <= width) break;
    current -= 0.5;
  }
  return current;
}

export function drawHeader(ctx: StreamContext): void {
  if (ctx.options.hideHeader) return;
  const hasContacts = ctx.parsed.contactItems.length > 0 || !!ctx.qrAsset;
  const headerHeight = hasContacts ? mm(31) : mm(18);
  const top = safeNumber(ctx.y, ctx.contentTop);

  if (ctx.logoAsset) {
    const box = headerLogoBox({
      logoScale: ctx.options.logoScale,
      contentWidthPt: ctx.tableWidth,
      headerHeightPt: headerHeight,
      marginPt: ctx.margin,
      offsetXMm: ctx.options.logoOffsetXMm,
      offsetYMm: ctx.options.logoOffsetYMm,
    });
    // Left-align the logo within its box (the box width is a generous cap, so
    // centering would push the logo right). This matches the client preview.
    drawAssetInBox(ctx, ctx.logoAsset, ctx.margin + box.xOffsetPt, top + box.yOffsetPt, box.widthPt, box.heightPt, { "object-position": "left center" }, 1, "logo");
  } else {
    const brand = ctx.parsed.brandText || "DOCUMENT";
    const brandFont = ctx.fontResolver.resolve({ fallbackFont: ctx.boldFontName, text: brand, defaultBold: true });
    const fontSize = fitFontSize(ctx.doc, brandFont, brand, 21, ctx.tableWidth * 0.42, 11);
    ctx.doc.font(brandFont).fontSize(fontSize).fillColor(COLORS.text).text(brand, ctx.margin, top, {
      width: ctx.tableWidth * 0.45,
      lineBreak: false,
    });
  }

  let right = ctx.pageWidth - ctx.margin;
  if (ctx.qrAsset) {
    const size = Math.min(76, headerHeight - 4);
    right -= size;
    drawAssetSafely(ctx, ctx.qrAsset, right, top, size, size, 1, "qr");
    right -= 10;
  }

  if (ctx.parsed.contactItems.length > 0) {
    const maxWidth = Math.max(1, Math.min(235, right - ctx.margin - 160));
    let y = top;
    for (const item of ctx.parsed.contactItems.slice(0, 5)) {
      const font = ctx.fontResolver.resolve({ fallbackFont: ctx.regularFontName, text: item });
      const fontSize = fitFontSize(ctx.doc, font, item, 8.5, maxWidth, 6.5);
      ctx.doc.font(font).fontSize(fontSize).fillColor(COLORS.text).text(item, right - maxWidth, y, {
        width: maxWidth,
        align: "right",
        lineBreak: false,
      });
      y += fontSize + 4;
    }
  }

  ctx.y += headerHeight + 8;
}

export function ensureSpace(ctx: StreamContext, height: number): void {
  if (safeNumber(ctx.y, 0) + Math.max(0, safeNumber(height, 0)) > ctx.contentBottom) addPage(ctx);
}

