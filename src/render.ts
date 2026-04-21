import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFImage,
  PDFFont,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from "pdf-lib";
import { discoverFontPaths, embedImage, loadFontBytes, resolveFontPaths } from "./assets";
import { parsePrintableHtml } from "./html";
import { prepareHtmlForRender } from "./resources";
import { protectPdfWithQpdf } from "./protect";
import type {
  PageOrientation,
  ParsedCell,
  ParsedDocument,
  ParsedRow,
  RenderHtmlToPdfOptions,
  RenderHtmlToPdfResult,
} from "./types";
import {
  a4Size,
  calculateFontScale,
  calculateHeaderCellHeight,
  calculatePaddingScale,
  clamp,
  determineOrientation,
  letterSize,
  mm,
} from "./units";
import { WarningSink } from "./warnings";
import { wrapText } from "./text";
import { Html2PdfError } from "./errors";

type Rgb = ReturnType<typeof rgb>;

interface EmbeddedFonts {
  regular: PDFFont;
  bold: PDFFont;
}

interface RenderContext {
  pdfDoc: PDFDocument;
  fonts: EmbeddedFonts;
  warnings: WarningSink;
  imageCache: Map<string, Promise<PDFImage | null>>;
  options: RenderHtmlToPdfOptions;
  pageSize: { width: number; height: number };
  margin: number;
  orientation: PageOrientation;
  columns: number;
  fontScale: number;
  paddingScale: number;
  baseFontSize: number;
  headerFontSize: number;
  priceFontSize: number;
  sectionFontSize: number;
  cellPaddingX: number;
  cellPaddingY: number;
  columnWidths: number[];
  tableWidth: number;
  tableX: number;
  tableTopY: number;
  page: PDFPage;
  y: number;
  pageCount: number;
  watermarkImage: PDFImage | null;
  logoImage: PDFImage | null;
  contactQrImage: PDFImage | null;
}

const COLORS = {
  text: rgb(0.13, 0.15, 0.18),
  muted: rgb(0.36, 0.39, 0.43),
  border: rgb(0.84, 0.86, 0.89),
  grid: rgb(0.88, 0.9, 0.93),
  headerBg: rgb(0.97, 0.98, 0.99),
  paramBg: rgb(0.96, 0.97, 0.98),
  evenBg: rgb(0.98, 0.98, 0.99),
  sectionBg: rgb(0.12, 0.14, 0.16),
  sectionText: rgb(1, 1, 1),
  diffBg: rgb(1, 0.94, 0.75),
};

function asOpacity(value: number | undefined, fallback: number): number {
  if (value == null) return fallback;
  if (value <= 1) return clamp(value, 0.01, 1);
  return clamp(0.15 + (1 - 0.15) * ((value - 1) / 99), 0.01, 1);
}

function fitTextSize(font: PDFFont, text: string, size: number, maxWidth: number, minSize: number): number {
  let current = size;
  while (current > minSize && font.widthOfTextAtSize(text, current) > maxWidth) {
    current -= 0.5;
  }
  return current;
}

function computeColumnWidths(columns: number, contentWidth: number): number[] {
  if (columns <= 1) return [contentWidth];
  const configColumns = columns - 1;
  const labelWidth = clamp(118 - Math.max(0, configColumns - 4) * 4.5, 58, Math.min(155, contentWidth * 0.28));
  const rest = contentWidth - labelWidth;
  const configWidth = rest / configColumns;
  return [labelWidth, ...Array.from({ length: configColumns }, () => configWidth)];
}

async function embedFonts(pdfDoc: PDFDocument, options: RenderHtmlToPdfOptions, warnings: WarningSink): Promise<EmbeddedFonts> {
  pdfDoc.registerFontkit(fontkit);
  const resolved = await resolveFontPaths(options.font, warnings, options.resourcePolicy);
  const regularInput = options.font?.regularBytes ?? resolved.regularPath;
  const boldInput = options.font?.boldBytes ?? resolved.boldPath ?? regularInput;

  try {
    const regularBytes = await loadFontBytes(regularInput);
    const boldBytes = await loadFontBytes(boldInput);
    if (regularBytes) {
      const regular = await pdfDoc.embedFont(regularBytes, { subset: true });
      const bold = boldBytes
        ? await pdfDoc.embedFont(boldBytes, { subset: true })
        : regular;
      return { regular, bold };
    }
  } catch (error) {
    warnings.add("font_embed_failed", `Could not embed configured/discovered font: ${String(error)}`);
  }

  warnings.add("font_fallback", "Falling back to PDF standard Helvetica; non-Latin text may not render correctly.");
  return {
    regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
    bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
  };
}

