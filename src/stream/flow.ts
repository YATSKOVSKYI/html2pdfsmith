import { parseBorderStyle, parseCssColor, type StyleMap } from "../css";
import type { ParsedBlock } from "../types";
import {
  COLORS,
  type StreamContext,
  blockMarginBottom,
  blockMarginTop,
  borderPxToPt,
  borderRadiusPt,
  clipBox,
  cssLengthPt,
  fillBox,
  pxToPt,
  spacingPt,
  strokeBox,
  tableStyle,
  textBoxStyle,
} from "./layout";
import { drawAssetInBox, drawBackgroundImage, drawBoxShadow, getAsset, imageDimensions } from "./assets";
import { addPage, ensureSpace } from "./page";
import { drawInlineText, inlineTextHeight, isOverflowHidden, lineGapForStyle } from "./inline-text";
import { chartBoxMetrics, drawChartBlock } from "./charts";
import { computeTableColumnWidths, drawTableBlock, rowsHeight } from "./table";

function blockFontSize(block: ParsedBlock): number {
  if (block.type === "heading") {
    const defaults: Record<number, number> = { 1: 24, 2: 20, 3: 17, 4: 14, 5: 12, 6: 11 };
    return cssLengthPt(block.style["font-size"]) ?? defaults[block.level] ?? 12;
  }
  if (block.type === "preformatted") return cssLengthPt(block.style["font-size"]) ?? 9;
  if (block.type === "blockquote") return cssLengthPt(block.style["font-size"]) ?? 10.5;
  return cssLengthPt(block.style["font-size"]) ?? 10.5;
}

function blockColor(block: ParsedBlock): string {
  return parseCssColor(block.style["color"]) ?? COLORS.text;
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

export async function drawBlock(ctx: StreamContext, block: ParsedBlock): Promise<void> {
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
