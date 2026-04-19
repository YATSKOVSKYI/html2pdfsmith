export type PageOrientation = "portrait" | "landscape";
export type WatermarkPattern = "auto" | "minimal" | "diagonal" | "triangle" | "corners" | "honeycomb" | "none";
export type WatermarkLayer = "background" | "foreground" | "both";
export type TableHeaderRepeat = boolean | "auto";
export type TableRowspanPagination = "avoid" | "split";
export type TableHorizontalPagination = "none" | "auto" | "always";
export type TextOverflowWrap = "normal" | "break-word" | "anywhere";

export interface PdfStylesheetInput {
  href?: string;
  content?: string;
}

export type PdfStylesheet = string | PdfStylesheetInput;

export interface PdfResourcePolicy {
  allowHttp?: boolean;
  allowFile?: boolean;
  allowData?: boolean;
  timeoutMs?: number;
  maxImageBytes?: number;
  maxStylesheetBytes?: number;
  maxFontBytes?: number;
}

export interface PdfBundledFontFace {
  family: string;
  regularPath: string;
  boldPath?: string;
  italicPath?: string;
  boldItalicPath?: string;
  license?: string;
  source?: string;
}

export interface PdfFontOptions {
  regularPath?: string;
  boldPath?: string;
  italicPath?: string;
  boldItalicPath?: string;
  regularBytes?: Uint8Array;
  boldBytes?: Uint8Array;
  italicBytes?: Uint8Array;
  boldItalicBytes?: Uint8Array;
  /**
   * Google Fonts family name, e.g. "Inter", "Roboto", "Noto Sans".
   * On first use the regular (400) and bold (700) TTF files are downloaded
   * and cached to disk (`~/.cache/html2pdfsmith/fonts/`).
   * Subsequent renders read from disk — zero extra RAM.
   *
   * Takes priority over `autoDiscover` but is overridden by explicit
   * `regularPath`/`boldPath`/`regularBytes`/`boldBytes`.
   */
  googleFont?: string;
  /**
   * Additional Google Fonts that can be selected with CSS `font-family`
   * inside the document, e.g. `font-family: "Roboto"`.
   */
  googleFonts?: string[];
  /**
   * Optional pre-bundled font face. Use this for offline/no-network rendering.
   * Takes priority over `googleFont` but is overridden by explicit paths/bytes.
   */
  bundled?: PdfBundledFontFace;
  /**
   * Additional pre-bundled fonts that can be selected with CSS `font-family`.
   */
  bundledFonts?: PdfBundledFontFace[];
  /**
   * When true, the renderer may auto-discover large system fonts for CJK/Cyrillic coverage.
   * Keep false for lowest memory; pass explicit small/subset fonts in production.
   */
  autoDiscover?: boolean;
}

export interface PdfPageOptions {
  size?: "A4" | "LETTER";
  orientation?: PageOrientation | "auto";
  marginMm?: number;
}

export interface PdfTextOptions {
  overflowWrap?: TextOverflowWrap;
}

export interface PdfTableOptions {
  /**
   * Keep rows connected by rowspan on one page whenever the group fits on a fresh page.
   * This mirrors spreadsheet/PDF-export behavior for merged vertical cells.
   */
  rowspanPagination?: TableRowspanPagination;
  /**
   * Split very wide tables into several horizontal page slices.
   * Repeated headers and rowspans keep working inside every slice.
   */
  horizontalPagination?: TableHorizontalPagination;
  /**
   * Maximum non-repeated source columns rendered in one horizontal slice.
   */
  horizontalPageColumns?: number;
  /**
   * Number of left-side source columns repeated in every horizontal slice.
   */
  repeatColumns?: number;
}

export type PdfPageTextAlign = "left" | "center" | "right";

export interface PdfPageTemplateOptions {
  text?: string;
  heightMm?: number;
  align?: PdfPageTextAlign;
  fontSize?: number;
  color?: string;
}

export interface PdfPageNumberOptions {
  enabled?: boolean;
  format?: string;
  align?: PdfPageTextAlign;
  fontSize?: number;
  color?: string;
}

export interface RenderWarning {
  code: string;
  message: string;
}

