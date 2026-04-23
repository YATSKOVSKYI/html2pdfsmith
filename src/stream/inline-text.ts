import { parseBorderStyle, parseBoxSpacing, parseCssColor, type StyleMap } from "../css";
import type { ParsedInlineSegment, TextOverflowWrap } from "../types";
import {
  COLORS,
  type BorderStyle,
  type BoxSpacing,
  type InlineLayoutItem,
  type InlineLayoutLine,
  type PdfKitDocument,
  type StreamContext,
  borderPxToPt,
  boxPxToPt,
  boxRadiusPt,
  cssLengthPt,
  fillBox,
  fontForStyle,
  strokeBox,
} from "./layout";

export function lineGapForStyle(style: StyleMap, size: number, fallbackFactor: number): number {
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

export function inlineFont(ctx: StreamContext, segment: ParsedInlineSegment, fallbackFont: string): string {
  return fontForStyle(ctx, segment.styles, fallbackFont, segment.text);
}

export function cssFontSizePt(value: string | undefined, fallbackSize: number): number {
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

export function inlineSize(segment: ParsedInlineSegment, fallbackSize: number): number {
  return cssFontSizePt(segment.styles["font-size"], fallbackSize);
}

export function inlineColor(segment: ParsedInlineSegment, fallbackColor: string): string {
  return parseCssColor(segment.styles["color"]) ?? fallbackColor;
}

export function wrapModeFromStyle(style: StyleMap, fallback: TextOverflowWrap | undefined): TextOverflowWrap {
  const whiteSpace = (style["white-space"] ?? "").trim().toLowerCase();
  if (whiteSpace === "nowrap" || whiteSpace === "pre") return "normal";
  const overflowWrap = (style["overflow-wrap"] ?? style["word-wrap"] ?? "").trim().toLowerCase();
  const wordBreak = (style["word-break"] ?? "").trim().toLowerCase();
  if (overflowWrap === "anywhere" || wordBreak === "break-all") return "anywhere";
  if (overflowWrap === "break-word" || wordBreak === "break-word") return "break-word";
  return fallback ?? "normal";
}

export function applyTextTransform(value: string, style: StyleMap): string {
  const transform = (style["text-transform"] ?? "").trim().toLowerCase();
  if (transform === "uppercase") return value.toUpperCase();
  if (transform === "lowercase") return value.toLowerCase();
  if (transform === "capitalize") return value.replace(/\b([\p{L}\p{N}])/gu, (match) => match.toUpperCase());
  return value;
}

export function isNoWrapStyle(style: StyleMap): boolean {
  const value = (style["white-space"] ?? "").trim().toLowerCase();
  return value === "nowrap" || value === "pre";
}

export function wantsEllipsis(style: StyleMap): boolean {
  return (style["text-overflow"] ?? "").trim().toLowerCase() === "ellipsis";
}

export function isOverflowHidden(style: StyleMap): boolean {
  return (style["overflow"] ?? "").trim().toLowerCase() === "hidden";
}

export function hasInlineBoxStyle(segment: ParsedInlineSegment): boolean {
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

export function inlineBaselineShift(segment: ParsedInlineSegment, size: number): number {
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

export function needsManualInlineLayout(inlines: ParsedInlineSegment[]): boolean {
  return inlines.some((segment) => hasInlineBoxStyle(segment) || inlineBaselineShift(segment, inlineSize(segment, 10)) !== 0);
}

export function breakLongToken(doc: PdfKitDocument, font: string, size: number, token: string, width: number): string {
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

export function wrapSegmentText(ctx: StreamContext, segment: ParsedInlineSegment, fallbackFont: string, fallbackSize: number, width: number): string {
  const transformedText = applyTextTransform(segment.text, segment.styles);
  const mode = wrapModeFromStyle(segment.styles, ctx.options.text?.overflowWrap);
  if (mode === "normal" || width <= 0) return transformedText;
  const font = inlineFont(ctx, segment, fallbackFont);
  const size = inlineSize(segment, fallbackSize);
  if (mode === "anywhere") return breakLongToken(ctx.doc, font, size, transformedText, width);
  return transformedText.split(/(\s+)/).map((part) => /\s+/.test(part) ? part : breakLongToken(ctx.doc, font, size, part, width)).join("");
}

export function wrappedInlineSegments(ctx: StreamContext, inlines: ParsedInlineSegment[], fallbackFont: string, fallbackSize: number, width: number): ParsedInlineSegment[] {
  return inlines.map((segment) => ({ ...segment, text: wrapSegmentText(ctx, segment, fallbackFont, fallbackSize, width) }));
}

export function ellipsizeText(ctx: StreamContext, text: string, font: string, size: number, width: number): string {
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

export function displayInlineSegments(
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

export function inlineBoxPadding(styles: StyleMap): BoxSpacing {
  return boxPxToPt(parseBoxSpacing(styles, "padding", { top: 0, right: 0, bottom: 0, left: 0 }));
}

export function inlineBoxBorder(styles: StyleMap): BorderStyle {
  return borderPxToPt(parseBorderStyle(styles, { width: 0, color: COLORS.border, style: "solid" }));
}

export function inlineItem(
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

export function inlineItemWithText(ctx: StreamContext, item: InlineLayoutItem, text: string): InlineLayoutItem {
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

export function inlineLayoutItems(
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

export function layoutInlineLines(ctx: StreamContext, items: InlineLayoutItem[], width: number, noWrap: boolean): InlineLayoutLine[] {
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

export function fallbackLineHeight(items: InlineLayoutItem[]): number {
  return Math.max(1, ...items.map((item) => item.visualHeight));
}

export function inlineManualHeight(
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

export function drawManualInlineText(
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

export function inlineTextHeight(ctx: StreamContext, text: string, inlines: ParsedInlineSegment[], fallbackFont: string, fallbackSize: number, width: number, lineGap: number, noWrap = false): number {
  const maxSize = Math.max(fallbackSize, ...inlines.map((segment) => inlineSize(segment, fallbackSize)));
  const source = inlines.length > 0 ? inlines : [{ text, styles: {} }];
  if (needsManualInlineLayout(source)) return inlineManualHeight(ctx, source, fallbackFont, fallbackSize, COLORS.text, width, noWrap);
  const wrappedText = (noWrap ? source : wrappedInlineSegments(ctx, source, fallbackFont, fallbackSize, width)).map((segment) => segment.text).join("");
  ctx.doc.font(fontForStyle(ctx, {}, fallbackFont, wrappedText)).fontSize(maxSize);
  return ctx.doc.heightOfString(wrappedText || " ", { width: noWrap ? 100000 : width, lineGap, lineBreak: !noWrap });
}

export function drawInlineText(
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
