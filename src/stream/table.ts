import { parseBorderStyle, parseCssColor, type BorderStyle, type BoxSpacing, type StyleMap } from "../css";
import type { ParsedCell, ParsedCellBlock, ParsedInlineSegment, ParsedBlock, ParsedRow, ParsedTable, PdfPageTextAlign, PdfTableOptions, TableDensity } from "../types";
import {
  COLORS,
  type BoxRadius,
  type CellVerticalAlign,
  type ColumnRange,
  type InlineLayoutLine,
  type LogicalCell,
  type RowRenderGroup,
  type StreamContext,
  type TableColumnSlice,
  type TableRenderStyle,
  borderPxToPt,
  borderRadiusPt,
  boxRadiusPt,
  calculateHeaderCellHeight,
  cellBorders,
  cellPadding,
  clamp,
  clipBox,
  computeColumnWidths,
  cssLengthPt,
  fillBox,
  fontForStyle,
  maxBoxRadius,
  safeNumber,
  spacingPt,
  strokeBox,
  strokeCellBorder,
  tableStyle,
} from "./layout";
import { drawAssetInBox, drawBackgroundImage, drawBoxShadow, getAsset } from "./assets";
import { addPage } from "./page";
import { applyTextTransform, displayInlineSegments, drawInlineLayoutLines, drawInlineText, inlineFont, inlineLayoutItems, inlineSize, inlineTextHeight, isNoWrapStyle, isOverflowHidden, layoutInlineLines, lineGapForStyle, measureInlineLines, wantsEllipsis, type TextBlockMetrics } from "./inline-text";

