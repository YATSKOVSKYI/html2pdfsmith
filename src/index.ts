export type {
  PageOrientation,
  ParsedCell,
  ParsedChart,
  ParsedChartType,
  ParsedDocument,
  ParsedFontFace,
  ParsedPageRule,
  ParsedRow,
  ParsedTable,
  PdfBundledFontFace,
  PdfFontOptions,
  PdfPageOptions,
  PdfTextOptions,
  PdfTableOptions,
  PdfResourcePolicy,
  PdfStylesheet,
  PdfStylesheetInput,
  RenderHtmlToPdfOptions,
  RenderHtmlToPdfResult,
  RenderWarning,
  TableHeaderRepeat,
  TableHorizontalPagination,
  TableRowspanPagination,
  TextOverflowWrap,
  WatermarkLayer,
  WatermarkPattern,
} from "./types";
export type {
  ChartDashboardCard,
  ChartDashboardList,
  ChartDashboardOptions,
  ChartDashboardSeries,
  ChartDashboardValue,
} from "./dashboard";

export { parsePrintableHtml } from "./html";
export { createChartDashboardHtml } from "./dashboard";
export { convertHtmlToPdf, convertHtmlToPdfDetailed } from "./compat";
export {
  renderHtmlToPdf,
  renderHtmlToPdfDetailed,
} from "./stream-render";
export {
  renderHtmlToPdf as renderHtmlToPdfLegacy,
  renderHtmlToPdfDetailed as renderHtmlToPdfDetailedLegacy,
} from "./render";
export {
  calculateFontScale,
  calculateHeaderCellHeight,
  calculatePaddingScale,
  determineOrientation,
} from "./units";
export {
  resolveGoogleFont,
  isGoogleFontCached,
  getGoogleFontCacheDir,
} from "./google-fonts";
export { resolveFontPaths } from "./assets";
