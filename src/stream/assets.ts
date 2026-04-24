import SVGtoPDF from "svg-to-pdfkit";
import { Buffer } from "node:buffer";
import { loadImage } from "../assets";
import { parseCssColor, parseLengthPx, type StyleMap } from "../css";
import type { RenderHtmlToPdfOptions } from "../types";
import { safeNumber } from "../units";
import type { WarningSink } from "../warnings";
import {
  type BoxShadow,
  type CssTransformOrigin,
  type ImageDimensions,
  type LoadedPdfKitAsset,
  type ObjectFitMode,
  type ObjectPosition,
  type PdfKitDocument,
  type StreamContext,
  clamp,
  clipBox,
  cssLengthPt,
  fillBox,
  pxToPt,
} from "./layout";

export async function loadPdfKitAsset(src: string | null | undefined, warnings: WarningSink, options: Pick<RenderHtmlToPdfOptions, "baseUrl" | "resourcePolicy">): Promise<LoadedPdfKitAsset | null> {
  if (!src) return null;
  const loaded = await loadImage(src, warnings, options);
  if (!loaded) return null;
  if (loaded.kind !== "png" && loaded.kind !== "jpg" && loaded.kind !== "svg") return null;
  const bytes = Buffer.from(loaded.bytes);
  const asset: LoadedPdfKitAsset = { bytes, kind: loaded.kind };
  if (loaded.kind === "svg") asset.svgText = bytes.toString("utf8");
  return asset;
}

export function getAsset(ctx: StreamContext, src: string): Promise<LoadedPdfKitAsset | null> {
  let asset = ctx.assetCache.get(src);
  if (!asset) {
    asset = loadPdfKitAsset(src, ctx.warnings, ctx.options);
    ctx.assetCache.set(src, asset);
  }
  return asset;
}

export function drawAsset(doc: PdfKitDocument, asset: LoadedPdfKitAsset, x: number, y: number, width: number, height: number, opacity = 1, preserveAspectRatio = "xMidYMid meet"): void {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(1, safeNumber(width, 1));
  const safeHeight = Math.max(1, safeNumber(height, 1));
  const safeOpacity = clamp(safeNumber(opacity, 1), 0, 1);
  doc.save();
  doc.opacity(safeOpacity);
  if (asset.kind === "svg" && asset.svgText) {
    SVGtoPDF(doc, asset.svgText, safeX, safeY, { width: safeWidth, height: safeHeight, preserveAspectRatio });
  } else {
    doc.image(asset.bytes, safeX, safeY, { width: safeWidth, height: safeHeight });
  }
  doc.restore();
}

export function drawAssetSafely(ctx: StreamContext, asset: LoadedPdfKitAsset, x: number, y: number, width: number, height: number, opacity = 1, label = "image"): void {
  drawAssetInBox(ctx, asset, x, y, width, height, {}, opacity, label);
}

export function objectFitFromStyle(styles: StyleMap | undefined): ObjectFitMode {
  const value = styles?.["object-fit"]?.trim().toLowerCase();
  if (value === "cover") return "cover";
  if (value === "fill") return "fill";
  return "contain";
}

export function objectPositionFromStyle(styles: StyleMap | undefined): ObjectPosition {
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

export function positionedStart(containerStart: number, containerSize: number, itemSize: number, align: "left" | "center" | "right" | "top" | "bottom"): number {
  const start = safeNumber(containerStart, 0);
  const size = safeNumber(containerSize, 0);
  const item = safeNumber(itemSize, 0);
  if (align === "right" || align === "bottom") return start + size - item;
  if (align === "center") return start + (size - item) / 2;
  return start;
}

export function cssOpacity(styles: StyleMap | undefined, fallback = 1): number {
  const raw = styles?.["opacity"];
  if (!raw) return fallback;
  const trimmed = raw.trim();
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) return fallback;
  return clamp(trimmed.endsWith("%") ? value / 100 : value, 0, 1);
}

export function cssUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(value);
  const url = match?.[2]?.trim();
  return url || undefined;
}

export function backgroundPositionStyles(styles: StyleMap): StyleMap {
  return {
    "object-fit": styles["background-size"] ?? "cover",
    "object-position": styles["background-position"] ?? "center center",
  };
}

