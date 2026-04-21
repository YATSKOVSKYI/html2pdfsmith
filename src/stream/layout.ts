import PDFDocument from "pdfkit";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { resolveFontPaths } from "../assets";
import { parseBorderSideStyle, parseBorderStyle, parseBoxSpacing, parseLengthPx, type BoxSpacing, type BorderStyle, type StyleMap } from "../css";
import { resolveGoogleFont } from "../google-fonts";
import { loadResource } from "../resources";
import type { PageOrientation, ParsedCell, ParsedDocument, ParsedBlock, ParsedFontFace, ParsedInlineSegment, ParsedPageRule, ParsedRow, PdfBundledFontFace, PdfPageOptions, RenderHtmlToPdfOptions } from "../types";
import { clamp } from "../units";
import type { WarningSink } from "../warnings";

export { calculateFontScale, calculateHeaderCellHeight, calculatePaddingScale, clamp, determineOrientation, mm } from "../units";
export type { BoxSpacing, BorderStyle, StyleMap } from "../css";

export type PdfKitDocument = InstanceType<typeof PDFDocument>;

export interface RegisteredFontPair {
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
}

export interface StreamContext {
  doc: PdfKitDocument;
  warnings: WarningSink;
  options: RenderHtmlToPdfOptions;
  parsed: ParsedDocument;
  columns: number;
  orientation: PageOrientation;
  pageSize: "A4" | "LETTER";
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

export interface LoadedPdfKitAsset {
  bytes: Buffer;
  kind: "png" | "jpg" | "svg";
  svgText?: string;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export type CellVerticalAlign = "top" | "middle" | "bottom";
export type ObjectFitMode = "contain" | "cover" | "fill";

export interface ObjectPosition {
  x: "left" | "center" | "right";
  y: "top" | "center" | "bottom";
}

export interface CssTransformOrigin {
  x: number;
  y: number;
}

export interface TableRenderStyle {
  borderCollapse: boolean;
  border: BorderStyle;
  layout: "auto" | "fixed";
}

export interface CellBorderStyle {
  top: BorderStyle;
  right: BorderStyle;
  bottom: BorderStyle;
  left: BorderStyle;
}

export interface BoxShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
  inset: boolean;
}

export interface BoxRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

export type BoxRadiusInput = number | BoxRadius;

export interface InlineLayoutItem {
  segment: ParsedInlineSegment;
  text: string;
  font: string;
  size: number;
  color: string;
  width: number;
  height: number;
  visualHeight: number;
  baselineShift: number;
  visualTop: number;
  visualBottom: number;
  textWidth: number;
  padding: BoxSpacing;
  border: BorderStyle;
  radius: BoxRadius;
  background?: string;
  link?: string;
  decoration: string;
  boxed: boolean;
  whitespace: boolean;
}

export interface InlineLayoutLine {
  items: InlineLayoutItem[];
  width: number;
  height: number;
}

export interface TextBoxStyle {
  margin: BoxSpacing;
  padding: BoxSpacing;
  border: BorderStyle;
}

export interface RowRenderGroup {
  rows: ParsedRow[];
  startIndex: number;
  height: number;
  hasRowspan: boolean;
}

export interface TableColumnSlice {
  columns: number[];
  start: number;
  end: number;
  index: number;
  total: number;
}

export interface LogicalCell {
  cell: ParsedCell;
  start: number;
  end: number;
}

export interface ColumnRange {
  start: number;
  end: number;
}

export const COLORS = {
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

export const CHART_COLORS = ["#2563eb", "#0f766e", "#f59e0b", "#7c3aed", "#dc2626", "#0891b2", "#4f46e5", "#65a30d"];
export const CHART_THEMES: Record<string, { colors: string[]; grid: string; muted: string; text: string; track: string; areaEnd: string }> = {
  default: { colors: CHART_COLORS, grid: "#e2e8f0", muted: "#64748b", text: "#0f172a", track: "#edf2f7", areaEnd: "#ffffff" },
  aurora: { colors: ["#2563eb", "#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"], grid: "#dbeafe", muted: "#5b6b84", text: "#0f172a", track: "#eef4ff", areaEnd: "#ffffff" },
  emerald: { colors: ["#047857", "#10b981", "#84cc16", "#0ea5e9", "#64748b", "#f59e0b"], grid: "#d1fae5", muted: "#526b61", text: "#10231d", track: "#ecfdf5", areaEnd: "#ffffff" },
  graphite: { colors: ["#334155", "#64748b", "#0f766e", "#2563eb", "#9333ea", "#f59e0b"], grid: "#e2e8f0", muted: "#64748b", text: "#111827", track: "#f1f5f9", areaEnd: "#ffffff" },
  royal: { colors: ["#7c3aed", "#2563eb", "#db2777", "#0891b2", "#f59e0b", "#4f46e5"], grid: "#e9d5ff", muted: "#665f7a", text: "#17132e", track: "#f5f3ff", areaEnd: "#ffffff" },
  sunset: { colors: ["#f97316", "#dc2626", "#f59e0b", "#be123c", "#7c2d12", "#2563eb"], grid: "#fed7aa", muted: "#795548", text: "#28150f", track: "#fff7ed", areaEnd: "#ffffff" },
  ocean: { colors: ["#0284c7", "#0891b2", "#2563eb", "#0f766e", "#38bdf8", "#6366f1"], grid: "#bae6fd", muted: "#516b7d", text: "#0b1f2a", track: "#ecfeff", areaEnd: "#ffffff" },
};

export function asOpacity(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (value <= 1) return clamp(value, 0.01, 1);
  return clamp(0.15 + (1 - 0.15) * ((value - 1) / 99), 0.01, 1);
}

export function pageLayout(orientation: PageOrientation): "portrait" | "landscape" {
  return orientation === "portrait" ? "portrait" : "landscape";
}

export function effectivePageOptions(options: RenderHtmlToPdfOptions, pageRule: ParsedPageRule | undefined): Required<PdfPageOptions> {
  return {
    size: options.page?.size ?? pageRule?.size ?? "A4",
    orientation: options.page?.orientation ?? pageRule?.orientation ?? "auto",
    marginMm: options.page?.marginMm ?? pageRule?.marginMm ?? 2.5,
  };
}

export function computeColumnWidths(columns: number, contentWidth: number): number[] {
  if (columns <= 1) return [contentWidth];
  const dataColumns = columns - 1;
  const labelWidth = clamp(118 - Math.max(0, dataColumns - 4) * 4.5, 58, Math.min(155, contentWidth * 0.28));
  const dataWidth = (contentWidth - labelWidth) / dataColumns;
  return [labelWidth, ...Array.from({ length: dataColumns }, () => dataWidth)];
}

export function pxToPt(value: number): number {
  return value * 72 / 96;
}

export function cssLengthPt(value: string | undefined, base = 0): number | undefined {
  const px = parseLengthPx(value, base ? base * 96 / 72 : 0);
  return px == null ? undefined : pxToPt(px);
}

export function boxPxToPt(box: BoxSpacing): BoxSpacing {
  return {
    top: pxToPt(box.top),
    right: pxToPt(box.right),
    bottom: pxToPt(box.bottom),
    left: pxToPt(box.left),
  };
}

export function cellPadding(ctx: StreamContext, cell: ParsedCell): BoxSpacing {
  return boxPxToPt(parseBoxSpacing(cell.styles, "padding", {
    top: ctx.cellPaddingY * 96 / 72,
    right: ctx.cellPaddingX * 96 / 72,
    bottom: ctx.cellPaddingY * 96 / 72,
    left: ctx.cellPaddingX * 96 / 72,
  }));
}

export function cssRadiusTokenPt(value: string | undefined, base: number): number | undefined {
  const token = value?.trim().split(/\s+/)[0];
  return cssLengthPt(token, base);
}

export function boxRadiusPt(styles: StyleMap, width: number, height: number): BoxRadius {
  const base = Math.min(width, height);
  const raw = (styles["border-radius"] ?? "").split("/")[0]?.trim() ?? "";
  const tokens = raw ? raw.split(/\s+/).filter(Boolean).slice(0, 4) : [];
  const values = tokens.map((token) => cssLengthPt(token, base) ?? 0);
  let radius: BoxRadius = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
  if (values.length === 1) {
    radius = { topLeft: values[0]!, topRight: values[0]!, bottomRight: values[0]!, bottomLeft: values[0]! };
  } else if (values.length === 2) {
    radius = { topLeft: values[0]!, topRight: values[1]!, bottomRight: values[0]!, bottomLeft: values[1]! };
  } else if (values.length === 3) {
    radius = { topLeft: values[0]!, topRight: values[1]!, bottomRight: values[2]!, bottomLeft: values[1]! };
  } else if (values.length >= 4) {
    radius = { topLeft: values[0]!, topRight: values[1]!, bottomRight: values[2]!, bottomLeft: values[3]! };
  }

  radius.topLeft = cssRadiusTokenPt(styles["border-top-left-radius"], base) ?? radius.topLeft;
  radius.topRight = cssRadiusTokenPt(styles["border-top-right-radius"], base) ?? radius.topRight;
  radius.bottomRight = cssRadiusTokenPt(styles["border-bottom-right-radius"], base) ?? radius.bottomRight;
  radius.bottomLeft = cssRadiusTokenPt(styles["border-bottom-left-radius"], base) ?? radius.bottomLeft;

  radius = normalizeBoxRadius(radius, width, height);
  return radius;
}

export function borderRadiusPt(styles: StyleMap, width: number, height: number): number {
  const radius = boxRadiusPt(styles, width, height);
  return Math.max(radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft);
}

export function normalizeBoxRadius(radius: BoxRadiusInput, width: number, height: number): BoxRadius {
  const maxRadius = Math.max(0, Math.min(width, height) / 2);
  const out = typeof radius === "number"
    ? { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius }
    : { ...radius };
  out.topLeft = clamp(out.topLeft, 0, maxRadius);
  out.topRight = clamp(out.topRight, 0, maxRadius);
  out.bottomRight = clamp(out.bottomRight, 0, maxRadius);
  out.bottomLeft = clamp(out.bottomLeft, 0, maxRadius);

  const top = out.topLeft + out.topRight;
  const right = out.topRight + out.bottomRight;
  const bottom = out.bottomLeft + out.bottomRight;
  const left = out.topLeft + out.bottomLeft;
  const scale = Math.min(
    1,
    top > 0 ? width / top : 1,
    right > 0 ? height / right : 1,
    bottom > 0 ? width / bottom : 1,
    left > 0 ? height / left : 1,
  );
  if (scale < 1) {
    out.topLeft *= scale;
    out.topRight *= scale;
    out.bottomRight *= scale;
    out.bottomLeft *= scale;
  }
  return out;
}

export function maxBoxRadius(radius: BoxRadiusInput): number {
  if (typeof radius === "number") return radius;
  return Math.max(radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft);
}

export function roundedBoxPath(ctx: StreamContext, x: number, y: number, width: number, height: number, radiusInput: BoxRadiusInput): void {
  const radius = normalizeBoxRadius(radiusInput, width, height);
  ctx.doc
    .moveTo(x + radius.topLeft, y)
    .lineTo(x + width - radius.topRight, y);
  if (radius.topRight > 0) ctx.doc.quadraticCurveTo(x + width, y, x + width, y + radius.topRight);
  else ctx.doc.lineTo(x + width, y);
  ctx.doc.lineTo(x + width, y + height - radius.bottomRight);
  if (radius.bottomRight > 0) ctx.doc.quadraticCurveTo(x + width, y + height, x + width - radius.bottomRight, y + height);
  else ctx.doc.lineTo(x + width, y + height);
  ctx.doc.lineTo(x + radius.bottomLeft, y + height);
  if (radius.bottomLeft > 0) ctx.doc.quadraticCurveTo(x, y + height, x, y + height - radius.bottomLeft);
  else ctx.doc.lineTo(x, y + height);
  ctx.doc.lineTo(x, y + radius.topLeft);
  if (radius.topLeft > 0) ctx.doc.quadraticCurveTo(x, y, x + radius.topLeft, y);
  else ctx.doc.lineTo(x, y);
  ctx.doc.closePath();
}

export function fillBox(ctx: StreamContext, x: number, y: number, width: number, height: number, color: string, radius: BoxRadiusInput = 0): void {
  if (maxBoxRadius(radius) > 0) roundedBoxPath(ctx, x, y, width, height, radius);
  else ctx.doc.rect(x, y, width, height);
  ctx.doc.fill(color);
}

export function strokeBox(ctx: StreamContext, x: number, y: number, width: number, height: number, border: BorderStyle, radius: BoxRadiusInput = 0): void {
  if (border.width <= 0 || border.style === "none") return;
  ctx.doc.save();
  ctx.doc.strokeColor(border.color ?? COLORS.border).lineWidth(border.width);
  if (border.style === "dashed") ctx.doc.dash(Math.max(2, border.width * 3), { space: Math.max(2, border.width * 2) });
  if (border.style === "dotted") ctx.doc.dash(Math.max(0.7, border.width), { space: Math.max(1.4, border.width * 2) });
  if (maxBoxRadius(radius) > 0) roundedBoxPath(ctx, x, y, width, height, radius);
  else ctx.doc.rect(x, y, width, height);
  ctx.doc.stroke();
  ctx.doc.undash();
  ctx.doc.restore();
}

export function clipBox(ctx: StreamContext, x: number, y: number, width: number, height: number, radius: BoxRadiusInput = 0): void {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  if (maxBoxRadius(radius) > 0) roundedBoxPath(ctx, x, y, safeWidth, safeHeight, radius);
  else ctx.doc.rect(x, y, safeWidth, safeHeight);
  ctx.doc.clip();
}

export function spacingPt(styles: StyleMap, property: "padding" | "margin", fallback: BoxSpacing): BoxSpacing {
  return boxPxToPt(parseBoxSpacing(styles, property, {
    top: fallback.top * 96 / 72,
    right: fallback.right * 96 / 72,
    bottom: fallback.bottom * 96 / 72,
    left: fallback.left * 96 / 72,
  }));
}

export function borderPxToPt(border: BorderStyle): BorderStyle {
  const out: BorderStyle = { width: pxToPt(border.width) };
  if (border.color) out.color = border.color;
  if (border.style) out.style = border.style;
  return out;
}

export function cellBorders(ctx: StreamContext, cell: ParsedCell): CellBorderStyle {
  const fallback = {
    width: ctx.currentTableStyle.border.width * 96 / 72,
    color: cell.isParam ? COLORS.border : ctx.currentTableStyle.border.color ?? COLORS.grid,
    style: ctx.currentTableStyle.border.style ?? "solid",
  } satisfies BorderStyle;
  return {
    top: borderPxToPt(parseBorderSideStyle(cell.styles, "top", fallback)),
    right: borderPxToPt(parseBorderSideStyle(cell.styles, "right", fallback)),
    bottom: borderPxToPt(parseBorderSideStyle(cell.styles, "bottom", fallback)),
    left: borderPxToPt(parseBorderSideStyle(cell.styles, "left", fallback)),
  };
}

export function strokeBorderLine(ctx: StreamContext, border: BorderStyle, x1: number, y1: number, x2: number, y2: number, fallbackColor: string): void {
  if (border.width <= 0 || border.style === "none") return;
  const lineWidth = ctx.currentTableStyle.borderCollapse ? Math.max(0.2, border.width * 0.75) : border.width;
  ctx.doc.save();
  ctx.doc.strokeColor(border.color ?? fallbackColor).lineWidth(lineWidth);
  if (border.style === "dashed") ctx.doc.dash(Math.max(2, lineWidth * 3), { space: Math.max(2, lineWidth * 2) });
  if (border.style === "dotted") ctx.doc.dash(Math.max(0.7, lineWidth), { space: Math.max(1.4, lineWidth * 2) });
  ctx.doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
  ctx.doc.undash();
  ctx.doc.restore();
}

export function strokeCellBorder(ctx: StreamContext, cell: ParsedCell, x: number, y: number, width: number, height: number, border: CellBorderStyle): void {
  const fallbackColor = cell.isParam ? COLORS.border : COLORS.grid;

  strokeBorderLine(ctx, border.left, x, y, x, y + height, fallbackColor);
  strokeBorderLine(ctx, border.right, x + width, y, x + width, y + height, fallbackColor);
  if (!cell.isSpanPlaceholder) strokeBorderLine(ctx, border.top, x, y, x + width, y, fallbackColor);
  if (!cell.isSpanPlaceholder && cell.rowspan <= 1 || cell.isSpanPlaceholderEnd) {
    strokeBorderLine(ctx, border.bottom, x, y + height, x + width, y + height, fallbackColor);
  }
}

export function tableStyle(style: StyleMap): TableRenderStyle {
  return {
    borderCollapse: (style["border-collapse"] ?? "").trim().toLowerCase() === "collapse",
    border: borderPxToPt(parseBorderStyle(style, { width: 0.45 * 96 / 72, color: COLORS.grid, style: "solid" })),
    layout: (style["table-layout"] ?? "").trim().toLowerCase() === "fixed" ? "fixed" : "auto",
  };
}

export function textBoxStyle(block: Extract<ParsedBlock, { type: "heading" | "paragraph" | "list-item" | "blockquote" | "preformatted" }>): TextBoxStyle {
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

export function maxDocumentColumns(parsed: ParsedDocument): number {
  return Math.max(
    1,
    ...parsed.blocks.map((block) => block.type === "table" ? block.table.columnCount : 1),
  );
}

export function chunksToBuffer(doc: PdfKitDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export function normalizeFontFamily(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const first = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  return first ? first.toLowerCase() : undefined;
}

export function fontForStyle(ctx: StreamContext, style: StyleMap, fallbackFont: string): string {
  const family = normalizeFontFamily(style["font-family"]);
  if (!family || family === "monospace") return fallbackFont;
  const pair = ctx.fontFamilies.get(family);
  if (!pair) return fallbackFont;
  const fontStyle = (style["font-style"] ?? "").trim().toLowerCase();
  const weight = Number.parseInt(style["font-weight"] ?? "", 10);
  const bold = style["font-weight"] === "bold" || Number.isFinite(weight) && weight >= 600;
  if (bold && fontStyle === "italic") return pair.boldItalic;
  if (bold) return pair.bold;
  if (fontStyle === "italic") return pair.italic;
  return pair.regular;
}

export function blockMarginBottom(block: ParsedBlock): number {
  if (block.type === "heading") return cssLengthPt(block.style["margin-bottom"]) ?? 8;
  if (block.type === "paragraph" || block.type === "list-item" || block.type === "blockquote" || block.type === "preformatted") return cssLengthPt(block.style["margin-bottom"]) ?? 6;
  if (block.type === "image") return cssLengthPt(block.style["margin-bottom"]) ?? 8;
  if (block.type === "chart") return cssLengthPt(block.style["margin-bottom"]) ?? 8;
  return cssLengthPt(block.style["margin-bottom"]) ?? 4;
}

export function blockMarginTop(block: ParsedBlock): number {
  return cssLengthPt(block.style["margin-top"]) ?? 0;
}

export function googleFontFamilies(options: RenderHtmlToPdfOptions): string[] {
  const families = [options.font?.googleFont, ...(options.font?.googleFonts ?? [])]
    .map((family) => family?.trim())
    .filter((family): family is string => Boolean(family));
  return [...new Map(families.map((family) => [family.toLowerCase(), family])).values()];
}

export function bundledFontFaces(options: RenderHtmlToPdfOptions): PdfBundledFontFace[] {
  const faces = [options.font?.bundled, ...(options.font?.bundledFonts ?? [])]
    .filter((face): face is PdfBundledFontFace => Boolean(face?.family && face.regularPath));
  return [...new Map(faces.map((face) => [face.family.trim().toLowerCase(), face])).values()];
}

export function registerFontPair(doc: PdfKitDocument, family: string, paths: { regularPath?: string; boldPath?: string; italicPath?: string; boldItalicPath?: string }, warnings: WarningSink): RegisteredFontPair | null {
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

export function fontFaceSlot(face: ParsedFontFace): keyof RegisteredFontPair {
  const weight = (face.fontWeight ?? "400").toLowerCase();
  const style = (face.fontStyle ?? "normal").toLowerCase();
  const bold = weight === "bold" || Number.parseFloat(weight) >= 600;
  const italic = style === "italic" || style === "oblique";
  if (bold && italic) return "boldItalic";
  if (italic) return "italic";
  return bold ? "bold" : "regular";
}

export async function registerCssFontFace(doc: PdfKitDocument, face: ParsedFontFace, index: number, options: RenderHtmlToPdfOptions, warnings: WarningSink): Promise<{ family: string; slot: keyof RegisteredFontPair; name: string } | null> {
  const slot = fontFaceSlot(face);
  const slug = normalizeFontFamily(face.family)?.replace(/[^a-z0-9_-]+/g, "-") ?? `css-font-${index}`;
  const name = `css-${slug}-${slot}-${index}`;

  for (const src of face.srcs) {
    const loaded = await loadResource(src, "font", warnings, options);
    if (!loaded) continue;
    try {
      doc.registerFont(name, Buffer.from(loaded.bytes));
      return { family: face.family, slot, name };
    } catch (error) {
      warnings.add("font_face_register_failed", `Could not register @font-face "${face.family}" from ${loaded.display}: ${String(error)}`);
    }
  }

  warnings.add("font_face_unavailable", `No usable src was found for @font-face "${face.family}".`);
  return null;
}

export async function registerCssFontFaces(doc: PdfKitDocument, parsed: ParsedDocument, options: RenderHtmlToPdfOptions, warnings: WarningSink): Promise<Map<string, RegisteredFontPair>> {
  const partials = new Map<string, Partial<RegisteredFontPair>>();

  for (let i = 0; i < parsed.fontFaces.length; i++) {
    const registered = await registerCssFontFace(doc, parsed.fontFaces[i]!, i, options, warnings);
    const normalized = normalizeFontFamily(registered?.family);
    if (!registered || !normalized) continue;
    const partial = partials.get(normalized) ?? {};
    partial[registered.slot] = registered.name;
    partials.set(normalized, partial);
  }

  const families = new Map<string, RegisteredFontPair>();
  for (const [family, partial] of partials) {
    const fallback = partial.regular ?? partial.bold ?? partial.italic ?? partial.boldItalic;
    if (!fallback) continue;
    families.set(family, {
      regular: partial.regular ?? fallback,
      bold: partial.bold ?? partial.regular ?? fallback,
      italic: partial.italic ?? partial.regular ?? fallback,
      boldItalic: partial.boldItalic ?? partial.bold ?? partial.italic ?? partial.regular ?? fallback,
    });
  }

  return families;
}

export async function registerFonts(doc: PdfKitDocument, parsed: ParsedDocument, options: RenderHtmlToPdfOptions, warnings: WarningSink): Promise<RegisteredFontPair & { families: Map<string, RegisteredFontPair> }> {
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

  const cssFamilies = await registerCssFontFaces(doc, parsed, options, warnings);
  for (const [family, pair] of cssFamilies) families.set(family, pair);

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

  if (families.size === 0) {
    warnings.add("font_fallback", "Falling back to Helvetica; pass explicit fonts for non-Latin text. This keeps the default memory footprint low.");
  }
  return { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique", boldItalic: "Helvetica-BoldOblique", families };
}

