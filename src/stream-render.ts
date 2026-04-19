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
}

interface InlineLayoutItem {
  segment: ParsedInlineSegment;
  text: string;
  font: string;
  size: number;
  color: string;
  width: number;
  height: number;
  textWidth: number;
  padding: BoxSpacing;
  border: BorderStyle;
  radius: number;
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

function borderRadiusPt(styles: StyleMap, width: number, height: number): number {
  const raw = styles["border-radius"]?.trim().split(/\s+/)[0];
  const radius = cssLengthPt(raw, Math.min(width, height)) ?? 0;
  return clamp(radius, 0, Math.min(width, height) / 2);
}

function fillBox(ctx: StreamContext, x: number, y: number, width: number, height: number, color: string, radius = 0): void {
  if (radius > 0) ctx.doc.roundedRect(x, y, width, height, radius).fill(color);
  else ctx.doc.rect(x, y, width, height).fill(color);
}

function strokeBox(ctx: StreamContext, x: number, y: number, width: number, height: number, border: BorderStyle, radius = 0): void {
  if (border.width <= 0 || border.style === "none") return;
  ctx.doc.save();
  ctx.doc.strokeColor(border.color ?? COLORS.border).lineWidth(border.width);
  if (border.style === "dashed") ctx.doc.dash(Math.max(2, border.width * 3), { space: Math.max(2, border.width * 2) });
  if (border.style === "dotted") ctx.doc.dash(Math.max(0.7, border.width), { space: Math.max(1.4, border.width * 2) });
  if (radius > 0) ctx.doc.roundedRect(x, y, width, height, radius).stroke();
  else ctx.doc.rect(x, y, width, height).stroke();
  ctx.doc.undash();
  ctx.doc.restore();
}

function clipBox(ctx: StreamContext, x: number, y: number, width: number, height: number, radius = 0): void {
  if (radius > 0) ctx.doc.roundedRect(x, y, Math.max(1, width), Math.max(1, height), radius).clip();
  else ctx.doc.rect(x, y, Math.max(1, width), Math.max(1, height)).clip();
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
  const rgba = /rgba?\(([^)]+)\)/i.exec(value);
  if (!rgba?.[1]) return 1;
  const parts = rgba[1].split(",").map((part) => part.trim());
  const alpha = Number.parseFloat(parts[3] ?? "1");
  return Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
}

function parseBoxShadow(styles: StyleMap): BoxShadow | undefined {
  const raw = styles["box-shadow"]?.trim();
  if (!raw || raw === "none" || raw.includes("inset")) return undefined;
  const rgbaMatch = /rgba?\([^)]+\)/i.exec(raw);
  const hexMatch = /#[0-9a-f]{3,8}/i.exec(raw);
  const namedMatch = raw.split(/\s+/).find((token) => parseCssColor(token) && !/[0-9]/.test(token));
  const colorRaw = rgbaMatch?.[0] ?? hexMatch?.[0] ?? namedMatch;
  const color = parseCssColor(colorRaw) ?? "#000000";
  const opacity = colorOpacity(colorRaw) * 0.25;
  const lengths = raw
    .replace(colorRaw ?? "", "")
    .trim()
    .split(/\s+/)
    .map((token) => cssLengthPt(token))
    .filter((value): value is number => value != null);
  if (lengths.length < 2) return undefined;
  return {
    offsetX: lengths[0] ?? 0,
    offsetY: lengths[1] ?? 0,
    blur: lengths[2] ?? 0,
    spread: lengths[3] ?? 0,
    color,
    opacity,
  };
}

