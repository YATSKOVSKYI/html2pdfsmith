import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";
import { discoverFontPaths, loadImage, resolveFontPaths } from "./assets";
import { parseBorderSideStyle, parseBorderStyle, parseBoxSpacing, parseCssColor, parseLengthPx, type BoxSpacing, type BorderStyle, type StyleMap } from "./css";
import { resolveGoogleFont } from "./google-fonts";
import { parsePrintableHtml } from "./html";
import { loadResource, prepareHtmlForRender } from "./resources";
import type {
  PageOrientation,
  PdfBundledFontFace,
  ParsedBlock,
  ParsedCell,
  ParsedCellBlock,
  ParsedDocument,
  ParsedFontFace,
  ParsedInlineSegment,
  ParsedPageRule,
  ParsedRow,
  ParsedTable,
  PdfPageOptions,
  RenderHtmlToPdfOptions,
  RenderHtmlToPdfResult,
  TextOverflowWrap,
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

interface LoadedPdfKitAsset {
  bytes: Buffer;
  kind: "png" | "jpg" | "svg";
  svgText?: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

type CellVerticalAlign = "top" | "middle" | "bottom";
type ObjectFitMode = "contain" | "cover" | "fill";

interface ObjectPosition {
  x: "left" | "center" | "right";
  y: "top" | "center" | "bottom";
}

interface CssTransformOrigin {
  x: number;
  y: number;
}

interface TableRenderStyle {
  borderCollapse: boolean;
  border: BorderStyle;
  layout: "auto" | "fixed";
}

interface CellBorderStyle {
  top: BorderStyle;
  right: BorderStyle;
  bottom: BorderStyle;
  left: BorderStyle;
}

interface BoxShadow {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
  inset: boolean;
}

interface BoxRadius {
  topLeft: number;
  topRight: number;
  bottomRight: number;
  bottomLeft: number;
}

type BoxRadiusInput = number | BoxRadius;

interface InlineLayoutItem {
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

interface InlineLayoutLine {
  items: InlineLayoutItem[];
  width: number;
  height: number;
}

interface TextBoxStyle {
  margin: BoxSpacing;
  padding: BoxSpacing;
  border: BorderStyle;
}

interface RowRenderGroup {
  rows: ParsedRow[];
  startIndex: number;
  height: number;
  hasRowspan: boolean;
}

interface TableColumnSlice {
  columns: number[];
  start: number;
  end: number;
  index: number;
  total: number;
}

interface LogicalCell {
  cell: ParsedCell;
  start: number;
  end: number;
}

interface ColumnRange {
  start: number;
  end: number;
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

const CHART_COLORS = ["#2563eb", "#0f766e", "#f59e0b", "#7c3aed", "#dc2626", "#0891b2", "#4f46e5", "#65a30d"];
const CHART_THEMES: Record<string, { colors: string[]; grid: string; muted: string; text: string; track: string; areaEnd: string }> = {
  default: { colors: CHART_COLORS, grid: "#e2e8f0", muted: "#64748b", text: "#0f172a", track: "#edf2f7", areaEnd: "#ffffff" },
  aurora: { colors: ["#2563eb", "#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"], grid: "#dbeafe", muted: "#5b6b84", text: "#0f172a", track: "#eef4ff", areaEnd: "#ffffff" },
  emerald: { colors: ["#047857", "#10b981", "#84cc16", "#0ea5e9", "#64748b", "#f59e0b"], grid: "#d1fae5", muted: "#526b61", text: "#10231d", track: "#ecfdf5", areaEnd: "#ffffff" },
  graphite: { colors: ["#334155", "#64748b", "#0f766e", "#2563eb", "#9333ea", "#f59e0b"], grid: "#e2e8f0", muted: "#64748b", text: "#111827", track: "#f1f5f9", areaEnd: "#ffffff" },
  royal: { colors: ["#7c3aed", "#2563eb", "#db2777", "#0891b2", "#f59e0b", "#4f46e5"], grid: "#e9d5ff", muted: "#665f7a", text: "#17132e", track: "#f5f3ff", areaEnd: "#ffffff" },
  sunset: { colors: ["#f97316", "#dc2626", "#f59e0b", "#be123c", "#7c2d12", "#2563eb"], grid: "#fed7aa", muted: "#795548", text: "#28150f", track: "#fff7ed", areaEnd: "#ffffff" },
  ocean: { colors: ["#0284c7", "#0891b2", "#2563eb", "#0f766e", "#38bdf8", "#6366f1"], grid: "#bae6fd", muted: "#516b7d", text: "#0b1f2a", track: "#ecfeff", areaEnd: "#ffffff" },
};

function asOpacity(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (value <= 1) return clamp(value, 0.01, 1);
  return clamp(0.15 + (1 - 0.15) * ((value - 1) / 99), 0.01, 1);
}

function pageLayout(orientation: PageOrientation): "portrait" | "landscape" {
  return orientation === "portrait" ? "portrait" : "landscape";
}

function effectivePageOptions(options: RenderHtmlToPdfOptions, pageRule: ParsedPageRule | undefined): Required<PdfPageOptions> {
  return {
    size: options.page?.size ?? pageRule?.size ?? "A4",
    orientation: options.page?.orientation ?? pageRule?.orientation ?? "auto",
    marginMm: options.page?.marginMm ?? pageRule?.marginMm ?? 2.5,
  };
}

function computeColumnWidths(columns: number, contentWidth: number): number[] {
  if (columns <= 1) return [contentWidth];
  const dataColumns = columns - 1;
  const labelWidth = clamp(118 - Math.max(0, dataColumns - 4) * 4.5, 58, Math.min(155, contentWidth * 0.28));
  const dataWidth = (contentWidth - labelWidth) / dataColumns;
  return [labelWidth, ...Array.from({ length: dataColumns }, () => dataWidth)];
}

function computeColumnWidthsFromStyles(table: ParsedTable, contentWidth: number): number[] {
  const styles = table.columnStyles ?? [];
  if (styles.length === 0) return computeColumnWidths(table.columnCount, contentWidth);

  const widths = Array.from({ length: table.columnCount }, (_, index) => cssLengthPt(styles[index]?.["width"], contentWidth));
  const fixedTotal = widths.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const missing = widths.filter((value) => value == null).length;
  const remaining = Math.max(0, contentWidth - fixedTotal);

  if (missing === 0 && fixedTotal > 0) {
    const scale = contentWidth / fixedTotal;
    return widths.map((value) => Math.max(1, (value ?? 0) * scale));
  }

  const fallback = missing > 0 ? remaining / missing : 0;
  return widths.map((value) => Math.max(1, value ?? fallback));
}

function plainInlineText(text: string, inlines: ParsedInlineSegment[], style: StyleMap): string {
  const source = inlines.length > 0 ? inlines : [{ text, styles: style }];
  return source.map((segment) => applyTextTransform(segment.text, { ...style, ...segment.styles })).join("");
}

function measureCellWidth(ctx: StreamContext, cell: ParsedCell, row: ParsedRow, contentWidth: number): { min: number; preferred: number } {
  if (cell.isSpanPlaceholder) return { min: 0, preferred: 0 };
  const font = fontForCell(ctx, cell, row);
  const size = sizeForCell(ctx, cell, row);
  const padding = cellPadding(ctx, cell);
  const text = plainInlineText(cell.text, cell.inlines, { ...row.styles, ...cell.styles }).replace(/\s+/g, " ").trim();
  ctx.doc.font(font).fontSize(size);
  const lines = text ? text.split(/\n+/) : [""];
  const preferredText = Math.max(0, ...lines.map((line) => ctx.doc.widthOfString(line)));
  const tokens = text.split(/\s+/).filter(Boolean);
  const longestToken = Math.max(0, ...tokens.map((token) => ctx.doc.widthOfString(token)));
  const noWrap = isNoWrapStyle({ ...row.styles, ...cell.styles });
  const ellipsis = wantsEllipsis({ ...row.styles, ...cell.styles });
  const imageWidth = cell.imageSrc
    ? cssLengthPt(cell.imageStyles?.["width"], contentWidth) ?? Math.min(48, contentWidth)
    : 0;
  const preferred = Math.max(preferredText, imageWidth) + padding.left + padding.right;
  const min = Math.max(noWrap && !ellipsis ? preferredText : ellipsis ? Math.min(preferredText, 48) : longestToken, imageWidth * 0.65, 18) + padding.left + padding.right;
  return { min, preferred: Math.max(min, preferred) };
}

function normalizeAutoWidths(minWidths: number[], preferredWidths: number[], contentWidth: number): number[] {
  const minTotal = minWidths.reduce((sum, value) => sum + value, 0);
  const preferredTotal = preferredWidths.reduce((sum, value) => sum + value, 0);
  if (preferredTotal <= 0) return computeColumnWidths(minWidths.length, contentWidth);
  if (preferredTotal <= contentWidth) {
    const extra = contentWidth - preferredTotal;
    return preferredWidths.map((value) => Math.max(1, value + extra * (value / preferredTotal)));
  }
  if (minTotal >= contentWidth) {
    const scale = contentWidth / Math.max(1, minTotal);
    return minWidths.map((value) => Math.max(1, value * scale));
  }
  const shrinkable = Math.max(1, preferredTotal - minTotal);
  const ratio = (contentWidth - minTotal) / shrinkable;
  return preferredWidths.map((preferred, index) => minWidths[index]! + (preferred - minWidths[index]!) * ratio);
}

function computeAutoColumnWidths(ctx: StreamContext, table: ParsedTable, contentWidth: number): number[] {
  const minWidths = Array.from({ length: table.columnCount }, () => 18);
  const preferredWidths = Array.from({ length: table.columnCount }, () => 24);

  for (const row of [...table.headRows, ...table.bodyRows]) {
    let col = 0;
    for (const cell of row.cells) {
      const span = Math.max(1, cell.colspan);
      if (!cell.isSpanPlaceholder && row.kind !== "section") {
        const measured = measureCellWidth(ctx, cell, row, contentWidth);
        const shareMin = measured.min / span;
        const sharePreferred = measured.preferred / span;
        for (let i = col; i < Math.min(table.columnCount, col + span); i++) {
          minWidths[i] = Math.max(minWidths[i]!, shareMin);
          preferredWidths[i] = Math.max(preferredWidths[i]!, sharePreferred);
        }
      }
      col += span;
    }
  }

  return normalizeAutoWidths(minWidths, preferredWidths, contentWidth);
}

function computeTableColumnWidths(ctx: StreamContext, table: ParsedTable, contentWidth: number, style: TableRenderStyle): number[] {
  if ((table.columnStyles?.length ?? 0) > 0) return computeColumnWidthsFromStyles(table, contentWidth);
  if (style.layout === "fixed") return Array.from({ length: table.columnCount }, () => contentWidth / table.columnCount);
  return computeAutoColumnWidths(ctx, table, contentWidth);
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

function cssRadiusTokenPt(value: string | undefined, base: number): number | undefined {
  const token = value?.trim().split(/\s+/)[0];
  return cssLengthPt(token, base);
}

function boxRadiusPt(styles: StyleMap, width: number, height: number): BoxRadius {
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

function borderRadiusPt(styles: StyleMap, width: number, height: number): number {
  const radius = boxRadiusPt(styles, width, height);
  return Math.max(radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft);
}

function normalizeBoxRadius(radius: BoxRadiusInput, width: number, height: number): BoxRadius {
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

function maxBoxRadius(radius: BoxRadiusInput): number {
  if (typeof radius === "number") return radius;
  return Math.max(radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft);
}

function roundedBoxPath(ctx: StreamContext, x: number, y: number, width: number, height: number, radiusInput: BoxRadiusInput): void {
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

function fillBox(ctx: StreamContext, x: number, y: number, width: number, height: number, color: string, radius: BoxRadiusInput = 0): void {
  if (maxBoxRadius(radius) > 0) roundedBoxPath(ctx, x, y, width, height, radius);
  else ctx.doc.rect(x, y, width, height);
  ctx.doc.fill(color);
}

function strokeBox(ctx: StreamContext, x: number, y: number, width: number, height: number, border: BorderStyle, radius: BoxRadiusInput = 0): void {
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

function clipBox(ctx: StreamContext, x: number, y: number, width: number, height: number, radius: BoxRadiusInput = 0): void {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  if (maxBoxRadius(radius) > 0) roundedBoxPath(ctx, x, y, safeWidth, safeHeight, radius);
  else ctx.doc.rect(x, y, safeWidth, safeHeight);
  ctx.doc.clip();
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
  if (border.style) out.style = border.style;
  return out;
}

function cellBorders(ctx: StreamContext, cell: ParsedCell): CellBorderStyle {
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

function strokeBorderLine(ctx: StreamContext, border: BorderStyle, x1: number, y1: number, x2: number, y2: number, fallbackColor: string): void {
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

function strokeCellBorder(ctx: StreamContext, cell: ParsedCell, x: number, y: number, width: number, height: number, border: CellBorderStyle): void {
  const fallbackColor = cell.isParam ? COLORS.border : COLORS.grid;

  strokeBorderLine(ctx, border.left, x, y, x, y + height, fallbackColor);
  strokeBorderLine(ctx, border.right, x + width, y, x + width, y + height, fallbackColor);
  if (!cell.isSpanPlaceholder) strokeBorderLine(ctx, border.top, x, y, x + width, y, fallbackColor);
  if (!cell.isSpanPlaceholder && cell.rowspan <= 1 || cell.isSpanPlaceholderEnd) {
    strokeBorderLine(ctx, border.bottom, x, y + height, x + width, y + height, fallbackColor);
  }
}

function tableStyle(style: StyleMap): TableRenderStyle {
  return {
    borderCollapse: (style["border-collapse"] ?? "").trim().toLowerCase() === "collapse",
    border: borderPxToPt(parseBorderStyle(style, { width: 0.45 * 96 / 72, color: COLORS.grid, style: "solid" })),
    layout: (style["table-layout"] ?? "").trim().toLowerCase() === "fixed" ? "fixed" : "auto",
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

function fontFaceSlot(face: ParsedFontFace): keyof RegisteredFontPair {
  const weight = (face.fontWeight ?? "400").toLowerCase();
  const style = (face.fontStyle ?? "normal").toLowerCase();
  const bold = weight === "bold" || Number.parseFloat(weight) >= 600;
  const italic = style === "italic" || style === "oblique";
  if (bold && italic) return "boldItalic";
  if (italic) return "italic";
  return bold ? "bold" : "regular";
}

async function registerCssFontFace(doc: PdfKitDocument, face: ParsedFontFace, index: number, options: RenderHtmlToPdfOptions, warnings: WarningSink): Promise<{ family: string; slot: keyof RegisteredFontPair; name: string } | null> {
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

async function registerCssFontFaces(doc: PdfKitDocument, parsed: ParsedDocument, options: RenderHtmlToPdfOptions, warnings: WarningSink): Promise<Map<string, RegisteredFontPair>> {
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

async function registerFonts(doc: PdfKitDocument, parsed: ParsedDocument, options: RenderHtmlToPdfOptions, warnings: WarningSink): Promise<RegisteredFontPair & { families: Map<string, RegisteredFontPair> }> {
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

function drawAsset(doc: PdfKitDocument, asset: LoadedPdfKitAsset, x: number, y: number, width: number, height: number, opacity = 1, preserveAspectRatio = "xMidYMid meet"): void {
  doc.save();
  doc.opacity(opacity);
  if (asset.kind === "svg" && asset.svgText) {
    SVGtoPDF(doc, asset.svgText, x, y, { width, height, preserveAspectRatio });
  } else {
    doc.image(asset.bytes, x, y, { width, height });
  }
  doc.restore();
}

function drawAssetSafely(ctx: StreamContext, asset: LoadedPdfKitAsset, x: number, y: number, width: number, height: number, opacity = 1, label = "image"): void {
  drawAssetInBox(ctx, asset, x, y, width, height, {}, opacity, label);
}

function objectFitFromStyle(styles: StyleMap | undefined): ObjectFitMode {
  const value = styles?.["object-fit"]?.trim().toLowerCase();
  if (value === "cover") return "cover";
  if (value === "fill") return "fill";
  return "contain";
}

function objectPositionFromStyle(styles: StyleMap | undefined): ObjectPosition {
  const tokens = (styles?.["object-position"] ?? "center center").trim().toLowerCase().split(/\s+/).filter(Boolean);
  let x: ObjectPosition["x"] = "center";
  let y: ObjectPosition["y"] = "center";

  for (const token of tokens) {
    if (token === "left" || token === "right") x = token;
    else if (token === "top" || token === "bottom") y = token;
    else if (token === "center") {
      x = x ?? "center";
      y = y ?? "center";
    }
  }

  return { x, y };
}

function positionedStart(containerStart: number, containerSize: number, itemSize: number, align: "left" | "center" | "right" | "top" | "bottom"): number {
  if (align === "right" || align === "bottom") return containerStart + containerSize - itemSize;
  if (align === "center") return containerStart + (containerSize - itemSize) / 2;
  return containerStart;
}

function cssOpacity(styles: StyleMap | undefined, fallback = 1): number {
  const raw = styles?.["opacity"];
  if (!raw) return fallback;
  const trimmed = raw.trim();
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) return fallback;
  return clamp(trimmed.endsWith("%") ? value / 100 : value, 0, 1);
}

function cssUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(value);
  const url = match?.[2]?.trim();
  return url || undefined;
}

function backgroundPositionStyles(styles: StyleMap): StyleMap {
  return {
    "object-fit": styles["background-size"] ?? "cover",
    "object-position": styles["background-position"] ?? "center center",
  };
}

function backgroundTileSize(ctx: StreamContext, asset: LoadedPdfKitAsset, width: number, height: number, styles: StyleMap): { width: number; height: number } {
  const raw = (styles["background-size"] ?? "cover").trim().toLowerCase();
  const natural = imageDimensions(asset);
  if (raw === "cover" || raw === "contain") return { width, height };
  if (raw === "auto") {
    return natural ? { width: pxToPt(natural.width), height: pxToPt(natural.height) } : { width, height };
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  const cssWidth = cssLengthPt(parts[0], width);
  const cssHeight = cssLengthPt(parts[1], height);
  let tileWidth = cssWidth ?? (natural ? pxToPt(natural.width) : width);
  let tileHeight = cssHeight ?? (natural ? pxToPt(natural.height) : height);
  if (natural && cssWidth != null && cssHeight == null) tileHeight = tileWidth * natural.height / natural.width;
  if (natural && cssHeight != null && cssWidth == null) tileWidth = tileHeight * natural.width / natural.height;
  return { width: Math.max(1, tileWidth), height: Math.max(1, tileHeight) };
}

async function drawBackgroundImage(ctx: StreamContext, styles: StyleMap, x: number, y: number, width: number, height: number, radius = 0): Promise<void> {
  const src = cssUrl(styles["background-image"]);
  if (!src) return;
  const asset = await getAsset(ctx, src);
  if (!asset) return;

  const repeat = (styles["background-repeat"] ?? "no-repeat").trim().toLowerCase();
  const tile = backgroundTileSize(ctx, asset, width, height, styles);
  const positionStyles = backgroundPositionStyles(styles);

  ctx.doc.save();
  clipBox(ctx, x, y, width, height, radius);
  if (repeat === "repeat" || repeat === "repeat-x" || repeat === "repeat-y") {
    const maxX = repeat === "repeat-y" ? x : x + width;
    const maxY = repeat === "repeat-x" ? y : y + height;
    for (let ty = y; ty < maxY; ty += tile.height) {
      for (let tx = x; tx < maxX; tx += tile.width) {
        drawAssetInBox(ctx, asset, tx, ty, tile.width, tile.height, positionStyles, cssOpacity(styles), "background image");
      }
    }
  } else {
    const position = objectPositionFromStyle(positionStyles);
    const tx = positionedStart(x, width, tile.width, position.x);
    const ty = positionedStart(y, height, tile.height, position.y);
    drawAssetInBox(ctx, asset, tx, ty, tile.width, tile.height, positionStyles, cssOpacity(styles), "background image");
  }
  ctx.doc.restore();
}

function colorOpacity(value: string | undefined): number {
  if (!value) return 1;
  const hex = /^#([0-9a-f]{8})$/i.exec(value.trim());
  if (hex?.[1]) {
    const alpha = Number.parseInt(hex[1].slice(6, 8), 16) / 255;
    return Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
  }
  const rgba = /rgba?\(([^)]+)\)/i.exec(value);
  if (!rgba?.[1]) return 1;
  const parts = rgba[1].split(",").map((part) => part.trim());
  const alpha = Number.parseFloat(parts[3] ?? "1");
  return Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
}

function splitShadowList(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out.filter(Boolean);
}

function shadowColor(value: string | undefined): { color: string; opacity: number } {
  const parsed = parseCssColor(value) ?? "#000000";
  const opacity = value && /^rgba?\(/i.test(value.trim())
    ? colorOpacity(value)
    : value && /^#[0-9a-f]{8}$/i.test(value.trim())
      ? colorOpacity(value)
      : 0.22;
  return {
    color: parsed.length === 9 ? parsed.slice(0, 7) : parsed,
    opacity,
  };
}

function parseBoxShadowPart(rawPart: string): BoxShadow | undefined {
  const part = rawPart.trim();
  if (!part || part === "none") return undefined;
  const inset = /\binset\b/i.test(part);
  const withoutInset = part.replace(/\binset\b/gi, "").trim();
  const rgbaMatch = /rgba?\([^)]+\)/i.exec(withoutInset);
  const hexMatch = /#[0-9a-f]{3,8}/i.exec(withoutInset);
  const namedMatch = withoutInset.split(/\s+/).find((token) => parseCssColor(token) && !/[0-9]/.test(token));
  const colorRaw = rgbaMatch?.[0] ?? hexMatch?.[0] ?? namedMatch;
  const { color, opacity } = shadowColor(colorRaw);
  const lengthSource = colorRaw ? withoutInset.replace(colorRaw, "") : withoutInset;
  const lengths = lengthSource
    .trim()
    .split(/\s+/)
    .map((token) => cssLengthPt(token))
    .filter((value): value is number => value != null);
  if (lengths.length < 2) return undefined;
  return {
    offsetX: lengths[0] ?? 0,
    offsetY: lengths[1] ?? 0,
    blur: Math.max(0, lengths[2] ?? 0),
    spread: lengths[3] ?? 0,
    color,
    opacity,
    inset,
  };
}

function parseBoxShadows(styles: StyleMap): BoxShadow[] {
  const raw = styles["box-shadow"]?.trim();
  if (!raw || raw === "none") return [];
  return splitShadowList(raw).map(parseBoxShadowPart).filter((shadow): shadow is BoxShadow => !!shadow);
}

function drawShadowShape(ctx: StreamContext, x: number, y: number, width: number, height: number, radius: number, color: string, opacity: number): void {
  if (width <= 0 || height <= 0 || opacity < 0.0005) return;
  ctx.doc.save();
  ctx.doc.opacity(clamp(opacity, 0, 0.65));
  fillBox(ctx, x, y, width, height, color, radius);
  ctx.doc.restore();
  ctx.doc.opacity(1);
}

function drawOuterBoxShadow(ctx: StreamContext, shadow: BoxShadow, x: number, y: number, width: number, height: number, radius: number): void {
  const blur = Math.max(0, shadow.blur);
  const layers = blur > 0 ? clamp(Math.ceil(blur * 1.65), 10, 36) : 1;
  const weights = Array.from({ length: layers }, (_, index) => {
    const ratio = (index + 1) / layers;
    return Math.pow(1 - ratio, 2.15);
  });
  const weightTotal = Math.max(0.001, weights.reduce((sum, weight) => sum + weight, 0));
  for (let i = layers; i >= 1; i--) {
    const ratio = i / layers;
    const eased = 1 - Math.pow(1 - ratio, 1.35);
    const expansion = shadow.spread + blur * eased;
    const sx = x + shadow.offsetX - expansion;
    const sy = y + shadow.offsetY - expansion;
    const sw = width + expansion * 2;
    const sh = height + expansion * 2;
    const alpha = blur > 0
      ? shadow.opacity * 1.08 * weights[i - 1]! / weightTotal
      : shadow.opacity;
    drawShadowShape(ctx, sx, sy, sw, sh, Math.max(0, radius + expansion), shadow.color, alpha);
  }
}

function drawInsetBoxShadow(ctx: StreamContext, shadow: BoxShadow, x: number, y: number, width: number, height: number, radius: number): void {
  const blur = Math.max(0, shadow.blur);
  const spread = Math.max(0, shadow.spread);
  const edge = Math.max(1, blur * 0.45 + spread);
  ctx.doc.save();
  clipBox(ctx, x, y, width, height, radius);
  const opacity = clamp(shadow.opacity * 0.55, 0.005, 0.35);
  ctx.doc.opacity(opacity);
  ctx.doc.rect(x + shadow.offsetX, y + shadow.offsetY, width, Math.min(edge, height)).fill(shadow.color);
  ctx.doc.rect(x + shadow.offsetX, y + height - edge + shadow.offsetY, width, Math.min(edge, height)).fill(shadow.color);
  ctx.doc.rect(x + shadow.offsetX, y + shadow.offsetY, Math.min(edge, width), height).fill(shadow.color);
  ctx.doc.rect(x + width - edge + shadow.offsetX, y + shadow.offsetY, Math.min(edge, width), height).fill(shadow.color);
  ctx.doc.restore();
  ctx.doc.opacity(1);
}

function drawBoxShadow(ctx: StreamContext, styles: StyleMap, x: number, y: number, width: number, height: number, radius = 0): void {
  const shadows = parseBoxShadows(styles);
  for (const shadow of shadows) {
    if (shadow.inset) drawInsetBoxShadow(ctx, shadow, x, y, width, height, radius);
    else drawOuterBoxShadow(ctx, shadow, x, y, width, height, radius);
  }
}

function transformValue(styles: StyleMap | undefined): string {
  return (styles?.["transform"] ?? styles?.["-webkit-transform"] ?? "").trim();
}

function transformOriginValue(styles: StyleMap | undefined): string {
  return (styles?.["transform-origin"] ?? styles?.["-webkit-transform-origin"] ?? "center center").trim();
}

function splitTransformArgs(args: string): string[] {
  return args.trim().split(/\s*,\s*|\s+/).filter(Boolean);
}

function angleDeg(value: string | undefined): number {
  if (!value) return 0;
  const raw = value.trim().toLowerCase();
  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric)) return 0;
  if (raw.endsWith("rad")) return numeric * 180 / Math.PI;
  if (raw.endsWith("turn")) return numeric * 360;
  if (raw.endsWith("grad")) return numeric * 0.9;
  return numeric;
}

function translateLength(value: string | undefined, base: number): number {
  if (!value) return 0;
  return cssLengthPt(value, base) ?? 0;
}

function transformOriginAxis(token: string | undefined, base: number, axis: "x" | "y"): number | undefined {
  if (!token) return undefined;
  const raw = token.trim().toLowerCase();
  if (axis === "x") {
    if (raw === "left") return 0;
    if (raw === "center") return base / 2;
    if (raw === "right") return base;
    if (raw === "top" || raw === "bottom") return undefined;
  } else {
    if (raw === "top") return 0;
    if (raw === "center") return base / 2;
    if (raw === "bottom") return base;
    if (raw === "left" || raw === "right") return undefined;
  }
  return cssLengthPt(raw, base);
}

function transformOrigin(styles: StyleMap | undefined, width: number, height: number): CssTransformOrigin {
  const tokens = transformOriginValue(styles).toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { x: width / 2, y: height / 2 };
  let x: number | undefined;
  let y: number | undefined;

  for (const token of tokens) {
    x ??= transformOriginAxis(token, width, "x");
    y ??= transformOriginAxis(token, height, "y");
  }

  if (tokens.length >= 2) {
    x = transformOriginAxis(tokens[0], width, "x") ?? x;
    y = transformOriginAxis(tokens[1], height, "y") ?? y;
  }

  return { x: x ?? width / 2, y: y ?? height / 2 };
}

function applyCssTransform(doc: PdfKitDocument, styles: StyleMap | undefined, x: number, y: number, width: number, height: number): void {
  const raw = transformValue(styles);
  if (!raw || raw.toLowerCase() === "none") return;

  const origin = transformOrigin(styles, width, height);
  doc.translate(x + origin.x, y + origin.y);

  for (const match of raw.matchAll(/([a-z0-9-]+)\(([^)]*)\)/gi)) {
    const fn = (match[1] ?? "").toLowerCase();
    const args = splitTransformArgs(match[2] ?? "");
    if (fn === "rotate") {
      doc.rotate(angleDeg(args[0]));
    } else if (fn === "scale") {
      const sx = Number.parseFloat(args[0] ?? "1");
      const sy = Number.parseFloat(args[1] ?? args[0] ?? "1");
      doc.scale(Number.isFinite(sx) ? sx : 1, Number.isFinite(sy) ? sy : 1);
    } else if (fn === "scalex") {
      const sx = Number.parseFloat(args[0] ?? "1");
      doc.scale(Number.isFinite(sx) ? sx : 1, 1);
    } else if (fn === "scaley") {
      const sy = Number.parseFloat(args[0] ?? "1");
      doc.scale(1, Number.isFinite(sy) ? sy : 1);
    } else if (fn === "translate") {
      doc.translate(translateLength(args[0], width), translateLength(args[1], height));
    } else if (fn === "translatex") {
      doc.translate(translateLength(args[0], width), 0);
    } else if (fn === "translatey") {
      doc.translate(0, translateLength(args[0], height));
    }
  }

  doc.translate(-x - origin.x, -y - origin.y);
}

function drawAssetInBox(
  ctx: StreamContext,
  asset: LoadedPdfKitAsset,
  x: number,
  y: number,
  width: number,
  height: number,
  styles: StyleMap | undefined,
  opacity = 1,
  label = "image",
): void {
  const fit = objectFitFromStyle(styles);
  const position = objectPositionFromStyle(styles);
  const natural = imageDimensions(asset);
  const cssWidth = cssLengthPt(styles?.["width"], width);
  const cssHeight = cssLengthPt(styles?.["height"], height);
  let drawWidth = cssWidth ?? width;
  let drawHeight = cssHeight ?? height;

  if (fit !== "fill" && natural) {
    const targetRatio = width / Math.max(1, height);
    const naturalRatio = natural.width / Math.max(1, natural.height);
    const scale = fit === "cover"
      ? naturalRatio > targetRatio ? height / natural.height : width / natural.width
      : naturalRatio > targetRatio ? width / natural.width : height / natural.height;
    if (cssWidth == null) drawWidth = natural.width * scale;
    if (cssHeight == null) drawHeight = natural.height * scale;
    if (cssWidth != null && cssHeight == null) drawHeight = drawWidth / naturalRatio;
    if (cssHeight != null && cssWidth == null) drawWidth = drawHeight * naturalRatio;
  }

  drawWidth = Math.max(1, fit === "fill" && cssWidth == null ? width : drawWidth);
  drawHeight = Math.max(1, fit === "fill" && cssHeight == null ? height : drawHeight);
  const drawX = positionedStart(x, width, drawWidth, position.x);
  const drawY = positionedStart(y, height, drawHeight, position.y);
  const preserveAspectRatio = fit === "fill" ? "none" : `x${position.x === "left" ? "Min" : position.x === "right" ? "Max" : "Mid"}Y${position.y === "top" ? "Min" : position.y === "bottom" ? "Max" : "Mid"} ${fit === "cover" ? "slice" : "meet"}`;
  const effectiveOpacity = clamp(opacity * cssOpacity(styles), 0, 1);

  try {
    ctx.doc.save();
    ctx.doc.rect(x, y, Math.max(1, width), Math.max(1, height)).clip();
    applyCssTransform(ctx.doc, styles, drawX, drawY, drawWidth, drawHeight);
    drawAsset(ctx.doc, asset, drawX, drawY, drawWidth, drawHeight, effectiveOpacity, preserveAspectRatio);
    ctx.doc.restore();
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
  ctx.doc.addPage({ size: ctx.pageSize, layout: pageLayout(ctx.orientation), margin: 0 });
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
  if (block.type === "chart") return cssLengthPt(block.style["margin-bottom"]) ?? 8;
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

function cssFontSizePt(value: string | undefined, fallbackSize: number): number {
  const raw = value?.trim().toLowerCase();
  if (!raw) return fallbackSize;
  const numeric = Number.parseFloat(raw);
  if (Number.isFinite(numeric)) {
    if (raw.endsWith("%")) return Math.max(1, fallbackSize * numeric / 100);
    if (raw.endsWith("em")) return Math.max(1, fallbackSize * numeric);
    if (raw.endsWith("rem")) return Math.max(1, 12 * numeric);
  }
  return cssLengthPt(raw) ?? fallbackSize;
}

function inlineSize(segment: ParsedInlineSegment, fallbackSize: number): number {
  return cssFontSizePt(segment.styles["font-size"], fallbackSize);
}

function inlineColor(segment: ParsedInlineSegment, fallbackColor: string): string {
  return parseCssColor(segment.styles["color"]) ?? fallbackColor;
}

function wrapModeFromStyle(style: StyleMap, fallback: TextOverflowWrap | undefined): TextOverflowWrap {
  const whiteSpace = (style["white-space"] ?? "").trim().toLowerCase();
  if (whiteSpace === "nowrap" || whiteSpace === "pre") return "normal";
  const overflowWrap = (style["overflow-wrap"] ?? style["word-wrap"] ?? "").trim().toLowerCase();
  const wordBreak = (style["word-break"] ?? "").trim().toLowerCase();
  if (overflowWrap === "anywhere" || wordBreak === "break-all") return "anywhere";
  if (overflowWrap === "break-word" || wordBreak === "break-word") return "break-word";
  return fallback ?? "normal";
}

function applyTextTransform(value: string, style: StyleMap): string {
  const transform = (style["text-transform"] ?? "").trim().toLowerCase();
  if (transform === "uppercase") return value.toUpperCase();
  if (transform === "lowercase") return value.toLowerCase();
  if (transform === "capitalize") return value.replace(/\b([\p{L}\p{N}])/gu, (match) => match.toUpperCase());
  return value;
}

function isNoWrapStyle(style: StyleMap): boolean {
  const value = (style["white-space"] ?? "").trim().toLowerCase();
  return value === "nowrap" || value === "pre";
}

function wantsEllipsis(style: StyleMap): boolean {
  return (style["text-overflow"] ?? "").trim().toLowerCase() === "ellipsis";
}

function isOverflowHidden(style: StyleMap): boolean {
  return (style["overflow"] ?? "").trim().toLowerCase() === "hidden";
}

function hasInlineBoxStyle(segment: ParsedInlineSegment): boolean {
  if (!segment.inlineBox) return false;
  const display = (segment.styles["display"] ?? "").trim().toLowerCase();
  return display === "inline-block"
    || display === "inline-flex"
    || !!segment.styles["background-color"]
    || !!segment.styles["border"]
    || !!segment.styles["border-width"]
    || !!segment.styles["border-radius"]
    || !!segment.styles["padding"]
    || !!segment.styles["padding-left"]
    || !!segment.styles["padding-right"]
    || !!segment.styles["padding-top"]
    || !!segment.styles["padding-bottom"];
}

function inlineBaselineShift(segment: ParsedInlineSegment, size: number): number {
  const value = (segment.styles["baseline-shift"] ?? segment.styles["vertical-align"] ?? "").trim().toLowerCase();
  if (!value || value === "baseline") return 0;
  if (value === "super" || value === "sup" || value === "text-top") return -size * 0.38;
  if (value === "sub" || value === "text-bottom") return size * 0.22;
  if (value.endsWith("%")) {
    const percent = Number.parseFloat(value);
    if (Number.isFinite(percent)) return -size * percent / 100;
  }
  const length = cssLengthPt(value, size);
  return length == null ? 0 : -length;
}

function needsManualInlineLayout(inlines: ParsedInlineSegment[]): boolean {
  return inlines.some((segment) => hasInlineBoxStyle(segment) || inlineBaselineShift(segment, inlineSize(segment, 10)) !== 0);
}

function breakLongToken(doc: PdfKitDocument, font: string, size: number, token: string, width: number): string {
  doc.font(font).fontSize(size);
  if (doc.widthOfString(token) <= width) return token;
  let out = "";
  let current = "";
  for (const char of token) {
    const candidate = current + char;
    if (current && doc.widthOfString(candidate) > width) {
      out += `${current}\n`;
      current = char;
    } else {
      current = candidate;
    }
  }
  return out + current;
}

function wrapSegmentText(ctx: StreamContext, segment: ParsedInlineSegment, fallbackFont: string, fallbackSize: number, width: number): string {
  const transformedText = applyTextTransform(segment.text, segment.styles);
  const mode = wrapModeFromStyle(segment.styles, ctx.options.text?.overflowWrap);
  if (mode === "normal" || width <= 0) return transformedText;
  const font = inlineFont(ctx, segment, fallbackFont);
  const size = inlineSize(segment, fallbackSize);
  if (mode === "anywhere") return breakLongToken(ctx.doc, font, size, transformedText, width);
  return transformedText.split(/(\s+)/).map((part) => /\s+/.test(part) ? part : breakLongToken(ctx.doc, font, size, part, width)).join("");
}

function wrappedInlineSegments(ctx: StreamContext, inlines: ParsedInlineSegment[], fallbackFont: string, fallbackSize: number, width: number): ParsedInlineSegment[] {
  return inlines.map((segment) => ({ ...segment, text: wrapSegmentText(ctx, segment, fallbackFont, fallbackSize, width) }));
}

function ellipsizeText(ctx: StreamContext, text: string, font: string, size: number, width: number): string {
  const marker = "...";
  ctx.doc.font(font).fontSize(size);
  if (ctx.doc.widthOfString(text) <= width) return text;
  if (ctx.doc.widthOfString(marker) > width) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.doc.widthOfString(text.slice(0, mid) + marker) <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + marker;
}

function displayInlineSegments(
  ctx: StreamContext,
  text: string,
  inlines: ParsedInlineSegment[],
  fallbackFont: string,
  fallbackSize: number,
  width: number,
  style: StyleMap,
): ParsedInlineSegment[] {
  const base = inlines.length > 0 ? inlines : [{ text, styles: style }];
  if (isNoWrapStyle(style) && wantsEllipsis(style)) {
    const plain = base.map((segment) => applyTextTransform(segment.text, { ...style, ...segment.styles })).join("").replace(/\n+/g, " ");
    return [{ text: ellipsizeText(ctx, plain, fallbackFont, fallbackSize, width), styles: base[0]?.styles ?? style }];
  }
  return wrappedInlineSegments(ctx, base, fallbackFont, fallbackSize, width);
}

function inlineBoxPadding(styles: StyleMap): BoxSpacing {
  return boxPxToPt(parseBoxSpacing(styles, "padding", { top: 0, right: 0, bottom: 0, left: 0 }));
}

function inlineBoxBorder(styles: StyleMap): BorderStyle {
  return borderPxToPt(parseBorderStyle(styles, { width: 0, color: COLORS.border, style: "solid" }));
}

function inlineItem(
  ctx: StreamContext,
  segment: ParsedInlineSegment,
  text: string,
  fallbackFont: string,
  fallbackSize: number,
  fallbackColor: string,
  boxed: boolean,
  whitespace: boolean,
): InlineLayoutItem {
  const font = inlineFont(ctx, segment, fallbackFont);
  const size = inlineSize(segment, fallbackSize);
  const padding = boxed ? inlineBoxPadding(segment.styles) : { top: 0, right: 0, bottom: 0, left: 0 };
  const border = boxed ? inlineBoxBorder(segment.styles) : { width: 0, style: "none" as const };
  const background = parseCssColor(segment.styles["background-color"]);
  const textValue = applyTextTransform(text, segment.styles);
  const baselineShift = boxed ? 0 : inlineBaselineShift(segment, size);
  ctx.doc.font(font).fontSize(size);
  const textWidth = ctx.doc.widthOfString(textValue);
  const textHeight = ctx.doc.heightOfString(textValue || " ", { width: Math.max(1, textWidth + 2), lineBreak: false });
  const width = textWidth + padding.left + padding.right + border.width * 2;
  const height = Math.max(size * 1.15, textHeight) + padding.top + padding.bottom + border.width * 2;
  const visualTop = Math.min(0, baselineShift);
  const visualBottom = Math.max(height, baselineShift + height);
  const visualHeight = visualBottom - visualTop;
  const item: InlineLayoutItem = {
    segment,
    text: textValue,
    font,
    size,
    color: inlineColor(segment, fallbackColor),
    width,
    height,
    visualHeight,
    baselineShift,
    visualTop,
    visualBottom,
    textWidth,
    padding,
    border,
    radius: boxed ? boxRadiusPt(segment.styles, width, height) : boxRadiusPt({}, width, height),
    decoration: (segment.styles["text-decoration"] ?? "").toLowerCase(),
    boxed,
    whitespace,
  };
  if (background) item.background = background;
  if (segment.href) item.link = segment.href;
  return item;
}

function inlineItemWithText(ctx: StreamContext, item: InlineLayoutItem, text: string): InlineLayoutItem {
  ctx.doc.font(item.font).fontSize(item.size);
  const textWidth = ctx.doc.widthOfString(text);
  const textHeight = ctx.doc.heightOfString(text || " ", { width: Math.max(1, textWidth + 2), lineBreak: false });
  const width = textWidth + item.padding.left + item.padding.right + item.border.width * 2;
  const height = Math.max(item.size * 1.15, textHeight) + item.padding.top + item.padding.bottom + item.border.width * 2;
  const visualTop = Math.min(0, item.baselineShift);
  const visualBottom = Math.max(height, item.baselineShift + height);
  const visualHeight = visualBottom - visualTop;
  return {
    ...item,
    text,
    width,
    height,
    visualHeight,
    visualTop,
    visualBottom,
    textWidth,
    radius: item.boxed ? boxRadiusPt(item.segment.styles, width, height) : boxRadiusPt({}, width, height),
  };
}

function inlineLayoutItems(
  ctx: StreamContext,
  inlines: ParsedInlineSegment[],
  fallbackFont: string,
  fallbackSize: number,
  fallbackColor: string,
  noWrap: boolean,
): InlineLayoutItem[] {
  const items: InlineLayoutItem[] = [];
  for (const segment of inlines) {
    const boxed = hasInlineBoxStyle(segment);
    const text = segment.text;
    if (boxed || noWrap) {
      items.push(inlineItem(ctx, segment, text, fallbackFont, fallbackSize, fallbackColor, boxed, false));
      continue;
    }
    for (const part of text.split(/(\s+)/)) {
      if (!part) continue;
      items.push(inlineItem(ctx, segment, part, fallbackFont, fallbackSize, fallbackColor, false, /^\s+$/.test(part)));
    }
  }
  return items;
}

function layoutInlineLines(ctx: StreamContext, items: InlineLayoutItem[], width: number, noWrap: boolean): InlineLayoutLine[] {
  const lines: InlineLayoutLine[] = [];
  let current: InlineLayoutItem[] = [];
  let currentWidth = 0;
  let currentHeight = 0;

  const flush = () => {
    while (current[0]?.whitespace) {
      currentWidth -= current[0].width;
      current.shift();
    }
    while (current[current.length - 1]?.whitespace) {
      currentWidth -= current[current.length - 1]!.width;
      current.pop();
    }
    if (current.length > 0) {
      const top = Math.min(0, ...current.map((item) => item.visualTop));
      const bottom = Math.max(1, ...current.map((item) => item.visualBottom));
      lines.push({ items: current, width: Math.max(0, currentWidth), height: Math.max(1, bottom - top) });
    }
    current = [];
    currentWidth = 0;
    currentHeight = 0;
  };

  for (const item of items) {
    if (!noWrap && item.text.includes("\n")) {
      const parts = item.text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          const next = inlineItemWithText(ctx, item, parts[i]!);
          next.whitespace = false;
          current.push(next);
          currentWidth += next.width;
          currentHeight = Math.max(currentHeight, next.visualHeight);
        }
        if (i < parts.length - 1) flush();
      }
      continue;
    }
    if (!noWrap && !item.whitespace && current.length > 0 && currentWidth + item.width > width) flush();
    if (!noWrap && item.whitespace && current.length === 0) continue;
    current.push(item);
    currentWidth += item.width;
    currentHeight = Math.max(currentHeight, item.visualHeight);
  }
  flush();
  return lines.length > 0 ? lines : [{ items: [], width: 0, height: fallbackLineHeight(items) }];
}

function fallbackLineHeight(items: InlineLayoutItem[]): number {
  return Math.max(1, ...items.map((item) => item.visualHeight));
}

function inlineManualHeight(
  ctx: StreamContext,
  inlines: ParsedInlineSegment[],
  fallbackFont: string,
  fallbackSize: number,
  fallbackColor: string,
  width: number,
  noWrap: boolean,
): number {
  const items = inlineLayoutItems(ctx, inlines, fallbackFont, fallbackSize, fallbackColor, noWrap);
  return layoutInlineLines(ctx, items, width, noWrap).reduce((sum, line) => sum + line.height, 0);
}

function drawManualInlineText(
  ctx: StreamContext,
  inlines: ParsedInlineSegment[],
  x: number,
  y: number,
  width: number,
  fallbackFont: string,
  fallbackSize: number,
  fallbackColor: string,
  align: "left" | "center" | "right",
  noWrap: boolean,
): void {
  const items = inlineLayoutItems(ctx, inlines, fallbackFont, fallbackSize, fallbackColor, noWrap);
  const lines = layoutInlineLines(ctx, items, width, noWrap);
  let cursorY = y;
  for (const line of lines) {
    let cursorX = align === "right" ? x + width - line.width : align === "center" ? x + (width - line.width) / 2 : x;
    const lineTop = Math.min(0, ...line.items.map((item) => item.visualTop));
    for (const item of line.items) {
      const itemY = cursorY - lineTop + item.baselineShift;
      if (item.background) fillBox(ctx, cursorX, itemY, item.width, item.height, item.background, item.radius);
      strokeBox(ctx, cursorX, itemY, item.width, item.height, item.border, item.radius);
      ctx.doc
        .font(item.font)
        .fontSize(item.size)
        .fillColor(item.color)
        .text(item.text, cursorX + item.border.width + item.padding.left, itemY + item.border.width + item.padding.top, {
          width: Math.max(1, item.textWidth + 2),
          lineBreak: false,
          continued: false,
          underline: item.decoration.includes("underline"),
          strike: item.decoration.includes("line-through"),
          link: item.link,
        });
      cursorX += item.width;
    }
    cursorY += line.height;
  }
}

function inlineTextHeight(ctx: StreamContext, text: string, inlines: ParsedInlineSegment[], fallbackFont: string, fallbackSize: number, width: number, lineGap: number, noWrap = false): number {
  const maxSize = Math.max(fallbackSize, ...inlines.map((segment) => inlineSize(segment, fallbackSize)));
  const source = inlines.length > 0 ? inlines : [{ text, styles: {} }];
  if (needsManualInlineLayout(source)) return inlineManualHeight(ctx, source, fallbackFont, fallbackSize, COLORS.text, width, noWrap);
  const wrappedText = (noWrap ? source : wrappedInlineSegments(ctx, source, fallbackFont, fallbackSize, width)).map((segment) => segment.text).join("");
  ctx.doc.font(fallbackFont).fontSize(maxSize);
  return ctx.doc.heightOfString(wrappedText || " ", { width: noWrap ? 100000 : width, lineGap, lineBreak: !noWrap });
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
  noWrap = false,
): void {
  const source = inlines.length > 0 ? inlines : [{ text, styles: {} }];
  if (needsManualInlineLayout(source)) {
    drawManualInlineText(ctx, source, x, y, width, fallbackFont, fallbackSize, fallbackColor, align, noWrap);
    return;
  }
  const segments = noWrap ? source : wrappedInlineSegments(ctx, source, fallbackFont, fallbackSize, width);
  const noWrapWidth = noWrap
    ? Math.max(1, segments.reduce((sum, segment) => {
      ctx.doc.font(inlineFont(ctx, segment, fallbackFont)).fontSize(inlineSize(segment, fallbackSize));
      return sum + ctx.doc.widthOfString(segment.text);
    }, 0))
    : width;
  const drawX = noWrap && align === "right"
    ? x + width - noWrapWidth
    : noWrap && align === "center"
      ? x + (width - noWrapWidth) / 2
      : x;
  const drawWidth = noWrap ? Math.max(width, noWrapWidth + 2) : width;
  const drawAlign = noWrap ? "left" : align;
  let first = true;
  for (const segment of segments) {
    const decoration = (segment.styles["text-decoration"] ?? "").toLowerCase();
    const options = {
      width: drawWidth,
      lineGap,
      align: drawAlign,
      lineBreak: !noWrap,
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
      ctx.doc.text(segment.text, drawX, y, options);
      first = false;
    } else {
      ctx.doc.text(segment.text, options);
    }
  }
  if (!first) ctx.doc.text("", { continued: false });
}

async function drawTextBlock(ctx: StreamContext, block: Extract<ParsedBlock, { type: "heading" | "paragraph" | "list-item" | "blockquote" | "preformatted" }>): Promise<void> {
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
  const radius = borderRadiusPt(block.style, boxWidth, boxHeight);
  drawBoxShadow(ctx, block.style, boxX, ctx.y, boxWidth, boxHeight, radius);
  if (bg) fillBox(ctx, boxX, ctx.y, boxWidth, boxHeight, bg, radius);
  await drawBackgroundImage(ctx, block.style, boxX, ctx.y, boxWidth, boxHeight, radius);
  strokeBox(ctx, boxX, ctx.y, boxWidth, boxHeight, box.border, radius);
  if (block.type === "blockquote") {
    const border = parseBorderStyle(block.style, { width: 3 * 96 / 72, color: parseCssColor(block.style["border-color"]) ?? COLORS.border });
    ctx.doc.rect(boxX, ctx.y, Math.max(2, pxToPt(border.width)), boxHeight).fill(border.color ?? COLORS.border);
  }

  ctx.doc.save();
  if (isOverflowHidden(block.style) || radius > 0) {
    clipBox(ctx, contentX, ctx.y + box.border.width + box.padding.top, contentWidth, Math.max(1, boxHeight - box.border.width * 2 - box.padding.top - box.padding.bottom), Math.max(0, radius - Math.max(box.padding.left, box.padding.top)));
  }
  drawInlineText(ctx, displayText, displayInlines, contentX, ctx.y + box.border.width + box.padding.top, contentWidth, font, size, blockColor(block), lineGap, block.style["text-align"] === "center" || block.style["text-align"] === "right" ? block.style["text-align"] as "center" | "right" : "left");
  ctx.doc.restore();
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
  drawAssetInBox(ctx, asset, x, ctx.y, width, height, block.style, 1, "image block");
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

function chartTheme(block: Extract<ParsedBlock, { type: "chart" }>): { colors: string[]; grid: string; muted: string; text: string; track: string; areaEnd: string } {
  return CHART_THEMES[block.chart.theme ?? ""] ?? CHART_THEMES.default!;
}

function chartColor(block: Extract<ParsedBlock, { type: "chart" }>, index: number): string {
  const theme = chartTheme(block);
  const raw = block.chart.colors?.[index] ?? theme.colors[index % theme.colors.length] ?? CHART_COLORS[index % CHART_COLORS.length] ?? "#2563eb";
  return parseCssColor(raw) ?? raw;
}

function chartGradientColor(block: Extract<ParsedBlock, { type: "chart" }>, index: number, fallback: string): string {
  const raw = block.chart.gradient?.[index];
  return raw ? parseCssColor(raw) ?? raw : fallback;
}

function fillChartAreaGradient(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number, fallbackColor: string): void {
  const start = chartGradientColor(block, 0, fallbackColor);
  const end = chartGradientColor(block, 1, chartTheme(block).areaEnd);
  const gradientDoc = ctx.doc as unknown as {
    linearGradient?: (x1: number, y1: number, x2: number, y2: number) => {
      stop: (offset: number, color: string, opacity?: number) => unknown;
    };
  };
  if (typeof gradientDoc.linearGradient !== "function") {
    ctx.doc.fillOpacity(0.13).fill(fallbackColor).fillOpacity(1);
    return;
  }
  const gradient = gradientDoc.linearGradient(x, y, x, y + height);
  gradient.stop(0, start, 0.24);
  gradient.stop(1, end, 0.04);
  ctx.doc.fill(gradient as unknown as string);
}

function chartTitleHeight(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, width: number): number {
  let height = 0;
  if (block.chart.title) {
    ctx.doc.font(fontForStyle(ctx, block.style, ctx.boldFontName)).fontSize(cssLengthPt(block.style["font-size"]) ?? 11);
    height += ctx.doc.heightOfString(block.chart.title, { width, lineGap: 1 });
  }
  if (block.chart.subtitle) {
    ctx.doc.font(ctx.regularFontName).fontSize(7.5);
    height += ctx.doc.heightOfString(block.chart.subtitle, { width, lineGap: 1 }) + 2;
  }
  return height > 0 ? height + 8 : 0;
}

function drawChartHeader(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number): number {
  let cursor = y;
  if (block.chart.title) {
    ctx.doc
      .font(fontForStyle(ctx, block.style, ctx.boldFontName))
      .fontSize(cssLengthPt(block.style["font-size"]) ?? 11)
      .fillColor(parseCssColor(block.style["color"]) ?? "#0f172a")
      .text(block.chart.title, x, cursor, { width, lineBreak: false });
    cursor += 14;
  }
  if (block.chart.subtitle) {
    ctx.doc
      .font(ctx.regularFontName)
      .fontSize(7.5)
      .fillColor("#64748b")
      .text(block.chart.subtitle, x, cursor, { width, lineBreak: false });
    cursor += 12;
  }
  return cursor + (cursor > y ? 4 : 0);
}

function drawBarChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
  const values = block.chart.values;
  const max = Math.max(1, ...values);
  const plotLeft = x + 30;
  const plotBottom = y + height - 18;
  const plotTop = y + 10;
  const plotWidth = Math.max(1, width - 38);
  const plotHeight = Math.max(1, plotBottom - plotTop);
  const gap = Math.min(10, plotWidth / Math.max(1, values.length) * 0.22);
  const barWidth = Math.max(4, (plotWidth - gap * (values.length - 1)) / Math.max(1, values.length));

  ctx.doc.save();
  ctx.doc.strokeColor("#e2e8f0").lineWidth(0.5);
  for (let i = 0; i <= 3; i++) {
    const gy = plotTop + plotHeight * i / 3;
    ctx.doc.moveTo(plotLeft, gy).lineTo(plotLeft + plotWidth, gy).stroke();
  }
  ctx.doc.font(ctx.regularFontName).fontSize(6.2).fillColor("#94a3b8");
  ctx.doc.text(`${Math.round(max)}${block.chart.unit ?? ""}`, x, plotTop - 2, { width: 26, align: "right", lineBreak: false });
  ctx.doc.text(`0${block.chart.unit ?? ""}`, x, plotBottom - 5, { width: 26, align: "right", lineBreak: false });

  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? 0;
    const barHeight = plotHeight * Math.max(0, value) / max;
    const bx = plotLeft + i * (barWidth + gap);
    const by = plotBottom - barHeight;
    const color = chartColor(block, i);
    fillBox(ctx, bx, by, barWidth, barHeight, color, { topLeft: 3, topRight: 3, bottomRight: 0, bottomLeft: 0 });
    ctx.doc.font(ctx.boldFontName).fontSize(7).fillColor("#334155").text(String(Math.round(value)), bx - 5, by - 11, { width: barWidth + 10, align: "center", lineBreak: false });
    ctx.doc.font(ctx.regularFontName).fontSize(6.3).fillColor("#64748b").text(block.chart.labels[i] ?? "", bx - 10, plotBottom + 5, { width: barWidth + 20, align: "center", lineBreak: false });
  }
  ctx.doc.restore();
}

function chartSeries(block: Extract<ParsedBlock, { type: "chart" }>): number[][] {
  return block.chart.series?.length ? block.chart.series : [block.chart.values];
}

function pointsForSeries(values: number[], min: number, max: number, plotLeft: number, plotTop: number, plotWidth: number, plotHeight: number): Array<{ x: number; y: number }> {
  const range = Math.max(1, max - min);
  return values.map((value, index) => ({
    x: plotLeft + plotWidth * (values.length === 1 ? 0 : index / (values.length - 1)),
    y: plotTop + plotHeight - (value - min) / range * plotHeight,
  }));
}

function drawSmoothPath(ctx: StreamContext, points: Array<{ x: number; y: number }>): void {
  if (points.length === 0) return;
  ctx.doc.moveTo(points[0]!.x, points[0]!.y);
  if (points.length === 1) return;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.doc.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

function fillSeriesArea(ctx: StreamContext, points: Array<{ x: number; y: number }>, bottom: number, color: string, opacity: number): void {
  if (points.length < 2) return;
  ctx.doc.save();
  ctx.doc.moveTo(points[0]!.x, bottom);
  ctx.doc.lineTo(points[0]!.x, points[0]!.y);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.doc.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
  ctx.doc.lineTo(points[points.length - 1]!.x, bottom).closePath();
  ctx.doc.opacity(clamp(opacity, 0, 1));
  ctx.doc.fill(color);
  ctx.doc.restore();
  ctx.doc.opacity(1);
}

function drawLineChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
  const theme = chartTheme(block);
  const series = chartSeries(block).map((items) => items.filter((value) => Number.isFinite(value)));
  const allValues = series.flat();
  const max = block.chart.max && block.chart.max > 0 ? block.chart.max : Math.max(1, ...allValues);
  const min = Math.min(0, ...allValues);
  const plotLeft = x + 30;
  const plotRight = x + width - 10;
  const plotTop = y + 10;
  const legendSpace = series.length > 1 ? 18 : 0;
  const plotBottom = y + height - 21 - legendSpace;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);
  const isArea = block.chart.chartType === "area";

  ctx.doc.save();
  ctx.doc.strokeColor(theme.grid).lineWidth(0.45);
  for (let i = 0; i <= 4; i++) {
    const gy = plotTop + plotHeight * i / 4;
    ctx.doc.moveTo(plotLeft, gy).lineTo(plotRight, gy).stroke();
  }
  ctx.doc.font(ctx.regularFontName).fontSize(5.8).fillColor(theme.muted);
  ctx.doc.text(`${Math.round(max)}${block.chart.unit ?? ""}`, x, plotTop - 3, { width: 26, align: "right", lineBreak: false });
  ctx.doc.text(`${Math.round(min)}${block.chart.unit ?? ""}`, x, plotBottom - 5, { width: 26, align: "right", lineBreak: false });

  for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
    const values = series[seriesIndex]!;
    const points = pointsForSeries(values, min, max, plotLeft, plotTop, plotWidth, plotHeight);
    const color = chartColor(block, seriesIndex);
    if (isArea) fillSeriesArea(ctx, points, plotBottom, color, seriesIndex === 0 ? 0.16 : 0.09);
  }
  for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
    const values = series[seriesIndex]!;
    const points = pointsForSeries(values, min, max, plotLeft, plotTop, plotWidth, plotHeight);
    const color = chartColor(block, seriesIndex);
    drawSmoothPath(ctx, points);
    ctx.doc.strokeColor(color).lineWidth(seriesIndex === 0 ? 2.2 : 1.8).stroke();
    for (const point of points) {
      ctx.doc.circle(point.x, point.y, 2.7).fill(color);
      ctx.doc.circle(point.x, point.y, 2.7).strokeColor("#ffffff").lineWidth(0.9).stroke();
    }
  }
  const labelStep = Math.max(1, Math.ceil(block.chart.labels.length / 6));
  ctx.doc.font(ctx.regularFontName).fontSize(5.8).fillColor(theme.muted);
  for (let i = 0; i < block.chart.labels.length; i += labelStep) {
    const lx = plotLeft + plotWidth * (block.chart.labels.length === 1 ? 0 : i / (block.chart.labels.length - 1));
    ctx.doc.text(block.chart.labels[i] ?? "", lx - 18, plotBottom + 6, { width: 36, align: "center", lineBreak: false });
  }
  if (series.length > 1) drawChartLegend(ctx, block, x, y + height - 12, width, series.length);
  ctx.doc.restore();
}

function drawChartLegend(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, count: number): void {
  const legendCount = Math.min(count, 6);
  const labels = Array.from({ length: legendCount }, (_, index) => block.chart.seriesLabels?.[index] ?? block.chart.labels[index] ?? `Series ${index + 1}`);
  ctx.doc.font(ctx.boldFontName).fontSize(6.4);
  const marker = 7;
  const markerGap = 5;
  const itemGap = 18;
  const itemWidths = labels.map((label) => marker + markerGap + Math.min(72, ctx.doc.widthOfString(label)));
  const rawTotal = itemWidths.reduce((sum, item) => sum + item, 0) + itemGap * Math.max(0, legendCount - 1);
  const total = Math.min(width, rawTotal);
  let legendX = x + Math.max(0, (width - total) / 2);
  for (let i = 0; i < legendCount; i++) {
    ctx.doc.roundedRect(legendX, y + 2, 7, 7, 2).fill(chartColor(block, i));
    ctx.doc
      .font(ctx.boldFontName)
      .fontSize(6.4)
      .fillColor(chartTheme(block).text)
      .text(labels[i]!, legendX + marker + markerGap, y, { width: Math.min(72, Math.max(1, itemWidths[i]! - marker - markerGap)), lineBreak: false });
    legendX += itemWidths[i]! + itemGap;
  }
}

function drawSparklineChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
  const theme = chartTheme(block);
  const series = chartSeries(block).map((items) => items.filter((value) => Number.isFinite(value)));
  const allValues = series.flat();
  const max = Math.max(1, ...allValues);
  const min = Math.min(...allValues);
  const padX = 10;
  const plotLeft = x + padX;
  const plotRight = x + width - padX;
  const plotTop = y + 17;
  const plotBottom = y + height - (series.length > 1 ? 25 : 14);
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);

  ctx.doc.save();
  ctx.doc.strokeColor(theme.grid).lineWidth(0.4);
  for (let i = 0; i <= 2; i++) {
    const gy = plotTop + plotHeight * i / 2;
    ctx.doc.moveTo(plotLeft, gy).lineTo(plotRight, gy).stroke();
  }
  for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
    const points = pointsForSeries(series[seriesIndex]!, min, max, plotLeft, plotTop, plotWidth, plotHeight);
    const color = chartColor(block, seriesIndex);
    if (seriesIndex === 0) fillSeriesArea(ctx, points, plotBottom, color, 0.1);
    drawSmoothPath(ctx, points);
    ctx.doc.strokeColor(color).lineWidth(seriesIndex === 0 ? 2.1 : 1.7).stroke();
    const last = points[points.length - 1];
    if (last) {
      ctx.doc.circle(last.x, last.y, 3.2).fill(color);
      ctx.doc.circle(last.x, last.y, 3.2).strokeColor("#ffffff").lineWidth(1).stroke();
    }
  }
  const latest = series[0]?.[series[0].length - 1] ?? block.chart.values[block.chart.values.length - 1] ?? 0;
  ctx.doc.font(ctx.boldFontName).fontSize(12).fillColor(theme.text).text(`${Math.round(latest)}${block.chart.unit ?? ""}`, x + width - 62, y + 3, { width: 54, align: "right", lineBreak: false });
  if (series.length > 1) drawChartLegend(ctx, block, x, y + height - 13, width, series.length);
  ctx.doc.restore();
}

function drawHorizontalBarChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
  const theme = chartTheme(block);
  const values = block.chart.values.map((value) => Math.max(0, value));
  const max = block.chart.max && block.chart.max > 0 ? block.chart.max : Math.max(1, ...values);
  const plotLeft = x + Math.min(76, width * 0.32);
  const plotRight = x + width - 36;
  const plotTop = y + 8;
  const rowHeight = Math.min(22, Math.max(14, (height - 16) / Math.max(1, values.length)));
  const barHeight = Math.max(6, rowHeight * 0.48);
  const plotWidth = Math.max(1, plotRight - plotLeft);

  ctx.doc.save();
  ctx.doc.font(ctx.regularFontName).fontSize(6.8).fillColor("#475569");
  for (let i = 0; i < values.length; i++) {
    const rowY = plotTop + i * rowHeight;
    const centerY = rowY + rowHeight / 2;
    const label = block.chart.labels[i] ?? String(i + 1);
    const value = values[i]!;
    const barWidth = plotWidth * clamp(value / max, 0, 1);
    ctx.doc.text(label, x, centerY - 4, { width: plotLeft - x - 8, align: "right", lineBreak: false });
    fillBox(ctx, plotLeft, centerY - barHeight / 2, plotWidth, barHeight, theme.track, 999);
    fillBox(ctx, plotLeft, centerY - barHeight / 2, barWidth, barHeight, chartColor(block, i), 999);
    ctx.doc.font(ctx.boldFontName).fontSize(6.8).fillColor("#0f172a").text(`${Math.round(value)}${block.chart.unit ?? ""}`, plotRight + 4, centerY - 4, { width: 32, align: "right", lineBreak: false });
    ctx.doc.font(ctx.regularFontName).fontSize(6.8).fillColor("#475569");
  }
  ctx.doc.restore();
}

function drawStackedBarChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
  const series = chartSeries(block).map((items) => items.map((value) => Math.max(0, value)));
  const categoryCount = Math.max(1, block.chart.labels.length, ...series.map((items) => items.length));
  const totals = Array.from({ length: categoryCount }, (_, index) => series.reduce((sum, items) => sum + (items[index] ?? 0), 0));
  const max = block.chart.max && block.chart.max > 0 ? block.chart.max : Math.max(1, ...totals);
  const plotLeft = x + 28;
  const plotBottom = y + height - 24;
  const plotTop = y + 10;
  const plotWidth = Math.max(1, width - 40);
  const plotHeight = Math.max(1, plotBottom - plotTop);
  const gap = Math.min(11, plotWidth / categoryCount * 0.26);
  const barWidth = Math.max(6, (plotWidth - gap * Math.max(0, categoryCount - 1)) / categoryCount);

  ctx.doc.save();
  ctx.doc.strokeColor("#e2e8f0").lineWidth(0.5);
  for (let i = 0; i <= 3; i++) {
    const gy = plotTop + plotHeight * i / 3;
    ctx.doc.moveTo(plotLeft, gy).lineTo(plotLeft + plotWidth, gy).stroke();
  }
  for (let category = 0; category < categoryCount; category++) {
    let cursorBottom = plotBottom;
    const bx = plotLeft + category * (barWidth + gap);
    for (let seriesIndex = 0; seriesIndex < series.length; seriesIndex++) {
      const value = series[seriesIndex]?.[category] ?? 0;
      const segmentHeight = plotHeight * value / max;
      if (segmentHeight > 0) {
        fillBox(ctx, bx, cursorBottom - segmentHeight, barWidth, segmentHeight, chartColor(block, seriesIndex), seriesIndex === series.length - 1 ? { topLeft: 3, topRight: 3, bottomRight: 0, bottomLeft: 0 } : 0);
        cursorBottom -= segmentHeight;
      }
    }
    ctx.doc.font(ctx.regularFontName).fontSize(6.1).fillColor("#64748b").text(block.chart.labels[category] ?? String(category + 1), bx - 10, plotBottom + 6, { width: barWidth + 20, align: "center", lineBreak: false });
  }
  drawChartLegend(ctx, block, x, y + height - 10, width, series.length);
  ctx.doc.restore();
}

function donutSegmentPath(ctx: StreamContext, cx: number, cy: number, outerRadius: number, innerRadius: number, startDeg: number, endDeg: number): void {
  const steps = Math.max(8, Math.ceil(Math.abs(endDeg - startDeg) / 8));
  const outer: Array<{ x: number; y: number }> = [];
  const inner: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (startDeg + (endDeg - startDeg) * i / steps) * Math.PI / 180;
    outer.push({ x: cx + Math.cos(angle) * outerRadius, y: cy + Math.sin(angle) * outerRadius });
    inner.push({ x: cx + Math.cos(angle) * innerRadius, y: cy + Math.sin(angle) * innerRadius });
  }
  ctx.doc.moveTo(outer[0]!.x, outer[0]!.y);
  for (const point of outer.slice(1)) ctx.doc.lineTo(point.x, point.y);
  for (const point of inner.reverse()) ctx.doc.lineTo(point.x, point.y);
  ctx.doc.closePath();
}

function fillAnnularSegment(ctx: StreamContext, cx: number, cy: number, outerRadius: number, innerRadius: number, startDeg: number, endDeg: number, color: string, opacity = 1): void {
  if (outerRadius <= 0 || innerRadius < 0 || endDeg <= startDeg) return;
  ctx.doc.save();
  ctx.doc.opacity(clamp(opacity, 0, 1));
  donutSegmentPath(ctx, cx, cy, outerRadius, innerRadius, startDeg, endDeg);
  ctx.doc.fill(color);
  ctx.doc.restore();
  ctx.doc.opacity(1);
}

function chartMax(block: Extract<ParsedBlock, { type: "chart" }>, values: number[]): number {
  if (block.chart.max && block.chart.max > 0) return block.chart.max;
  const max = Math.max(1, ...values.map((value) => Math.max(0, value)));
  return max <= 100 ? 100 : max;
}

function drawCenteredChartValue(ctx: StreamContext, text: string, unit: string | undefined, cx: number, cy: number, width: number, color = "#0f172a"): void {
  const unitText = unit?.trim() ?? "";
  const valueSize = clamp(width * 0.18, 12, 22);
  const unitSize = clamp(width * 0.07, 5.5, 8);
  const valueHeight = valueSize * 0.9;
  const unitHeight = unitText ? unitSize * 1.05 : 0;
  const gap = unitText ? 2 : 0;
  const stackHeight = valueHeight + gap + unitHeight;
  const top = cy - stackHeight / 2;
  ctx.doc
    .font(ctx.boldFontName)
    .fontSize(valueSize)
    .fillColor(color)
    .text(text, cx - width / 2, top, { width, align: "center", lineBreak: false });
  if (unitText) {
    ctx.doc
      .font(ctx.regularFontName)
      .fontSize(unitSize)
      .fillColor("#64748b")
      .text(unitText, cx - width / 2, top + valueHeight + gap, { width, align: "center", lineBreak: false });
  }
}

function drawDonutChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
  const values = block.chart.values.map((value) => Math.max(0, value));
  const total = Math.max(1, values.reduce((sum, value) => sum + value, 0));
  const radius = Math.min(height * 0.34, width * 0.16, 48);
  const innerRadius = radius * 0.62;
  const cx = x + width * 0.24;
  const cy = y + height * 0.48;
  let angle = -90;
  ctx.doc.save();
  for (let i = 0; i < values.length; i++) {
    const sweep = values[i]! / total * 360;
    if (sweep > 0) {
      donutSegmentPath(ctx, cx, cy, radius, innerRadius, angle + 1, angle + sweep - 1);
      ctx.doc.fill(chartColor(block, i));
    }
    angle += sweep;
  }
  ctx.doc.circle(cx, cy, innerRadius).fill("#ffffff");
  ctx.doc.restore();
  const valueText = String(Math.round(total));
  const unitText = block.chart.unit?.trim() ?? "";
  const valueSize = Math.max(11, Math.min(16, innerRadius * 0.5));
  const unitSize = Math.max(5, Math.min(7, innerRadius * 0.2));
  const valueHeight = valueSize * 0.9;
  const unitHeight = unitText ? unitSize * 1.05 : 0;
  const gap = unitText ? 2 : 0;
  const stackHeight = valueHeight + gap + unitHeight;
  const textTop = cy - stackHeight / 2;
  const textWidth = innerRadius * 2;
  ctx.doc
    .font(ctx.boldFontName)
    .fontSize(valueSize)
    .fillColor("#0f172a")
    .text(valueText, cx - innerRadius, textTop, { width: textWidth, align: "center", lineBreak: false });
  if (unitText) {
    ctx.doc
      .font(ctx.regularFontName)
      .fontSize(unitSize)
      .fillColor("#64748b")
      .text(unitText, cx - innerRadius, textTop + valueHeight + gap, { width: textWidth, align: "center", lineBreak: false });
  }

  const legendX = x + width * 0.46;
  const itemHeight = 14;
  for (let i = 0; i < Math.min(values.length, block.chart.labels.length, 5); i++) {
    const itemY = y + 16 + i * itemHeight;
    ctx.doc.roundedRect(legendX, itemY + 2, 7, 7, 2).fill(chartColor(block, i));
    ctx.doc.font(ctx.regularFontName).fontSize(7).fillColor("#475569").text(block.chart.labels[i] ?? "", legendX + 11, itemY, { width: width * 0.28, lineBreak: false });
    ctx.doc.font(ctx.boldFontName).fontSize(7).fillColor("#0f172a").text(String(values[i]), x + width - 48, itemY, { width: 40, align: "right", lineBreak: false });
  }
}

function drawPieChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
  const theme = chartTheme(block);
  const values = block.chart.values.map((value) => Math.max(0, value));
  const total = Math.max(1, values.reduce((sum, value) => sum + value, 0));
  const radius = Math.min(height * 0.42, width * 0.2, 64);
  const cx = x + width * 0.27;
  const cy = y + height * 0.5;
  let angle = -90;
  ctx.doc.save();
  ctx.doc.circle(cx + 1.5, cy + 2, radius).fillOpacity(0.06).fill("#0f172a").fillOpacity(1);
  for (let i = 0; i < values.length; i++) {
    const sweep = values[i]! / total * 360;
    if (sweep > 0) {
      const overlap = values.length > 1 ? 0.18 : 0;
      fillAnnularSegment(ctx, cx, cy, radius, 0, angle - overlap, angle + sweep + overlap, chartColor(block, i));
    }
    angle += sweep;
  }
  ctx.doc.circle(cx, cy, radius).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
  ctx.doc.circle(cx, cy, radius * 0.48).fillOpacity(0.10).fill("#ffffff").fillOpacity(1);
  const legendX = x + width * 0.55;
  const itemHeight = 15;
  const legendTop = y + Math.max(8, (height - itemHeight * Math.min(values.length, 6)) / 2);
  for (let i = 0; i < Math.min(values.length, block.chart.labels.length, 6); i++) {
    const itemY = legendTop + i * itemHeight;
    const percent = Math.round(values[i]! / total * 100);
    fillBox(ctx, legendX - 3, itemY - 2, width * 0.38, 12, i % 2 === 0 ? "#f8fafc" : "#ffffff", 4);
    ctx.doc.roundedRect(legendX + 3, itemY + 1.5, 7, 7, 2).fill(chartColor(block, i));
    ctx.doc.font(ctx.regularFontName).fontSize(7).fillColor(theme.muted).text(block.chart.labels[i] ?? "", legendX + 14, itemY, { width: width * 0.2, lineBreak: false });
    ctx.doc.font(ctx.boldFontName).fontSize(7).fillColor(theme.text).text(`${percent}%`, x + width - 44, itemY, { width: 38, align: "right", lineBreak: false });
  }
  ctx.doc.restore();
}

function drawGaugeChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
  const value = Math.max(0, block.chart.values[0] ?? 0);
  const max = block.chart.max && block.chart.max > 0 ? block.chart.max : 100;
  const radius = Math.min(width * 0.27, height * 0.43, 72);
  const thickness = Math.max(10, Math.min(18, radius * 0.24));
  const innerRadius = radius - thickness;
  const cx = x + width * 0.5;
  const cy = y + height * 0.66;
  const start = 180;
  const sweep = 180;
  fillAnnularSegment(ctx, cx, cy, radius, innerRadius, start, start + sweep, "#e5e7eb", 0.95);
  fillAnnularSegment(ctx, cx, cy, radius, innerRadius, start, start + sweep * clamp(value / max, 0, 1), chartColor(block, 0), 0.98);
  drawCenteredChartValue(ctx, block.chart.center ?? String(Math.round(value)), block.chart.unit, cx, cy - radius * 0.07, radius * 1.2);
  ctx.doc.save();
  ctx.doc.font(ctx.regularFontName).fontSize(6.2).fillColor("#64748b");
  ctx.doc.text(`0${block.chart.unit ?? ""}`, cx - radius - 20, cy + 3, { width: 36, align: "center", lineBreak: false });
  ctx.doc.text(`${Math.round(max)}${block.chart.unit ?? ""}`, cx + radius - 16, cy + 3, { width: 42, align: "center", lineBreak: false });
  ctx.doc.restore();
}

function drawRadialChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
  const values = block.chart.values.map((value) => Math.max(0, value));
  const max = chartMax(block, values);
  const ringCount = clamp(values.length, 1, 6);
  const outerRadius = Math.min(width * 0.22, height * 0.35, 58);
  const cx = x + width * 0.38;
  const cy = y + height * 0.48;
  const gap = Math.max(2, outerRadius * 0.055);
  const thickness = Math.max(5, Math.min(11, (outerRadius * 0.68 - gap * (ringCount - 1)) / ringCount));
  const start = -205;
  const sweep = 310;
  ctx.doc.save();
  for (let i = 0; i < ringCount; i++) {
    const outer = outerRadius - i * (thickness + gap);
    const inner = Math.max(2, outer - thickness);
    fillAnnularSegment(ctx, cx, cy, outer, inner, start, start + sweep, "#e5e7eb", 0.9);
    fillAnnularSegment(ctx, cx, cy, outer, inner, start, start + sweep * clamp(values[i]! / max, 0, 1), chartColor(block, i), 0.98);
  }
  const centerText = block.chart.center ?? (values.length === 1 ? String(Math.round(values[0]!)) : "");
  if (centerText) drawCenteredChartValue(ctx, centerText, block.chart.unit, cx, cy, outerRadius * 1.05);
  const legendX = x + width * 0.67;
  const legendTop = y + Math.max(14, height * 0.18);
  for (let i = 0; i < Math.min(values.length, block.chart.labels.length, 6); i++) {
    const itemY = legendTop + i * 13;
    ctx.doc.roundedRect(legendX, itemY + 2, 7, 7, 2).fill(chartColor(block, i));
    ctx.doc.font(ctx.regularFontName).fontSize(6.8).fillColor("#475569").text(block.chart.labels[i] ?? "", legendX + 11, itemY, { width: width * 0.22, lineBreak: false });
    ctx.doc.font(ctx.boldFontName).fontSize(6.8).fillColor("#0f172a").text(String(Math.round(values[i]!)), x + width - 44, itemY, { width: 36, align: "right", lineBreak: false });
  }
  ctx.doc.restore();
}

function drawRadialStackedChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
  const values = block.chart.values.map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0);
  const max = block.chart.max && block.chart.max > 0 ? block.chart.max : Math.max(1, total);
  const radius = Math.min(width * 0.28, height * 0.42, 72);
  const thickness = Math.max(10, Math.min(17, radius * 0.22));
  const innerRadius = radius - thickness;
  const cx = x + width * 0.48;
  const cy = y + height * 0.64;
  const start = 180;
  const sweep = 180;
  fillAnnularSegment(ctx, cx, cy, radius, innerRadius, start, start + sweep, "#e5e7eb", 0.9);
  let angle = start;
  for (let i = 0; i < values.length; i++) {
    const part = sweep * values[i]! / max;
    fillAnnularSegment(ctx, cx, cy, radius, innerRadius, angle + 0.8, Math.min(start + sweep, angle + part - 0.8), chartColor(block, i), 0.98);
    angle += part;
  }
  drawCenteredChartValue(ctx, block.chart.center ?? String(Math.round(total)), block.chart.unit, cx, cy - radius * 0.06, radius * 1.25);
  drawChartLegend(ctx, block, x, y + height - 15, width, Math.min(values.length, 4));
}

function radarPoint(cx: number, cy: number, radius: number, index: number, total: number, ratio: number): { x: number; y: number } {
  const angle = (-90 + 360 * index / Math.max(1, total)) * Math.PI / 180;
  return {
    x: cx + Math.cos(angle) * radius * ratio,
    y: cy + Math.sin(angle) * radius * ratio,
  };
}

function drawRadarPolygon(ctx: StreamContext, points: Array<{ x: number; y: number }>, fill: string | undefined, stroke: string, opacity: number): void {
  if (points.length === 0) return;
  ctx.doc.save();
  ctx.doc.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) ctx.doc.lineTo(point.x, point.y);
  ctx.doc.closePath();
  if (fill) {
    ctx.doc.opacity(clamp(opacity, 0, 1));
    ctx.doc.fill(fill);
    ctx.doc.opacity(1);
  }
  ctx.doc.moveTo(points[0]!.x, points[0]!.y);
  for (const point of points.slice(1)) ctx.doc.lineTo(point.x, point.y);
  ctx.doc.closePath().strokeColor(stroke).lineWidth(1.2).stroke();
  ctx.doc.restore();
}

function drawRadarChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
  const series = (block.chart.series?.length ? block.chart.series : [block.chart.values]).map((items) => items.map((value) => Math.max(0, value)));
  const axisCount = Math.max(3, block.chart.labels.length, ...series.map((items) => items.length));
  const allValues = series.flat();
  const max = chartMax(block, allValues);
  const radius = Math.min(width * 0.24, height * 0.31, 62);
  const cx = x + width * 0.5;
  const cy = y + height * 0.45;

  ctx.doc.save();
  ctx.doc.strokeColor("#d8e0ea").lineWidth(0.55);
  for (let level = 1; level <= 4; level++) {
    const points = Array.from({ length: axisCount }, (_, index) => radarPoint(cx, cy, radius, index, axisCount, level / 4));
    ctx.doc.moveTo(points[0]!.x, points[0]!.y);
    for (const point of points.slice(1)) ctx.doc.lineTo(point.x, point.y);
    ctx.doc.closePath().stroke();
  }
  for (let index = 0; index < axisCount; index++) {
    const edge = radarPoint(cx, cy, radius, index, axisCount, 1);
    ctx.doc.moveTo(cx, cy).lineTo(edge.x, edge.y).stroke();
  }
  ctx.doc.font(ctx.regularFontName).fontSize(6.7).fillColor("#64748b");
  for (let index = 0; index < axisCount; index++) {
    const point = radarPoint(cx, cy, radius + 12, index, axisCount, 1);
    const label = block.chart.labels[index] ?? String(index + 1);
    ctx.doc.text(label, point.x - 22, point.y - 4, { width: 44, align: "center", lineBreak: false });
  }
  for (let i = 0; i < series.length; i++) {
    const color = chartColor(block, i);
    const points = Array.from({ length: axisCount }, (_, index) => {
      const value = series[i]?.[index] ?? 0;
      return radarPoint(cx, cy, radius, index, axisCount, clamp(value / max, 0, 1));
    });
    drawRadarPolygon(ctx, points, color, color, i === 0 ? 0.24 : 0.18);
  }
  drawChartLegend(ctx, block, x, y + height - 18, width, Math.min(series.length, 4));
  ctx.doc.restore();
}