function createPage(ctx: RenderContext): PDFPage {
  const page = ctx.pdfDoc.addPage([ctx.pageSize.width, ctx.pageSize.height]);
  ctx.page = page;
  ctx.y = ctx.pageSize.height - ctx.margin;
  ctx.pageCount += 1;
  drawWatermark(ctx);
  return page;
}

async function getImage(ctx: RenderContext, src: string | undefined): Promise<PDFImage | null> {
  if (!src) return null;
  let promise = ctx.imageCache.get(src);
  if (!promise) {
    promise = embedImage(ctx.pdfDoc, src, ctx.warnings, ctx.options);
    ctx.imageCache.set(src, promise);
  }
  return promise;
}

function drawWatermark(ctx: RenderContext): void {
  const text = ctx.options.watermarkText?.trim();
  const image = ctx.watermarkImage;
  if (!text && !image) return;

  const opacity = asOpacity(ctx.options.watermarkOpacity, 0.22);
  const scale = clamp(ctx.options.watermarkScale ?? 50, 1, 100);
  const step = 105 + scale * 2.7;
  const rotate = ctx.options.patternType === "honeycomb" ? degrees(30) : degrees(45);
  const page = ctx.page;
  const startX = -ctx.pageSize.width * 0.25;
  const startY = -ctx.pageSize.height * 0.1;
  const endX = ctx.pageSize.width * 1.25;
  const endY = ctx.pageSize.height * 1.15;

  for (let y = startY; y < endY; y += step) {
    for (let x = startX; x < endX; x += step) {
      if (image) {
        const side = 24 + scale * 1.15;
        const dims = image.scaleToFit(side, side);
        page.drawImage(image, {
          x,
          y,
          width: dims.width,
          height: dims.height,
          rotate,
          opacity,
        });
      } else if (text) {
        const size = 12 + scale * 0.16;
        page.drawText(text, {
          x,
          y,
          size,
          font: ctx.fonts.bold,
          color: rgb(0.25, 0.25, 0.25),
          rotate,
          opacity,
        });
      }
    }
  }
}

function drawHeader(ctx: RenderContext, doc: ParsedDocument): void {
  if (ctx.options.hideHeader) return;
  const headerHeight = Math.max(mm(18), doc.contactItems.length > 0 || ctx.contactQrImage ? mm(31) : mm(18));
  const top = ctx.y;
  const baseline = top - 18;
  const logoScale = clamp(ctx.options.logoScale ?? 100, 1, 200);

  if (ctx.logoImage) {
    const maxW = 60 + logoScale * 1.8;
    const maxH = Math.min(headerHeight - 6, 42);
    const dims = ctx.logoImage.scaleToFit(maxW, maxH);
    ctx.page.drawImage(ctx.logoImage, {
      x: ctx.margin,
      y: top - dims.height - 2,
      width: dims.width,
      height: dims.height,
    });
  } else {
    const brand = doc.brandText || "AUTO-TABLES";
    const size = fitTextSize(ctx.fonts.bold, brand, 21, ctx.tableWidth * 0.42, 11);
    ctx.page.drawText(brand, {
      x: ctx.margin,
      y: baseline,
      size,
      font: ctx.fonts.bold,
      color: COLORS.text,
    });
  }

  drawContacts(ctx, doc, top, headerHeight);
  ctx.y -= headerHeight + 8;
}

function drawContacts(ctx: RenderContext, doc: ParsedDocument, top: number, headerHeight: number): void {
  if (doc.contactItems.length === 0 && !ctx.contactQrImage) return;
  const right = ctx.pageSize.width - ctx.margin;
  const qrSize = ctx.contactQrImage ? Math.min(76, headerHeight - 4) : 0;
  let x = right;

  if (ctx.contactQrImage) {
    x -= qrSize;
    ctx.page.drawImage(ctx.contactQrImage, {
      x,
      y: top - qrSize,
      width: qrSize,
      height: qrSize,
    });
    x -= 10;
  }

  const maxTextWidth = Math.min(235, x - ctx.margin - 160);
  let y = top - 12;
  for (const item of doc.contactItems.slice(0, 5)) {
    const size = fitTextSize(ctx.fonts.regular, item, 8.5, maxTextWidth, 6.5);
    const width = ctx.fonts.regular.widthOfTextAtSize(item, size);
    ctx.page.drawText(item, {
      x: x - width,
      y,
      size,
      font: ctx.fonts.regular,
      color: COLORS.text,
    });
    y -= size + 4;
  }
}