export function backgroundTileSize(asset: LoadedPdfKitAsset, width: number, height: number, styles: StyleMap): { width: number; height: number } {
  const safeWidth = Math.max(1, safeNumber(width, 1));
  const safeHeight = Math.max(1, safeNumber(height, 1));
  const raw = (styles["background-size"] ?? "cover").trim().toLowerCase();
  const natural = imageDimensions(asset);
  if (raw === "cover" || raw === "contain") return { width: safeWidth, height: safeHeight };
  if (raw === "auto") {
    return natural ? { width: Math.max(1, pxToPt(natural.width)), height: Math.max(1, pxToPt(natural.height)) } : { width: safeWidth, height: safeHeight };
  }

  const parts = raw.split(/\s+/).filter(Boolean);
  const cssWidth = cssLengthPt(parts[0], safeWidth);
  const cssHeight = cssLengthPt(parts[1], safeHeight);
  let tileWidth = cssWidth ?? (natural ? pxToPt(natural.width) : safeWidth);
  let tileHeight = cssHeight ?? (natural ? pxToPt(natural.height) : safeHeight);
  if (natural && cssWidth != null && cssHeight == null) tileHeight = tileWidth * natural.height / natural.width;
  if (natural && cssHeight != null && cssWidth == null) tileWidth = tileHeight * natural.width / natural.height;
  return { width: Math.max(1, tileWidth), height: Math.max(1, tileHeight) };
}