function chartBoxMetrics(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, availableWidth: number): {
  margin: BoxSpacing;
  padding: BoxSpacing;
  border: BorderStyle;
  outerWidth: number;
  outerHeight: number;
} {
  const margin = spacingPt(block.style, "margin", { top: 0, right: 0, bottom: 8, left: 0 });
  const padding = spacingPt(block.style, "padding", { top: 10, right: 12, bottom: 10, left: 12 });
  const border = borderPxToPt(parseBorderStyle(block.style, { width: 0.7 * 96 / 72, color: "#d8e0ea", style: "solid" }));
  const outerWidth = Math.min(availableWidth - margin.left - margin.right, cssLengthPt(block.style["width"], availableWidth) ?? availableWidth - margin.left - margin.right);
  const contentWidth = Math.max(40, outerWidth - padding.left - padding.right - border.width * 2);
  const chartHeight = cssLengthPt(block.style["height"]) ?? 145;
  const titleHeight = chartTitleHeight(ctx, block, contentWidth);
  const outerHeight = chartHeight + titleHeight + padding.top + padding.bottom + border.width * 2;
  return { margin, padding, border, outerWidth, outerHeight };
}

async function drawChartBlock(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>): Promise<void> {
  const { margin, padding, border, outerWidth, outerHeight } = chartBoxMetrics(ctx, block, ctx.tableWidth);
  const contentWidth = Math.max(40, outerWidth - padding.left - padding.right - border.width * 2);
  ensureSpace(ctx, margin.top + outerHeight + margin.bottom);
  ctx.y += margin.top;

  const align = block.style["text-align"] === "center" ? "center" : block.style["text-align"] === "right" ? "right" : "left";
  const x = align === "center"
    ? ctx.margin + margin.left + (ctx.tableWidth - margin.left - margin.right - outerWidth) / 2
    : align === "right"
      ? ctx.margin + ctx.tableWidth - margin.right - outerWidth
      : ctx.margin + margin.left;
  const y = ctx.y;
  const radius = borderRadiusPt(block.style, outerWidth, outerHeight);
  drawBoxShadow(ctx, block.style, x, y, outerWidth, outerHeight, radius);
  fillBox(ctx, x, y, outerWidth, outerHeight, parseCssColor(block.style["background-color"]) ?? "#ffffff", radius);
  await drawBackgroundImage(ctx, block.style, x, y, outerWidth, outerHeight, radius);
  strokeBox(ctx, x, y, outerWidth, outerHeight, border, radius);

  const contentX = x + border.width + padding.left;
  let cursor = drawChartHeader(ctx, block, contentX, y + border.width + padding.top, contentWidth);
  if (cursor === y + border.width + padding.top) cursor = y + border.width + padding.top;
  const plotY = cursor;
  const plotHeight = Math.max(50, y + outerHeight - padding.bottom - border.width - plotY);
  if (block.chart.chartType === "line" || block.chart.chartType === "area") drawLineChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "sparkline") drawSparklineChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "horizontal-bar") drawHorizontalBarChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "stacked-bar") drawStackedBarChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "pie") drawPieChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "donut") drawDonutChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "gauge") drawGaugeChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "radial") drawRadialChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "radial-stacked") drawRadialStackedChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "radar") drawRadarChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else drawBarChart(ctx, block, contentX, plotY, contentWidth, plotHeight);

  ctx.y += outerHeight + margin.bottom;
}

function gridTemplateColumns(style: StyleMap): string[] {
  const raw = (style["grid-template-columns"] ?? "").trim();
  if (!raw) return ["1fr"];
  const expanded = raw.replace(/repeat\(\s*(\d+)\s*,\s*([^)]+)\)/gi, (_match, count: string, value: string) =>
    Array.from({ length: Math.max(1, Number.parseInt(count, 10) || 1) }, () => value.trim()).join(" "),
  );
  return expanded.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

function gridGap(style: StyleMap, axis: "row" | "column"): number {
  const specific = axis === "row" ? style["row-gap"] : style["column-gap"];
  const gap = style["gap"];
  if (specific) return cssLengthPt(specific) ?? 0;
  if (!gap) return 0;
  const parts = gap.trim().split(/\s+/);
  const raw = axis === "row" ? parts[0] : parts[1] ?? parts[0];
  return cssLengthPt(raw) ?? 0;
}

function gridColumnWidths(style: StyleMap, availableWidth: number): number[] {
  const tracks = gridTemplateColumns(style);
  const columnGap = gridGap(style, "column");
  const gapTotal = columnGap * Math.max(0, tracks.length - 1);
  const widthForTracks = Math.max(1, availableWidth - gapTotal);
  const fixed = tracks.map((track) => track.endsWith("fr") ? undefined : cssLengthPt(track, widthForTracks));
  const fixedTotal = fixed.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const frTotal = tracks.reduce<number>((sum, track, index) => fixed[index] == null ? sum + (Number.parseFloat(track) || 1) : sum, 0);
  const remaining = Math.max(1, widthForTracks - fixedTotal);
  return tracks.map((track, index) => fixed[index] ?? remaining * ((Number.parseFloat(track) || 1) / Math.max(1, frTotal)));
}

async function estimateBlockHeight(ctx: StreamContext, block: ParsedBlock, width: number): Promise<number> {
  if (block.type === "heading" || block.type === "paragraph" || block.type === "list-item" || block.type === "blockquote" || block.type === "preformatted") {
    const size = blockFontSize(block);
    const font = block.type === "heading" || block.style["font-weight"] === "bold" || Number(block.style["font-weight"]) >= 600 ? ctx.boldFontName : ctx.regularFontName;
    const box = textBoxStyle(block);
    const indent = block.type === "list-item" ? 14 : 0;
    const boxWidth = Math.max(20, width - box.margin.left - box.margin.right);
    const contentWidth = Math.max(20, boxWidth - box.border.width * 2 - box.padding.left - box.padding.right - indent);
    const lineGap = lineGapForStyle(block.style, size, block.type === "preformatted" ? 0.1 : 0.22);
    const prefix = block.type === "list-item" ? block.ordered ? `${block.index}. ` : "- " : "";
    const displayText = prefix + block.text;
    const displayInlines = prefix ? [{ text: prefix, styles: { "font-weight": block.type === "list-item" && block.ordered ? "400" : "700" } }, ...block.inlines] : block.inlines;
    ctx.doc.font(font).fontSize(size);
    const textHeightValue = inlineTextHeight(ctx, displayText, displayInlines, font, size, contentWidth, lineGap);
    return box.margin.top + textHeightValue + box.padding.top + box.padding.bottom + box.border.width * 2 + box.margin.bottom;
  }
  if (block.type === "chart") {
    const metrics = chartBoxMetrics(ctx, block, width);
    return metrics.margin.top + metrics.outerHeight + metrics.margin.bottom;
  }
  if (block.type === "hr") return (blockMarginTop(block) || 6) + (blockMarginBottom(block) || 6) + 2;
  if (block.type === "image") {
    const cssHeight = cssLengthPt(block.style["height"]);
    return (cssHeight ?? 120) + blockMarginTop(block) + blockMarginBottom(block);
  }
  if (block.type === "table") {
    const previousTableWidth = ctx.tableWidth;
    const previousColumns = ctx.columns;
    const previousWidths = ctx.columnWidths;
    const previousStyle = ctx.currentTableStyle;
    ctx.tableWidth = width;
    ctx.columns = block.table.columnCount;
    ctx.currentTableStyle = tableStyle(block.style);
    ctx.columnWidths = computeTableColumnWidths(ctx, block.table, width, ctx.currentTableStyle);
    const height = rowsHeight(ctx, block.table.headRows, false) + rowsHeight(ctx, block.table.bodyRows, false) + blockMarginBottom(block);
    ctx.tableWidth = previousTableWidth;
    ctx.columns = previousColumns;
    ctx.columnWidths = previousWidths;
    ctx.currentTableStyle = previousStyle;
    return height;
  }
  if (block.type === "grid") {
    return estimateGridHeight(ctx, block, width);
  }
  return 0;
}

async function estimateGridHeight(ctx: StreamContext, block: Extract<ParsedBlock, { type: "grid" }>, width: number): Promise<number> {
  const margin = spacingPt(block.style, "margin", { top: 0, right: 0, bottom: 8, left: 0 });
  const padding = spacingPt(block.style, "padding", { top: 0, right: 0, bottom: 0, left: 0 });
  const border = borderPxToPt(parseBorderStyle(block.style, { width: 0, color: COLORS.border, style: "solid" }));
  const innerWidth = Math.max(1, width - margin.left - margin.right - padding.left - padding.right - border.width * 2);
  const columns = gridColumnWidths(block.style, innerWidth);
  const rowGap = gridGap(block.style, "row");
  let contentHeight = 0;
  for (let index = 0; index < block.blocks.length; index += columns.length) {
    const rowBlocks = block.blocks.slice(index, index + columns.length);
    const heights = await Promise.all(rowBlocks.map((child, childIndex) => estimateBlockHeight(ctx, child, columns[childIndex] ?? columns[0] ?? innerWidth)));
    if (index > 0) contentHeight += rowGap;
    contentHeight += Math.max(0, ...heights);
  }
  return margin.top + padding.top + padding.bottom + border.width * 2 + contentHeight + margin.bottom;
}

