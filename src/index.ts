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
  PdfFallbackFontPath,
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
  LoadFontManifestOptions,
  PdfFontManifest,
  PdfFontManifestFace,
} from "./font-manifest";
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
export {
  fontOptionsFromManifest,
  loadFontManifest,
} from "./font-manifest";
export { resolveFontPaths } from "./assets";
export { protectPdfWithQpdf } from "./protect";
export * from "./errors";