function rowBaseHeight(ctx: RenderContext, row: ParsedRow): number {
  if (row.kind === "section") return 24 * ctx.paddingScale + 10;
  if (row.kind === "header") return Math.max(32, calculateHeaderCellHeight(ctx.columns) * 0.62);
  if (row.kind === "price") return 24 + 8 * ctx.paddingScale;
  return 22 + 8 * ctx.paddingScale;
}

function fontForCell(ctx: RenderContext, cell: ParsedCell, row: ParsedRow): PDFFont {
  if (row.kind === "header" || row.kind === "price" || row.kind === "section" || cell.isParam) return ctx.fonts.bold;
  return ctx.fonts.regular;
}

function sizeForCell(ctx: RenderContext, cell: ParsedCell, row: ParsedRow): number {
  if (row.kind === "section") return ctx.sectionFontSize;
  if (row.kind === "header") return ctx.headerFontSize;
  if (row.kind === "price") return ctx.priceFontSize;
  if (cell.isParam) return ctx.baseFontSize * 0.98;
  return ctx.baseFontSize;
}

function estimateRowHeight(ctx: RenderContext, row: ParsedRow): number {
  if (row.kind === "section") return rowBaseHeight(ctx, row);
  let max = rowBaseHeight(ctx, row);
  let col = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    const width = ctx.columnWidths.slice(col, col + span).reduce((sum, w) => sum + w, 0);
    const size = sizeForCell(ctx, cell, row);
    const font = fontForCell(ctx, cell, row);
    const lines = wrapText(font, cell.text, size, Math.max(12, width - ctx.cellPaddingX * 2));
    max = Math.max(max, lines.length * size * 1.25 + ctx.cellPaddingY * 2);
    col += span;
  }
  return Math.min(max, ctx.pageSize.height - ctx.margin * 2 - 8);
}

function drawCellText(
  ctx: RenderContext,
  cell: ParsedCell,
  row: ParsedRow,
  x: number,
  y: number,
  width: number,
  height: number,
  color: Rgb,
): void {
  const font = fontForCell(ctx, cell, row);
  const size = sizeForCell(ctx, cell, row);
  const maxWidth = Math.max(12, width - ctx.cellPaddingX * 2);
  const lines = wrapText(font, cell.text, size, maxWidth);
  const lineHeight = size * 1.25;
  const availableLines = Math.max(1, Math.floor((height - ctx.cellPaddingY * 2) / lineHeight));
  const visible = lines.slice(0, availableLines);
  if (visible.length < lines.length) {
    const last = visible[visible.length - 1] ?? "";
    visible[visible.length - 1] = last.length > 1 ? `${last.slice(0, -1)}...` : "...";
  }

  let textY = y + height - ctx.cellPaddingY - size;
  if (row.kind === "header" || row.kind === "price") {
    textY = y + (height + visible.length * lineHeight) / 2 - size;
  }

  for (const line of visible) {
    if (line) {
      ctx.page.drawText(line, {
        x: x + ctx.cellPaddingX,
        y: textY,
        size,
        font,
        color,
      });
    }
    textY -= lineHeight;
  }
}

async function drawRow(ctx: RenderContext, row: ParsedRow, rowIndex: number): Promise<void> {
  const height = estimateRowHeight(ctx, row);
  const y = ctx.y - height;

  if (row.kind === "section") {
    const text = row.cells.find((cell) => cell.text)?.text ?? "";
    ctx.page.drawRectangle({
      x: ctx.tableX,
      y,
      width: ctx.tableWidth,
      height,
      color: COLORS.sectionBg,
    });
    drawCellText(ctx, { ...row.cells[0]!, text }, row, ctx.tableX, y, ctx.tableWidth, height, COLORS.sectionText);
    ctx.y = y;
    return;
  }

  let x = ctx.tableX;
  let col = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    const width = ctx.columnWidths.slice(col, col + span).reduce((sum, w) => sum + w, 0);
    const isEven = row.kind === "body" && rowIndex % 2 === 1;
    const bg = cell.isDiff
      ? COLORS.diffBg
      : row.kind === "header" || row.kind === "price"
        ? COLORS.headerBg
        : cell.isParam
          ? COLORS.paramBg
          : isEven
            ? COLORS.evenBg
            : undefined;

    if (bg) {
      ctx.page.drawRectangle({ x, y, width, height, color: bg });
    }

    ctx.page.drawRectangle({
      x,
      y,
      width,
      height,
      borderColor: cell.isParam ? COLORS.border : COLORS.grid,
      borderWidth: 0.45,
    });

    if (cell.imageSrc) {
      const image = await getImage(ctx, cell.imageSrc);
      if (image) {
        const dims = image.scaleToFit(width - ctx.cellPaddingX * 2, height - ctx.cellPaddingY * 2);
        ctx.page.drawImage(image, {
          x: x + (width - dims.width) / 2,
          y: y + (height - dims.height) / 2,
          width: dims.width,
          height: dims.height,
        });
      }
    }

    drawCellText(ctx, cell, row, x, y, width, height, COLORS.text);
    x += width;
    col += span;
  }

  ctx.y = y;
}

