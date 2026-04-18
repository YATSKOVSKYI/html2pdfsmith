export type {
  PageOrientation,
  ParsedCell,
  ParsedDocument,
  ParsedRow,
  ParsedTable,
  PdfFontOptions,
  PdfPageOptions,
  RenderHtmlToPdfOptions,
  RenderHtmlToPdfResult,
  RenderWarning,
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