async function drawGridBlock(ctx: StreamContext, block: Extract<ParsedBlock, { type: "grid" }>): Promise<void> {
  const margin = spacingPt(block.style, "margin", { top: 0, right: 0, bottom: 8, left: 0 });
  const padding = spacingPt(block.style, "padding", { top: 0, right: 0, bottom: 0, left: 0 });
  const border = borderPxToPt(parseBorderStyle(block.style, { width: 0, color: COLORS.border, style: "solid" }));
  const outerWidth = Math.max(1, ctx.tableWidth - margin.left - margin.right);
  const innerWidth = Math.max(1, outerWidth - padding.left - padding.right - border.width * 2);
  const columns = gridColumnWidths(block.style, innerWidth);
  const columnGap = gridGap(block.style, "column");
  const rowGap = gridGap(block.style, "row");
  const totalHeight = await estimateGridHeight(ctx, block, ctx.tableWidth);
  ensureSpace(ctx, totalHeight);
  ctx.y += margin.top;

  const gridX = ctx.margin + margin.left;
  const gridY = ctx.y;
  const radius = borderRadiusPt(block.style, outerWidth, totalHeight - margin.top - margin.bottom);
  drawBoxShadow(ctx, block.style, gridX, gridY, outerWidth, totalHeight - margin.top - margin.bottom, radius);
  const bg = parseCssColor(block.style["background-color"]);
  if (bg) fillBox(ctx, gridX, gridY, outerWidth, totalHeight - margin.top - margin.bottom, bg, radius);
  strokeBox(ctx, gridX, gridY, outerWidth, totalHeight - margin.top - margin.bottom, border, radius);

  let cursorY = gridY + border.width + padding.top;
  for (let index = 0; index < block.blocks.length; index += columns.length) {
    const rowBlocks = block.blocks.slice(index, index + columns.length);
    const heights = await Promise.all(rowBlocks.map((child, childIndex) => estimateBlockHeight(ctx, child, columns[childIndex] ?? columns[0] ?? innerWidth)));
    const rowHeight = Math.max(0, ...heights);
    let cursorX = gridX + border.width + padding.left;
    for (let childIndex = 0; childIndex < rowBlocks.length; childIndex++) {
      const child = rowBlocks[childIndex]!;
      const cellWidth = columns[childIndex] ?? columns[0] ?? innerWidth;
      const previousMargin = ctx.margin;
      const previousWidth = ctx.tableWidth;
      const previousY = ctx.y;
      ctx.margin = cursorX;
      ctx.tableWidth = cellWidth;
      ctx.y = cursorY;
      await drawBlock(ctx, child);
      ctx.margin = previousMargin;
      ctx.tableWidth = previousWidth;
      ctx.y = previousY;
      cursorX += cellWidth + columnGap;
    }
    cursorY += rowHeight + rowGap;
  }
  ctx.y = gridY + totalHeight - margin.top;
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

function fontForStyle(ctx: StreamContext, style: StyleMap, fallbackFont: string): string {
  const family = normalizeFontFamily(style["font-family"]);
  const weight = style["font-weight"];
  const bold = weight === "bold" || Number(weight) >= 600;
  const italic = (style["font-style"] ?? "").toLowerCase() === "italic";
  if (family && ctx.fontFamilies.has(family)) {
    const pair = ctx.fontFamilies.get(family)!;
    if (bold && italic) return pair.boldItalic;
    if (italic) return pair.italic;
    if (bold) return pair.bold;
    return pair.regular;
  }
  if (bold && italic) return ctx.boldItalicFontName;
  if (italic) return ctx.italicFontName;
  if (bold) return ctx.boldFontName;
  return fallbackFont;
}

function cellBlockFontSize(block: ParsedCellBlock, fallbackSize: number): number {
  if (block.type === "heading") {
    const defaults: Record<number, number> = { 1: 18, 2: 16, 3: 14, 4: 12, 5: 10.5, 6: 10 };
    return cssLengthPt(block.style["font-size"]) ?? defaults[block.level] ?? fallbackSize;
  }
  return cssLengthPt(block.style["font-size"]) ?? fallbackSize;
}

function cellBlockMargin(block: ParsedCellBlock): BoxSpacing {
  const fallback = block.type === "heading"
    ? { top: 0, right: 0, bottom: 6, left: 0 }
    : block.type === "text"
      ? { top: 0, right: 0, bottom: 4, left: 0 }
      : block.type === "image"
        ? { top: 0, right: 0, bottom: 6, left: 0 }
        : { top: 0, right: 0, bottom: 0, left: 0 };
  return spacingPt(block.style, "margin", fallback);
}

function cellBlockPadding(block: ParsedCellBlock): BoxSpacing {
  return spacingPt(block.style, "padding", { top: 0, right: 0, bottom: 0, left: 0 });
}

function cellBlockBorder(block: ParsedCellBlock): BorderStyle {
  return borderPxToPt(parseBorderStyle(block.style, { width: 0, color: COLORS.border, style: "solid" }));
}

function isAbsoluteBlock(block: ParsedCellBlock): boolean {
  return (block.style["position"] ?? "").trim().toLowerCase() === "absolute";
}

function cellBlockAlign(style: StyleMap): "left" | "center" | "right" {
  const align = (style["text-align"] ?? "").trim().toLowerCase();
  return align === "center" || align === "right" ? align : "left";
}

function cellBlockVerticalAlign(style: StyleMap): CellVerticalAlign {
  const align = (style["vertical-align"] ?? style["align-items"] ?? "").trim().toLowerCase();
  if (align === "middle" || align === "center") return "middle";
  if (align === "bottom" || align === "end" || align === "flex-end") return "bottom";
  return "top";
}

function richBlockTextWidth(ctx: StreamContext, block: Extract<ParsedCellBlock, { type: "text" | "heading" }>, fallbackFont: string, fallbackSize: number): number {
  const size = cellBlockFontSize(block, fallbackSize);
  const font = fontForStyle(ctx, block.style, block.type === "heading" ? ctx.boldFontName : fallbackFont);
  const inlines = block.inlines.length > 0 ? block.inlines : [{ text: block.text, styles: block.style }];
  let width = 0;
  for (const segment of inlines) {
    ctx.doc.font(inlineFont(ctx, segment, font)).fontSize(inlineSize(segment, size));
    width += ctx.doc.widthOfString(applyTextTransform(segment.text, segment.styles));
  }
  return width;
}

function estimateRichImageHeight(ctx: StreamContext, block: Extract<ParsedCellBlock, { type: "image" }>, width: number): number {
  const margin = cellBlockMargin(block);
  const cssWidth = cssLengthPt(block.style["width"], width);
  const cssHeight = cssLengthPt(block.style["height"], ctx.contentBottom - ctx.contentTop);
  if (cssHeight != null) return margin.top + cssHeight + margin.bottom;
  if (cssWidth != null) return margin.top + Math.min(cssWidth * 0.58, ctx.contentBottom - ctx.contentTop) + margin.bottom;
  return margin.top + Math.min(90, width * 0.52) + margin.bottom;
}

function estimateRichBlockHeight(ctx: StreamContext, block: ParsedCellBlock, width: number, fallbackFont: string, fallbackSize: number): number {
  if (isAbsoluteBlock(block)) return 0;
  const margin = cellBlockMargin(block);
  const padding = cellBlockPadding(block);
  const border = cellBlockBorder(block);
  const availableWidth = Math.max(8, width - margin.left - margin.right);
  const explicitWidth = cssLengthPt(block.style["width"], availableWidth);
  const boxWidth = Math.max(8, explicitWidth ?? availableWidth);
  const explicitHeight = styleBoxHeight(block.style, ctx.contentBottom - ctx.contentTop);

  if (block.type === "image") {
    return explicitHeight != null
      ? margin.top + explicitHeight + margin.bottom
      : estimateRichImageHeight(ctx, block, availableWidth);
  }

  if (block.type === "box") {
    if (explicitHeight != null) return margin.top + explicitHeight + margin.bottom;
    const innerWidth = Math.max(8, boxWidth - padding.left - padding.right - border.width * 2);
    const childHeight = block.blocks.reduce((sum, child) => sum + estimateRichBlockHeight(ctx, child, innerWidth, fallbackFont, fallbackSize), 0);
    return margin.top + childHeight + padding.top + padding.bottom + border.width * 2 + margin.bottom;
  }

  const size = cellBlockFontSize(block, fallbackSize);
  const font = fontForStyle(ctx, block.style, block.type === "heading" ? ctx.boldFontName : fallbackFont);
  const contentWidth = Math.max(8, boxWidth - padding.left - padding.right - border.width * 2);
  const lineGap = lineGapForStyle(block.style, size, 0.18);
  const noWrap = isNoWrapStyle(block.style);
  const displayInlines = displayInlineSegments(ctx, block.text, block.inlines, font, size, contentWidth, block.style);
  const textHeightValue = inlineTextHeight(ctx, block.text, displayInlines, font, size, contentWidth, lineGap, noWrap);
  return margin.top + (explicitHeight ?? textHeightValue + padding.top + padding.bottom + border.width * 2) + margin.bottom;
}

function estimateRichCellHeight(ctx: StreamContext, cell: ParsedCell, width: number, fallbackFont: string, fallbackSize: number): number {
  if (!cell.richBlocks?.length) return 0;
  return cell.richBlocks.reduce((sum, block) => sum + estimateRichBlockHeight(ctx, block, width, fallbackFont, fallbackSize), 0);
}

function drawRichBlockBox(ctx: StreamContext, style: StyleMap, x: number, y: number, width: number, height: number, border: BorderStyle, padding: BoxSpacing): BoxRadius {
  const radius = boxRadiusPt(style, width, height);
  drawBoxShadow(ctx, style, x, y, width, height, maxBoxRadius(radius));
  const bg = parseCssColor(style["background-color"]);
  if (bg) fillBox(ctx, x, y, width, height, bg, radius);
  strokeBox(ctx, x, y, width, height, border, radius);
  return {
    topLeft: Math.max(0, radius.topLeft - Math.max(padding.left, padding.top)),
    topRight: Math.max(0, radius.topRight - Math.max(padding.right, padding.top)),
    bottomRight: Math.max(0, radius.bottomRight - Math.max(padding.right, padding.bottom)),
    bottomLeft: Math.max(0, radius.bottomLeft - Math.max(padding.left, padding.bottom)),
  };
}

function absoluteRichBlockRect(
  ctx: StreamContext,
  block: ParsedCellBlock,
  containerX: number,
  containerY: number,
  containerWidth: number,
  containerHeight: number,
  fallbackFont: string,
  fallbackSize: number,
): { x: number; y: number; width: number; height: number } {
  const margin = cellBlockMargin(block);
  const padding = cellBlockPadding(block);
  const border = cellBlockBorder(block);
  const left = cssLengthPt(block.style["left"], containerWidth);
  const right = cssLengthPt(block.style["right"], containerWidth);
  const top = cssLengthPt(block.style["top"], containerHeight);
  const bottom = cssLengthPt(block.style["bottom"], containerHeight);
  let width = cssLengthPt(block.style["width"], containerWidth - margin.left - margin.right);
  let height = styleBoxHeight(block.style, containerHeight);

  if (block.type === "text" || block.type === "heading") {
    width ??= richBlockTextWidth(ctx, block, fallbackFont, fallbackSize) + padding.left + padding.right + border.width * 2;
  } else {
    width ??= Math.max(12, containerWidth - margin.left - margin.right);
  }
  height ??= estimateRichBlockHeight(ctx, { ...block, style: { ...block.style, position: "static" } } as ParsedCellBlock, Math.max(12, width), fallbackFont, fallbackSize);
  height = Math.max(1, height - margin.top - margin.bottom);

  const x = left != null
    ? containerX + left + margin.left
    : right != null
      ? containerX + containerWidth - right - width - margin.right
      : containerX + margin.left;
  const y = top != null
    ? containerY + top + margin.top
    : bottom != null
      ? containerY + containerHeight - bottom - height - margin.bottom
      : containerY + margin.top;
  return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
}

async function drawRichBlock(
  ctx: StreamContext,
  block: ParsedCellBlock,
  x: number,
  y: number,
  width: number,
  containerHeight: number,
  fallbackFont: string,
  fallbackSize: number,
  fallbackColor: string,
): Promise<number> {
  const margin = cellBlockMargin(block);
  const padding = cellBlockPadding(block);
  const border = cellBlockBorder(block);
  const availableWidth = Math.max(8, width - margin.left - margin.right);
  const explicitWidth = cssLengthPt(block.style["width"], availableWidth);
  const boxWidth = Math.max(8, Math.min(availableWidth, explicitWidth ?? availableWidth));
  const drawX = cellBlockAlign(block.style) === "center"
    ? x + margin.left + (availableWidth - boxWidth) / 2
    : cellBlockAlign(block.style) === "right"
      ? x + width - margin.right - boxWidth
      : x + margin.left;
  const drawY = y + margin.top;
  const estimatedHeight = Math.max(1, estimateRichBlockHeight(ctx, block, width, fallbackFont, fallbackSize) - margin.top - margin.bottom);
  const explicitHeight = styleBoxHeight(block.style, containerHeight);
  const boxHeight = Math.max(1, explicitHeight ?? estimatedHeight);

  if (block.type === "image") {
    const asset = await getAsset(ctx, block.src);
    if (asset) drawAssetInBox(ctx, asset, drawX, drawY, boxWidth, boxHeight, block.style, 1, "cell rich image");
    return margin.top + boxHeight + margin.bottom;
  }

  const outerRadius = boxRadiusPt(block.style, boxWidth, boxHeight);
  const contentRadius = drawRichBlockBox(ctx, block.style, drawX, drawY, boxWidth, boxHeight, border, padding);
  await drawBackgroundImage(ctx, block.style, drawX, drawY, boxWidth, boxHeight, borderRadiusPt(block.style, boxWidth, boxHeight));

  if (block.type === "box") {
    const innerX = drawX + border.width + padding.left;
    const innerY = drawY + border.width + padding.top;
    const innerWidth = Math.max(8, boxWidth - border.width * 2 - padding.left - padding.right);
    const innerHeight = Math.max(1, boxHeight - border.width * 2 - padding.top - padding.bottom);
    ctx.doc.save();
    if (isOverflowHidden(block.style) || maxBoxRadius(outerRadius) > 0) clipBox(ctx, drawX, drawY, boxWidth, boxHeight, outerRadius);
    await drawRichBlocks(ctx, block.blocks.filter((child) => !isAbsoluteBlock(child)), innerX, innerY, innerWidth, innerHeight, fallbackFont, fallbackSize, fallbackColor);
    for (const child of block.blocks.filter(isAbsoluteBlock)) {
      const rect = absoluteRichBlockRect(ctx, child, drawX, drawY, boxWidth, boxHeight, fallbackFont, fallbackSize);
      await drawRichBlock(ctx, { ...child, style: { ...child.style, position: "static" } } as ParsedCellBlock, rect.x, rect.y, rect.width, rect.height, fallbackFont, fallbackSize, fallbackColor);
    }
    ctx.doc.restore();
    return margin.top + boxHeight + margin.bottom;
  }

  const size = cellBlockFontSize(block, fallbackSize);
  const font = fontForStyle(ctx, block.style, block.type === "heading" ? ctx.boldFontName : fallbackFont);
  const textColor = parseCssColor(block.style["color"]) ?? fallbackColor;
  const contentX = drawX + border.width + padding.left;
  const contentY = drawY + border.width + padding.top;
  const contentWidth = Math.max(8, boxWidth - border.width * 2 - padding.left - padding.right);
  const contentHeight = Math.max(1, boxHeight - border.width * 2 - padding.top - padding.bottom);
  const lineGap = lineGapForStyle(block.style, size, 0.18);
  const noWrap = isNoWrapStyle(block.style);
  const displayInlines = displayInlineSegments(ctx, block.text, block.inlines, font, size, contentWidth, block.style);
  const textHeightValue = inlineTextHeight(ctx, block.text, displayInlines, font, size, contentWidth, lineGap, noWrap);
  const textY = verticalContentY(contentY, contentHeight, textHeightValue, cellBlockVerticalAlign(block.style));
  ctx.doc.save();
  if (isOverflowHidden(block.style) || maxBoxRadius(contentRadius) > 0) clipBox(ctx, contentX, contentY, contentWidth, contentHeight, contentRadius);
  drawInlineText(ctx, block.text, displayInlines, contentX, textY, contentWidth, font, size, textColor, lineGap, cellBlockAlign(block.style), noWrap);
  ctx.doc.restore();
  return margin.top + boxHeight + margin.bottom;
}

async function drawRichBlocks(
  ctx: StreamContext,
  blocks: ParsedCellBlock[],
  x: number,
  y: number,
  width: number,
  height: number,
  fallbackFont: string,
  fallbackSize: number,
  fallbackColor: string,
): Promise<number> {
  let cursorY = y;
  for (const block of blocks) {
    cursorY += await drawRichBlock(ctx, block, x, cursorY, width, Math.max(1, height - (cursorY - y)), fallbackFont, fallbackSize, fallbackColor);
  }
  return cursorY - y;
}

function styleBoxHeight(styles: StyleMap, base: number): number | undefined {
  const height = cssLengthPt(styles["height"], base);
  const minHeight = cssLengthPt(styles["min-height"], base);
  const values = [height, minHeight].filter((value): value is number => value != null && Number.isFinite(value));
  return values.length ? Math.max(...values) : undefined;
}

function cellVerticalAlign(cell: ParsedCell, row: ParsedRow): CellVerticalAlign {
  const raw = (cell.styles["vertical-align"] ?? row.styles["vertical-align"] ?? "").trim().toLowerCase();
  if (raw === "middle" || raw === "center") return "middle";
  if (raw === "bottom") return "bottom";
  return "top";
}

function verticalContentY(y: number, contentHeight: number, itemHeight: number, align: CellVerticalAlign): number {
  if (align === "bottom") return y + Math.max(0, contentHeight - itemHeight);
  if (align === "middle") return y + Math.max(0, (contentHeight - itemHeight) / 2);
  return y;
}

function estimatedCellImageHeight(ctx: StreamContext, cell: ParsedCell, contentWidth: number): number {
  if (!cell.imageSrc) return 0;
  const styles = cell.imageStyles ?? {};
  const explicitHeight = cssLengthPt(styles["height"], ctx.contentBottom - ctx.contentTop);
  if (explicitHeight != null) return explicitHeight;
  const explicitWidth = cssLengthPt(styles["width"], contentWidth);
  if (explicitWidth != null) return Math.min(explicitWidth, (ctx.contentBottom - ctx.contentTop) * 0.5);
  return Math.min(36, contentWidth);
}

function textHeight(ctx: StreamContext, text: string, font: string, size: number, width: number): number {
  ctx.doc.font(font).fontSize(size);
  return ctx.doc.heightOfString(text || " ", { width, lineGap: size * 0.18 });
}

function estimateRowHeight(ctx: StreamContext, row: ParsedRow, capToPage = true): number {
  const rowHeight = styleBoxHeight(row.styles, ctx.contentBottom - ctx.contentTop);
  if (row.kind === "section") return Math.max(rowHeight ?? 0, 24 * ctx.paddingScale + 10);
  let height = row.kind === "header"
    ? Math.max(32, calculateHeaderCellHeight(ctx.columns) * 0.62)
    : row.kind === "price"
      ? 24 + 8 * ctx.paddingScale
      : 22 + 8 * ctx.paddingScale;
  if (rowHeight != null) height = Math.max(height, rowHeight);

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
    const contentWidth = Math.max(12, width - padding.left - padding.right);
    const cellTextStyle = { ...row.styles, ...cell.styles };
    const noWrap = isNoWrapStyle(cellTextStyle);
    const richContentHeight = cell.richBlocks?.length
      ? estimateRichCellHeight(ctx, cell, contentWidth, font, size)
      : 0;
    const textContentHeight = !cell.richBlocks?.length && (cell.text || cell.inlines.length > 0)
      ? inlineTextHeight(ctx, cell.text, cell.inlines, font, size, contentWidth, lineGap, noWrap)
      : 0;
    const imageContentHeight = !cell.richBlocks?.length ? estimatedCellImageHeight(ctx, cell, contentWidth) : 0;
    const cssCellHeight = styleBoxHeight(cell.styles, ctx.contentBottom - ctx.contentTop);
    height = Math.max(height, richContentHeight + padding.top + padding.bottom, textContentHeight + padding.top + padding.bottom, imageContentHeight + padding.top + padding.bottom, cssCellHeight ?? 0);
    col += span;
  }

  return capToPage ? Math.min(height, ctx.contentBottom - ctx.contentTop - 8) : height;
}

async function drawRow(ctx: StreamContext, row: ParsedRow, index: number): Promise<void> {
  const height = estimateRowHeight(ctx, row);
  const y = ctx.y;

  if (row.kind === "section") {
    const sectionCell = row.cells.find((cell) => cell.text) ?? row.cells[0];
    const text = sectionCell?.text ?? "";
    const sectionPadding = sectionCell ? cellPadding(ctx, sectionCell) : { top: ctx.cellPaddingY, right: ctx.cellPaddingX, bottom: ctx.cellPaddingY, left: ctx.cellPaddingX };
    const sectionStyle = { ...row.styles, ...(sectionCell?.styles ?? {}) };
    const fill = parseCssColor(sectionStyle["background-color"]) ?? COLORS.sectionBg;
    const textColor = parseCssColor(sectionStyle["color"]) ?? COLORS.sectionText;
    const radius = sectionCell ? borderRadiusPt(sectionCell.styles, ctx.tableWidth, height) : 0;
    if (fill) fillBox(ctx, ctx.margin, y, ctx.tableWidth, height, fill, radius);
    const sectionAlign = sectionCell ? cellVerticalAlign(sectionCell, row) : "middle";
    const sectionWidth = Math.max(12, ctx.tableWidth - sectionPadding.left - sectionPadding.right);
    const sectionSize = sizeForCell(ctx, sectionCell ?? row.cells[0]!, row);
    const sectionLineGap = lineGapForStyle(sectionStyle, sectionSize, 0.18);
    const sectionInlines = sectionCell?.inlines ?? [{ text, styles: sectionStyle }];
    const sectionTextHeight = inlineTextHeight(ctx, text, sectionInlines, ctx.boldFontName, sectionSize, sectionWidth, sectionLineGap);
    const textAlign = sectionStyle["text-align"] === "center" || sectionStyle["text-align"] === "right"
      ? sectionStyle["text-align"] as "center" | "right"
      : "left";
    drawInlineText(
      ctx,
      text,
      sectionInlines,
      ctx.margin + sectionPadding.left,
      verticalContentY(y + sectionPadding.top, Math.max(1, height - sectionPadding.top - sectionPadding.bottom), sectionTextHeight, sectionAlign),
      sectionWidth,
      ctx.boldFontName,
      sectionSize,
      textColor,
      sectionLineGap,
      textAlign,
    );
    ctx.y = y + height;
    return;
  }

  let x = ctx.margin;
  let col = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    const width = ctx.columnWidths.slice(col, col + span).reduce((sum, value) => sum + value, 0);
    const padding = cellPadding(ctx, cell);
    const border = cellBorders(ctx, cell);
    const radius = borderRadiusPt(cell.styles, width, height);
    const fill = cell.isDiff
      ? (parseCssColor(cell.styles["background-color"]) ?? COLORS.diffBg)
      : row.kind === "header" || row.kind === "price"
        ? (parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? COLORS.headerBg)
        : cell.isParam
          ? (parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? COLORS.paramBg)
          : row.kind === "body" && index % 2 === 1
            ? (parseCssColor(row.styles["background-color"]) ?? COLORS.evenBg)
            : parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? null;

    if (!cell.isSpanPlaceholder) drawBoxShadow(ctx, cell.styles, x, y, width, height, radius);
    if (fill) fillBox(ctx, x, y, width, height, fill, radius);
    if (!cell.isSpanPlaceholder) await drawBackgroundImage(ctx, cell.styles, x, y, width, height, radius);
    strokeCellBorder(ctx, cell, x, y, width, height, border);

    if (cell.isSpanPlaceholder) {
      x += width;
      col += span;
      continue;
    }

    const font = fontForCell(ctx, cell, row);
    const size = sizeForCell(ctx, cell, row);
    const align = cell.styles["text-align"] === "center" || cell.styles["text-align"] === "right"
      ? cell.styles["text-align"] as "center" | "right"
      : row.styles["text-align"] === "center" || row.styles["text-align"] === "right"
        ? row.styles["text-align"] as "center" | "right"
        : "left";
    const verticalAlign = cellVerticalAlign(cell, row);
    const contentX = x + padding.left;
    const contentY = y + padding.top;
    const contentWidth = Math.max(12, width - padding.left - padding.right);
    const contentHeight = Math.max(8, height - padding.top - padding.bottom);
    const textColor = parseCssColor(cell.styles["color"]) ?? parseCssColor(row.styles["color"]) ?? COLORS.text;

    if (cell.richBlocks?.length) {
      const richHeight = estimateRichCellHeight(ctx, cell, contentWidth, font, size);
      const richY = verticalContentY(contentY, contentHeight, richHeight, verticalAlign);
      ctx.doc.save();
      const contentRadius = isOverflowHidden(cell.styles) || radius > 0 ? Math.max(0, radius - Math.max(padding.left, padding.top)) : 0;
      clipBox(ctx, contentX, contentY, contentWidth, contentHeight, contentRadius);
      await drawRichBlocks(ctx, cell.richBlocks, contentX, richY, contentWidth, contentHeight, font, size, textColor);
      ctx.doc.restore();
      x += width;
      col += span;
      continue;
    }

    if (cell.imageSrc) {
      const asset = await getAsset(ctx, cell.imageSrc);
      if (asset) {
        const imageStyles: StyleMap = { ...(cell.imageStyles ?? {}) };
        if (!imageStyles["object-position"]) {
          const objectX = align === "right" ? "right" : align === "center" ? "center" : "left";
          const objectY = verticalAlign === "bottom" ? "bottom" : verticalAlign === "middle" ? "center" : "top";
          imageStyles["object-position"] = `${objectX} ${objectY}`;
        }
        drawAssetInBox(ctx, asset, contentX, contentY, contentWidth, contentHeight, imageStyles, 1, "cell image");
      }
    }

    const cellTextStyle = { ...row.styles, ...cell.styles };
    const noWrap = isNoWrapStyle(cellTextStyle);
    const displayInlines = displayInlineSegments(ctx, cell.text, cell.inlines, font, size, contentWidth, cellTextStyle);
    const lineGap = lineGapForStyle(cellTextStyle, size, 0.18);
    const textBlockHeight = inlineTextHeight(ctx, cell.text, displayInlines, font, size, contentWidth, lineGap, noWrap);
    const textY = verticalContentY(contentY, contentHeight, textBlockHeight, verticalAlign);
    ctx.doc.save();
    const contentRadius = isOverflowHidden(cell.styles) || radius > 0 ? Math.max(0, radius - Math.max(padding.left, padding.top)) : 0;
    clipBox(ctx, contentX, contentY, contentWidth, contentHeight, contentRadius);
    drawInlineText(ctx, cell.text, displayInlines, contentX, textY, contentWidth, font, size, textColor, lineGap, align, noWrap);
    ctx.doc.restore();

    x += width;
    col += span;
  }

  ctx.y = y + height;
}

