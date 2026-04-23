import { parseBorderStyle, parseCssColor, type BorderStyle, type BoxSpacing, type StyleMap } from "../css";
import type { ParsedCell, ParsedCellBlock, ParsedInlineSegment, ParsedBlock, ParsedRow, ParsedTable } from "../types";
import {
  COLORS,
  type BoxRadius,
  type CellVerticalAlign,
  type ColumnRange,
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
  spacingPt,
  strokeBox,
  strokeCellBorder,
  tableStyle,
} from "./layout";
import { drawAssetInBox, drawBackgroundImage, drawBoxShadow, getAsset } from "./assets";
import { addPage } from "./page";
import { applyTextTransform, displayInlineSegments, drawInlineText, inlineFont, inlineSize, inlineTextHeight, isNoWrapStyle, isOverflowHidden, lineGapForStyle, wantsEllipsis } from "./inline-text";

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

export function measureCellWidth(ctx: StreamContext, cell: ParsedCell, row: ParsedRow, contentWidth: number): { min: number; preferred: number } {
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
  if (style.layout === "fixed") return Array.from({ length: table.columnCount }, () => contentWidth / table.columnCount);
  return computeAutoColumnWidths(ctx, table, contentWidth);
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
    width += ctx.doc.widthOfString(applyTextTransform(segment.text, segment.styles));
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
  const lineGap = lineGapForStyle(block.style, size, 0.18);
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

export async function drawRow(ctx: StreamContext, row: ParsedRow, index: number): Promise<void> {
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
    const sectionFont = sectionCell ? fontForCell(ctx, sectionCell, row) : fontForStyle(ctx, sectionStyle, ctx.boldFontName, text, true);
    const sectionLineGap = lineGapForStyle(sectionStyle, sectionSize, 0.18);
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

export async function drawRowSequentially(ctx: StreamContext, row: ParsedRow, index: number, headers: ParsedRow[], repeat: boolean): Promise<void> {
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
      await drawRowSequentially(ctx, group.rows[offset]!, group.startIndex + offset, headers, repeat);
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

