export type PageOrientation = "portrait" | "landscape";
export type WatermarkPattern = "auto" | "minimal" | "diagonal" | "triangle" | "corners" | "honeycomb" | "none";

export interface PdfFontOptions {
  regularPath?: string;
  boldPath?: string;
  regularBytes?: Uint8Array;
  boldBytes?: Uint8Array;
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
  recordId?: string;
  page?: PdfPageOptions;
  font?: PdfFontOptions;
  repeatHeaders?: boolean;
  hideHeader?: boolean;
  watermarkText?: string | null;
  watermarkUrl?: string | null;
  userLogoUrl?: string | null;
  logoScale?: number;
  watermarkScale?: number;
  watermarkOpacity?: number;
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
  blocks: ParsedBlock[];
  primaryTable?: ParsedTable;
}

export type ParsedBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; style: Record<string, string> }
  | { type: "paragraph"; text: string; style: Record<string, string> }
  | { type: "list-item"; text: string; ordered: boolean; index: number; style: Record<string, string> }
  | { type: "image"; src: string; alt: string; style: Record<string, string> }
  | { type: "hr"; style: Record<string, string> }
  | { type: "table"; table: ParsedTable; style: Record<string, string> };

export interface ParsedTable {
  headRows: ParsedRow[];
  bodyRows: ParsedRow[];
  columnCount: number;
}

export interface ParsedRow {
  cells: ParsedCell[];
  kind: "header" | "price" | "section" | "body";
}

export interface ParsedCell {
  text: string;
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
}

export interface RendererStats {
  pages: number;
  columns: number;
  orientation: PageOrientation;
}