export interface RenderHtmlToPdfOptions {
  html: string;
  baseUrl?: string;
  stylesheets?: PdfStylesheet[];
  resourcePolicy?: PdfResourcePolicy;
  recordId?: string;
  page?: PdfPageOptions;
  text?: PdfTextOptions;
  table?: PdfTableOptions;
  font?: PdfFontOptions;
  tableHeaderRepeat?: TableHeaderRepeat;
  repeatHeaders?: boolean;
  hideHeader?: boolean;
  watermarkText?: string | null;
  watermarkUrl?: string | null;
  userLogoUrl?: string | null;
  logoScale?: number;
  watermarkScale?: number;
  watermarkOpacity?: number;
  watermarkLayer?: WatermarkLayer;
  patternType?: WatermarkPattern | string;
  pageHeader?: PdfPageTemplateOptions;
  pageFooter?: PdfPageTemplateOptions;
  pageNumbers?: boolean | PdfPageNumberOptions;
  protectPdf?: boolean;
  qpdfPath?: string;
  onWarning?: (warning: RenderWarning) => void;
}

export interface RenderHtmlToPdfResult {
  pdf: Uint8Array;
  warnings: RenderWarning[];
  pages: number;
  columns: number;
  orientation: PageOrientation;
}

export interface ParsedDocument {
  brandText: string;
  contactItems: string[];
  contactQrSrc?: string;
  fontFaces: ParsedFontFace[];
  page?: ParsedPageRule;
  blocks: ParsedBlock[];
  primaryTable?: ParsedTable;
}

export interface ParsedPageRule {
  size?: "A4" | "LETTER";
  orientation?: PageOrientation;
  marginMm?: number;
}

export interface ParsedFontFace {
  family: string;
  srcs: string[];
  fontWeight?: string;
  fontStyle?: string;
}

export interface ParsedInlineSegment {
  text: string;
  styles: Record<string, string>;
  href?: string;
  inlineBox?: boolean;
}

export type ParsedChartType = "bar" | "line" | "donut";

export interface ParsedChart {
  chartType: ParsedChartType;
  title?: string;
  subtitle?: string;
  labels: string[];
  values: number[];
  unit?: string;
  colors?: string[];
}

export type ParsedBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; inlines: ParsedInlineSegment[]; style: Record<string, string> }
  | { type: "paragraph"; text: string; inlines: ParsedInlineSegment[]; style: Record<string, string> }
  | { type: "preformatted"; text: string; inlines: ParsedInlineSegment[]; style: Record<string, string> }
  | { type: "blockquote"; text: string; inlines: ParsedInlineSegment[]; style: Record<string, string> }
  | { type: "list-item"; text: string; inlines: ParsedInlineSegment[]; ordered: boolean; index: number; style: Record<string, string> }
  | { type: "image"; src: string; alt: string; style: Record<string, string> }
  | { type: "chart"; chart: ParsedChart; style: Record<string, string> }
  | { type: "hr"; style: Record<string, string> }
  | { type: "page-break"; style: Record<string, string> }
  | { type: "table"; table: ParsedTable; style: Record<string, string> };

export interface ParsedTable {
  headRows: ParsedRow[];
  bodyRows: ParsedRow[];
  columnCount: number;
  columnStyles?: Record<string, string>[];
  repeatHeader?: boolean;
}

export interface ParsedRow {
  cells: ParsedCell[];
  kind: "header" | "price" | "section" | "body";
  styles: Record<string, string>;
}

export type ParsedCellBlock =
  | { type: "box"; blocks: ParsedCellBlock[]; className: string; style: Record<string, string> }
  | { type: "text"; text: string; inlines: ParsedInlineSegment[]; style: Record<string, string> }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; inlines: ParsedInlineSegment[]; style: Record<string, string> }
  | { type: "image"; src: string; alt: string; style: Record<string, string> };

export interface ParsedCell {
  text: string;
  inlines: ParsedInlineSegment[];
  richBlocks?: ParsedCellBlock[];
  className: string;
  style: string;
  styles: Record<string, string>;
  colspan: number;
  rowspan: number;
  isHeader: boolean;
  isParam: boolean;
  isPrice: boolean;
  isDiff: boolean;
  isSection: boolean;
  isSpanPlaceholder?: boolean;
  isSpanPlaceholderEnd?: boolean;
  imageSrc?: string;
  imageStyles?: Record<string, string>;
}

export interface RendererStats {
  pages: number;
  columns: number;
  orientation: PageOrientation;
}
