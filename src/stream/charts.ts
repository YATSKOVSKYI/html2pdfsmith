import { parseBorderStyle, parseCssColor } from "../css";
import type { ParsedBlock } from "../types";
import {
  CHART_COLORS,
  CHART_THEMES,
  type BorderStyle,
  type BoxSpacing,
  type StreamContext,
  borderPxToPt,
  borderRadiusPt,
  clamp,
  cssLengthPt,
  fillBox,
  fontForStyle,
  safeNumber,
  spacingPt,
  strokeBox,
} from "./layout";
import { drawBackgroundImage, drawBoxShadow } from "./assets";
import { ensureSpace } from "./page";

export function chartTheme(block: Extract<ParsedBlock, { type: "chart" }>): { colors: string[]; grid: string; muted: string; text: string; track: string; areaEnd: string } {
  return CHART_THEMES[block.chart.theme ?? ""] ?? CHART_THEMES.default!;
}

export function chartColor(block: Extract<ParsedBlock, { type: "chart" }>, index: number): string {
  const theme = chartTheme(block);
  const raw = block.chart.colors?.[index] ?? theme.colors[index % theme.colors.length] ?? CHART_COLORS[index % CHART_COLORS.length] ?? "#2563eb";
  return parseCssColor(raw) ?? raw;
}

export function chartGradientColor(block: Extract<ParsedBlock, { type: "chart" }>, index: number, fallback: string): string {
  const raw = block.chart.gradient?.[index];
  return raw ? parseCssColor(raw) ?? raw : fallback;
}

export function fillChartAreaGradient(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, _width: number, height: number, fallbackColor: string): void {
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

export function chartTitleHeight(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, width: number): number {
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

export function drawChartHeader(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number): number {
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

export function drawBarChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
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

export function chartSeries(block: Extract<ParsedBlock, { type: "chart" }>): number[][] {
  return block.chart.series?.length ? block.chart.series : [block.chart.values];
}

export function pointsForSeries(values: number[], min: number, max: number, plotLeft: number, plotTop: number, plotWidth: number, plotHeight: number): Array<{ x: number; y: number }> {
  const range = Math.max(1, max - min);
  return values.map((value, index) => ({
    x: plotLeft + plotWidth * (values.length === 1 ? 0 : index / (values.length - 1)),
    y: plotTop + plotHeight - (value - min) / range * plotHeight,
  }));
}

export function drawSmoothPath(ctx: StreamContext, points: Array<{ x: number; y: number }>): void {
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

export function fillSeriesArea(ctx: StreamContext, points: Array<{ x: number; y: number }>, bottom: number, color: string, opacity: number): void {
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

export function drawLineChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
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

export function drawChartLegend(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, count: number): void {
  const legendCount = Math.min(count, 6);
  const labels = Array.from({ length: legendCount }, (_, index) => block.chart.seriesLabels?.[index] ?? block.chart.labels[index] ?? `Series ${index + 1}`);
  ctx.doc.font(ctx.boldFontName).fontSize(6.4);
  const marker = 7;
  const markerGap = 5;
  const itemGap = 18;
  const itemWidths = labels.map((label) => marker + markerGap + Math.min(72, safeNumber(ctx.doc.widthOfString(label), 0)));
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

export function drawSparklineChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
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

export function drawHorizontalBarChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
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

export function drawStackedBarChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
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

export function donutSegmentPath(ctx: StreamContext, cx: number, cy: number, outerRadius: number, innerRadius: number, startDeg: number, endDeg: number): void {
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

export function fillAnnularSegment(ctx: StreamContext, cx: number, cy: number, outerRadius: number, innerRadius: number, startDeg: number, endDeg: number, color: string, opacity = 1): void {
  if (outerRadius <= 0 || innerRadius < 0 || endDeg <= startDeg) return;
  ctx.doc.save();
  ctx.doc.opacity(clamp(opacity, 0, 1));
  donutSegmentPath(ctx, cx, cy, outerRadius, innerRadius, startDeg, endDeg);
  ctx.doc.fill(color);
  ctx.doc.restore();
  ctx.doc.opacity(1);
}

export function chartMax(block: Extract<ParsedBlock, { type: "chart" }>, values: number[]): number {
  if (block.chart.max && block.chart.max > 0) return block.chart.max;
  const max = Math.max(1, ...values.map((value) => Math.max(0, value)));
  return max <= 100 ? 100 : max;
}

export function drawCenteredChartValue(ctx: StreamContext, text: string, unit: string | undefined, cx: number, cy: number, width: number, color = "#0f172a"): void {
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

export function drawDonutChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
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

export function drawPieChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
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

export function drawGaugeChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
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

export function drawRadialChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
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

export function drawRadialStackedChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
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

export function radarPoint(cx: number, cy: number, radius: number, index: number, total: number, ratio: number): { x: number; y: number } {
  const angle = (-90 + 360 * index / Math.max(1, total)) * Math.PI / 180;
  return {
    x: cx + Math.cos(angle) * radius * ratio,
    y: cy + Math.sin(angle) * radius * ratio,
  };
}

export function drawRadarPolygon(ctx: StreamContext, points: Array<{ x: number; y: number }>, fill: string | undefined, stroke: string, opacity: number): void {
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

export function drawRadarChart(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, x: number, y: number, width: number, height: number): void {
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

export function chartBoxMetrics(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>, availableWidth: number): {
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

export async function drawChartBlock(ctx: StreamContext, block: Extract<ParsedBlock, { type: "chart" }>): Promise<void> {
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