async function drawRows(ctx: RenderContext, rows: ParsedRow[], headRows: ParsedRow[], repeatHeaders: boolean): Promise<void> {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const height = estimateRowHeight(ctx, row);
    if (ctx.y - height < ctx.margin) {
      createPage(ctx);
      if (repeatHeaders) {
        for (const head of headRows) {
          await drawRow(ctx, head, -1);
        }
      }
    }
    await drawRow(ctx, row, i);
  }
}

async function createContext(
  pdfDoc: PDFDocument,
  parsed: ParsedDocument,
  options: RenderHtmlToPdfOptions,
  warnings: WarningSink,
): Promise<RenderContext> {
  const columns = parsed.primaryTable?.columnCount ?? 1;
  const configuredOrientation = options.page?.orientation;
  const orientation = configuredOrientation && configuredOrientation !== "auto"
    ? configuredOrientation
    : determineOrientation(columns);
  const pageSize = (options.page?.size ?? "A4") === "LETTER"
    ? letterSize(orientation)
    : a4Size(orientation);
  const margin = mm(options.page?.marginMm ?? 2.5);
  const contentWidth = pageSize.width - margin * 2;
  const fonts = await embedFonts(pdfDoc, options, warnings);
  const fontScale = calculateFontScale(columns) / 100;
  const paddingScale = calculatePaddingScale(columns);
  const baseFontSize = 9.7 * fontScale;
  const columnWidths = computeColumnWidths(columns, contentWidth);
  const page = pdfDoc.addPage([pageSize.width, pageSize.height]);

  const ctx: RenderContext = {
    pdfDoc,
    fonts,
    warnings,
    imageCache: new Map(),
    options,
    pageSize,
    margin,
    orientation,
    columns,
    fontScale,
    paddingScale,
    baseFontSize,
    headerFontSize: Math.max(5.4, 14.2 * fontScale),
    priceFontSize: Math.max(5.4, 12.5 * fontScale),
    sectionFontSize: Math.max(6.2, 10.5 * fontScale),
    cellPaddingX: Math.max(2.2, 7 * paddingScale),
    cellPaddingY: Math.max(1.8, 4 * paddingScale),
    columnWidths,
    tableWidth: contentWidth,
    tableX: margin,
    tableTopY: pageSize.height - margin,
    page,
    y: pageSize.height - margin,
    pageCount: 1,
    watermarkImage: null,
    logoImage: null,
    contactQrImage: null,
  };

  ctx.watermarkImage = await getImage(ctx, options.watermarkUrl ?? undefined);
  ctx.logoImage = await getImage(ctx, options.userLogoUrl ?? undefined);
  ctx.contactQrImage = await getImage(ctx, parsed.contactQrSrc);
  drawWatermark(ctx);
  return ctx;
}

export async function renderHtmlToPdfDetailed(
  options: RenderHtmlToPdfOptions,
): Promise<RenderHtmlToPdfResult> {
  const warnings = new WarningSink(options.onWarning);
  const html = await prepareHtmlForRender(options, warnings);
  const parsed = parsePrintableHtml(html);
  if (!parsed.primaryTable) {
    throw new Html2PdfError("Legacy pdf-lib backend only supports documents with a table. Use the default streaming renderer for general printable HTML.");
  }
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setProducer("Html2PdfSmith");
  if (options.recordId) pdfDoc.setTitle(`HTML PDF ${options.recordId}`);

  const ctx = await createContext(pdfDoc, parsed, options, warnings);
  drawHeader(ctx, parsed);

  for (const head of parsed.primaryTable.headRows) {
    await drawRow(ctx, head, -1);
  }

  await drawRows(ctx, parsed.primaryTable.bodyRows, parsed.primaryTable.headRows, options.repeatHeaders ?? false);

  let pdf = await pdfDoc.save({ useObjectStreams: true });
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
    pages: ctx.pageCount,
    columns: ctx.columns,
    orientation: ctx.orientation,
  };
}

export async function renderHtmlToPdf(
  options: RenderHtmlToPdfOptions,
): Promise<Uint8Array> {
  return (await renderHtmlToPdfDetailed(options)).pdf;
}