function drawBoxShadow(ctx: StreamContext, styles: StyleMap, x: number, y: number, width: number, height: number, radius = 0): void {
  const shadow = parseBoxShadow(styles);
  if (!shadow) return;
  const spread = shadow.spread + shadow.blur * 0.18;
  ctx.doc.save();
  ctx.doc.opacity(clamp(shadow.opacity, 0.02, 0.45));
  const sx = x + shadow.offsetX - spread;
  const sy = y + shadow.offsetY - spread;
  const sw = width + spread * 2;
  const sh = height + spread * 2;
  if (radius > 0) ctx.doc.roundedRect(sx, sy, sw, sh, radius + spread).fill(shadow.color);
  else ctx.doc.rect(sx, sy, sw, sh).fill(shadow.color);
  ctx.doc.restore();
  ctx.doc.opacity(1);
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

function needsManualInlineLayout(inlines: ParsedInlineSegment[]): boolean {
  return inlines.some((segment) => hasInlineBoxStyle(segment));
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
  ctx.doc.font(font).fontSize(size);
  const textWidth = ctx.doc.widthOfString(textValue);
  const textHeight = ctx.doc.heightOfString(textValue || " ", { width: Math.max(1, textWidth + 2), lineBreak: false });
  const width = textWidth + padding.left + padding.right + border.width * 2;
  const height = Math.max(size * 1.15, textHeight) + padding.top + padding.bottom + border.width * 2;
  const item: InlineLayoutItem = {
    segment,
    text: textValue,
    font,
    size,
    color: inlineColor(segment, fallbackColor),
    width,
    height,
    textWidth,
    padding,
    border,
    radius: boxed ? borderRadiusPt(segment.styles, width, height) : 0,
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
  return {
    ...item,
    text,
    width,
    height,
    textWidth,
    radius: item.boxed ? borderRadiusPt(item.segment.styles, width, height) : 0,
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
    if (current.length > 0) lines.push({ items: current, width: Math.max(0, currentWidth), height: Math.max(1, currentHeight) });
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
          currentHeight = Math.max(currentHeight, next.height);
        }
        if (i < parts.length - 1) flush();
      }
      continue;
    }
    if (!noWrap && !item.whitespace && current.length > 0 && currentWidth + item.width > width) flush();
    if (!noWrap && item.whitespace && current.length === 0) continue;
    current.push(item);
    currentWidth += item.width;
    currentHeight = Math.max(currentHeight, item.height);
  }
  flush();
  return lines.length > 0 ? lines : [{ items: [], width: 0, height: fallbackLineHeight(items) }];
}

function fallbackLineHeight(items: InlineLayoutItem[]): number {
  return Math.max(1, ...items.map((item) => item.height));
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
    for (const item of line.items) {
      const itemY = cursorY + (line.height - item.height) / 2;
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
    const textContentHeight = cell.text || cell.inlines.length > 0
      ? inlineTextHeight(ctx, cell.text, cell.inlines, font, size, contentWidth, lineGap, noWrap)
      : 0;
    const imageContentHeight = estimatedCellImageHeight(ctx, cell, contentWidth);
    const cssCellHeight = styleBoxHeight(cell.styles, ctx.contentBottom - ctx.contentTop);
    height = Math.max(height, textContentHeight + padding.top + padding.bottom, imageContentHeight + padding.top + padding.bottom, cssCellHeight ?? 0);
    col += span;
  }

  return capToPage ? Math.min(height, ctx.contentBottom - ctx.contentTop - 8) : height;
}

async function drawRow(ctx: StreamContext, row: ParsedRow, index: number): Promise<void> {
  const height = estimateRowHeight(ctx, row);
  const y = ctx.y;

  if (row.kind === "section") {
    const text = row.cells.find((cell) => cell.text)?.text ?? "";
    ctx.doc.rect(ctx.margin, y, ctx.tableWidth, height).fill(COLORS.sectionBg);
    const sectionCell = row.cells.find((cell) => cell.text) ?? row.cells[0];
    const sectionAlign = sectionCell ? cellVerticalAlign(sectionCell, row) : "middle";
    const sectionWidth = Math.max(12, ctx.tableWidth - ctx.cellPaddingX * 2);
    const sectionLineGap = lineGapForStyle(row.styles, ctx.sectionFontSize, 0.18);
    const sectionTextHeight = inlineTextHeight(ctx, text, sectionCell?.inlines ?? [{ text, styles: {} }], ctx.boldFontName, ctx.sectionFontSize, sectionWidth, sectionLineGap);
    drawInlineText(
      ctx,
      text,
      sectionCell?.inlines ?? [{ text, styles: {} }],
      ctx.margin + ctx.cellPaddingX,
      verticalContentY(y + ctx.cellPaddingY, Math.max(1, height - ctx.cellPaddingY * 2), sectionTextHeight, sectionAlign),
      sectionWidth,
      ctx.boldFontName,
      ctx.sectionFontSize,
      COLORS.sectionText,
      sectionLineGap,
      "center",
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

    const textColor = parseCssColor(cell.styles["color"]) ?? parseCssColor(row.styles["color"]) ?? COLORS.text;
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
