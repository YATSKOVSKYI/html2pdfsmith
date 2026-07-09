import { Buffer } from 'node:buffer';

type PageOrientation = "portrait" | "landscape";
/** @deprecated legacy pattern names — use {@link WatermarkLayout}. Kept for back-compat input mapping. */
type WatermarkPattern = "auto" | "minimal" | "diagonal" | "triangle" | "corners" | "honeycomb" | "none";
/** Native tiling arrangements for image/text watermarks. */
type WatermarkLayout = "honeycomb" | "grid" | "diagonal" | "single";
type WatermarkLayer = "background" | "foreground" | "both";
type TableHeaderRepeat = boolean | "auto";
type TableRowspanPagination = "avoid" | "split";
type TableHorizontalPagination = "none" | "auto" | "always";
type TableCellPagination = "off" | "text" | "rich-text";
type TableVerticalAlignMode = "layout" | "optical";
type TableDensity = "normal" | "compact" | "dense";
type TableFit = "content" | "page-width";
type TablePreset = "comparison" | "compact-comparison" | "dense-comparison";
type TextOverflowWrap = "normal" | "break-word" | "anywhere";
interface PdfStylesheetInput {
    href?: string;
    content?: string;
}
type PdfStylesheet = string | PdfStylesheetInput;
interface PdfResourcePolicy {
    allowHttp?: boolean;
    allowFile?: boolean;
    allowData?: boolean;
    timeoutMs?: number;
    maxImageBytes?: number;
    maxStylesheetBytes?: number;
    maxFontBytes?: number;
}
interface PdfBundledFontFace {
    family: string;
    regularPath: string;
    boldPath?: string;
    italicPath?: string;
    boldItalicPath?: string;
    license?: string;
    source?: string;
}
interface PdfFallbackFontPath {
    family: string;
    regularPath: string;
    boldPath?: string;
    italicPath?: string;
    boldItalicPath?: string;
}
interface PdfFontOptions {
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
     * Additional Google Font families used as CSS/font coverage fallbacks.
     * They are resolved through the same disk cache as `googleFont` and
     * `googleFonts`, and are only loaded when explicitly configured.
     */
    fallbackFonts?: string[];
    /**
     * Additional local font families used as CSS/font coverage fallbacks.
     */
    fallbackFontPaths?: PdfFallbackFontPath[];
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
interface PdfPageOptions {
    size?: "A4" | "LETTER";
    orientation?: PageOrientation | "auto";
    marginMm?: number;
}
interface PdfTextOptions {
    overflowWrap?: TextOverflowWrap;
}
interface PdfTableOptions {
    /**
     * Opinionated generic table defaults. Explicit table options and CSS still win.
     */
    preset?: TablePreset;
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
    /**
     * Split oversized plain text table cells across page fragments.
     *
     * `off` preserves historical row-level pagination. `text` paginates text/inlines
     * while keeping cell chrome on each continuation fragment. `rich-text` also
     * paginates structural text/heading content nested in rich cells. Images,
     * positioned blocks, and fixed-height rich blocks remain atomic whole-block
     * fallbacks with warnings when they cannot fit.
     */
    cellPagination?: TableCellPagination;
    /**
     * Use layout box math or optical text metrics for `vertical-align: middle`.
     * Defaults to `layout` for backward compatibility.
     */
    verticalAlignMode?: TableVerticalAlignMode;
    /**
     * Predictable density preset for table default font, padding, and line-height.
     * Explicit CSS on rows/cells continues to win.
     */
    density?: TableDensity;
    /**
     * `page-width` makes table layout use the available page content width.
     * `content` preserves the table's CSS/content width behavior.
     */
    fit?: TableFit;
    /**
     * Relative width weight for the first column when generated table widths are used.
     * Explicit colgroup widths are preserved.
     */
    firstColumnWeight?: number;
    /**
     * Relative generated column weights. Explicit colgroup widths are preserved.
     */
    columnWeights?: number[];
    /**
     * Default text alignment for table cells without explicit CSS `text-align`.
     */
    cellTextAlign?: PdfPageTextAlign;
    /**
     * Default text alignment for header cells without explicit CSS `text-align`.
     */
    headerTextAlign?: PdfPageTextAlign;
    /**
     * Default text alignment for first-column cells without explicit CSS `text-align`.
     */
    firstColumnTextAlign?: PdfPageTextAlign;
    /**
     * Clamp generated table font sizes. Explicit CSS `font-size` is not clamped.
     */
    minFontSize?: number;
    maxFontSize?: number;
}
type PdfPageTextAlign = "left" | "center" | "right";
interface PdfPageTemplateOptions {
    text?: string;
    heightMm?: number;
    align?: PdfPageTextAlign;
    fontSize?: number;
    color?: string;
    fontFamily?: string;
}
interface PdfPageNumberOptions {
    enabled?: boolean;
    format?: string;
    align?: PdfPageTextAlign;
    fontSize?: number;
    color?: string;
}
interface RenderWarning {
    code: string;
    message: string;
}
/** Built-in glyph for a contact row icon or a QR social badge. */
type HeaderContactIcon = "phone" | "email" | "globe" | "telegram" | "wechat" | "whatsapp" | "instagram" | "facebook" | "youtube" | "viber" | "linkedin" | "x";
interface HeaderContactItem {
    /** Built-in icon drawn before the text. Omit for no icon. */
    icon?: HeaderContactIcon;
    text: string;
    /** Optional link target (rendered as a clickable annotation). */
    href?: string;
}
interface HeaderContactsQr {
    /** Image source for the QR (data URI, http(s), or file per resource policy). */
    src: string;
    /** Social glyph drawn in a white disc at the QR centre. */
    badge?: HeaderContactIcon | null;
}
interface HeaderContacts {
    items?: HeaderContactItem[];
    qr?: HeaderContactsQr | null;
}
interface RenderHtmlToPdfOptions {
    html: string;
    baseUrl?: string;
    stylesheets?: PdfStylesheet[];
    resourcePolicy?: PdfResourcePolicy;
    recordId?: string;
    /** PDF metadata title. Falls back to `recordId`, then "HTML PDF". */
    title?: string;
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
    /** Horizontal nudge of the header logo from its left anchor, in mm (clamped to ±20). */
    logoOffsetXMm?: number;
    /** Vertical nudge of the header logo from the header top, in mm (clamped to ±20). */
    logoOffsetYMm?: number;
    /**
     * Structured header contact block — rendered natively (icon + text rows, plus an
     * optional QR with a centered social badge). Takes precedence over contacts parsed
     * from the HTML `.contact-card`. The QR `src` is loaded like any other image asset.
     */
    headerContacts?: HeaderContacts | null;
    /**
     * Combined size+density knob (1..100). Legacy single control.
     * Prefer the decoupled {@link watermarkLogoScale} + {@link watermarkDensity}.
     * Used as the fallback for either when they are not provided.
     */
    watermarkScale?: number;
    /** Logo/text size, 1..100 (decoupled from spacing). Falls back to {@link watermarkScale}. */
    watermarkLogoScale?: number;
    /** Tiling density, 1..100 — higher = tiles packed closer together. Falls back to {@link watermarkScale}. */
    watermarkDensity?: number;
    watermarkOpacity?: number;
    watermarkLayer?: WatermarkLayer;
    /** Tiling arrangement. Overrides {@link patternType} mapping when set. */
    watermarkLayout?: WatermarkLayout;
    /** Rotation of the whole watermark layer, in degrees. Defaults per layout. */
    watermarkAngle?: number;
    /**
     * When true, the watermark is not drawn over the table head band (header /
     * price rows) — it is clipped to start below them on each page. Useful to keep
     * titles, prices and the document header readable.
     */
    watermarkAvoidHeader?: boolean;
    /** @deprecated legacy pattern name; mapped to {@link WatermarkLayout}. */
    patternType?: WatermarkPattern | string;
    pageHeader?: PdfPageTemplateOptions;
    pageFooter?: PdfPageTemplateOptions;
    pageNumbers?: boolean | PdfPageNumberOptions;
    protectPdf?: boolean;
    qpdfPath?: string;
    onWarning?: (warning: RenderWarning) => void;
}
interface RenderHtmlToPdfResult {
    pdf: Uint8Array;
    warnings: RenderWarning[];
    pages: number;
    columns: number;
    orientation: PageOrientation;
}
interface ParsedDocument {
    brandText: string;
    contactItems: string[];
    contactQrSrc?: string;
    fontFaces: ParsedFontFace[];
    page?: ParsedPageRule;
    blocks: ParsedBlock[];
    primaryTable?: ParsedTable;
}
interface ParsedPageRule {
    size?: "A4" | "LETTER";
    orientation?: PageOrientation;
    marginMm?: number;
}
interface ParsedFontFace {
    family: string;
    srcs: string[];
    fontWeight?: string;
    fontStyle?: string;
}
interface ParsedInlineSegment {
    text: string;
    styles: Record<string, string>;
    href?: string;
    inlineBox?: boolean;
}
type ParsedChartType = "bar" | "horizontal-bar" | "stacked-bar" | "line" | "area" | "sparkline" | "pie" | "donut" | "gauge" | "radial" | "radial-stacked" | "radar";
interface ParsedChart {
    chartType: ParsedChartType;
    title?: string;
    subtitle?: string;
    labels: string[];
    values: number[];
    series?: number[][];
    seriesLabels?: string[];
    max?: number;
    center?: string;
    theme?: string;
    unit?: string;
    colors?: string[];
    gradient?: string[];
}
type ParsedBlock = {
    type: "heading";
    level: 1 | 2 | 3 | 4 | 5 | 6;
    text: string;
    inlines: ParsedInlineSegment[];
    style: Record<string, string>;
} | {
    type: "paragraph";
    text: string;
    inlines: ParsedInlineSegment[];
    style: Record<string, string>;
} | {
    type: "preformatted";
    text: string;
    inlines: ParsedInlineSegment[];
    style: Record<string, string>;
} | {
    type: "blockquote";
    text: string;
    inlines: ParsedInlineSegment[];
    style: Record<string, string>;
} | {
    type: "list-item";
    text: string;
    inlines: ParsedInlineSegment[];
    ordered: boolean;
    index: number;
    style: Record<string, string>;
} | {
    type: "image";
    src: string;
    alt: string;
    style: Record<string, string>;
} | {
    type: "chart";
    chart: ParsedChart;
    style: Record<string, string>;
} | {
    type: "grid";
    blocks: ParsedBlock[];
    style: Record<string, string>;
} | {
    type: "hr";
    style: Record<string, string>;
} | {
    type: "page-break";
    style: Record<string, string>;
} | {
    type: "table";
    table: ParsedTable;
    style: Record<string, string>;
};
interface ParsedTable {
    headRows: ParsedRow[];
    bodyRows: ParsedRow[];
    columnCount: number;
    columnStyles?: Record<string, string>[];
    repeatHeader?: boolean;
}
interface ParsedRow {
    cells: ParsedCell[];
    kind: "header" | "price" | "section" | "body";
    styles: Record<string, string>;
}
type ParsedCellBlock = {
    type: "box";
    blocks: ParsedCellBlock[];
    className: string;
    style: Record<string, string>;
} | {
    type: "text";
    text: string;
    inlines: ParsedInlineSegment[];
    style: Record<string, string>;
} | {
    type: "heading";
    level: 1 | 2 | 3 | 4 | 5 | 6;
    text: string;
    inlines: ParsedInlineSegment[];
    style: Record<string, string>;
} | {
    type: "image";
    src: string;
    alt: string;
    style: Record<string, string>;
};
interface ParsedCell {
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

interface PdfFontManifestFace {
    family: string;
    regularPath: string;
    boldPath?: string;
    italicPath?: string;
    boldItalicPath?: string;
    source?: string;
    license?: string;
}
interface PdfFontManifest {
    version: 1;
    generatedBy?: string;
    generatedAt?: string;
    defaultFamily?: string;
    fallbackFamilies?: string[];
    cssPath?: string;
    fonts: PdfFontManifestFace[];
}
interface LoadFontManifestOptions {
    defaultFamily?: string;
    fallbackFonts?: string[];
}
declare function fontOptionsFromManifest(manifest: PdfFontManifest, manifestDir?: string, options?: LoadFontManifestOptions): PdfFontOptions;
declare function loadFontManifest(manifestPath: string, options?: LoadFontManifestOptions): Promise<PdfFontOptions>;

type ChartDashboardValue = number | string;
type ChartDashboardList = string | readonly ChartDashboardValue[];
type ChartDashboardSeries = string | readonly (readonly ChartDashboardValue[])[];
interface ChartDashboardCard {
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
interface ChartDashboardOptions {
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
declare function createChartDashboardHtml(options: ChartDashboardOptions): string;

declare function parsePrintableHtml(html: string): ParsedDocument;

interface ConvertHtmlToPdfLiteOptions {
    htmlContent: string;
    baseUrl?: string;
    stylesheets?: RenderHtmlToPdfOptions["stylesheets"];
    resourcePolicy?: RenderHtmlToPdfOptions["resourcePolicy"];
    recordId?: string;
    repeatHeaders?: boolean;
    hideHeader?: boolean;
    watermarkText?: string | null;
    watermarkUrl?: string | null;
    userLogoUrl?: string | null;
    logoScale?: number;
    logoOffsetXMm?: number;
    logoOffsetYMm?: number;
    headerContacts?: RenderHtmlToPdfOptions["headerContacts"];
    watermarkScale?: number;
    watermarkOpacity?: number;
    patternType?: string;
    protectPdf?: boolean;
    qpdfPath?: string;
    font?: RenderHtmlToPdfOptions["font"];
    page?: RenderHtmlToPdfOptions["page"];
}
declare function convertHtmlToPdfDetailed(options: ConvertHtmlToPdfLiteOptions): Promise<RenderHtmlToPdfResult>;
declare function convertHtmlToPdf(options: ConvertHtmlToPdfLiteOptions): Promise<Buffer>;

declare function renderHtmlToPdfDetailed(options: RenderHtmlToPdfOptions): Promise<RenderHtmlToPdfResult>;
declare function renderHtmlToPdf(options: RenderHtmlToPdfOptions): Promise<Uint8Array>;

declare function calculateFontScale(columns: number): number;
declare function calculatePaddingScale(columns: number): number;
declare function calculateHeaderCellHeight(columns: number): number;
declare function determineOrientation(columns: number): "portrait" | "landscape";

declare class WarningSink {
    private readonly handler?;
    readonly warnings: RenderWarning[];
    constructor(handler?: ((warning: RenderWarning) => void) | undefined);
    add(code: string, message: string): void;
}

/**
 * Google Fonts resolver with disk cache.
 *
 * Downloads .ttf files from the Google Fonts CSS API and caches them to disk.
 * Returns **file paths**, not byte arrays, so the PDF renderer reads from disk
 * and the module itself adds zero persistent memory pressure.
 *
 * Cache directory: `~/.cache/html2pdfsmith/fonts/`
 * (or `LOCALAPPDATA/html2pdfsmith/fonts/` on Windows)
 */

interface GoogleFontPaths {
    regularPath: string;
    boldPath: string;
    italicPath?: string;
    boldItalicPath?: string;
}
/**
 * Resolve a Google Fonts family name to local .ttf file paths.
 *
 * - First render: downloads regular (400) + bold (700) TTFs → saves to disk cache.
 * - Subsequent renders: returns cached paths instantly, zero network, zero extra RAM.
 *
 * @param family  Google Fonts family name, e.g. "Inter", "Roboto", "Noto Sans"
 * @param warnings  Warning sink for non-fatal issues
 * @returns File paths to cached .ttf files
 */
declare function resolveGoogleFont(family: string, warnings: WarningSink): Promise<GoogleFontPaths | null>;
/**
 * Check if a Google Font is already cached (no network call).
 */
declare function isGoogleFontCached(family: string): boolean;
/**
 * Get the cache directory path (for diagnostics / cleanup).
 */
declare function getGoogleFontCacheDir(): string;

/**
 * Resolve the font file paths from all possible sources, in priority order:
 * 1. Explicit `regularPath`/`boldPath` (user-provided)
 * 2. Bundled fonts from an optional package (offline, no network)
 * 3. Google Fonts `googleFont` (downloaded once, cached to disk)
 * 4. Auto-discover system fonts (`autoDiscover: true`)
 * 5. Fallback (returns empty → renderer uses Helvetica)
 *
 * Google Fonts paths are cached to disk, so after the first download this
 * function is just two `existsSync()` calls — zero network, zero extra RAM.
 */
declare function resolveFontPaths(fontOptions: PdfFontOptions | undefined, warnings: WarningSink, resourcePolicy?: PdfResourcePolicy): Promise<{
    regularPath?: string;
    boldPath?: string;
    italicPath?: string;
    boldItalicPath?: string;
}>;

/** Largest header-logo nudge accepted, in mm, on either axis. */
declare const HEADER_LOGO_MAX_OFFSET_MM = 20;
interface HeaderLogoBoxInput {
    /** Logo size knob, 1..200 (100 = default). */
    logoScale?: number | undefined;
    /** Content (table) width in pt — the band the logo is anchored within. */
    contentWidthPt: number;
    /** Header band height in pt. */
    headerHeightPt: number;
    /** Page margin in pt — how much room exists left of / above the anchor. */
    marginPt: number;
    /** Horizontal nudge from the left anchor, in mm (clamped to ±{@link HEADER_LOGO_MAX_OFFSET_MM}). */
    offsetXMm?: number | undefined;
    /** Vertical nudge from the header top, in mm (clamped to ±{@link HEADER_LOGO_MAX_OFFSET_MM}). */
    offsetYMm?: number | undefined;
}
interface HeaderLogoBox {
    /** Horizontal nudge applied to the left anchor, in pt. */
    xOffsetPt: number;
    /** Vertical nudge applied to the top anchor, in pt. */
    yOffsetPt: number;
    /** Logo box width in pt (object-fit: contain inside this box). */
    widthPt: number;
    /** Logo box height in pt. */
    heightPt: number;
}
/**
 * Single source of truth for the header-logo geometry. The PDF renderer and the
 * client preview both derive the logo box from this so what users arrange in the
 * editor matches the generated PDF. The box is anchored at the header's top-left
 * (`margin`, `top`); offsets nudge it from there. At offset 0 the box matches the
 * historical output (`width = 60 + logoScale*1.8`, `height = min(42, header-4)`).
 */
declare function headerLogoBox(input: HeaderLogoBoxInput): HeaderLogoBox;

declare function protectPdfWithQpdf(pdf: Uint8Array, qpdfPath?: string): Promise<Uint8Array>;

/**
 * Base class for all html2pdfsmith errors.
 */
declare class Html2PdfError extends Error {
    constructor(message: string);
}
/**
 * Thrown when a resource (image, css, font) is blocked by the configured resourcePolicy,
 * or exceeds size limits.
 */
declare class ResourcePolicyError extends Html2PdfError {
    constructor(message: string);
}
/**
 * Thrown when a network request for a resource or font fails (e.g. HTTP 404 or timeout).
 */
declare class ResourceLoadError extends Html2PdfError {
    constructor(message: string);
}
/**
 * Thrown when there is an issue resolving or fetching Google Fonts.
 */
declare class FontLoadError extends Html2PdfError {
    constructor(message: string);
}
/**
 * Thrown when qpdf fails to protect the document.
 */
declare class PdfProtectionError extends Html2PdfError {
    constructor(message: string);
}

export { type ChartDashboardCard, type ChartDashboardList, type ChartDashboardOptions, type ChartDashboardSeries, type ChartDashboardValue, FontLoadError, HEADER_LOGO_MAX_OFFSET_MM, type HeaderContactIcon, type HeaderContactItem, type HeaderContacts, type HeaderContactsQr, type HeaderLogoBox, type HeaderLogoBoxInput, Html2PdfError, type LoadFontManifestOptions, type PageOrientation, type ParsedCell, type ParsedChart, type ParsedChartType, type ParsedDocument, type ParsedFontFace, type ParsedPageRule, type ParsedRow, type ParsedTable, type PdfBundledFontFace, type PdfFallbackFontPath, type PdfFontManifest, type PdfFontManifestFace, type PdfFontOptions, type PdfPageOptions, PdfProtectionError, type PdfResourcePolicy, type PdfStylesheet, type PdfStylesheetInput, type PdfTableOptions, type PdfTextOptions, type RenderHtmlToPdfOptions, type RenderHtmlToPdfResult, type RenderWarning, ResourceLoadError, ResourcePolicyError, type TableCellPagination, type TableDensity, type TableFit, type TableHeaderRepeat, type TableHorizontalPagination, type TablePreset, type TableRowspanPagination, type TableVerticalAlignMode, type TextOverflowWrap, type WatermarkLayer, type WatermarkLayout, type WatermarkPattern, calculateFontScale, calculateHeaderCellHeight, calculatePaddingScale, convertHtmlToPdf, convertHtmlToPdfDetailed, createChartDashboardHtml, determineOrientation, fontOptionsFromManifest, getGoogleFontCacheDir, headerLogoBox, isGoogleFontCached, loadFontManifest, parsePrintableHtml, protectPdfWithQpdf, renderHtmlToPdf, renderHtmlToPdfDetailed, resolveFontPaths, resolveGoogleFont };
