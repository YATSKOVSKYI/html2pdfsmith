import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { discoverFontPaths, loadImage, resolveFontPaths } from "./assets";
import { parseBorderStyle, parseBoxSpacing, parseCssColor, parseLengthPx, type BoxSpacing, type BorderStyle, type StyleMap } from "./css";
import { resolveGoogleFont } from "./google-fonts";
import { parsePrintableHtml } from "./html";
import { prepareHtmlForRender } from "./resources";
import type {
  PageOrientation,
  PdfBundledFontFace,
  ParsedBlock,
  ParsedCell,
  ParsedDocument,
  ParsedInlineSegment,
  ParsedRow,
  ParsedTable,
  RenderHtmlToPdfOptions,
  RenderHtmlToPdfResult,
} from "./types";
import {
  calculateFontScale,
  calculateHeaderCellHeight,
  calculatePaddingScale,
  clamp,
  determineOrientation,
  mm,
} from "./units";
import { WarningSink } from "./warnings";
import { protectPdfWithQpdf } from "./protect";

type PdfKitDocument = InstanceType<typeof PDFDocument>;

interface RegisteredFontPair {
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
}

interface StreamContext {
  doc: PdfKitDocument;
  warnings: WarningSink;
  options: RenderHtmlToPdfOptions;
  parsed: ParsedDocument;
  columns: number;
  orientation: PageOrientation;
  margin: number;
  contentTop: number;
  contentBottom: number;
  pageWidth: number;
  pageHeight: number;
  y: number;
  pages: number;
  columnWidths: number[];
  tableWidth: number;
  fontScale: number;
  paddingScale: number;
  baseFontSize: number;
  headerFontSize: number;
  priceFontSize: number;
  sectionFontSize: number;
  cellPaddingX: number;
  cellPaddingY: number;
  regularFontName: string;
  boldFontName: string;
  italicFontName: string;
  boldItalicFontName: string;
  fontFamilies: Map<string, RegisteredFontPair>;
  watermarkAsset: LoadedPdfKitAsset | null;
  logoAsset: LoadedPdfKitAsset | null;
  qrAsset: LoadedPdfKitAsset | null;
  assetCache: Map<string, Promise<LoadedPdfKitAsset | null>>;
  currentTableStyle: TableRenderStyle;
}