export function computeColumnWidthsFromStyles(table: ParsedTable, contentWidth: number): number[] {
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

export function plainInlineText(text: string, inlines: ParsedInlineSegment[], style: StyleMap): string {
  const source = inlines.length > 0 ? inlines : [{ text, styles: style }];
  return source.map((segment) => applyTextTransform(segment.text, { ...style, ...segment.styles })).join("");
}

function inlineTextFromSegments(inlines: ParsedInlineSegment[]): string {
  return inlines.map((segment) => segment.text).join("");
}

interface TableContextSnapshot {
  baseFontSize: number;
  headerFontSize: number;
  priceFontSize: number;
  sectionFontSize: number;
  cellPaddingX: number;
  cellPaddingY: number;
}

export function tablePresetDefaults(preset: PdfTableOptions["preset"]): Partial<PdfTableOptions> {
  if (preset === "dense-comparison") {
    return {
      density: "dense",
      fit: "page-width",
      firstColumnWeight: 1.65,
      minFontSize: 6.2,
      maxFontSize: 9,
      verticalAlignMode: "optical",
      cellPagination: "text",
      cellTextAlign: "center",
      headerTextAlign: "center",
      firstColumnTextAlign: "left",
    };
  }
  if (preset === "compact-comparison") {
    return {
      density: "compact",
      fit: "page-width",
      firstColumnWeight: 1.55,
      minFontSize: 6.6,
      maxFontSize: 9.4,
      verticalAlignMode: "optical",
      cellPagination: "text",
      cellTextAlign: "center",
      headerTextAlign: "center",
      firstColumnTextAlign: "left",
    };
  }
  if (preset === "comparison") {
    return {
      density: "normal",
      fit: "page-width",
      firstColumnWeight: 1.45,
      verticalAlignMode: "optical",
      cellPagination: "text",
      cellTextAlign: "center",
      headerTextAlign: "center",
      firstColumnTextAlign: "left",
    };
  }
  return {};
}

export function tableOption<K extends keyof PdfTableOptions>(ctx: StreamContext, key: K): PdfTableOptions[K] | undefined {
  const explicit = ctx.options.table?.[key];
  if (explicit !== undefined) return explicit;
  return tablePresetDefaults(ctx.options.table?.preset)[key] as PdfTableOptions[K] | undefined;
}

export function tableDensity(ctx: StreamContext): TableDensity {
  return tableOption(ctx, "density") ?? "normal";
}

export function tableDensityScales(density: TableDensity): { font: number; paddingX: number; paddingY: number; lineGap: number } {
  if (density === "dense") return { font: 0.88, paddingX: 0.56, paddingY: 0.48, lineGap: 0.09 };
  if (density === "compact") return { font: 0.94, paddingX: 0.74, paddingY: 0.66, lineGap: 0.13 };
  return { font: 1, paddingX: 1, paddingY: 1, lineGap: 0.18 };
}

export function clampTableFontSize(ctx: StreamContext, size: number): number {
  const min = tableOption(ctx, "minFontSize");
  const max = tableOption(ctx, "maxFontSize");
  let out = size;
  if (min != null && Number.isFinite(min)) out = Math.max(min, out);
  if (max != null && Number.isFinite(max)) out = Math.min(max, out);
  return out;
}

export function applyTableDensity(ctx: StreamContext): TableContextSnapshot {
  const snapshot = {
    baseFontSize: ctx.baseFontSize,
    headerFontSize: ctx.headerFontSize,
    priceFontSize: ctx.priceFontSize,
    sectionFontSize: ctx.sectionFontSize,
    cellPaddingX: ctx.cellPaddingX,
    cellPaddingY: ctx.cellPaddingY,
  };
  const scales = tableDensityScales(tableDensity(ctx));
  ctx.baseFontSize = clampTableFontSize(ctx, snapshot.baseFontSize * scales.font);
  ctx.headerFontSize = clampTableFontSize(ctx, snapshot.headerFontSize * scales.font);
  ctx.priceFontSize = clampTableFontSize(ctx, snapshot.priceFontSize * scales.font);
  ctx.sectionFontSize = clampTableFontSize(ctx, snapshot.sectionFontSize * scales.font);
  ctx.cellPaddingX = Math.max(1.2, snapshot.cellPaddingX * scales.paddingX);
  ctx.cellPaddingY = Math.max(1, snapshot.cellPaddingY * scales.paddingY);
  return snapshot;
}

export function restoreTableContext(ctx: StreamContext, snapshot: TableContextSnapshot): void {
  ctx.baseFontSize = snapshot.baseFontSize;
  ctx.headerFontSize = snapshot.headerFontSize;
  ctx.priceFontSize = snapshot.priceFontSize;
  ctx.sectionFontSize = snapshot.sectionFontSize;
  ctx.cellPaddingX = snapshot.cellPaddingX;
  ctx.cellPaddingY = snapshot.cellPaddingY;
}

export function tableLineGapForStyle(ctx: StreamContext, style: StyleMap, size: number): number {
  return lineGapForStyle(style, size, tableDensityScales(tableDensity(ctx)).lineGap);
}

export function measureCellWidth(ctx: StreamContext, cell: ParsedCell, row: ParsedRow, contentWidth: number): { min: number; preferred: number } {
  if (cell.isSpanPlaceholder) return { min: 0, preferred: 0 };
  const font = fontForCell(ctx, cell, row);
  const size = sizeForCell(ctx, cell, row);
  const padding = cellPadding(ctx, cell);
  const text = plainInlineText(cell.text, cell.inlines, { ...row.styles, ...cell.styles }).replace(/\s+/g, " ").trim();
  ctx.doc.font(font).fontSize(size);
  const lines = text ? text.split(/\n+/) : [""];
  const preferredText = Math.max(0, ...lines.map((line) => safeNumber(ctx.doc.widthOfString(line), 0)));
  const tokens = text.split(/\s+/).filter(Boolean);
  const longestToken = Math.max(0, ...tokens.map((token) => safeNumber(ctx.doc.widthOfString(token), 0)));
  const noWrap = isNoWrapStyle({ ...row.styles, ...cell.styles });
  const ellipsis = wantsEllipsis({ ...row.styles, ...cell.styles });
  const imageWidth = cell.imageSrc
    ? cssLengthPt(cell.imageStyles?.["width"], contentWidth) ?? Math.min(48, contentWidth)
    : 0;
  const preferred = Math.max(preferredText, imageWidth) + padding.left + padding.right;
  const min = Math.max(noWrap && !ellipsis ? preferredText : ellipsis ? Math.min(preferredText, 48) : longestToken, imageWidth * 0.65, 18) + padding.left + padding.right;
  return { min, preferred: Math.max(min, preferred) };
}

export function normalizeAutoWidths(minWidths: number[], preferredWidths: number[], contentWidth: number): number[] {
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

export function weightedFirstColumnWidths(columnCount: number, contentWidth: number, firstColumnWeight: number): number[] {
  if (columnCount <= 1) return [contentWidth];
  const weight = Number.isFinite(firstColumnWeight) ? clamp(firstColumnWeight, 0.5, 4) : 1;
  const unit = contentWidth / (weight + columnCount - 1);
  return [unit * weight, ...Array.from({ length: columnCount - 1 }, () => unit)];
}

export function weightedColumnWidths(columnCount: number, contentWidth: number, weights: number[]): number[] {
  const normalized = Array.from({ length: columnCount }, (_, index) => {
    const value = weights[index] ?? 1;
    return Number.isFinite(value) ? clamp(value, 0.1, 10) : 1;
  });
  const total = normalized.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return computeColumnWidths(columnCount, contentWidth);
  return normalized.map((weight) => contentWidth * weight / total);
}

export function generatedColumnWidths(ctx: StreamContext, columnCount: number, contentWidth: number, fallbackWidths: number[]): number[] {
  const configuredWeights = tableOption(ctx, "columnWeights");
  if (configuredWeights?.length) return weightedColumnWidths(columnCount, contentWidth, configuredWeights);
  const firstColumnWeight = tableOption(ctx, "firstColumnWeight");
  if (firstColumnWeight != null && Number.isFinite(firstColumnWeight) && columnCount > 1) {
    return weightedFirstColumnWidths(columnCount, contentWidth, firstColumnWeight);
  }
  return fallbackWidths;
}

export function computeAutoColumnWidths(ctx: StreamContext, table: ParsedTable, contentWidth: number): number[] {
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

export function computeTableColumnWidths(ctx: StreamContext, table: ParsedTable, contentWidth: number, style: TableRenderStyle): number[] {
  if ((table.columnStyles?.length ?? 0) > 0) return computeColumnWidthsFromStyles(table, contentWidth);
  if (style.layout === "fixed") return generatedColumnWidths(ctx, table.columnCount, contentWidth, Array.from({ length: table.columnCount }, () => contentWidth / table.columnCount));
  const autoWidths = computeAutoColumnWidths(ctx, table, contentWidth);
  return tableOption(ctx, "fit") === "page-width" ? generatedColumnWidths(ctx, table.columnCount, contentWidth, autoWidths) : autoWidths;
}

export function fontForCell(ctx: StreamContext, cell: ParsedCell, row: ParsedRow): string {
  const defaultBold = row.kind === "header" || row.kind === "price" || row.kind === "section" || cell.isParam;
  const style = { ...row.styles, ...cell.styles };
  const text = plainInlineText(cell.text, cell.inlines, style);
  return fontForStyle(ctx, style, defaultBold ? ctx.boldFontName : ctx.regularFontName, text, defaultBold);
}

export function sizeForCell(ctx: StreamContext, cell: ParsedCell, row: ParsedRow): number {
  const cssSize = cssLengthPt(cell.styles["font-size"]) ?? cssLengthPt(row.styles["font-size"]);
  if (cssSize) return cssSize;
  if (row.kind === "section") return ctx.sectionFontSize;
  if (row.kind === "header") return ctx.headerFontSize;
  if (row.kind === "price") return ctx.priceFontSize;
  if (cell.isParam) return ctx.baseFontSize * 0.98;
  return ctx.baseFontSize;
}

export function cellBlockFontSize(block: ParsedCellBlock, fallbackSize: number): number {
  if (block.type === "heading") {
    const defaults: Record<number, number> = { 1: 18, 2: 16, 3: 14, 4: 12, 5: 10.5, 6: 10 };
    return cssLengthPt(block.style["font-size"]) ?? defaults[block.level] ?? fallbackSize;
  }
  return cssLengthPt(block.style["font-size"]) ?? fallbackSize;
}

export function cellBlockMargin(block: ParsedCellBlock): BoxSpacing {
  const fallback = block.type === "heading"
    ? { top: 0, right: 0, bottom: 6, left: 0 }
    : block.type === "text"
      ? { top: 0, right: 0, bottom: 4, left: 0 }
      : block.type === "image"
        ? { top: 0, right: 0, bottom: 6, left: 0 }
        : { top: 0, right: 0, bottom: 0, left: 0 };
  return spacingPt(block.style, "margin", fallback);
}

export function cellBlockPadding(block: ParsedCellBlock): BoxSpacing {
  return spacingPt(block.style, "padding", { top: 0, right: 0, bottom: 0, left: 0 });
}

export function cellBlockBorder(block: ParsedCellBlock): BorderStyle {
  return borderPxToPt(parseBorderStyle(block.style, { width: 0, color: COLORS.border, style: "solid" }));
}

export function isAbsoluteBlock(block: ParsedCellBlock): boolean {
  return (block.style["position"] ?? "").trim().toLowerCase() === "absolute";
}

export function cellBlockAlign(style: StyleMap): "left" | "center" | "right" {
  const align = (style["text-align"] ?? "").trim().toLowerCase();
  return align === "center" || align === "right" ? align : "left";
}

export function cellBlockVerticalAlign(style: StyleMap): CellVerticalAlign {
  const align = (style["vertical-align"] ?? style["align-items"] ?? "").trim().toLowerCase();
  if (align === "middle" || align === "center") return "middle";
  if (align === "bottom" || align === "end" || align === "flex-end") return "bottom";
  return "top";
}

export function richBlockTextWidth(ctx: StreamContext, block: Extract<ParsedCellBlock, { type: "text" | "heading" }>, fallbackFont: string, fallbackSize: number): number {
  const size = cellBlockFontSize(block, fallbackSize);
  const font = fontForStyle(ctx, block.style, block.type === "heading" ? ctx.boldFontName : fallbackFont, block.text, block.type === "heading");
  const inlines = block.inlines.length > 0 ? block.inlines : [{ text: block.text, styles: block.style }];
  let width = 0;
  for (const segment of inlines) {
    ctx.doc.font(inlineFont(ctx, segment, font)).fontSize(inlineSize(segment, size));
    width += safeNumber(ctx.doc.widthOfString(applyTextTransform(segment.text, segment.styles)), 0);
  }
  return width;
}

export function estimateRichImageHeight(ctx: StreamContext, block: Extract<ParsedCellBlock, { type: "image" }>, width: number): number {
  const margin = cellBlockMargin(block);
  const cssWidth = cssLengthPt(block.style["width"], width);
  const cssHeight = cssLengthPt(block.style["height"], ctx.contentBottom - ctx.contentTop);
  if (cssHeight != null) return margin.top + cssHeight + margin.bottom;
  if (cssWidth != null) return margin.top + Math.min(cssWidth * 0.58, ctx.contentBottom - ctx.contentTop) + margin.bottom;
  return margin.top + Math.min(90, width * 0.52) + margin.bottom;
}

export function estimateRichBlockHeight(ctx: StreamContext, block: ParsedCellBlock, width: number, fallbackFont: string, fallbackSize: number): number {
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
  const font = fontForStyle(ctx, block.style, block.type === "heading" ? ctx.boldFontName : fallbackFont, block.text, block.type === "heading");
  const contentWidth = Math.max(8, boxWidth - padding.left - padding.right - border.width * 2);
  const lineGap = tableLineGapForStyle(ctx, block.style, size);
  const noWrap = isNoWrapStyle(block.style);
  const displayInlines = displayInlineSegments(ctx, block.text, block.inlines, font, size, contentWidth, block.style);
  const textHeightValue = inlineTextHeight(ctx, block.text, displayInlines, font, size, contentWidth, lineGap, noWrap);
  return margin.top + (explicitHeight ?? textHeightValue + padding.top + padding.bottom + border.width * 2) + margin.bottom;
}

export function estimateRichCellHeight(ctx: StreamContext, cell: ParsedCell, width: number, fallbackFont: string, fallbackSize: number): number {
  if (!cell.richBlocks?.length) return 0;
  return cell.richBlocks.reduce((sum, block) => sum + estimateRichBlockHeight(ctx, block, width, fallbackFont, fallbackSize), 0);
}

export function drawRichBlockBox(ctx: StreamContext, style: StyleMap, x: number, y: number, width: number, height: number, border: BorderStyle, padding: BoxSpacing): BoxRadius {
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

export function absoluteRichBlockRect(
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

export async function drawRichBlock(
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
  const font = fontForStyle(ctx, block.style, block.type === "heading" ? ctx.boldFontName : fallbackFont, block.text, block.type === "heading");
  const textColor = parseCssColor(block.style["color"]) ?? fallbackColor;
  const contentX = drawX + border.width + padding.left;
  const contentY = drawY + border.width + padding.top;
  const contentWidth = Math.max(8, boxWidth - border.width * 2 - padding.left - padding.right);
  const contentHeight = Math.max(1, boxHeight - border.width * 2 - padding.top - padding.bottom);
  const lineGap = tableLineGapForStyle(ctx, block.style, size);
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

export async function drawRichBlocks(
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

export function styleBoxHeight(styles: StyleMap, base: number): number | undefined {
  const height = cssLengthPt(styles["height"], base);
  const minHeight = cssLengthPt(styles["min-height"], base);
  const values = [height, minHeight].filter((value): value is number => value != null && Number.isFinite(value));
  return values.length ? Math.max(...values) : undefined;
}

export function cellVerticalAlign(cell: ParsedCell, row: ParsedRow): CellVerticalAlign {
  const raw = (cell.styles["vertical-align"] ?? row.styles["vertical-align"] ?? "").trim().toLowerCase();
  if (raw === "middle" || raw === "center") return "middle";
  if (raw === "bottom") return "bottom";
  return "top";
}

export function verticalContentY(y: number, contentHeight: number, itemHeight: number, align: CellVerticalAlign): number {
  if (align === "bottom") return y + Math.max(0, contentHeight - itemHeight);
  if (align === "middle") return y + Math.max(0, (contentHeight - itemHeight) / 2);
  return y;
}

export function opticalVerticalContentY(y: number, contentHeight: number, metrics: TextBlockMetrics, align: CellVerticalAlign): number {
  if (align !== "middle" || metrics.lineCount === 0) return verticalContentY(y, contentHeight, safeNumber(metrics.layoutHeight, 0), align);
  // Place text at 46 % of the available whitespace from the top instead of the mathematical 50 %.
  // This compensates for the well-known typographic optical-centre effect: a small text block
  // centred mathematically in a large field appears to sit below the visual centre.  The 4 %
  // correction scales with whitespace, so it is negligible for tight single-row cells
  // (~0.1 pt shift) but visible for tall rowspan cells (~1 pt shift for a 3-row merged area).
  const ws = Math.max(0, contentHeight - safeNumber(metrics.visualHeight, 0));
  const opticalY = y + ws * 0.46 - safeNumber(metrics.baselineOffsetTop, 0);
  return safeNumber(Math.max(y, Math.min(y + Math.max(0, contentHeight - safeNumber(metrics.layoutHeight, 0)), opticalY)), y);
}

export function tableTextBlockMetrics(
  ctx: StreamContext,
  inlines: ParsedInlineSegment[],
  font: string,
  size: number,
  width: number,
  lineGap: number,
  noWrap: boolean,
  color: string,
): { lines: InlineLayoutLine[]; metrics: TextBlockMetrics } {
  const items = inlineLayoutItems(ctx, inlines, font, size, color, noWrap);
  const lines = layoutInlineLines(ctx, items, width, noWrap);
  return { lines, metrics: measureInlineLines(ctx, lines, lineGap) };
}

interface PaginatedCellTextLayout {
  lines: InlineLayoutLine[];
  lineGap: number;
  cursor: number;
  align: "left" | "center" | "right";
  padding: BoxSpacing;
}

interface RowCellFragment {
  lineStart: number;
  lineEnd: number;
  lines: InlineLayoutLine[];
  lineGap: number;
  textHeight: number;
  align: "left" | "center" | "right";
  forceTopAlign: boolean;
  drawFirstOnlyContent: boolean;
}

interface RowFragmentRender {
  height: number;
  cells: Map<number, RowCellFragment>;
}

export function hasExplicitBlockHeight(block: ParsedCellBlock): boolean {
  return block.style["height"] != null || block.style["min-height"] != null;
}

export function hasAtomicRichContent(blocks: ParsedCellBlock[]): boolean {
  return blocks.some((block) => {
    if (isAbsoluteBlock(block) || hasExplicitBlockHeight(block) || block.type === "image") return true;
    if (block.type === "box") return hasAtomicRichContent(block.blocks);
    return false;
  });
}

export function hasSplittableRichTextBlock(blocks: ParsedCellBlock[]): boolean {
  return blocks.some((block) => {
    if (isAbsoluteBlock(block) || block.type === "image") return false;
    if (block.type === "text" || block.type === "heading") return Boolean(block.text || block.inlines.length > 0);
    return hasSplittableRichTextBlock(block.blocks);
  });
}

export function flattenRichBlocksForPagination(blocks: ParsedCellBlock[], inherited: StyleMap = {}): ParsedInlineSegment[] {
  const output: ParsedInlineSegment[] = [];
  const pushBreak = () => {
    if (output.length === 0) return;
    const previous = output[output.length - 1];
    if (!previous?.text.endsWith("\n")) output.push({ text: "\n", styles: inherited });
  };

  for (const block of blocks) {
    if (isAbsoluteBlock(block) || block.type === "image") continue;
    const style = { ...inherited, ...block.style };
    if (block.type === "box") {
      const nested = flattenRichBlocksForPagination(block.blocks, style);
      if (nested.length > 0) {
        pushBreak();
        output.push(...nested);
        pushBreak();
      }
      continue;
    }
    const source = block.inlines.length > 0 ? block.inlines : [{ text: block.text, styles: block.style }];
    pushBreak();
    for (const segment of source) output.push({ ...segment, styles: { ...style, ...segment.styles } });
    pushBreak();
  }

  while (output.length > 0 && output[0]?.text === "\n") output.shift();
  while (output.length > 0 && output[output.length - 1]?.text === "\n") output.pop();
  return output;
}

export function minimumRowHeight(ctx: StreamContext, row: ParsedRow): number {
  const rowHeight = styleBoxHeight(row.styles, ctx.contentBottom - ctx.contentTop);
  if (row.kind === "section") return Math.max(rowHeight ?? 0, 24 * ctx.paddingScale + 10);
  // Scale the minimum with the actual font size and density-adjusted padding rather than using
  // a fixed constant. The old 22 + 8*paddingScale (~26 pt at 11 columns) was 3× too tall for
  // dense tables with small fonts (5–6 pt), forcing huge empty space in each row.
  const naturalLine = ctx.baseFontSize * 1.4 + ctx.cellPaddingY * 2;
  const base = row.kind === "header"
    ? Math.max(naturalLine * 2, calculateHeaderCellHeight(ctx.columns) * 0.62)
    : row.kind === "price"
      ? Math.max(naturalLine, 24 + 8 * ctx.paddingScale)
      : naturalLine;
  return Math.max(base, rowHeight ?? 0);
}

export function takeLineFragment(lines: InlineLayoutLine[], start: number, maxHeight: number, lineGap: number, forceOne: boolean): { end: number; height: number } {
  let end = start;
  let height = 0;
  while (end < lines.length) {
    const next = lines[end]!;
    const nextHeight = height + (end > start ? lineGap : 0) + next.height;
    if (nextHeight > maxHeight && end > start) break;
    if (nextHeight > maxHeight && !forceOne) break;
    height = nextHeight;
    end += 1;
    if (nextHeight > maxHeight) break;
  }
  return { end, height };
}

export function normalizedTextAlign(value: string | undefined): PdfPageTextAlign | undefined {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "center" || normalized === "right" || normalized === "left" ? normalized : undefined;
}

export function cellTextAlign(ctx: StreamContext, cell: ParsedCell, row: ParsedRow, col = 0): "left" | "center" | "right" {
  const explicit = normalizedTextAlign(cell.styles["text-align"]) ?? normalizedTextAlign(row.styles["text-align"]);
  if (explicit) return explicit;
  if (row.kind === "header" || cell.isHeader) return tableOption(ctx, "headerTextAlign") ?? "left";
  if (col === 0) return tableOption(ctx, "firstColumnTextAlign") ?? tableOption(ctx, "cellTextAlign") ?? "left";
  return tableOption(ctx, "cellTextAlign") ?? "left";
}

export function estimatedCellImageHeight(ctx: StreamContext, cell: ParsedCell, contentWidth: number): number {
  if (!cell.imageSrc) return 0;
  const styles = cell.imageStyles ?? {};
  const explicitHeight = cssLengthPt(styles["height"], ctx.contentBottom - ctx.contentTop);
  if (explicitHeight != null) return explicitHeight;
  const explicitWidth = cssLengthPt(styles["width"], contentWidth);
  if (explicitWidth != null) return Math.min(explicitWidth, (ctx.contentBottom - ctx.contentTop) * 0.5);
  return Math.min(36, contentWidth);
}

export function textHeight(ctx: StreamContext, text: string, font: string, size: number, width: number): number {
  ctx.doc.font(font).fontSize(size);
  return ctx.doc.heightOfString(text || " ", { width, lineGap: size * 0.18 });
}

export function estimateRowHeight(ctx: StreamContext, row: ParsedRow, capToPage = true): number {
  let height = minimumRowHeight(ctx, row);
  if (row.kind === "section") return height;

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
    const lineGap = tableLineGapForStyle(ctx, { ...row.styles, ...cell.styles }, size);
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

export async function drawRow(ctx: StreamContext, row: ParsedRow, index: number, fragment?: RowFragmentRender, groupHeight?: number): Promise<void> {
  const height = fragment?.height ?? estimateRowHeight(ctx, row);
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
    const sectionFont = sectionCell ? fontForCell(ctx, sectionCell, row) : fontForStyle(ctx, sectionStyle, ctx.boldFontName, text, true);
    const sectionLineGap = tableLineGapForStyle(ctx, sectionStyle, sectionSize);
    const sectionInlines = sectionCell?.inlines ?? [{ text, styles: sectionStyle }];
    const sectionTextHeight = inlineTextHeight(ctx, text, sectionInlines, sectionFont, sectionSize, sectionWidth, sectionLineGap);
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
      sectionFont,
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

    // Span placeholders: the owning rowspan cell (drawn in the first row of the group) already
    // fills the entire merged area — skip placeholder cells entirely.
    if (cell.isSpanPlaceholder) {
      x += width;
      col += span;
      continue;
    }

    const padding = cellPadding(ctx, cell);
    const border = cellBorders(ctx, cell);
    // For rowspan cells in a rowspan group, use the group's total height so the background fill
    // and text placement span the full merged area. Clamped to the page bottom to prevent bleed.
    const cellH = (cell.rowspan > 1 && groupHeight != null && !fragment)
      ? Math.min(groupHeight, Math.max(height, ctx.contentBottom - y))
      : height;
    const radius = borderRadiusPt(cell.styles, width, cellH);
    const cellFragment = fragment?.cells.get(col);
    const fill = cell.isDiff
      ? (parseCssColor(cell.styles["background-color"]) ?? COLORS.diffBg)
      : row.kind === "header" || row.kind === "price"
        ? (parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? COLORS.headerBg)
        : cell.isParam
          ? (parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? COLORS.paramBg)
          : row.kind === "body" && index % 2 === 1
            ? (parseCssColor(row.styles["background-color"]) ?? COLORS.evenBg)
            : parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? null;

    drawBoxShadow(ctx, cell.styles, x, y, width, cellH, radius);
    if (fill) fillBox(ctx, x, y, width, cellH, fill, radius);
    await drawBackgroundImage(ctx, cell.styles, x, y, width, cellH, radius);
    const borderCell = fragment && cell.rowspan > 1 ? { ...cell, rowspan: 1 } : cell;
    strokeCellBorder(ctx, borderCell, x, y, width, cellH, border);

    const font = fontForCell(ctx, cell, row);
    const size = sizeForCell(ctx, cell, row);
    const align = cellTextAlign(ctx, cell, row, col);
    const verticalAlign = cellFragment?.forceTopAlign ? "top" : cellVerticalAlign(cell, row);
    const contentX = x + padding.left;
    const contentY = y + padding.top;
    const contentWidth = Math.max(12, width - padding.left - padding.right);
    const contentHeight = Math.max(8, cellH - padding.top - padding.bottom);
    const textColor = parseCssColor(cell.styles["color"]) ?? parseCssColor(row.styles["color"]) ?? COLORS.text;

    if (cell.richBlocks?.length) {
      if (cellFragment && cellFragment.lineEnd > cellFragment.lineStart) {
        const textY = verticalContentY(contentY, contentHeight, cellFragment.textHeight, "top");
        ctx.doc.save();
        const contentRadius = isOverflowHidden(cell.styles) || radius > 0 ? Math.max(0, radius - Math.max(padding.left, padding.top)) : 0;
        clipBox(ctx, contentX, contentY, contentWidth, contentHeight, contentRadius);
        drawInlineLayoutLines(ctx, cellFragment.lines.slice(cellFragment.lineStart, cellFragment.lineEnd), contentX, textY, contentWidth, cellFragment.align, cellFragment.lineGap);
        ctx.doc.restore();
        x += width;
        col += span;
        continue;
      }
      if (fragment && !cellFragment?.drawFirstOnlyContent) {
        x += width;
        col += span;
        continue;
      }
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
      const asset = !fragment || cellFragment?.drawFirstOnlyContent ? await getAsset(ctx, cell.imageSrc) : null;
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

    if (fragment && !cellFragment) {
      x += width;
      col += span;
      continue;
    }

    const cellTextStyle = { ...row.styles, ...cell.styles };
    const noWrap = isNoWrapStyle(cellTextStyle);
    const lineGap = tableLineGapForStyle(ctx, cellTextStyle, size);
    const displayInlines = displayInlineSegments(ctx, cell.text, cell.inlines, font, size, contentWidth, cellTextStyle);
    const opticalText = !cellFragment && tableOption(ctx, "verticalAlignMode") === "optical";
    const textLayout = opticalText ? tableTextBlockMetrics(ctx, displayInlines, font, size, contentWidth, lineGap, noWrap, textColor) : undefined;
    const textBlockHeight = cellFragment
      ? cellFragment.textHeight
      : textLayout?.metrics.layoutHeight ?? inlineTextHeight(ctx, cell.text, displayInlines, font, size, contentWidth, lineGap, noWrap);
    const textY = textLayout
      ? opticalVerticalContentY(contentY, contentHeight, textLayout.metrics, verticalAlign)
      : verticalContentY(contentY, contentHeight, textBlockHeight, verticalAlign);
    ctx.doc.save();
    const contentRadius = isOverflowHidden(cell.styles) || radius > 0 ? Math.max(0, radius - Math.max(padding.left, padding.top)) : 0;
    clipBox(ctx, contentX, contentY, contentWidth, contentHeight, contentRadius);
    if (cellFragment) {
      drawInlineLayoutLines(ctx, cellFragment.lines.slice(cellFragment.lineStart, cellFragment.lineEnd), contentX, textY, contentWidth, cellFragment.align, cellFragment.lineGap);
    } else if (textLayout) {
      drawInlineLayoutLines(ctx, textLayout.lines, contentX, textY, contentWidth, align, lineGap);
    } else {
      drawInlineText(ctx, cell.text, displayInlines, contentX, textY, contentWidth, font, size, textColor, lineGap, align, noWrap);
    }
    ctx.doc.restore();

    x += width;
    col += span;
  }

  ctx.y = y + height;
}

export function rowHasBreakInsideAvoid(row: ParsedRow): boolean {
  const value = (row.styles["break-inside"] ?? row.styles["page-break-inside"] ?? "").trim().toLowerCase();
  return value === "avoid" || value === "avoid-page";
}

export function groupRowsByRowspan(ctx: StreamContext, rows: ParsedRow[]): RowRenderGroup[] {
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

export function rowsHeight(ctx: StreamContext, rows: ParsedRow[], capToPage = true): number {
  return rows.reduce((sum, row) => sum + estimateRowHeight(ctx, row, capToPage), 0);
}

export async function drawRepeatedHeaders(ctx: StreamContext, headers: ParsedRow[], repeat: boolean): Promise<void> {
  if (!repeat) return;
  for (const header of headers) await drawRow(ctx, header, -1);
}

export function freshPageBodyHeight(ctx: StreamContext, headers: ParsedRow[], repeat: boolean): number {
  return Math.max(0, ctx.contentBottom - ctx.contentTop - (repeat ? rowsHeight(ctx, headers) : 0));
}

export function rowHasUnsupportedCellPaginationSpan(ctx: StreamContext, row: ParsedRow): boolean {
  const allowRowspanContinuation = tableOption(ctx, "cellPagination") !== "off" && ctx.options.table?.rowspanPagination === "split";
  return row.cells.some((cell) => (cell.rowspan > 1 || cell.isSpanPlaceholder) && !allowRowspanContinuation);
}

export function isSplittableTextCell(ctx: StreamContext, cell: ParsedCell): boolean {
  if (cell.isSpanPlaceholder || cell.imageSrc) return false;
  if (!cell.richBlocks?.length) return Boolean(cell.text || cell.inlines.length > 0);
  return tableOption(ctx, "cellPagination") === "rich-text" && hasSplittableRichTextBlock(cell.richBlocks);
}

export function canPaginateRowCells(ctx: StreamContext, row: ParsedRow, rawHeight: number, freshBodyHeightValue: number, index: number): boolean {
  const mode = tableOption(ctx, "cellPagination") ?? "off";
  if (mode === "off") return false;
  if (row.kind === "section" || rowHasBreakInsideAvoid(row)) return false;
  if (rawHeight <= freshBodyHeightValue) return false;
  if (rowHasUnsupportedCellPaginationSpan(ctx, row)) {
    ctx.warnings.add("table_cell_pagination_rowspan_unsupported", `Table row ${index + 1} is taller than a page and belongs to a rowspan group; set table.rowspanPagination to "split" to allow cell text fragments inside the group, otherwise the existing grouped rowspan behavior is preserved.`);
    return false;
  }
  if (mode === "rich-text" && row.cells.some((cell) => cell.imageSrc || (cell.richBlocks?.length && hasAtomicRichContent(cell.richBlocks)))) {
    ctx.warnings.add("table_cell_pagination_rich_content_unsupported", `Table row ${index + 1} contains image, fixed-height, or positioned rich content; rich-text pagination splits structural text and keeps atomic rich blocks whole.`);
  }
  return row.cells.some((cell) => isSplittableTextCell(ctx, cell));
}

export function cellTextLayout(ctx: StreamContext, row: ParsedRow, cell: ParsedCell, col: number): PaginatedCellTextLayout {
  const span = Math.max(1, cell.colspan);
  const width = ctx.columnWidths.slice(col, col + span).reduce((sum, value) => sum + value, 0);
  const padding = cellPadding(ctx, cell);
  const contentWidth = Math.max(12, width - padding.left - padding.right);
  const font = fontForCell(ctx, cell, row);
  const size = sizeForCell(ctx, cell, row);
  const style = { ...row.styles, ...cell.styles };
  const noWrap = isNoWrapStyle(style);
  const lineGap = tableLineGapForStyle(ctx, style, size);
  const textColor = parseCssColor(cell.styles["color"]) ?? parseCssColor(row.styles["color"]) ?? COLORS.text;
  const sourceInlines = cell.richBlocks?.length && tableOption(ctx, "cellPagination") === "rich-text"
    ? flattenRichBlocksForPagination(cell.richBlocks, style)
    : cell.inlines;
  const sourceText = sourceInlines.length > 0 ? inlineTextFromSegments(sourceInlines) : cell.text;
  const displayInlines = displayInlineSegments(ctx, sourceText, sourceInlines, font, size, contentWidth, style);
  const items = inlineLayoutItems(ctx, displayInlines, font, size, textColor, noWrap);
  const lines = layoutInlineLines(ctx, items, contentWidth, noWrap);
  return {
    lines,
    lineGap,
    cursor: 0,
    align: cellTextAlign(ctx, cell, row, col),
    padding,
  };
}

export function preparePaginatedTextLayouts(ctx: StreamContext, row: ParsedRow): Map<number, PaginatedCellTextLayout> {
  const layouts = new Map<number, PaginatedCellTextLayout>();
  let col = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    if (isSplittableTextCell(ctx, cell)) {
      layouts.set(col, cellTextLayout(ctx, row, cell, col));
    }
    col += span;
  }
  return layouts;
}

export function firstOnlyCellContentHeight(ctx: StreamContext, row: ParsedRow, cell: ParsedCell, col: number): number {
  if (!cell.richBlocks?.length && !cell.imageSrc) return 0;
  const span = Math.max(1, cell.colspan);
  const width = ctx.columnWidths.slice(col, col + span).reduce((sum, value) => sum + value, 0);
  const padding = cellPadding(ctx, cell);
  const contentWidth = Math.max(12, width - padding.left - padding.right);
  const font = fontForCell(ctx, cell, row);
  const size = sizeForCell(ctx, cell, row);
  const contentHeight = cell.richBlocks?.length
    ? estimateRichCellHeight(ctx, cell, contentWidth, font, size)
    : estimatedCellImageHeight(ctx, cell, contentWidth);
  return contentHeight + padding.top + padding.bottom;
}

export function firstFragmentWholeBlockHeight(ctx: StreamContext, row: ParsedRow, layouts: Map<number, PaginatedCellTextLayout>): number {
  let col = 0;
  let height = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    const hasWholeBlock = !layouts.has(col) && (cell.imageSrc || (cell.richBlocks?.length && !isSplittableTextCell(ctx, cell)));
    if (hasWholeBlock) height = Math.max(height, firstOnlyCellContentHeight(ctx, row, cell, col));
    col += span;
  }
  return height;
}

export function rowPaginationDone(layouts: Map<number, PaginatedCellTextLayout>): boolean {
  for (const layout of layouts.values()) {
    if (layout.cursor < layout.lines.length) return false;
  }
  return true;
}

export function rowPaginationCursorTotal(layouts: Map<number, PaginatedCellTextLayout>): number {
  let total = 0;
  for (const layout of layouts.values()) total += layout.cursor;
  return total;
}

export function buildRowFragment(ctx: StreamContext, row: ParsedRow, layouts: Map<number, PaginatedCellTextLayout>, firstFragment: boolean, capacity: number, index: number): RowFragmentRender {
  const cells = new Map<number, RowCellFragment>();
  let height = Math.min(capacity, minimumRowHeight(ctx, row));
  let col = 0;

  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    const layout = layouts.get(col);
    const padding = cellPadding(ctx, cell);

    if (layout && layout.cursor < layout.lines.length) {
      const contentCapacity = Math.max(1, capacity - layout.padding.top - layout.padding.bottom);
      const forceOne = false;
      const slice = takeLineFragment(layout.lines, layout.cursor, contentCapacity, layout.lineGap, forceOne);
      if (slice.end === layout.cursor) {
        ctx.warnings.add("table_cell_pagination_fragment_too_small", `Table row ${index + 1} had no room for the next text line; forcing a clipped continuation fragment.`);
        ctx.warnings.add("table_cell_pagination_forced_line", `Table row ${index + 1} contains a wrapped line taller than the available fragment; rendering one line in a clipped fragment to guarantee progress.`);
        const forced = takeLineFragment(layout.lines, layout.cursor, contentCapacity, layout.lineGap, true);
        cells.set(col, {
          lineStart: layout.cursor,
          lineEnd: forced.end,
          lines: layout.lines,
          lineGap: layout.lineGap,
          textHeight: forced.height,
          align: layout.align,
          forceTopAlign: true,
          drawFirstOnlyContent: false,
        });
        layout.cursor = forced.end;
        height = Math.max(height, Math.min(capacity, forced.height + layout.padding.top + layout.padding.bottom));
      } else {
        const continues = slice.end < layout.lines.length || layout.cursor > 0;
        cells.set(col, {
          lineStart: layout.cursor,
          lineEnd: slice.end,
          lines: layout.lines,
          lineGap: layout.lineGap,
          textHeight: slice.height,
          align: layout.align,
          forceTopAlign: continues,
          drawFirstOnlyContent: false,
        });
        layout.cursor = slice.end;
        height = Math.max(height, Math.min(capacity, slice.height + layout.padding.top + layout.padding.bottom));
      }
    } else if (firstFragment && (cell.richBlocks?.length || cell.imageSrc)) {
      const contentHeight = firstOnlyCellContentHeight(ctx, row, cell, col);
      if (contentHeight > capacity) {
        ctx.warnings.add("table_cell_pagination_rich_content_unsupported", `Table row ${index + 1} contains rich/image cell content taller than the current fragment; cell pagination keeps that block whole and clips it as before.`);
        ctx.warnings.add("table_cell_pagination_clipped_block", `Table row ${index + 1} contains an atomic rich/image block taller than the available fragment; the block is clipped because atomic blocks are not sliced.`);
      }
      cells.set(col, {
        lineStart: 0,
        lineEnd: 0,
        lines: [],
        lineGap: 0,
        textHeight: 0,
        align: cellTextAlign(ctx, cell, row, col),
        forceTopAlign: false,
        drawFirstOnlyContent: true,
      });
      height = Math.max(height, Math.min(capacity, contentHeight));
    }

    const cssCellHeight = styleBoxHeight(cell.styles, ctx.contentBottom - ctx.contentTop);
    if (cssCellHeight != null) height = Math.max(height, Math.min(capacity, cssCellHeight + padding.top + padding.bottom));
    col += span;
  }

  return { height: Math.max(1, Math.min(capacity, height)), cells };
}

export async function drawPaginatedTextRow(ctx: StreamContext, row: ParsedRow, index: number, headers: ParsedRow[], repeat: boolean): Promise<void> {
  const layouts = preparePaginatedTextLayouts(ctx, row);
  if (layouts.size === 0) {
    ctx.warnings.add("table_cell_pagination_no_text", `Table row ${index + 1} is taller than a page, but no plain text cells were available for cellPagination=text.`);
    await drawRowSequentiallyFallback(ctx, row, index, headers, repeat);
    return;
  }

  let firstFragment = true;
  let guard = 0;
  while (!rowPaginationDone(layouts) && guard < 1000) {
    guard += 1;
    let capacity = ctx.contentBottom - ctx.y;
    if (capacity < Math.max(10, minimumRowHeight(ctx, row) * 0.5)) {
      addPage(ctx);
      await drawRepeatedHeaders(ctx, headers, repeat);
      capacity = ctx.contentBottom - ctx.y;
    }
    if (firstFragment) {
      const wholeBlockHeight = firstFragmentWholeBlockHeight(ctx, row, layouts);
      const freshCapacity = freshPageBodyHeight(ctx, headers, repeat);
      if (wholeBlockHeight > capacity && wholeBlockHeight <= freshCapacity && ctx.y > ctx.contentTop + 0.5) {
        addPage(ctx);
        await drawRepeatedHeaders(ctx, headers, repeat);
        capacity = ctx.contentBottom - ctx.y;
      }
    }

    const beforeCursor = rowPaginationCursorTotal(layouts);
    const fragment = buildRowFragment(ctx, row, layouts, firstFragment, Math.max(1, capacity), index);
    await drawRow(ctx, row, index, fragment);
    const afterCursor = rowPaginationCursorTotal(layouts);
    firstFragment = false;

    if (afterCursor <= beforeCursor && !rowPaginationDone(layouts)) {
      ctx.warnings.add("table_cell_pagination_no_progress", `Table row ${index + 1} cell pagination made no progress; stopping pagination for this row to avoid an infinite loop.`);
      break;
    }

    if (!rowPaginationDone(layouts)) {
      addPage(ctx);
      await drawRepeatedHeaders(ctx, headers, repeat);
    }
  }

  if (guard >= 1000) {
    ctx.warnings.add("table_cell_pagination_no_progress", `Table row ${index + 1} cell pagination stopped after too many fragments.`);
  }
}

export async function drawRowSequentiallyFallback(ctx: StreamContext, row: ParsedRow, index: number, headers: ParsedRow[], repeat: boolean, groupHeight?: number): Promise<void> {
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
  await drawRow(ctx, row, index, undefined, groupHeight);
}

export async function drawRowSequentially(ctx: StreamContext, row: ParsedRow, index: number, headers: ParsedRow[], repeat: boolean, groupHeight?: number): Promise<void> {
  const rawHeight = estimateRowHeight(ctx, row, false);
  const freshBody = freshPageBodyHeight(ctx, headers, repeat);
  if (canPaginateRowCells(ctx, row, rawHeight, freshBody, index)) {
    await drawPaginatedTextRow(ctx, row, index, headers, repeat);
    return;
  }
  await drawRowSequentiallyFallback(ctx, row, index, headers, repeat, groupHeight);
}

export async function drawRowGroups(ctx: StreamContext, rows: ParsedRow[], headers: ParsedRow[], repeat: boolean): Promise<void> {
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
      // Pass the group's total height only for the first row so its rowspan cells
      // draw their background and center their text across the full merged area.
      const gh = group.hasRowspan && offset === 0 ? group.height : undefined;
      await drawRowSequentially(ctx, group.rows[offset]!, group.startIndex + offset, headers, repeat, gh);
    }
  }
}

export function shouldRepeatTableHeaders(ctx: StreamContext, table: ParsedTable): boolean {
  if (ctx.options.tableHeaderRepeat === "auto") return table.headRows.length > 0;
  if (typeof ctx.options.tableHeaderRepeat === "boolean") return ctx.options.tableHeaderRepeat;
  if (ctx.options.repeatHeaders != null) return ctx.options.repeatHeaders;
  return table.repeatHeader ?? false;
}

export function normalizedHorizontalPageColumns(ctx: StreamContext): number {
  const configured = ctx.options.table?.horizontalPageColumns;
  if (configured != null && Number.isFinite(configured)) return Math.max(1, Math.floor(configured));
  return ctx.orientation === "landscape" ? 8 : 6;
}

export function normalizedRepeatColumns(ctx: StreamContext, table: ParsedTable): number {
  const configured = ctx.options.table?.repeatColumns ?? 0;
  if (!Number.isFinite(configured) || table.columnCount <= 1) return 0;
  return clamp(Math.floor(configured), 0, table.columnCount - 1);
}

export function protectedColspanRanges(table: ParsedTable): ColumnRange[] {
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

export function adjustedSliceEnd(start: number, initialEnd: number, table: ParsedTable, protectedRanges: ColumnRange[]): number {
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

export function horizontalColumnSlices(ctx: StreamContext, table: ParsedTable): TableColumnSlice[] {
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

export function logicalCellsForRow(row: ParsedRow): LogicalCell[] {
  const cells: LogicalCell[] = [];
  let col = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    cells.push({ cell, start: col, end: col + span });
    col += span;
  }
  return cells;
}

export function logicalCellAt(cells: LogicalCell[], column: number): LogicalCell | undefined {
  return cells.find((item) => column >= item.start && column < item.end);
}

export function emptySliceCell(isParam: boolean, colspan: number): ParsedCell {
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

export function cloneCellForSlice(cell: ParsedCell, colspan: number): ParsedCell {
  return {
    ...cell,
    colspan,
    rowspan: cell.rowspan,
    inlines: cell.inlines.map((segment) => ({ ...segment, styles: { ...segment.styles } })),
    styles: { ...cell.styles },
  };
}

export function sliceRowByColumns(row: ParsedRow, columns: number[]): { row: ParsedRow; splitBodyColspan: boolean } {
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

export function sliceTableByColumns(table: ParsedTable, columns: number[]): { table: ParsedTable; splitBodyColspan: boolean } {
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

export async function drawSingleTableBlock(ctx: StreamContext, table: ParsedTable, style: StyleMap, addTrailingGap = true): Promise<void> {
  const previousWidths = ctx.columnWidths;
  const previousColumns = ctx.columns;
  const previousTableWidth = ctx.tableWidth;
  const previousTableStyle = ctx.currentTableStyle;
  const previousTableContext = applyTableDensity(ctx);
  try {
    const cssWidth = cssLengthPt(style["width"], previousTableWidth);
    const width = tableOption(ctx, "fit") === "page-width" ? previousTableWidth : cssWidth ?? previousTableWidth;
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
    if (addTrailingGap) ctx.y += 8;
  } finally {
    ctx.columns = previousColumns;
    ctx.columnWidths = previousWidths;
    ctx.tableWidth = previousTableWidth;
    ctx.currentTableStyle = previousTableStyle;
    restoreTableContext(ctx, previousTableContext);
  }
}

export async function drawTableBlock(ctx: StreamContext, block: Extract<ParsedBlock, { type: "table" }>): Promise<void> {
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

