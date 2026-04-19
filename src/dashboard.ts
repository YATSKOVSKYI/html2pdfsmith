import type { ParsedChartType } from "./types";

export type ChartDashboardValue = number | string;
export type ChartDashboardList = string | readonly ChartDashboardValue[];
export type ChartDashboardSeries = string | readonly (readonly ChartDashboardValue[])[];

export interface ChartDashboardCard {
  type: ParsedChartType;
  title: string;
  subtitle?: string;
  theme?: string;
  labels?: ChartDashboardList;
  values?: ChartDashboardList;
  series?: ChartDashboardSeries;
  seriesLabels?: ChartDashboardList;
  unit?: string;
  max?: number | string;
  center?: number | string;
  colors?: ChartDashboardList;
  gradient?: ChartDashboardList;
}

export interface ChartDashboardOptions {
  title: string;
  lead?: string;
  charts: readonly ChartDashboardCard[];
  className?: string;
  gridClassName?: string;
  cardClassName?: string;
  columns?: number;
  gap?: string;
  cardHeight?: string;
  cardPadding?: string;
  includeStyles?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function attr(name: string, value: number | string | undefined): string {
  return value === undefined || value === "" ? "" : ` ${name}="${escapeHtml(String(value))}"`;
}

function list(value: ChartDashboardList | undefined): string | undefined {
  if (value === undefined || typeof value === "string") {
    return value;
  }
  return value.map(String).join(",");
}

function series(value: ChartDashboardSeries | undefined): string | undefined {
  if (value === undefined || typeof value === "string") {
    return value;
  }
  return value.map((line) => line.map(String).join(",")).join("|");
}

function dashboardCss({
  gridClassName,
  cardClassName,
  columns,
  gap,
  cardHeight,
  cardPadding,
}: Required<Pick<ChartDashboardOptions, "gridClassName" | "cardClassName" | "columns" | "gap" | "cardHeight" | "cardPadding">>): string {
  return `<style>
    .${gridClassName} { display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: ${gap}; margin-top: 12px; }
    .${cardClassName} { height: ${cardHeight}; margin-bottom: 0; padding: ${cardPadding}; border: 1px solid #d8e0ea; border-radius: 8px; background-color: #ffffff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 12px 28px -10px rgba(15, 23, 42, 0.18); }
  </style>`;
}

function dashboardCardHtml(card: ChartDashboardCard, cardClassName: string): string {
  return `<chart${attr("class", cardClassName)}${attr("type", card.type)}${attr("title", card.title)}${attr("subtitle", card.subtitle)}${attr("unit", card.unit)}${attr("data-theme", card.theme)}${attr("data-labels", list(card.labels))}${attr("data-values", list(card.values))}${attr("data-series", series(card.series))}${attr("data-series-labels", list(card.seriesLabels))}${attr("data-max", card.max)}${attr("data-center", card.center)}${attr("data-colors", list(card.colors))}${attr("data-gradient", list(card.gradient))}></chart>`;
}

export function createChartDashboardHtml(options: ChartDashboardOptions): string {
  const className = options.className ?? "h2ps-dashboard";
  const gridClassName = options.gridClassName ?? "h2ps-dashboard-grid";
  const cardClassName = options.cardClassName ?? "h2ps-dashboard-card";
  const columns = options.columns ?? 3;
  const gap = options.gap ?? "10px";
  const cardHeight = options.cardHeight ?? "166px";
  const cardPadding = options.cardPadding ?? "12px 14px";
  const includeStyles = options.includeStyles ?? true;
  const css = includeStyles
    ? `${dashboardCss({ gridClassName, cardClassName, columns, gap, cardHeight, cardPadding })}\n`
    : "";
  const lead = options.lead ? `\n    <p class="lead">${escapeHtml(options.lead)}</p>` : "";
  const charts = options.charts.map((chart) => `      ${dashboardCardHtml(chart, cardClassName)}`).join("\n");

  return `${css}<section class="${escapeHtml(className)}">
    <h1>${escapeHtml(options.title)}</h1>${lead}
    <div class="${escapeHtml(gridClassName)}">
${charts}
    </div>
  </section>`;
}