interface LoadedPdfKitAsset {
  bytes: Buffer;
  kind: "png" | "jpg" | "svg";
  svgText?: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface TableRenderStyle {
  borderCollapse: boolean;
  border: BorderStyle;
}

interface TextBoxStyle {
  margin: BoxSpacing;
  padding: BoxSpacing;
  border: BorderStyle;
}

const COLORS = {
  text: "#22252a",
  border: "#d7dce3",
  grid: "#e4e7ec",
  headerBg: "#f7f8fa",
  paramBg: "#f4f6f8",
  evenBg: "#fafbfc",
  sectionBg: "#1f2329",
  sectionText: "#ffffff",
  diffBg: "#fff1bf",
};

function asOpacity(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (value <= 1) return clamp(value, 0.01, 1);
  return clamp(0.15 + (1 - 0.15) * ((value - 1) / 99), 0.01, 1);
}

function pageLayout(orientation: PageOrientation): "portrait" | "landscape" {
  return orientation === "portrait" ? "portrait" : "landscape";
}

function computeColumnWidths(columns: number, contentWidth: number): number[] {
  if (columns <= 1) return [contentWidth];
  const dataColumns = columns - 1;
  const labelWidth = clamp(118 - Math.max(0, dataColumns - 4) * 4.5, 58, Math.min(155, contentWidth * 0.28));
  const dataWidth = (contentWidth - labelWidth) / dataColumns;
  return [labelWidth, ...Array.from({ length: dataColumns }, () => dataWidth)];
}

function pxToPt(value: number): number {
  return value * 72 / 96;
}

function cssLengthPt(value: string | undefined, base = 0): number | undefined {
  const px = parseLengthPx(value, base ? base * 96 / 72 : 0);
  return px == null ? undefined : pxToPt(px);
}

function boxPxToPt(box: BoxSpacing): BoxSpacing {
  return {
    top: pxToPt(box.top),
    right: pxToPt(box.right),
    bottom: pxToPt(box.bottom),
    left: pxToPt(box.left),
  };
}

function cellPadding(ctx: StreamContext, cell: ParsedCell): BoxSpacing {
  return boxPxToPt(parseBoxSpacing(cell.styles, "padding", {
    top: ctx.cellPaddingY * 96 / 72,
    right: ctx.cellPaddingX * 96 / 72,
    bottom: ctx.cellPaddingY * 96 / 72,
    left: ctx.cellPaddingX * 96 / 72,
  }));
}

function spacingPt(styles: StyleMap, property: "padding" | "margin", fallback: BoxSpacing): BoxSpacing {
  return boxPxToPt(parseBoxSpacing(styles, property, {
    top: fallback.top * 96 / 72,
    right: fallback.right * 96 / 72,
    bottom: fallback.bottom * 96 / 72,
    left: fallback.left * 96 / 72,
  }));
}

function borderPxToPt(border: BorderStyle): BorderStyle {
  const out: BorderStyle = { width: pxToPt(border.width) };
  if (border.color) out.color = border.color;
  return out;
}

function cellBorder(ctx: StreamContext, cell: ParsedCell): BorderStyle {
  return borderPxToPt(parseBorderStyle(cell.styles, {
    width: ctx.currentTableStyle.border.width * 96 / 72,
    color: cell.isParam ? COLORS.border : ctx.currentTableStyle.border.color ?? COLORS.grid,
  }));
}

function strokeCellBorder(ctx: StreamContext, cell: ParsedCell, x: number, y: number, width: number, height: number, border: BorderStyle): void {
  if (border.width <= 0) return;
  const lineWidth = ctx.currentTableStyle.borderCollapse ? Math.max(0.2, border.width * 0.75) : border.width;
  const color = border.color ?? (cell.isParam ? COLORS.border : COLORS.grid);

  ctx.doc.save();
  ctx.doc.strokeColor(color).lineWidth(lineWidth);

  if (!cell.isSpanPlaceholder && cell.rowspan <= 1) {
    ctx.doc.rect(x, y, width, height).stroke();
    ctx.doc.restore();
    return;
  }

  ctx.doc.moveTo(x, y).lineTo(x, y + height);
  ctx.doc.moveTo(x + width, y).lineTo(x + width, y + height);

  if (!cell.isSpanPlaceholder) {
    ctx.doc.moveTo(x, y).lineTo(x + width, y);
  }
  if (cell.isSpanPlaceholderEnd) {
    ctx.doc.moveTo(x, y + height).lineTo(x + width, y + height);
  }

  ctx.doc.stroke();
  ctx.doc.restore();
}

function tableStyle(style: StyleMap): TableRenderStyle {
  return {
    borderCollapse: (style["border-collapse"] ?? "").trim().toLowerCase() === "collapse",
    border: borderPxToPt(parseBorderStyle(style, { width: 0.45 * 96 / 72, color: COLORS.grid })),
  };
}

function textBoxStyle(block: Extract<ParsedBlock, { type: "heading" | "paragraph" | "list-item" | "blockquote" | "preformatted" }>): TextBoxStyle {
  const margin = spacingPt(block.style, "margin", {
    top: blockMarginTop(block),
    right: 0,
    bottom: blockMarginBottom(block),
    left: 0,
  });
  const defaultPadding = block.type === "preformatted"
    ? { top: 6, right: 7, bottom: 6, left: 7 }
    : block.type === "blockquote"
      ? { top: 2, right: 0, bottom: 2, left: 10 }
      : { top: 0, right: 0, bottom: 0, left: 0 };
  const padding = spacingPt(block.style, "padding", defaultPadding);
  const border = borderPxToPt(parseBorderStyle(block.style, {
    width: block.type === "blockquote" ? 0 : 0,
    color: COLORS.border,
  }));
  return { margin, padding, border };
}

function maxDocumentColumns(parsed: ParsedDocument): number {
  return Math.max(
    1,
    ...parsed.blocks.map((block) => block.type === "table" ? block.table.columnCount : 1),
  );
}

function chunksToBuffer(doc: PdfKitDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function normalizeFontFamily(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  return first ? first.toLowerCase() : undefined;
}

function googleFontFamilies(options: RenderHtmlToPdfOptions): string[] {
  const families = [options.font?.googleFont, ...(options.font?.googleFonts ?? [])]
    .map((family) => family?.trim())
    .filter((family): family is string => Boolean(family));
  return [...new Map(families.map((family) => [family.toLowerCase(), family])).values()];
}

function bundledFontFaces(options: RenderHtmlToPdfOptions): PdfBundledFontFace[] {
  const faces = [options.font?.bundled, ...(options.font?.bundledFonts ?? [])]
    .filter((face): face is PdfBundledFontFace => Boolean(face?.family && face.regularPath));
  return [...new Map(faces.map((face) => [face.family.trim().toLowerCase(), face])).values()];
}

function registerFontPair(doc: PdfKitDocument, family: string, paths: { regularPath?: string; boldPath?: string; italicPath?: string; boldItalicPath?: string }, warnings: WarningSink): RegisteredFontPair | null {
  const regularPath = paths.regularPath;
  const boldPath = paths.boldPath ?? regularPath;
  const italicPath = paths.italicPath ?? regularPath;
  const boldItalicPath = paths.boldItalicPath ?? boldPath ?? italicPath;
  if (!regularPath || !existsSync(regularPath)) return null;
  const slug = normalizeFontFamily(family)?.replace(/[^a-z0-9_-]+/g, "-") ?? `font-${Date.now()}`;
  const regularName = `font-${slug}-regular`;
  const boldName = `font-${slug}-bold`;
  const italicName = `font-${slug}-italic`;
  const boldItalicName = `font-${slug}-bold-italic`;
  try {
    doc.registerFont(regularName, regularPath);
    if (boldPath && existsSync(boldPath)) doc.registerFont(boldName, boldPath);
    else doc.registerFont(boldName, regularPath);
    if (italicPath && existsSync(italicPath)) doc.registerFont(italicName, italicPath);
    else doc.registerFont(italicName, regularPath);
    if (boldItalicPath && existsSync(boldItalicPath)) doc.registerFont(boldItalicName, boldItalicPath);
    else doc.registerFont(boldItalicName, boldPath ?? italicPath ?? regularPath);
    return { regular: regularName, bold: boldName, italic: italicName, boldItalic: boldItalicName };
  } catch (error) {
    warnings.add("font_family_register_failed", `Could not register font family "${family}": ${String(error)}`);
    return null;
  }
}

async function registerFonts(doc: PdfKitDocument, options: RenderHtmlToPdfOptions, warnings: WarningSink): Promise<RegisteredFontPair & { families: Map<string, RegisteredFontPair> }> {
  const resolved = await resolveFontPaths(options.font, warnings, options.resourcePolicy);
  const regularPath = resolved.regularPath;
  const boldPath = resolved.boldPath ?? regularPath;
  const families = new Map<string, RegisteredFontPair>();

  for (const family of googleFontFamilies(options)) {
    const paths = await resolveGoogleFont(family, warnings);
    if (!paths) continue;
    const pair = registerFontPair(doc, family, paths, warnings);
    const normalized = normalizeFontFamily(family);
    if (pair && normalized) families.set(normalized, pair);
  }

  for (const face of bundledFontFaces(options)) {
    const pair = registerFontPair(doc, face.family, face, warnings);
    const normalized = normalizeFontFamily(face.family);
    if (pair && normalized) families.set(normalized, pair);
  }

  if (regularPath && existsSync(regularPath)) {
    try {
      doc.registerFont("regular", regularPath);
      if (boldPath && existsSync(boldPath)) doc.registerFont("bold", boldPath);
      else doc.registerFont("bold", regularPath);
      if (resolved.italicPath && existsSync(resolved.italicPath)) doc.registerFont("italic", resolved.italicPath);
      else doc.registerFont("italic", regularPath);
      if (resolved.boldItalicPath && existsSync(resolved.boldItalicPath)) doc.registerFont("boldItalic", resolved.boldItalicPath);
      else doc.registerFont("boldItalic", boldPath ?? resolved.italicPath ?? regularPath);
      return { regular: "regular", bold: "bold", italic: "italic", boldItalic: "boldItalic", families };
    } catch (error) {
      warnings.add("font_register_failed", `Could not register custom font: ${String(error)}`);
    }
  }

  warnings.add("font_fallback", "Falling back to Helvetica; pass explicit fonts for non-Latin text. This keeps the default memory footprint low.");
  return { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique", boldItalic: "Helvetica-BoldOblique", families };
}

async function loadPdfKitAsset(src: string | null | undefined, warnings: WarningSink, options: Pick<RenderHtmlToPdfOptions, "baseUrl" | "resourcePolicy">): Promise<LoadedPdfKitAsset | null> {
  if (!src) return null;
  const loaded = await loadImage(src, warnings, options);
  if (!loaded) return null;
  if (loaded.kind !== "png" && loaded.kind !== "jpg" && loaded.kind !== "svg") return null;
  const bytes = Buffer.from(loaded.bytes);
  const asset: LoadedPdfKitAsset = { bytes, kind: loaded.kind };
  if (loaded.kind === "svg") asset.svgText = bytes.toString("utf8");
  return asset;
}

function getAsset(ctx: StreamContext, src: string): Promise<LoadedPdfKitAsset | null> {
  let asset = ctx.assetCache.get(src);
  if (!asset) {
    asset = loadPdfKitAsset(src, ctx.warnings, ctx.options);
    ctx.assetCache.set(src, asset);
  }
  return asset;
}

function drawAsset(doc: PdfKitDocument, asset: LoadedPdfKitAsset, x: number, y: number, width: number, height: number, opacity = 1): void {
  doc.save();
  doc.opacity(opacity);
  if (asset.kind === "svg" && asset.svgText) {
    SVGtoPDF(doc, asset.svgText, x, y, { width, height, preserveAspectRatio: "xMidYMid meet" });
  } else {
    doc.image(asset.bytes, x, y, { fit: [width, height], align: "center", valign: "center" });
  }
  doc.restore();
}

function drawAssetSafely(ctx: StreamContext, asset: LoadedPdfKitAsset, x: number, y: number, width: number, height: number, opacity = 1, label = "image"): void {
  try {
    drawAsset(ctx.doc, asset, x, y, width, height, opacity);
  } catch (error) {
    ctx.warnings.add("image_draw_failed", `Failed to draw ${label}: ${String(error)}`);
  }
}

function watermarkLayer(options: RenderHtmlToPdfOptions): "background" | "foreground" | "both" {
  return options.watermarkLayer ?? "background";
}

function shouldDrawWatermark(ctx: StreamContext, layer: "background" | "foreground"): boolean {
  const configured = watermarkLayer(ctx.options);
  return configured === "both" || configured === layer;
}

function drawWatermark(ctx: StreamContext, layer: "background" | "foreground"): void {
  if (!shouldDrawWatermark(ctx, layer)) return;
  const text = ctx.options.watermarkText?.trim();
  const asset = ctx.watermarkAsset;
  if (!text && !asset) return;

  const opacity = asOpacity(ctx.options.watermarkOpacity, 0.22);
  const scale = clamp(ctx.options.watermarkScale ?? 50, 1, 100);
  const step = 105 + scale * 2.7;
  const angle = ctx.options.patternType === "honeycomb" ? 30 : 45;
  const startX = ctx.margin;
  const startY = ctx.margin;
  const endX = ctx.pageWidth - ctx.margin;
  const endY = ctx.pageHeight - ctx.margin;

  ctx.doc.save();
  ctx.doc.opacity(opacity);
  for (let y = startY; y < endY; y += step) {
    for (let x = startX; x < endX; x += step) {
      ctx.doc.save();
      ctx.doc.rotate(angle, { origin: [x, y] });
      if (asset) {
        const side = 24 + scale * 1.15;
        drawAssetSafely(ctx, asset, x, y, side, side, 1, "watermark");
      } else if (text) {
        ctx.doc.font(ctx.boldFontName).fontSize(12 + scale * 0.16).fillColor("#555555").text(text, x, y, {
          width: step * 0.9,
          lineBreak: false,
        });
      }
      ctx.doc.restore();
    }
  }
  ctx.doc.restore();
  ctx.doc.opacity(1);
}

function pageTemplateHeight(template: RenderHtmlToPdfOptions["pageHeader"] | RenderHtmlToPdfOptions["pageFooter"]): number {
  if (!template?.text) return 0;
  return mm(template.heightMm ?? 8);
}

function pageNumberSettings(options: RenderHtmlToPdfOptions): { enabled: boolean; format: string; align: "left" | "center" | "right"; fontSize: number; color: string } {
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
    fontSize: options.pageNumbers.fontSize ?? 8,
    color: options.pageNumbers.color ?? COLORS.text,
  };
}

function reservedHeaderHeight(options: RenderHtmlToPdfOptions): number {
  return pageTemplateHeight(options.pageHeader);
}

function reservedFooterHeight(options: RenderHtmlToPdfOptions): number {
  const footer = pageTemplateHeight(options.pageFooter);
  const numbers = pageNumberSettings(options).enabled ? mm(8) : 0;
  return Math.max(footer, numbers);
}

function drawPageTemplate(ctx: StreamContext, template: RenderHtmlToPdfOptions["pageHeader"] | RenderHtmlToPdfOptions["pageFooter"], y: number, height: number): void {
  const text = template?.text?.trim();
  if (!template || !text || height <= 0) return;
  const fontSize = template.fontSize ?? 8;
  ctx.doc.font(ctx.regularFontName).fontSize(fontSize).fillColor(template.color ?? "#59606b").text(text, ctx.margin, y + Math.max(0, (height - fontSize) / 2) - 1, {
    width: ctx.tableWidth,
    align: template.align ?? "left",
    lineBreak: false,
    ellipsis: true,
  });
}

function drawPageChrome(ctx: StreamContext): void {
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
  ctx.doc.font(ctx.regularFontName).fontSize(pageNumbers.fontSize).fillColor(pageNumbers.color).text(text, ctx.margin, ctx.pageHeight - ctx.margin - footerHeight + Math.max(0, (footerHeight - pageNumbers.fontSize) / 2) - 1, {
    width: ctx.tableWidth,
    align: pageNumbers.align,
    lineBreak: false,
    ellipsis: true,
  });
}

function finishPage(ctx: StreamContext): void {
  drawWatermark(ctx, "foreground");
}

function addPage(ctx: StreamContext): void {
  finishPage(ctx);
  ctx.doc.addPage({ size: ctx.options.page?.size ?? "A4", layout: pageLayout(ctx.orientation), margin: 0 });
  ctx.y = ctx.contentTop;
  drawWatermark(ctx, "background");
  drawPageChrome(ctx);
}

function fitFontSize(doc: PdfKitDocument, fontName: string, text: string, size: number, width: number, min = 6): number {
  let current = size;
  doc.font(fontName);
  while (current > min) {
    doc.fontSize(current);
    if (doc.widthOfString(text) <= width) break;
    current -= 0.5;
  }
  return current;
}

function drawHeader(ctx: StreamContext): void {
  if (ctx.options.hideHeader) return;
  const hasContacts = ctx.parsed.contactItems.length > 0 || !!ctx.qrAsset;
  const headerHeight = hasContacts ? mm(31) : mm(18);
  const top = ctx.y;

  if (ctx.logoAsset) {
    const logoScale = clamp(ctx.options.logoScale ?? 100, 1, 200);
    drawAssetSafely(ctx, ctx.logoAsset, ctx.margin, top, 60 + logoScale * 1.8, Math.min(42, headerHeight - 4), 1, "logo");
  } else {
    const brand = ctx.parsed.brandText || "DOCUMENT";
    const fontSize = fitFontSize(ctx.doc, ctx.boldFontName, brand, 21, ctx.tableWidth * 0.42, 11);
    ctx.doc.font(ctx.boldFontName).fontSize(fontSize).fillColor(COLORS.text).text(brand, ctx.margin, top, {
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
    const maxWidth = Math.min(235, right - ctx.margin - 160);
    let y = top;
    for (const item of ctx.parsed.contactItems.slice(0, 5)) {
      const fontSize = fitFontSize(ctx.doc, ctx.regularFontName, item, 8.5, maxWidth, 6.5);
      ctx.doc.font(ctx.regularFontName).fontSize(fontSize).fillColor(COLORS.text).text(item, right - maxWidth, y, {
        width: maxWidth,
        align: "right",
        lineBreak: false,
      });
      y += fontSize + 4;
    }
  }

  ctx.y += headerHeight + 8;
}

function ensureSpace(ctx: StreamContext, height: number): void {
  if (ctx.y + height > ctx.contentBottom) addPage(ctx);
}

function blockFontSize(block: ParsedBlock): number {
  if (block.type === "heading") {
    const defaults: Record<number, number> = { 1: 24, 2: 20, 3: 17, 4: 14, 5: 12, 6: 11 };
    return cssLengthPt(block.style["font-size"]) ?? defaults[block.level] ?? 12;
  }
  if (block.type === "preformatted") return cssLengthPt(block.style["font-size"]) ?? 9;
  if (block.type === "blockquote") return cssLengthPt(block.style["font-size"]) ?? 10.5;
  return cssLengthPt(block.style["font-size"]) ?? 10.5;
}

function pngDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpgDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker && marker >= 0xc0 && marker <= 0xc3) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

function svgDimensions(svgText: string | undefined): ImageDimensions | null {
  if (!svgText) return null;
  const svgTag = /<svg\b([^>]*)>/i.exec(svgText);
  if (!svgTag?.[1]) return null;
  const attrs = svgTag[1];
  const widthRaw = /\bwidth\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
  const heightRaw = /\bheight\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
  const viewBoxRaw = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
  const width = parseLengthPx(widthRaw);
  const height = parseLengthPx(heightRaw);
  const viewBox = viewBoxRaw?.trim().split(/[\s,]+/).map((part) => Number.parseFloat(part));
  const viewBoxWidth = viewBox && viewBox.length >= 4 ? viewBox[2] : undefined;
  const viewBoxHeight = viewBox && viewBox.length >= 4 ? viewBox[3] : undefined;

  if (width && height) return { width, height };
  if (width && viewBoxWidth && viewBoxHeight) return { width, height: width * viewBoxHeight / viewBoxWidth };
  if (height && viewBoxWidth && viewBoxHeight) return { width: height * viewBoxWidth / viewBoxHeight, height };
  if (viewBoxWidth && viewBoxHeight) return { width: viewBoxWidth, height: viewBoxHeight };
  return null;
}

function imageDimensions(asset: LoadedPdfKitAsset): ImageDimensions | null {
  if (asset.kind === "png") return pngDimensions(asset.bytes);
  if (asset.kind === "jpg") return jpgDimensions(asset.bytes);
  if (asset.kind === "svg") return svgDimensions(asset.svgText);
  return null;
}

function blockColor(block: ParsedBlock): string {
  return parseCssColor(block.style["color"]) ?? COLORS.text;
}

function blockMarginBottom(block: ParsedBlock): number {
  if (block.type === "heading") return cssLengthPt(block.style["margin-bottom"]) ?? 8;
  if (block.type === "paragraph" || block.type === "list-item" || block.type === "blockquote" || block.type === "preformatted") return cssLengthPt(block.style["margin-bottom"]) ?? 6;
  if (block.type === "image") return cssLengthPt(block.style["margin-bottom"]) ?? 8;
  return cssLengthPt(block.style["margin-bottom"]) ?? 4;
}

function blockMarginTop(block: ParsedBlock): number {
  return cssLengthPt(block.style["margin-top"]) ?? 0;
}

function lineGapForStyle(style: StyleMap, size: number, fallbackFactor: number): number {
  const raw = style["line-height"];
  if (!raw || raw.trim().toLowerCase() === "normal") return size * fallbackFactor;
  const trimmed = raw.trim();
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return size * fallbackFactor;
  if (/^[0-9.]+$/.test(trimmed)) return Math.max(0, size * numeric - size);
  if (trimmed.endsWith("%")) return Math.max(0, size * numeric / 100 - size);
  const length = cssLengthPt(trimmed);
  return length == null ? size * fallbackFactor : Math.max(0, length - size);
}

function inlineFont(ctx: StreamContext, segment: ParsedInlineSegment, fallbackFont: string): string {
  const family = normalizeFontFamily(segment.styles["font-family"]);
  const weight = segment.styles["font-weight"];
  const bold = weight === "bold" || Number(weight) >= 600;
  const italic = (segment.styles["font-style"] ?? "").toLowerCase() === "italic";
  if (family && ctx.fontFamilies.has(family)) {
    const pair = ctx.fontFamilies.get(family)!;
    if (bold && italic) return pair.boldItalic;
    if (italic) return pair.italic;
    return bold ? pair.bold : pair.regular;
  }
  if (family?.includes("mono") || family?.includes("courier")) {
    if (bold && italic) return "Courier-BoldOblique";
    if (italic) return "Courier-Oblique";
    return bold ? "Courier-Bold" : "Courier";
  }
  if (italic && bold) return ctx.boldItalicFontName;
  if (italic) return ctx.italicFontName;
  if (bold) return ctx.boldFontName;
  return fallbackFont;
}

function inlineSize(segment: ParsedInlineSegment, fallbackSize: number): number {
  return cssLengthPt(segment.styles["font-size"]) ?? fallbackSize;
}

function inlineColor(segment: ParsedInlineSegment, fallbackColor: string): string {
  return parseCssColor(segment.styles["color"]) ?? fallbackColor;
}

function inlineTextHeight(ctx: StreamContext, text: string, inlines: ParsedInlineSegment[], fallbackFont: string, fallbackSize: number, width: number, lineGap: number): number {
  const maxSize = Math.max(fallbackSize, ...inlines.map((segment) => inlineSize(segment, fallbackSize)));
  ctx.doc.font(fallbackFont).fontSize(maxSize);
  return ctx.doc.heightOfString(text || " ", { width, lineGap });
}

function drawInlineText(
  ctx: StreamContext,
  text: string,
  inlines: ParsedInlineSegment[],
  x: number,
  y: number,
  width: number,
  fallbackFont: string,
  fallbackSize: number,
  fallbackColor: string,
  lineGap: number,
  align: "left" | "center" | "right",
): void {
  const segments = inlines.length > 0 ? inlines : [{ text, styles: {} }];
  let first = true;
  for (const segment of segments) {
    const decoration = (segment.styles["text-decoration"] ?? "").toLowerCase();
    const options = {
      width,
      lineGap,
      align,
      continued: !segment.text.endsWith("\n") && segment !== segments[segments.length - 1],
      underline: decoration.includes("underline"),
      strike: decoration.includes("line-through"),
      link: segment.href,
    };
    ctx.doc
      .font(inlineFont(ctx, segment, fallbackFont))
      .fontSize(inlineSize(segment, fallbackSize))
      .fillColor(inlineColor(segment, fallbackColor));
    if (first) {
      ctx.doc.text(segment.text, x, y, options);
      first = false;
    } else {
      ctx.doc.text(segment.text, options);
    }
  }
  if (!first) ctx.doc.text("", { continued: false });
}

function drawTextBlock(ctx: StreamContext, block: Extract<ParsedBlock, { type: "heading" | "paragraph" | "list-item" | "blockquote" | "preformatted" }>): void {
  const size = blockFontSize(block);
  const font = block.type === "heading" || block.style["font-weight"] === "bold" || Number(block.style["font-weight"]) >= 600
    ? ctx.boldFontName
    : ctx.regularFontName;
  const prefix = block.type === "list-item"
    ? block.ordered ? `${block.index}. ` : "- "
    : "";
  const box = textBoxStyle(block);
  const indent = block.type === "list-item" ? 14 : 0;
  const boxX = ctx.margin + box.margin.left;
  const boxWidth = Math.max(20, ctx.tableWidth - box.margin.left - box.margin.right);
  const contentX = boxX + box.border.width + box.padding.left + indent;
  const contentWidth = Math.max(20, boxWidth - box.border.width * 2 - box.padding.left - box.padding.right - indent);
  const lineGap = lineGapForStyle(block.style, size, block.type === "preformatted" ? 0.1 : 0.22);
  ctx.doc.font(font).fontSize(size);
  const displayText = prefix + block.text;
  const displayInlines = prefix
    ? [{ text: prefix, styles: { "font-weight": block.type === "list-item" && block.ordered ? "400" : "700" } }, ...block.inlines]
    : block.inlines;
  const textHeightValue = inlineTextHeight(ctx, displayText, displayInlines, font, size, contentWidth, lineGap);
  const boxHeight = textHeightValue + box.padding.top + box.padding.bottom + box.border.width * 2;
  ensureSpace(ctx, box.margin.top + boxHeight + box.margin.bottom);
  ctx.y += box.margin.top;

  const bg = parseCssColor(block.style["background-color"]) ?? (block.type === "preformatted" ? "#f6f8fa" : undefined);
  if (bg) ctx.doc.rect(boxX, ctx.y, boxWidth, boxHeight).fill(bg);
  if (box.border.width > 0) ctx.doc.rect(boxX, ctx.y, boxWidth, boxHeight).strokeColor(box.border.color ?? COLORS.border).lineWidth(box.border.width).stroke();
  if (block.type === "blockquote") {
    const border = parseBorderStyle(block.style, { width: 3 * 96 / 72, color: parseCssColor(block.style["border-color"]) ?? COLORS.border });
    ctx.doc.rect(boxX, ctx.y, Math.max(2, pxToPt(border.width)), boxHeight).fill(border.color ?? COLORS.border);
  }

  drawInlineText(ctx, displayText, displayInlines, contentX, ctx.y + box.border.width + box.padding.top, contentWidth, font, size, blockColor(block), lineGap, block.style["text-align"] === "center" || block.style["text-align"] === "right" ? block.style["text-align"] as "center" | "right" : "left");
  ctx.y += boxHeight + box.margin.bottom;
}

async function drawImageBlock(ctx: StreamContext, block: Extract<ParsedBlock, { type: "image" }>): Promise<void> {
  const asset = await getAsset(ctx, block.src);
  if (!asset) return;
  const dims = imageDimensions(asset);
  const cssWidth = cssLengthPt(block.style["width"], ctx.tableWidth);
  const cssHeight = cssLengthPt(block.style["height"]);
  let width = cssWidth ?? (dims ? pxToPt(dims.width) : ctx.tableWidth);
  let height = cssHeight ?? (dims ? pxToPt(dims.height) : 180);
  if (dims && cssWidth != null && cssHeight == null) height = width * dims.height / dims.width;
  if (dims && cssHeight != null && cssWidth == null) width = height * dims.width / dims.height;
  if (width > ctx.tableWidth) {
    const scale = ctx.tableWidth / width;
    width = ctx.tableWidth;
    height *= scale;
  }
  if (height > 360) {
    const scale = 360 / height;
    height = 360;
    width *= scale;
  }
  ensureSpace(ctx, height + blockMarginTop(block) + blockMarginBottom(block));
  ctx.y += blockMarginTop(block);
  const align = block.style["text-align"] === "center"
    ? "center"
    : block.style["text-align"] === "right"
      ? "right"
      : "left";
  const x = align === "center" ? ctx.margin + (ctx.tableWidth - width) / 2 : align === "right" ? ctx.margin + ctx.tableWidth - width : ctx.margin;
  drawAssetSafely(ctx, asset, x, ctx.y, width, height, 1, "image block");
  ctx.y += height + blockMarginBottom(block);
}

function drawHrBlock(ctx: StreamContext, block: Extract<ParsedBlock, { type: "hr" }>): void {
  const top = blockMarginTop(block) || 6;
  const bottom = blockMarginBottom(block) || 6;
  ensureSpace(ctx, top + bottom + 2);
  ctx.y += top;
  ctx.doc.moveTo(ctx.margin, ctx.y).lineTo(ctx.margin + ctx.tableWidth, ctx.y).strokeColor(parseCssColor(block.style["border-color"]) ?? COLORS.border).lineWidth(cssLengthPt(block.style["border-width"]) ?? 0.7).stroke();
  ctx.y += bottom;
}

function fontForCell(ctx: StreamContext, cell: ParsedCell, row: ParsedRow): string {
  if (row.kind === "header" || row.kind === "price" || row.kind === "section" || cell.isParam) return ctx.boldFontName;
  return ctx.regularFontName;
}

function sizeForCell(ctx: StreamContext, cell: ParsedCell, row: ParsedRow): number {
  const cssSize = cssLengthPt(cell.styles["font-size"]) ?? cssLengthPt(row.styles["font-size"]);
  if (cssSize) return cssSize;
  if (row.kind === "section") return ctx.sectionFontSize;
  if (row.kind === "header") return ctx.headerFontSize;
  if (row.kind === "price") return ctx.priceFontSize;
  if (cell.isParam) return ctx.baseFontSize * 0.98;
  return ctx.baseFontSize;
}

function textHeight(ctx: StreamContext, text: string, font: string, size: number, width: number): number {
  ctx.doc.font(font).fontSize(size);
  return ctx.doc.heightOfString(text || " ", { width, lineGap: size * 0.18 });
}

function estimateRowHeight(ctx: StreamContext, row: ParsedRow): number {
  if (row.kind === "section") return 24 * ctx.paddingScale + 10;
  let height = row.kind === "header"
    ? Math.max(32, calculateHeaderCellHeight(ctx.columns) * 0.62)
    : row.kind === "price"
      ? 24 + 8 * ctx.paddingScale
      : 22 + 8 * ctx.paddingScale;

  let col = 0;
  for (const cell of row.cells) {
    if (cell.isSpanPlaceholder) {
      col += Math.max(1, cell.colspan);
      continue;
    }
    const span = Math.max(1, cell.colspan);
    const width = ctx.columnWidths.slice(col, col + span).reduce((sum, value) => sum + value, 0);
    const font = fontForCell(ctx, cell, row);
    const size = sizeForCell(ctx, cell, row);
    const padding = cellPadding(ctx, cell);
    const lineGap = lineGapForStyle({ ...row.styles, ...cell.styles }, size, 0.18);
    height = Math.max(height, inlineTextHeight(ctx, cell.text, cell.inlines, font, size, Math.max(12, width - padding.left - padding.right), lineGap) + padding.top + padding.bottom);
    col += span;
  }

  return Math.min(height, ctx.contentBottom - ctx.contentTop - 8);
}

async function drawRow(ctx: StreamContext, row: ParsedRow, index: number): Promise<void> {
  const height = estimateRowHeight(ctx, row);
  const y = ctx.y;

  if (row.kind === "section") {
    const text = row.cells.find((cell) => cell.text)?.text ?? "";
    ctx.doc.rect(ctx.margin, y, ctx.tableWidth, height).fill(COLORS.sectionBg);
    ctx.doc.font(ctx.boldFontName).fontSize(ctx.sectionFontSize).fillColor(COLORS.sectionText).text(text, ctx.margin + ctx.cellPaddingX, y + ctx.cellPaddingY, {
      width: ctx.tableWidth - ctx.cellPaddingX * 2,
      height: height - ctx.cellPaddingY * 2,
    });
    ctx.y = y + height;
    return;
  }

  let x = ctx.margin;
  let col = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    const width = ctx.columnWidths.slice(col, col + span).reduce((sum, value) => sum + value, 0);
    const padding = cellPadding(ctx, cell);
    const border = cellBorder(ctx, cell);
    const fill = cell.isDiff
      ? (parseCssColor(cell.styles["background-color"]) ?? COLORS.diffBg)
      : row.kind === "header" || row.kind === "price"
        ? (parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? COLORS.headerBg)
        : cell.isParam
          ? (parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? COLORS.paramBg)
          : row.kind === "body" && index % 2 === 1
            ? (parseCssColor(row.styles["background-color"]) ?? COLORS.evenBg)
            : parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? null;

    if (fill) ctx.doc.rect(x, y, width, height).fill(fill);
    strokeCellBorder(ctx, cell, x, y, width, height, border);

    if (cell.isSpanPlaceholder) {
      x += width;
      col += span;
      continue;
    }

    const font = fontForCell(ctx, cell, row);
    const size = sizeForCell(ctx, cell, row);
    if (cell.imageSrc) {
      const asset = await getAsset(ctx, cell.imageSrc);
      if (asset) drawAssetSafely(ctx, asset, x + padding.left, y + padding.top, Math.max(1, width - padding.left - padding.right), Math.max(1, height - padding.top - padding.bottom), 1, "cell image");
    }

    const align = cell.styles["text-align"] === "center" || cell.styles["text-align"] === "right"
      ? cell.styles["text-align"] as "center" | "right"
      : row.styles["text-align"] === "center" || row.styles["text-align"] === "right"
        ? row.styles["text-align"] as "center" | "right"
        : "left";
    const textColor = parseCssColor(cell.styles["color"]) ?? parseCssColor(row.styles["color"]) ?? COLORS.text;
    const lineGap = lineGapForStyle({ ...row.styles, ...cell.styles }, size, 0.18);
    ctx.doc.save();
    ctx.doc.rect(x + padding.left, y + padding.top, Math.max(12, width - padding.left - padding.right), Math.max(8, height - padding.top - padding.bottom)).clip();
    drawInlineText(ctx, cell.text, cell.inlines, x + padding.left, y + padding.top, Math.max(12, width - padding.left - padding.right), font, size, textColor, lineGap, align);
    ctx.doc.restore();

    x += width;
    col += span;
  }

  ctx.y = y + height;
}

async function drawRows(ctx: StreamContext, rows: ParsedRow[], headers: ParsedRow[]): Promise<void> {
  const repeat = ctx.options.repeatHeaders ?? false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const height = estimateRowHeight(ctx, row);
    if (ctx.y + height > ctx.contentBottom) {
      addPage(ctx);
      if (repeat) {
        for (const header of headers) await drawRow(ctx, header, -1);
      }
    }
    await drawRow(ctx, row, i);
  }
}

async function drawTableBlock(ctx: StreamContext, block: Extract<ParsedBlock, { type: "table" }>): Promise<void> {
  const table = block.table;
  const previousWidths = ctx.columnWidths;
  const previousColumns = ctx.columns;
  const previousTableWidth = ctx.tableWidth;
  const previousTableStyle = ctx.currentTableStyle;
  const width = cssLengthPt(block.style["width"], previousTableWidth) ?? previousTableWidth;
  ctx.columns = table.columnCount;
  ctx.tableWidth = clamp(width, Math.min(previousTableWidth, 120), previousTableWidth);
  ctx.currentTableStyle = tableStyle(block.style);
  ctx.columnWidths = computeColumnWidths(table.columnCount, ctx.tableWidth);
  for (const row of table.headRows) {
    const height = estimateRowHeight(ctx, row);
    if (ctx.y + height > ctx.contentBottom) addPage(ctx);
    await drawRow(ctx, row, -1);
  }
  await drawRows(ctx, table.bodyRows, table.headRows);
  ctx.columns = previousColumns;
  ctx.columnWidths = previousWidths;
  ctx.tableWidth = previousTableWidth;
  ctx.currentTableStyle = previousTableStyle;
  ctx.y += 8;
}

async function drawBlock(ctx: StreamContext, block: ParsedBlock): Promise<void> {
  if (block.type === "heading" || block.type === "paragraph" || block.type === "list-item" || block.type === "blockquote" || block.type === "preformatted") {
    drawTextBlock(ctx, block);
  } else if (block.type === "image") {
    await drawImageBlock(ctx, block);
  } else if (block.type === "hr") {
    drawHrBlock(ctx, block);
  } else if (block.type === "page-break") {
    if (ctx.y > ctx.contentTop + 1) addPage(ctx);
  } else if (block.type === "table") {
    await drawTableBlock(ctx, block);
  }
}

async function createStreamContext(options: RenderHtmlToPdfOptions, parsed: ParsedDocument, warnings: WarningSink): Promise<{ ctx: StreamContext; done: Promise<Buffer> }> {
  const columns = maxDocumentColumns(parsed);
  const orientation = options.page?.orientation && options.page.orientation !== "auto"
    ? options.page.orientation
    : determineOrientation(columns);
  const margin = mm(options.page?.marginMm ?? 2.5);
  const doc = new PDFDocument({
    size: options.page?.size ?? "A4",
    layout: pageLayout(orientation),
    margin: 0,
    autoFirstPage: true,
    bufferPages: false,
    info: {
      Producer: "Html2PdfSmith",
      Title: options.recordId ? `HTML PDF ${options.recordId}` : "HTML PDF",
    },
  });
  const done = chunksToBuffer(doc);
  doc.on("pageAdded", () => {
    // Keep our public stats tied to the actual PDFKit page count.
    // The renderer itself avoids implicit page breaks, but this catches regressions.
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    ctxRef.pages += 1;
  });
  const fonts = await registerFonts(doc, options, warnings);
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const contentWidth = pageWidth - margin * 2;
  const headerReserve = reservedHeaderHeight(options);
  const footerReserve = reservedFooterHeight(options);
  const pageNumbers = pageNumberSettings(options);
  if (pageNumbers.enabled && pageNumbers.format.includes("{total}")) {
    warnings.add("page_total_unsupported_streaming", "Page number format contains {total}; streaming mode prints ? for total pages to keep memory usage low.");
  }
  const fontScale = calculateFontScale(columns) / 100;
  const paddingScale = calculatePaddingScale(columns);

  const ctxRef: StreamContext = {
    doc,
    warnings,
    options,
    parsed,
    columns,
    orientation,
    margin,
    contentTop: margin + headerReserve,
    contentBottom: pageHeight - margin - footerReserve,
    pageWidth,
    pageHeight,
    y: margin + headerReserve,
    pages: 1,
    columnWidths: computeColumnWidths(columns, contentWidth),
    tableWidth: contentWidth,
    fontScale,
    paddingScale,
    baseFontSize: 9.7 * fontScale,
    headerFontSize: Math.max(5.4, 14.2 * fontScale),
    priceFontSize: Math.max(5.4, 12.5 * fontScale),
    sectionFontSize: Math.max(6.2, 10.5 * fontScale),
    cellPaddingX: Math.max(2.2, 7 * paddingScale),
    cellPaddingY: Math.max(1.8, 4 * paddingScale),
    regularFontName: fonts.regular,
    boldFontName: fonts.bold,
    italicFontName: fonts.italic,
    boldItalicFontName: fonts.boldItalic,
    fontFamilies: fonts.families,
    watermarkAsset: await loadPdfKitAsset(options.watermarkUrl, warnings, options),
    logoAsset: await loadPdfKitAsset(options.userLogoUrl, warnings, options),
    qrAsset: await loadPdfKitAsset(parsed.contactQrSrc, warnings, options),
    assetCache: new Map(),
    currentTableStyle: tableStyle({}),
  };

  return { ctx: ctxRef, done };
}

export async function renderHtmlToPdfDetailed(
  options: RenderHtmlToPdfOptions,
): Promise<RenderHtmlToPdfResult> {
  const warnings = new WarningSink(options.onWarning);
  const html = await prepareHtmlForRender(options, warnings);
  const parsed = parsePrintableHtml(html);
  const { ctx, done } = await createStreamContext(options, parsed, warnings);

  drawWatermark(ctx, "background");
  drawPageChrome(ctx);
  drawHeader(ctx);
  for (const block of parsed.blocks) await drawBlock(ctx, block);
  finishPage(ctx);
  ctx.doc.end();

  let pdf: Uint8Array = new Uint8Array(await done);
  if (options.protectPdf) {
    try {
      pdf = await protectPdfWithQpdf(pdf, options.qpdfPath);
    } catch (error) {
      warnings.add("qpdf_failed", `qpdf protection failed; returning unprotected PDF: ${String(error)}`);
    }
  }

  return {
    pdf,
    warnings: warnings.warnings,
    pages: ctx.pages,
    columns: ctx.columns,
    orientation: ctx.orientation,
  };
}

export async function renderHtmlToPdf(options: RenderHtmlToPdfOptions): Promise<Uint8Array> {
  return (await renderHtmlToPdfDetailed(options)).pdf;
}
