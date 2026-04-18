export type {
  PageOrientation,
  ParsedCell,
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

export { parsePrintableHtml } from "./html";
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