export async function drawBackgroundImage(ctx: StreamContext, styles: StyleMap, x: number, y: number, width: number, height: number, radius = 0): Promise<void> {
  const src = cssUrl(styles["background-image"]);
  if (!src) return;
  const asset = await getAsset(ctx, src);
  if (!asset) return;

  const repeat = (styles["background-repeat"] ?? "no-repeat").trim().toLowerCase();
  const tile = backgroundTileSize(asset, width, height, styles);
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

export function colorOpacity(value: string | undefined): number {
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

export function splitShadowList(value: string): string[] {
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

export function shadowColor(value: string | undefined): { color: string; opacity: number } {
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

export function parseBoxShadowPart(rawPart: string): BoxShadow | undefined {
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

export function parseBoxShadows(styles: StyleMap): BoxShadow[] {
  const raw = styles["box-shadow"]?.trim();
  if (!raw || raw === "none") return [];
  return splitShadowList(raw).map(parseBoxShadowPart).filter((shadow): shadow is BoxShadow => !!shadow);
}

export function drawShadowShape(ctx: StreamContext, x: number, y: number, width: number, height: number, radius: number, color: string, opacity: number): void {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(0, safeNumber(width, 0));
  const safeHeight = Math.max(0, safeNumber(height, 0));
  const safeRadius = Math.max(0, safeNumber(radius, 0));
  const safeOpacity = clamp(safeNumber(opacity, 0), 0, 0.65);
  if (safeWidth <= 0 || safeHeight <= 0 || safeOpacity < 0.0005) return;
  ctx.doc.save();
  ctx.doc.opacity(safeOpacity);
  fillBox(ctx, safeX, safeY, safeWidth, safeHeight, color, safeRadius);
  ctx.doc.restore();
  ctx.doc.opacity(1);
}

export function drawOuterBoxShadow(ctx: StreamContext, shadow: BoxShadow, x: number, y: number, width: number, height: number, radius: number): void {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(0, safeNumber(width, 0));
  const safeHeight = Math.max(0, safeNumber(height, 0));
  const safeRadius = Math.max(0, safeNumber(radius, 0));
  const blur = Math.max(0, safeNumber(shadow.blur, 0));
  const spread = safeNumber(shadow.spread, 0);
  const offsetX = safeNumber(shadow.offsetX, 0);
  const offsetY = safeNumber(shadow.offsetY, 0);
  const opacity = safeNumber(shadow.opacity, 0);
  const layers = blur > 0 ? clamp(Math.ceil(blur * 1.65), 10, 36) : 1;
  const weights = Array.from({ length: layers }, (_, index) => {
    const ratio = (index + 1) / layers;
    return Math.pow(1 - ratio, 2.15);
  });
  const weightTotal = Math.max(0.001, weights.reduce((sum, weight) => sum + weight, 0));
  for (let i = layers; i >= 1; i--) {
    const ratio = i / layers;
    const eased = 1 - Math.pow(1 - ratio, 1.35);
    const expansion = spread + blur * eased;
    const sx = safeX + offsetX - expansion;
    const sy = safeY + offsetY - expansion;
    const sw = safeWidth + expansion * 2;
    const sh = safeHeight + expansion * 2;
    const alpha = blur > 0
      ? opacity * 1.08 * weights[i - 1]! / weightTotal
      : opacity;
    drawShadowShape(ctx, sx, sy, sw, sh, Math.max(0, safeRadius + expansion), shadow.color, alpha);
  }
}

export function drawInsetBoxShadow(ctx: StreamContext, shadow: BoxShadow, x: number, y: number, width: number, height: number, radius: number): void {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(0, safeNumber(width, 0));
  const safeHeight = Math.max(0, safeNumber(height, 0));
  const safeRadius = Math.max(0, safeNumber(radius, 0));
  const blur = Math.max(0, safeNumber(shadow.blur, 0));
  const spread = Math.max(0, safeNumber(shadow.spread, 0));
  const offsetX = safeNumber(shadow.offsetX, 0);
  const offsetY = safeNumber(shadow.offsetY, 0);
  const edge = Math.max(1, blur * 0.45 + spread);
  ctx.doc.save();
  clipBox(ctx, safeX, safeY, safeWidth, safeHeight, safeRadius);
  const opacity = clamp(safeNumber(shadow.opacity, 0) * 0.55, 0.005, 0.35);
  ctx.doc.opacity(opacity);
  ctx.doc.rect(safeX + offsetX, safeY + offsetY, safeWidth, Math.min(edge, safeHeight)).fill(shadow.color);
  ctx.doc.rect(safeX + offsetX, safeY + safeHeight - edge + offsetY, safeWidth, Math.min(edge, safeHeight)).fill(shadow.color);
  ctx.doc.rect(safeX + offsetX, safeY + offsetY, Math.min(edge, safeWidth), safeHeight).fill(shadow.color);
  ctx.doc.rect(safeX + safeWidth - edge + offsetX, safeY + offsetY, Math.min(edge, safeWidth), safeHeight).fill(shadow.color);
  ctx.doc.restore();
  ctx.doc.opacity(1);
}

export function drawBoxShadow(ctx: StreamContext, styles: StyleMap, x: number, y: number, width: number, height: number, radius = 0): void {
  const shadows = parseBoxShadows(styles);
  for (const shadow of shadows) {
    if (shadow.inset) drawInsetBoxShadow(ctx, shadow, x, y, width, height, radius);
    else drawOuterBoxShadow(ctx, shadow, x, y, width, height, radius);
  }
}

export function transformValue(styles: StyleMap | undefined): string {
  return (styles?.["transform"] ?? styles?.["-webkit-transform"] ?? "").trim();
}

export function transformOriginValue(styles: StyleMap | undefined): string {
  return (styles?.["transform-origin"] ?? styles?.["-webkit-transform-origin"] ?? "center center").trim();
}

export function splitTransformArgs(args: string): string[] {
  return args.trim().split(/\s*,\s*|\s+/).filter(Boolean);
}

export function angleDeg(value: string | undefined): number {
  if (!value) return 0;
  const raw = value.trim().toLowerCase();
  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric)) return 0;
  if (raw.endsWith("rad")) return numeric * 180 / Math.PI;
  if (raw.endsWith("turn")) return numeric * 360;
  if (raw.endsWith("grad")) return numeric * 0.9;
  return numeric;
}

export function translateLength(value: string | undefined, base: number): number {
  if (!value) return 0;
  return cssLengthPt(value, base) ?? 0;
}

export function transformOriginAxis(token: string | undefined, base: number, axis: "x" | "y"): number | undefined {
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

export function transformOrigin(styles: StyleMap | undefined, width: number, height: number): CssTransformOrigin {
  const safeWidth = safeNumber(width, 0);
  const safeHeight = safeNumber(height, 0);
  const tokens = transformOriginValue(styles).toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { x: safeWidth / 2, y: safeHeight / 2 };
  let x: number | undefined;
  let y: number | undefined;

  for (const token of tokens) {
    x ??= transformOriginAxis(token, safeWidth, "x");
    y ??= transformOriginAxis(token, safeHeight, "y");
  }

  if (tokens.length >= 2) {
    x = transformOriginAxis(tokens[0], safeWidth, "x") ?? x;
    y = transformOriginAxis(tokens[1], safeHeight, "y") ?? y;
  }

  return { x: safeNumber(x, safeWidth / 2), y: safeNumber(y, safeHeight / 2) };
}

export function applyCssTransform(doc: PdfKitDocument, styles: StyleMap | undefined, x: number, y: number, width: number, height: number): void {
  const raw = transformValue(styles);
  if (!raw || raw.toLowerCase() === "none") return;

  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = safeNumber(width, 0);
  const safeHeight = safeNumber(height, 0);
  const origin = transformOrigin(styles, safeWidth, safeHeight);
  doc.translate(safeX + origin.x, safeY + origin.y);

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
      doc.translate(translateLength(args[0], safeWidth), translateLength(args[1], safeHeight));
    } else if (fn === "translatex") {
      doc.translate(translateLength(args[0], safeWidth), 0);
    } else if (fn === "translatey") {
      doc.translate(0, translateLength(args[0], safeHeight));
    }
  }

  doc.translate(-safeX - origin.x, -safeY - origin.y);
}

export function drawAssetInBox(
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
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(1, safeNumber(width, 1));
  const safeHeight = Math.max(1, safeNumber(height, 1));
  const fit = objectFitFromStyle(styles);
  const position = objectPositionFromStyle(styles);
  const natural = imageDimensions(asset);
  const cssWidth = cssLengthPt(styles?.["width"], safeWidth);
  const cssHeight = cssLengthPt(styles?.["height"], safeHeight);
  let drawWidth = cssWidth ?? safeWidth;
  let drawHeight = cssHeight ?? safeHeight;

  if (fit !== "fill" && natural) {
    const targetRatio = safeWidth / Math.max(1, safeHeight);
    const naturalRatio = natural.width / Math.max(1, natural.height);
    const scale = fit === "cover"
      ? naturalRatio > targetRatio ? safeHeight / natural.height : safeWidth / natural.width
      : naturalRatio > targetRatio ? safeWidth / natural.width : safeHeight / natural.height;
    if (cssWidth == null) drawWidth = natural.width * scale;
    if (cssHeight == null) drawHeight = natural.height * scale;
    if (cssWidth != null && cssHeight == null) drawHeight = drawWidth / naturalRatio;
    if (cssHeight != null && cssWidth == null) drawWidth = drawHeight * naturalRatio;
  }

  drawWidth = Math.max(1, safeNumber(fit === "fill" && cssWidth == null ? safeWidth : drawWidth, 1));
  drawHeight = Math.max(1, safeNumber(fit === "fill" && cssHeight == null ? safeHeight : drawHeight, 1));
  const drawX = positionedStart(safeX, safeWidth, drawWidth, position.x);
  const drawY = positionedStart(safeY, safeHeight, drawHeight, position.y);
  const preserveAspectRatio = fit === "fill" ? "none" : `x${position.x === "left" ? "Min" : position.x === "right" ? "Max" : "Mid"}Y${position.y === "top" ? "Min" : position.y === "bottom" ? "Max" : "Mid"} ${fit === "cover" ? "slice" : "meet"}`;
  const effectiveOpacity = clamp(opacity * cssOpacity(styles), 0, 1);

  try {
    ctx.doc.save();
    ctx.doc.rect(safeX, safeY, safeWidth, safeHeight).clip();
    applyCssTransform(ctx.doc, styles, drawX, drawY, drawWidth, drawHeight);
    drawAsset(ctx.doc, asset, drawX, drawY, drawWidth, drawHeight, effectiveOpacity, preserveAspectRatio);
    ctx.doc.restore();
  } catch (error) {
    ctx.warnings.add("image_draw_failed", `Failed to draw ${label}: ${String(error)}`);
  }
}

export function pngDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function jpgDimensions(bytes: Buffer): ImageDimensions | null {
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

export function svgDimensions(svgText: string | undefined): ImageDimensions | null {
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

export function imageDimensions(asset: LoadedPdfKitAsset): ImageDimensions | null {
  if (asset.kind === "png") return pngDimensions(asset.bytes);
  if (asset.kind === "jpg") return jpgDimensions(asset.bytes);
  if (asset.kind === "svg") return svgDimensions(asset.svgText);
  return null;
}