function rowHasBreakInsideAvoid(row: ParsedRow): boolean {
  const value = (row.styles["break-inside"] ?? row.styles["page-break-inside"] ?? "").trim().toLowerCase();
  return value === "avoid" || value === "avoid-page";
}

function groupRowsByRowspan(ctx: StreamContext, rows: ParsedRow[]): RowRenderGroup[] {
  const groups: RowRenderGroup[] = [];
  for (let i = 0; i < rows.length;) {
    let end = rows[i]?.kind === "section" && i + 1 < rows.length ? i + 1 : i;
    let hasRowspan = false;

    for (let scan = i; scan <= end && scan < rows.length; scan++) {
      const row = rows[scan]!;
      for (const cell of row.cells) {
        if (!cell.isSpanPlaceholder && cell.rowspan > 1) {
          hasRowspan = true;
          end = Math.max(end, scan + cell.rowspan - 1);
        }
      }
    }

    const groupRows = rows.slice(i, Math.min(rows.length, end + 1));
    const height = groupRows.reduce((sum, row) => sum + estimateRowHeight(ctx, row, false), 0);
    groups.push({ rows: groupRows, startIndex: i, height, hasRowspan });
    i = end + 1;
  }
  return groups;
}

function rowsHeight(ctx: StreamContext, rows: ParsedRow[], capToPage = true): number {
  return rows.reduce((sum, row) => sum + estimateRowHeight(ctx, row, capToPage), 0);
}

async function drawRepeatedHeaders(ctx: StreamContext, headers: ParsedRow[], repeat: boolean): Promise<void> {
  if (!repeat) return;
  for (const header of headers) await drawRow(ctx, header, -1);
}

function freshPageBodyHeight(ctx: StreamContext, headers: ParsedRow[], repeat: boolean): number {
  return Math.max(0, ctx.contentBottom - ctx.contentTop - (repeat ? rowsHeight(ctx, headers) : 0));
}

async function drawRowSequentially(ctx: StreamContext, row: ParsedRow, index: number, headers: ParsedRow[], repeat: boolean): Promise<void> {
  const rawHeight = estimateRowHeight(ctx, row, false);
  const pageHeight = Math.max(1, ctx.contentBottom - ctx.contentTop);
  if (rawHeight > pageHeight) {
    ctx.warnings.add("table_row_too_tall", `Table row ${index + 1} is taller than a page and may be clipped. Reduce content, font size, or padding.`);
  }
  const height = estimateRowHeight(ctx, row);
  if (ctx.y + height > ctx.contentBottom) {
    addPage(ctx);
    await drawRepeatedHeaders(ctx, headers, repeat);
  }
  await drawRow(ctx, row, index);
}

async function drawRowGroups(ctx: StreamContext, rows: ParsedRow[], headers: ParsedRow[], repeat: boolean): Promise<void> {
  const groups = groupRowsByRowspan(ctx, rows);
  const keepRowspans = ctx.options.table?.rowspanPagination !== "split";

  for (const group of groups) {
    const avoidGroupBreak = keepRowspans && group.hasRowspan || group.rows.some(rowHasBreakInsideAvoid);
    const freshBody = freshPageBodyHeight(ctx, headers, repeat);

    if (avoidGroupBreak && group.height <= freshBody && ctx.y + group.height > ctx.contentBottom) {
      addPage(ctx);
      await drawRepeatedHeaders(ctx, headers, repeat);
    } else if (avoidGroupBreak && group.height > freshBody) {
      ctx.warnings.add("table_rowspan_group_too_tall", `Rows ${group.startIndex + 1}-${group.startIndex + group.rows.length} are connected by rowspan/break-inside and do not fit on a fresh page; rendering sequentially.`);
    }

    for (let offset = 0; offset < group.rows.length; offset++) {
      await drawRowSequentially(ctx, group.rows[offset]!, group.startIndex + offset, headers, repeat);
    }
  }
}

function shouldRepeatTableHeaders(ctx: StreamContext, table: ParsedTable): boolean {
  if (ctx.options.tableHeaderRepeat === "auto") return table.headRows.length > 0;
  if (typeof ctx.options.tableHeaderRepeat === "boolean") return ctx.options.tableHeaderRepeat;
  if (ctx.options.repeatHeaders != null) return ctx.options.repeatHeaders;
  return table.repeatHeader ?? false;
}

function normalizedHorizontalPageColumns(ctx: StreamContext): number {
  const configured = ctx.options.table?.horizontalPageColumns;
  if (configured != null && Number.isFinite(configured)) return Math.max(1, Math.floor(configured));
  return ctx.orientation === "landscape" ? 8 : 6;
}

function normalizedRepeatColumns(ctx: StreamContext, table: ParsedTable): number {
  const configured = ctx.options.table?.repeatColumns ?? 0;
  if (!Number.isFinite(configured) || table.columnCount <= 1) return 0;
  return clamp(Math.floor(configured), 0, table.columnCount - 1);
}

function protectedColspanRanges(table: ParsedTable): ColumnRange[] {
  const ranges: ColumnRange[] = [];
  for (const row of table.bodyRows) {
    if (row.kind === "section") continue;
    for (const item of logicalCellsForRow(row)) {
      const span = item.end - item.start;
      if (span <= 1 || span >= table.columnCount || item.cell.isSpanPlaceholder) continue;
      ranges.push({ start: item.start, end: item.end });
    }
  }
  return ranges;
}

function adjustedSliceEnd(start: number, initialEnd: number, table: ParsedTable, protectedRanges: ColumnRange[]): number {
  let end = initialEnd;
  let changed = true;
  while (changed) {
    changed = false;
    for (const range of protectedRanges) {
      if (range.start < end && range.end > end && range.end > start) {
        end = Math.min(table.columnCount, range.end);
        changed = true;
      }
    }
  }
  return Math.max(start + 1, Math.min(table.columnCount, end));
}

function horizontalColumnSlices(ctx: StreamContext, table: ParsedTable): TableColumnSlice[] {
  const mode = ctx.options.table?.horizontalPagination ?? "none";
  if (mode === "none" || table.columnCount <= 1) {
    return [{ columns: Array.from({ length: table.columnCount }, (_, i) => i), start: 0, end: table.columnCount, index: 0, total: 1 }];
  }

  const repeatColumns = normalizedRepeatColumns(ctx, table);
  const pageColumns = normalizedHorizontalPageColumns(ctx);
  const variableColumns = Math.max(1, table.columnCount - repeatColumns);
  if (variableColumns <= pageColumns) {
    return [{ columns: Array.from({ length: table.columnCount }, (_, i) => i), start: 0, end: table.columnCount, index: 0, total: 1 }];
  }

  const repeated = Array.from({ length: repeatColumns }, (_, i) => i);
  const protectedRanges = protectedColspanRanges(table);
  const slices: TableColumnSlice[] = [];
  for (let start = repeatColumns; start < table.columnCount;) {
    const end = adjustedSliceEnd(start, Math.min(table.columnCount, start + pageColumns), table, protectedRanges);
    slices.push({
      columns: [...repeated, ...Array.from({ length: end - start }, (_, i) => start + i)],
      start,
      end,
      index: slices.length,
      total: 0,
    });
    start = end;
  }
  return slices.map((slice) => ({ ...slice, total: slices.length }));
}

function logicalCellsForRow(row: ParsedRow): LogicalCell[] {
  const cells: LogicalCell[] = [];
  let col = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    cells.push({ cell, start: col, end: col + span });
    col += span;
  }
  return cells;
}

function logicalCellAt(cells: LogicalCell[], column: number): LogicalCell | undefined {
  return cells.find((item) => column >= item.start && column < item.end);
}

function emptySliceCell(isParam: boolean, colspan: number): ParsedCell {
  return {
    text: "",
    inlines: [],
    className: "",
    style: "",
    styles: {},
    colspan,
    rowspan: 1,
    isHeader: false,
    isParam,
    isPrice: false,
    isDiff: false,
    isSection: false,
  };
}

function cloneCellForSlice(cell: ParsedCell, colspan: number): ParsedCell {
  return {
    ...cell,
    colspan,
    rowspan: cell.rowspan,
    inlines: cell.inlines.map((segment) => ({ ...segment, styles: { ...segment.styles } })),
    styles: { ...cell.styles },
  };
}

function sliceRowByColumns(row: ParsedRow, columns: number[]): { row: ParsedRow; splitBodyColspan: boolean } {
  const logical = logicalCellsForRow(row);
  const cells: ParsedCell[] = [];
  let splitBodyColspan = false;
  let current: LogicalCell | undefined;
  let currentSpan = 0;
  let currentIsSynthetic = false;

  const flush = () => {
    if (currentSpan <= 0) return;
    if (!current) {
      cells.push(emptySliceCell(cells.length === 0, currentSpan));
    } else {
      if (
        currentSpan < Math.max(1, current.cell.colspan)
        && !current.cell.isSpanPlaceholder
        && !current.cell.isHeader
        && !current.cell.isSection
        && row.kind !== "section"
      ) {
        splitBodyColspan = true;
      }
      cells.push(cloneCellForSlice(current.cell, currentSpan));
    }
    current = undefined;
    currentSpan = 0;
    currentIsSynthetic = false;
  };

  for (const column of columns) {
    const hit = logicalCellAt(logical, column);
    const isSynthetic = !hit;
    if (currentSpan > 0 && hit?.cell === current?.cell && isSynthetic === currentIsSynthetic) {
      currentSpan += 1;
      continue;
    }
    flush();
    current = hit;
    currentSpan = 1;
    currentIsSynthetic = isSynthetic;
  }
  flush();

  return { row: { ...row, cells }, splitBodyColspan };
}

function sliceTableByColumns(table: ParsedTable, columns: number[]): { table: ParsedTable; splitBodyColspan: boolean } {
  let splitBodyColspan = false;
  const headRows = table.headRows.map((row) => sliceRowByColumns(row, columns).row);
  const bodyRows = table.bodyRows.map((row) => {
    const sliced = sliceRowByColumns(row, columns);
    if (sliced.splitBodyColspan) splitBodyColspan = true;
    return sliced.row;
  });
  const slicedTable: ParsedTable = { ...table, headRows, bodyRows, columnCount: columns.length };
  if ((table.columnStyles?.length ?? 0) > 0) slicedTable.columnStyles = columns.map((column) => table.columnStyles?.[column] ?? {});
  return { table: slicedTable, splitBodyColspan };
}

async function drawSingleTableBlock(ctx: StreamContext, table: ParsedTable, style: StyleMap, addTrailingGap = true): Promise<void> {
  const previousWidths = ctx.columnWidths;
  const previousColumns = ctx.columns;
  const previousTableWidth = ctx.tableWidth;
  const previousTableStyle = ctx.currentTableStyle;
  const width = cssLengthPt(style["width"], previousTableWidth) ?? previousTableWidth;
  ctx.columns = table.columnCount;
  ctx.tableWidth = clamp(width, Math.min(previousTableWidth, 120), previousTableWidth);
  ctx.currentTableStyle = tableStyle(style);
  ctx.columnWidths = computeTableColumnWidths(ctx, table, ctx.tableWidth, ctx.currentTableStyle);
  const repeat = shouldRepeatTableHeaders(ctx, table);
  const groups = groupRowsByRowspan(ctx, table.bodyRows);
  const firstGroup = groups[0];
  const headerHeight = rowsHeight(ctx, table.headRows);
  if (firstGroup && firstGroup.height <= freshPageBodyHeight(ctx, table.headRows, repeat) && ctx.y + headerHeight + firstGroup.height > ctx.contentBottom) {
    addPage(ctx);
  }
  for (const row of table.headRows) {
    const height = estimateRowHeight(ctx, row);
    if (ctx.y + height > ctx.contentBottom) addPage(ctx);
    await drawRow(ctx, row, -1);
  }
  await drawRowGroups(ctx, table.bodyRows, table.headRows, repeat);
  ctx.columns = previousColumns;
  ctx.columnWidths = previousWidths;
  ctx.tableWidth = previousTableWidth;
  ctx.currentTableStyle = previousTableStyle;
  if (addTrailingGap) ctx.y += 8;
}

async function drawTableBlock(ctx: StreamContext, block: Extract<ParsedBlock, { type: "table" }>): Promise<void> {
  const slices = horizontalColumnSlices(ctx, block.table);
  let splitBodyColspan = false;

  for (const slice of slices) {
    if (slice.index > 0) addPage(ctx);
    const sliced = sliceTableByColumns(block.table, slice.columns);
    if (sliced.splitBodyColspan) splitBodyColspan = true;
    await drawSingleTableBlock(ctx, sliced.table, block.style, slice.index === slices.length - 1);
  }

  if (splitBodyColspan) {
    ctx.warnings.add("table_colspan_horizontal_split", "A body cell with colspan crossed a horizontal table slice boundary; its visible portion was repeated/clipped per slice.");
  }
}

async function drawBlock(ctx: StreamContext, block: ParsedBlock): Promise<void> {
  if (block.type === "heading" || block.type === "paragraph" || block.type === "list-item" || block.type === "blockquote" || block.type === "preformatted") {
    await drawTextBlock(ctx, block);
  } else if (block.type === "image") {
    await drawImageBlock(ctx, block);
  } else if (block.type === "chart") {
    await drawChartBlock(ctx, block);
  } else if (block.type === "grid") {
    await drawGridBlock(ctx, block);
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
  const pageOptions = effectivePageOptions(options, parsed.page);
  const orientation = pageOptions.orientation !== "auto"
    ? pageOptions.orientation
    : determineOrientation(columns);
  const margin = mm(pageOptions.marginMm);
  const doc = new PDFDocument({
    size: pageOptions.size,
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
  const fonts = await registerFonts(doc, parsed, options, warnings);
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
    pageSize: pageOptions.size,
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
