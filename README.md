<p align="center">
  <img src="https://raw.githubusercontent.com/YATSKOVSKYI/html2pdfsmith/main/.github/assets/html2pdfsmith-banner.png" alt="Html2PdfSmith" width="860"/>
</p>

<p align="center">
  <strong>Browserless HTML-to-PDF rendering engine for TypeScript, Node.js, and Bun.</strong><br/>
  <sub>HTML in. PDF out. No Chromium, no Playwright, no headless browser process.</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/html2pdfsmith"><img src="https://img.shields.io/npm/v/html2pdfsmith?style=flat-square&color=cb3837&logo=npm&logoColor=white" alt="npm"/></a>
  <a href="#quickstart"><img src="https://img.shields.io/badge/Node.js-%3E%3D18.17-5fa04e?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 18.17"/></a>
  <a href="#quickstart"><img src="https://img.shields.io/badge/Bun-%3E%3D1.2.0-f472b6?style=flat-square&logo=bun&logoColor=white" alt="Bun >= 1.2.0"/></a>
  <a href="#api"><img src="https://img.shields.io/badge/TypeScript-first-3178c6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript first"/></a>
  <a href="#performance"><img src="https://img.shields.io/badge/incremental_RSS-~63_MB-22c55e?style=flat-square" alt="~63 MB incremental RSS"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-818cf8?style=flat-square" alt="MIT"/></a>
</p>

---

## Why

Most HTML-to-PDF stacks render through Chromium. That gives broad web compatibility, but it also brings browser startup, large binaries, and high memory use.

Html2PdfSmith is a different tradeoff: it is a document renderer for predictable printable HTML. It parses HTML, applies a pragmatic print-focused CSS subset, lays out pages, and writes PDF directly through a streaming PDFKit pipeline.

| Area | Browser-based renderers | Html2PdfSmith |
|---|---:|---:|
| Runtime | Chromium / Playwright / Puppeteer | Node.js or Bun + PDFKit |
| Memory model | Browser process per render or pool | Streaming PDF writer |
| Best fit | Arbitrary web pages | Reports, invoices, tables, branded PDFs |
| JavaScript execution | Yes | No |
| CSS scope | Browser CSS engine | Practical document CSS subset |
| Typical benchmark | Hundreds of MB RSS | ~63 MB incremental RSS for 10x100 table |

Html2PdfSmith is not trying to be a full browser. It is trying to be a small, controllable, production-friendly HTML-to-PDF engine.

Use it when you own the template and want stable PDF output for reports, invoices, tables, dashboards, statements, price lists, or branded printable documents. Do not use it to screenshot arbitrary websites, run client-side JavaScript, or expect browser-perfect CSS compatibility.

## Features

- Browserless renderer: no Chromium, no Puppeteer, no Playwright, no DOM runtime.
- Streaming PDF output through PDFKit with a low-memory render path.
- A4 and Letter pages with portrait, landscape, or automatic orientation.
- Page headers, page footers, text/image watermarks, and streaming page numbers.
- Document blocks: headings, paragraphs, sections, lists, blockquotes, `pre`/`code`, links, images, horizontal rules, and page breaks.
- Inline rich text: `strong`, `em`, `u`, `s`, `sup`, `sub`, inline `code`, links, styled spans, and inline badge/chip boxes.
- Practical CSS support for print documents: margins, padding, borders, colors, backgrounds, border radius, shadows, line-height, text alignment, text transforms, overflow wrapping, nowrap, pre-wrap, and ellipsis.
- Lightweight document grids with `display: grid`, `grid-template-columns`, `gap`, `row-gap`, and `column-gap`.
- Production table rendering: repeated headers, `thead`/`tbody`/`tfoot`, `colgroup`, `colspan`, basic `rowspan`, fixed and auto table layout, vertical alignment, per-side borders, and row/cell heights.
- Wide table pagination: split very wide tables into horizontal page slices with repeated left columns.
- Rich table cells with nested boxes, headings, paragraphs, images, clipped rounded content, and bounded absolute badges.
- Images from PNG, JPEG, SVG, data URLs, local files, and HTTP(S) URLs, including aspect-ratio handling, `object-fit`, `object-position`, opacity, and PDF-native transforms.
- Browserless charts through declarative `<chart>` blocks: bar, horizontal-bar, stacked-bar, line, area, sparkline, pie, donut, gauge, radial, radial-stacked, and radar.
- Fonts through explicit file paths, in-memory bytes, CSS `@font-face`, optional bundled fonts, optional Google Fonts disk cache, project-local font installs, and optional system font discovery.
- Resource loading policy for HTTP/file/data access, timeouts, and max CSS/image/font sizes.
- Optional `qpdf` owner-password protection.
- Warnings API for non-fatal rendering issues.

## Quickstart

Html2PdfSmith works as an ESM package in Node.js `>=18.17.0` and Bun `>=1.2.0`. The library returns standard `Uint8Array` PDF bytes; the repository's development scripts and examples use Bun for speed and convenience.

```bash
npm install html2pdfsmith
# or
bun add html2pdfsmith
```

```ts
import { renderHtmlToPdf } from "html2pdfsmith";
import { writeFile } from "node:fs/promises";

const pdf = await renderHtmlToPdf({
  html: `
    <!doctype html>
    <html>
      <body>
        <h1>Quarterly Report</h1>
        <p>Revenue increased compared with the previous quarter.</p>

        <table>
          <thead>
            <tr><th>Metric</th><th>Q1</th><th>Q2</th></tr>
          </thead>
          <tbody>
            <tr><td>Revenue</td><td>$1.2M</td><td>$1.4M</td></tr>
            <tr><td>Users</td><td>8,400</td><td>12,100</td></tr>
          </tbody>
        </table>
      </body>
    </html>
  `,
});

await writeFile("report.pdf", pdf);
```

## Full Example

```ts
import { renderHtmlToPdfDetailed } from "html2pdfsmith";
import { writeFile } from "node:fs/promises";

const result = await renderHtmlToPdfDetailed({
  html,
  baseUrl: "./public",
  stylesheets: ["./pdf.css"],
  resourcePolicy: { allowHttp: false, allowFile: true },
  repeatHeaders: true,
  tableHeaderRepeat: "auto",
  text: { overflowWrap: "break-word" },
  page: { size: "A4", orientation: "landscape", marginMm: 4 },
  pageHeader: { text: "Quarterly Report", align: "right" },
  pageFooter: { text: "Generated by Html2PdfSmith", align: "left" },
  pageNumbers: { format: "Page {page}", align: "right" },
  watermarkText: "CONFIDENTIAL",
  watermarkOpacity: 12,
  watermarkLayer: "foreground",
  font: { googleFont: "Inter" },
});

console.log(result.pages, result.orientation, result.warnings);
await writeFile("report.pdf", result.pdf);
```

## API

### `renderHtmlToPdf(options)`

Returns raw PDF bytes as `Uint8Array`.

```ts
const pdf = await renderHtmlToPdf({ html });
```

### `renderHtmlToPdfDetailed(options)`

Returns PDF bytes plus render metadata.

```ts
interface RenderHtmlToPdfResult {
  pdf: Uint8Array;
  warnings: RenderWarning[];
  pages: number;
  columns: number;
  orientation: "portrait" | "landscape";
}
```

### Options

| Option | Type | Description |
|---|---|---|
| `html` | `string` | HTML document string to render |
| `baseUrl` | `string` | Base URL or directory for relative assets such as CSS, images, SVGs, and fonts |
| `stylesheets` | `(string \| { href, content })[]` | Extra CSS files, URLs, or inline stylesheet content |
| `resourcePolicy` | `object` | Resource loading guardrails: HTTP/file/data access, timeout, max image/CSS/font bytes |
| `repeatHeaders` | `boolean` | Repeat table headers on page breaks |
| `tableHeaderRepeat` | `boolean \| "auto"` | Repeat table headers explicitly, or automatically for tables with headers |
| `table.rowspanPagination` | `"avoid" \| "split"` | Keep rowspan-connected rows together when they fit on a fresh page |
| `table.horizontalPagination` | `"none" \| "auto" \| "always"` | Split wide tables into several horizontal page slices |
| `table.horizontalPageColumns` | `number` | Maximum non-repeated source columns per horizontal slice |
| `table.repeatColumns` | `number` | Number of left-side source columns repeated in every horizontal slice |
| `table.cellPagination` | `"off" \| "text"` | Split oversized plain text table cells across vertical page fragments |
| `text.overflowWrap` | `"normal" \| "break-word" \| "anywhere"` | Break long unspaced words/tokens instead of clipping them |
| `page.size` | `"A4" \| "LETTER"` | PDF page size |
| `page.orientation` | `"portrait" \| "landscape" \| "auto"` | Page orientation |
| `page.marginMm` | `number` | Page margin in millimeters |
| `pageHeader` | `{ text, align, fontSize, color, heightMm }` | Repeated page header |
| `pageFooter` | `{ text, align, fontSize, color, heightMm }` | Repeated page footer |
| `pageNumbers` | `boolean \| object` | Streaming page numbers, for example `Page {page}` |
| `watermarkText` | `string \| null` | Text watermark |
| `watermarkUrl` | `string \| null` | Image watermark |
| `watermarkOpacity` | `number` | Watermark opacity, `0..100` or `0..1` |
| `watermarkScale` | `number` | Watermark size scale |
| `watermarkLayer` | `"background" \| "foreground" \| "both"` | Draw watermark behind content, above content, or both |
| `patternType` | `string` | Watermark pattern hint |
| `userLogoUrl` | `string \| null` | Logo image for the document header |
| `logoScale` | `number` | Logo image size scale |
| `font.googleFont` | `string` | Google Fonts family name, cached to disk |
| `font.googleFonts` | `string[]` | Additional Google Fonts selectable with CSS `font-family` |
| `font.fallbackFonts` | `string[]` | Additional Google Font families used when the selected font does not cover the text |
| `font.fallbackFontPaths` | `{ family, regularPath, boldPath? }[]` | Additional local fallback font families selectable by CSS and coverage fallback |
| `font.bundled` | `PdfBundledFontFace` | Default offline font from an optional bundled-font package |
| `font.bundledFonts` | `PdfBundledFontFace[]` | Additional offline fonts selectable with CSS `font-family` |
| `font.regularPath` | `string` | Path to regular font |
| `font.boldPath` | `string` | Path to bold font |
| `font.italicPath` | `string` | Path to italic font |
| `font.boldItalicPath` | `string` | Path to bold italic font |
| `font.regularBytes` | `Uint8Array` | Regular font bytes |
| `font.boldBytes` | `Uint8Array` | Bold font bytes |
| `font.italicBytes` | `Uint8Array` | Italic font bytes |
| `font.boldItalicBytes` | `Uint8Array` | Bold italic font bytes |
| `font.autoDiscover` | `boolean` | Discover system fonts; convenient but heavier |
| `protectPdf` | `boolean` | Apply optional qpdf owner-password protection |
| `qpdfPath` | `string` | Custom qpdf binary path |
| `hideHeader` | `boolean` | Hide document brand/contact header |
| `onWarning` | `(warning) => void` | Receive non-fatal render warnings |

`{total}` page counts are intentionally not resolved by the default streaming renderer. Use `{page}` for low-memory page numbers. Total page counts require buffering pages or a second pass.

### Error Handling

Html2PdfSmith separates fatal render failures from recoverable document problems.

Most template/resource issues are non-fatal. The renderer keeps producing a PDF and reports them through `result.warnings` and the optional `onWarning` callback:

```ts
const result = await renderHtmlToPdfDetailed({
  html,
  baseUrl: "./public",
  resourcePolicy: { allowHttp: false, allowFile: true },
  onWarning(warning) {
    console.warn(`[${warning.code}] ${warning.message}`);
  },
});

if (result.warnings.length > 0) {
  // Store, inspect, or fail your own job depending on policy.
}
```

Common warning cases:

| Warning | Meaning |
|---|---|
| `font_fallback` | No usable custom font was registered, so the renderer fell back to a built-in PDF font |
| `font_register_failed` / `font_face_register_failed` | A configured font path, font bytes, or CSS `@font-face` could not be registered |
| `google_font_download_failed` | Google Fonts could not be downloaded; cached or fallback fonts may be used instead |
| `image_load_failed` / `image_embed_failed` / `image_draw_failed` | An image was blocked, missing, unsupported, or failed during PDF drawing |
| `stylesheet_load_failed` | A linked or configured stylesheet could not be loaded |
| `page_total_unsupported_streaming` | `{total}` was requested in page numbers; streaming mode keeps memory low and prints `?` |
| `table_row_too_tall` | A table row is taller than a fresh page and must be rendered sequentially |
| `table_rowspan_group_too_tall` | Rows connected by `rowspan` cannot fit together on a fresh page |
| `table_colspan_horizontal_split` | A wide `colspan` crossed a horizontal table slice boundary |
| `qpdf_failed` | PDF protection failed; the unprotected PDF is returned with a warning |

Resource policy failures are warnings by default. For example, if `allowHttp: false` blocks an HTTP image, the image is omitted and the PDF still renders. If your production policy must fail closed, throw from `onWarning`:

```ts
await renderHtmlToPdfDetailed({
  html,
  resourcePolicy: { allowHttp: false, allowFile: true, allowData: true },
  onWarning(warning) {
    if (
      warning.code.endsWith("_load_failed") ||
      warning.code === "qpdf_failed" ||
      warning.code === "font_fallback"
    ) {
      throw new Error(`PDF render rejected: ${warning.code}: ${warning.message}`);
    }
  },
});
```

A runnable version of this pattern is included:

```bash
bun run example:error-handling
```

Unexpected renderer bugs, invalid runtime state, and exceptions thrown from your own `onWarning` callback reject the render promise. The package exports error classes for callers that want typed handling:

```ts
import {
  Html2PdfError,
  ResourcePolicyError,
  ResourceLoadError,
  FontLoadError,
  PdfProtectionError,
  renderHtmlToPdfDetailed,
} from "html2pdfsmith";
import { writeFile } from "node:fs/promises";

try {
  const result = await renderHtmlToPdfDetailed({ html });
  await writeFile("report.pdf", result.pdf);
} catch (error) {
  if (error instanceof Html2PdfError) {
    console.error(error.name, error.message);
  }
  throw error;
}
```

### Resource Loading

Use `baseUrl` when the HTML contains relative resources:

```ts
const result = await renderHtmlToPdfDetailed({
  html: `
    <link rel="stylesheet" href="assets/report.css">
    <img src="assets/logo.svg">
  `,
  baseUrl: "/srv/app/public",
  resourcePolicy: {
    allowHttp: false,
    allowFile: true,
    allowData: true,
    timeoutMs: 8000,
    maxImageBytes: 5_000_000,
    maxStylesheetBytes: 500_000,
    maxFontBytes: 10_000_000,
  },
});
```

The renderer takes finished HTML. TypeScript is only the caller; it does not have to build the PDF structure. A file-based render can be as small as:

```ts
import { dirname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { renderHtmlToPdfDetailed } from "html2pdfsmith";

const input = "/srv/templates/comparison.html";
const html = await readFile(input, "utf8");
const result = await renderHtmlToPdfDetailed({
  html,
  baseUrl: dirname(input),
  resourcePolicy: { allowFile: true, allowData: true },
});

await writeFile("comparison.pdf", result.pdf);
```

You can also pass stylesheets explicitly:

```ts
await renderHtmlToPdfDetailed({
  html,
  baseUrl: "./public",
  stylesheets: [
    "./pdf.css",
    { content: "table { border-collapse: collapse }" },
  ],
});
```

External CSS can declare fonts with `@font-face`. Font URLs are resolved relative to the stylesheet file, then loaded through the same resource policy:

```css
@font-face {
  font-family: "Report Sans";
  src: url("./fonts/ReportSans-Regular.ttf") format("truetype");
  font-weight: 400;
  font-style: normal;
}

@font-face {
  font-family: "Report Sans";
  src: url("./fonts/ReportSans-BoldItalic.ttf") format("truetype");
  font-weight: 700;
  font-style: italic;
}

body { font-family: "Report Sans"; }
```

## Supported HTML

Html2PdfSmith supports a document-oriented HTML subset:

- `html`, `head`, `body`
- `title`
- `header` with `.brand-name`
- `div`, `section`, `article`, `main`, `aside`
- `h1` through `h6`
- `p`, `address`, `blockquote`, `pre`, `code`
- `strong`, `b`, `em`, `i`, `u`, `s`, `del`, `sup`, `sub`, `span`, `a`
- `ul`, `ol`, `li`
- `table`, `thead`, `tbody`, `tfoot`, `colgroup`, `col`, `tr`, `th`, `td`
- `img`, `hr`, `br`
- `chart` for built-in PDF-rendered charts: bar, horizontal-bar, stacked-bar, line, area, sparkline, pie, donut, gauge, radial, radial-stacked, and radar
- `link rel="stylesheet"`, `style`
- text nodes

Unsupported elements are traversed when possible. Unsupported CSS is ignored rather than failing the render.

## Supported CSS

The CSS support is intentionally pragmatic:

- selector support: tag, class, id, combined simple selectors, and descendant selectors such as `table td`
- print media support through `@media print` and `@media all`
- `font-family` for registered, bundled, and Google Fonts
- `font-size`
- `font-weight`
- `font-style: italic`
- `color`
- `display: inline-block` and `display: inline-flex` for inline spans/chips
- `display: grid` for simple block grids
- `grid-template-columns`, including fixed lengths, percentages, `fr`, and `repeat(2, 1fr)`
- `gap`, `row-gap`, and `column-gap`
- `background-color`
- `background-image: url(...)`
- `background-size: cover`, `background-size: contain`, `background-size: auto`, and explicit sizes such as `32px 32px`
- `background-position` keywords such as `center center`, `left top`, `right bottom`
- `background-repeat: no-repeat`, `repeat`, `repeat-x`, `repeat-y`
- `text-align`
- `text-transform: uppercase`, `lowercase`, `capitalize`
- `vertical-align: top`, `vertical-align: middle`, `vertical-align: bottom` for table cells
- `vertical-align: super` and `vertical-align: sub` for inline text
- `baseline-shift` for inline text, including `super`, `sub`, percentages, and lengths
- `margin-top`
- `margin-bottom`
- `margin`, `margin-left`, `margin-right`
- `padding`, `padding-top`, `padding-right`, `padding-bottom`, `padding-left`
- `border`, `border-width`, `border-color`
- `border-style: solid`, `border-style: dashed`, `border-style: dotted`, `border-style: none`
- `border-top`, `border-right`, `border-bottom`, `border-left`
- `border-*-width`, `border-*-style`, `border-*-color`
- `line-height`
- `text-decoration`
- `border-collapse: collapse`
- `table-layout: fixed`
- `table-layout: auto` with content-based column width estimation
- `colgroup` / `col style="width: ..."` for table column widths
- `width`, `height` for images and tables
- `height`, `min-height` for table rows and cells
- `height`, `width`, `margin`, `padding`, `border`, `border-radius`, `background-color`, `box-shadow`, `font-size`, and `color` for `<chart>` blocks
- `border-radius` for text boxes and table cells, including four-value shorthand and `border-*-radius`
- `padding`, `border`, `border-radius`, and `background-color` for inline `span` badges/chips
- `box-shadow` with multiple comma-separated layers, blur, spread, negative spread, `none`, and basic `inset`
- `object-fit: contain`, `object-fit: cover`, `object-fit: fill` for images in table cells
- `object-position` keywords such as `left top`, `center center`, `right bottom`
- `opacity` for images
- `transform` and `-webkit-transform` for images: `rotate`, `scale`, `scaleX`, `scaleY`, `translate`, `translateX`, `translateY`
- `transform-origin` and `-webkit-transform-origin` for image transforms
- `display: none`
- `visibility: hidden`
- bounded rich-cell `position: relative` containers and `position: absolute` children with `top`, `right`, `bottom`, `left`
- `overflow: hidden` for rounded/clipped boxes and table-cell content
- `page-break-before`, `page-break-after`, `break-before`, `break-after`
- CSS `@page { size: A4 landscape; margin: 8mm }`
- CSS `@font-face { font-family: ...; src: url(...) }` for custom fonts loaded from external stylesheets
- `overflow-wrap: break-word`, `overflow-wrap: anywhere`, `word-break: break-word`, `word-break: break-all`
- `white-space: nowrap`, `white-space: pre-line`, `white-space: pre-wrap`
- `text-overflow: ellipsis` with `white-space: nowrap`
- `thead { display: table-header-group }` for repeated table headers on page breaks

Out of scope for now:

- arbitrary web pages
- JavaScript execution
- full Flexbox layout
- full browser-compatible CSS Grid; only the lightweight document grid described above is supported
- general fixed/absolute page positioning; only bounded rich-cell absolute badges are supported
- CSS animations and browser visual effects
- full browser-compatible cascade and layout

## Paged Documents

Html2PdfSmith supports a practical subset of CSS paged media:

```css
@page {
  size: A4 landscape;
  margin: 8mm;
}
```

Explicit API options still win when both are present:

```ts
await renderHtmlToPdfDetailed({
  html,
  page: { size: "A4", orientation: "landscape", marginMm: 8 },
});
```

Table headers can repeat on page breaks through API options or CSS:

```ts
await renderHtmlToPdfDetailed({
  html,
  tableHeaderRepeat: "auto",
  table: { rowspanPagination: "avoid", cellPagination: "text" },
});
```

```css
thead {
  display: table-header-group;
}
```

`table.cellPagination: "text"` lets an oversized non-rowspan row continue across pages by splitting plain text and inline-styled cell content line by line. Each continuation fragment keeps cell padding, background, borders, and header repetition. Rich blocks and images are kept whole; if they cannot fit in a fragment, the renderer emits a warning and uses the existing clipped fallback.

Long unspaced tokens can be wrapped instead of clipped:

```ts
await renderHtmlToPdfDetailed({
  html,
  text: { overflowWrap: "break-word" },
});
```

```css
td {
  overflow-wrap: anywhere;
}
```

Tall table cells can align content horizontally and vertically:

```css
td.logo {
  height: 80px;
  text-align: center;
  vertical-align: middle;
}

td.logo img {
  width: 42px;
  height: 42px;
  object-fit: contain;
  object-position: center center;
}
```

Images can be transformed without relying on a browser engine:

```css
td.mirror img {
  transform: scaleX(-1);
  transform-origin: center center;
}

td.apple-template img {
  -webkit-transform: rotate(-18deg) scale(1.1);
  -webkit-transform-origin: center center;
  opacity: 0.65;
}
```

The `-webkit-*` aliases are parsed for Safari/Apple-authored templates, but the render path is the same cross-platform PDF transform engine on Windows, Linux, macOS, and Bun runtimes.

Tables can use fixed column widths and text overflow controls:

```html
<table>
  <colgroup>
    <col style="width: 90px">
    <col style="width: 180px">
    <col style="width: 35%">
    <col>
  </colgroup>
  ...
</table>
```

```css
table {
  table-layout: fixed;
}

td.vin {
  white-space: nowrap;
}

td.title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

td.custom-border {
  border-left: 3px solid #2563eb;
  border-right: 2px dashed #d97706;
  border-bottom: 2px dotted #059669;
}
```

Cells and document boxes can use lightweight visual styling:

```css
.card {
  padding: 12px 16px;
  border-radius: 8px;
  background-color: #ffffff;
  background-image: url("./pattern.svg");
  background-size: 48px 48px;
  background-repeat: repeat;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.22);
  text-transform: capitalize;
}

td.status {
  border-radius: 6px;
  background-color: #dcfce7;
  text-transform: uppercase;
}
```

For merged table cells, the renderer groups rows connected by `rowspan` and keeps that group on one page whenever it fits on a fresh page. A section row immediately before a rowspan group, such as `<tr><td colspan="5">Section</td></tr>`, is kept with that group too. If the merged group is taller than a fresh page, Html2PdfSmith renders it sequentially and emits a warning instead of silently hiding the edge case.

Wide tables can be split horizontally without using a browser:

```ts
await renderHtmlToPdfDetailed({
  html,
  tableHeaderRepeat: "auto",
  table: {
    horizontalPagination: "always",
    horizontalPageColumns: 5,
    repeatColumns: 2,
    rowspanPagination: "avoid",
  },
});
```

With this mode Html2PdfSmith renders the table as multiple column slices. The first `repeatColumns` source columns are pinned on every slice, `thead` is repeated on every vertical page, rowspans keep their pagination behavior inside each slice, and body colspans push the horizontal break forward when they can fit in the current slice. If a body `colspan` is still too wide and crosses a horizontal slice boundary, the renderer clips it to the visible columns and emits a warning so the caller can decide whether the source table should be adjusted.

## Charts

Charts are rendered directly into the PDF stream. They do not require Canvas, SVG generation, JavaScript execution, or a browser:

```html
<chart
  type="bar"
  title="Memory profile"
  subtitle="Warm process, render delta, and peak RSS"
  unit=" MB"
  data-labels="Warm RSS,Render Delta,Peak RSS"
  data-values="250,116,366"
  data-colors="#334155,#2563eb,#0f766e">
</chart>
```

Supported chart types are `bar`, `horizontal-bar`, `stacked-bar`, `line`, `area`, `sparkline`, `pie`, `donut`, `gauge`, `radial`, `radial-stacked`, and `radar`. Chart blocks accept normal document styling such as `width`, `height`, `margin`, `padding`, `border`, `border-radius`, `background-color`, `box-shadow`, `font-size`, and `color`.

Built-in chart themes are available through `data-theme`: `default`, `aurora`, `emerald`, `graphite`, `royal`, `sunset`, and `ocean`. Explicit `data-colors` always override the theme palette.

Line, area and sparkline charts support multiple series through `data-series`:

```html
<chart
  type="area"
  title="Traffic"
  data-theme="ocean"
  data-labels="Apr 5,Apr 10,Apr 15,Apr 20"
  data-series-labels="Desktop,Mobile"
  data-series="42,38,45,51|24,28,26,35">
</chart>
```

Horizontal bars, stacked bars, pie charts, gauges and sparklines use the same declarative data attributes:

```html
<chart
  type="horizontal-bar"
  title="Feature score"
  unit="%"
  data-max="100"
  data-labels="Tables,Grid,Fonts,SVG"
  data-values="94,78,86,74"
  data-colors="#2563eb,#0f766e,#f59e0b,#7c3aed">
</chart>

<chart
  type="stacked-bar"
  title="Memory classes"
  data-labels="Warm,Measured,Final"
  data-series-labels="Heap,External,Buffers"
  data-series="34,38,39|18,21,19|2,3,2"
  data-colors="#2563eb,#93c5fd,#0f766e">
</chart>

<chart
  type="sparkline"
  title="Render trend"
  unit=" ms"
  data-theme="royal"
  data-series-labels="Current,Previous"
  data-series="95,88,93,84,87,81|101,97,96,89,91,86">
</chart>
```

Radial charts support `data-max` for the scale and `data-center` for the centered KPI value:

```html
<chart
  type="radial"
  title="Radial Chart"
  unit="%"
  data-max="100"
  data-center="84"
  data-labels="Tables,Fonts,SVG,Charts"
  data-values="92,86,74,88"
  data-colors="#2563eb,#0f766e,#f59e0b,#7c3aed">
</chart>
```

Stacked radial gauges render segmented semicircle progress:

```html
<chart
  type="radial-stacked"
  title="Runtime memory mix"
  unit=" MB"
  data-labels="Heap,External,Buffers"
  data-values="38,19,2"
  data-colors="#2563eb,#93c5fd,#0f766e">
</chart>
```

Radar charts support multiple series through `data-series` and `data-series-labels`:

```html
<chart
  type="radar"
  title="Radar Chart"
  data-max="100"
  data-labels="Layout,Tables,Fonts,SVG,Charts,Memory"
  data-series-labels="Desktop,Mobile"
  data-series="84,92,88,72,90,76|68,78,82,64,74,91"
  data-colors="#93c5fd,#2563eb">
</chart>
```

Charts and other block content can be placed in a lightweight CSS Grid:

```html
<div class="chart-grid">
  <chart type="line" title="Trend" data-labels="A,B,C" data-values="10,18,14"></chart>
  <chart type="donut" title="Mix" data-labels="A,B,C" data-values="34,18,2"></chart>
</div>
```

```css
.chart-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
```

For TypeScript callers that build report HTML from data, `createChartDashboardHtml` generates a reusable chart dashboard fragment:

```ts
import { createChartDashboardHtml, renderHtmlToPdf } from "html2pdfsmith";

const dashboard = createChartDashboardHtml({
  title: "Benchmark Intelligence",
  lead: "Memory, throughput, density and budget in one PDF-ready dashboard.",
  columns: 3,
  charts: [
    {
      type: "bar",
      title: "Memory envelope",
      subtitle: "Warm, render delta and peak RSS",
      unit: " MB",
      theme: "ocean",
      labels: ["Warm", "Render", "Peak"],
      values: [254, 105, 360],
    },
    {
      type: "donut",
      title: "Runtime split",
      subtitle: "Heap, external and buffers",
      unit: " MB",
      theme: "emerald",
      labels: ["Heap", "External", "Buffers"],
      values: [36, 19, 2],
    },
  ],
});

const pdf = await renderHtmlToPdf({
  html: `<!doctype html><html><body>${dashboard}</body></html>`,
});
```

## Additional Exports

Besides the main `renderHtmlToPdf` and `renderHtmlToPdfDetailed` functions, the library exports several utilities:

```ts
import {
  // Legacy compat wrappers (accept htmlContent instead of html)
  convertHtmlToPdf,
  convertHtmlToPdfDetailed,

  // HTML parser - returns the structured ParsedDocument
  parsePrintableHtml,

  // Dashboard HTML helper for reusable chart grids
  createChartDashboardHtml,

  // Google Fonts utilities
  resolveGoogleFont,
  isGoogleFontCached,
  getGoogleFontCacheDir,
  loadFontManifest,
  fontOptionsFromManifest,

  // PDF protection (requires qpdf in PATH or a custom path)
  protectPdfWithQpdf,

  // Font resolution
  resolveFontPaths,

  // Layout helpers
  calculateFontScale,
  calculateHeaderCellHeight,
  calculatePaddingScale,
  determineOrientation,
} from "html2pdfsmith";
```

All TypeScript types are also exported for consumers:

```ts
import type {
  RenderHtmlToPdfOptions,
  RenderHtmlToPdfResult,
  RenderWarning,
  PdfResourcePolicy,
  PdfFontOptions,
  PdfPageOptions,
  PdfTextOptions,
  PdfTableOptions,
  PdfBundledFontFace,
  PdfFallbackFontPath,
  PdfFontManifest,
  PdfFontManifestFace,
  LoadFontManifestOptions,
  ParsedDocument,
  ParsedTable,
  ParsedRow,
  ParsedCell,
  ChartDashboardCard,
  ChartDashboardOptions,
} from "html2pdfsmith";
```

## Fonts

For Latin-only documents, the default built-in PDF fonts are the lightest option.

For production documents, prefer bundled fonts, explicit fonts, or Google Fonts.

Bundled fonts are best when production must render offline without first-run network downloads:

```bash
bun add @html2pdfsmith/fonts
```

```ts
import { renderHtmlToPdfDetailed } from "html2pdfsmith";
import { bundledFonts } from "@html2pdfsmith/fonts";

const result = await renderHtmlToPdfDetailed({
  html,
  font: {
    bundled: bundledFonts.openSans,
    bundledFonts: [
      bundledFonts.ubuntu,
      bundledFonts.anton,
      bundledFonts.merriweather,
      bundledFonts.notoSans,
    ],
  },
});
```

Then CSS can select those families:

```css
h1 { font-family: "Anton"; }
td.note { font-family: "Ubuntu"; font-style: italic; }
td.body { font-family: "Open Sans"; }
```

The optional package currently includes Open Sans, Ubuntu, Anton, Roboto Condensed, Merriweather, and Noto Sans. It lives outside the core renderer so the main package stays small.

You can also install Google Fonts into your own project directory with the package CLI. This is useful when production must run offline, CI should be deterministic, or you want to commit reviewed font assets instead of relying on first-render downloads:

```bash
npx html2pdfsmith fonts install "Open Sans" "Anton" "Noto Sans SC" \
  --out ./assets/pdf-fonts \
  --default "Open Sans" \
  --fallback "Noto Sans SC"
```

The command downloads only the requested families. Families named in `--default` or `--fallback` are installed too, so fallback configuration cannot point at a missing local font by accident. It copies the regular, bold, italic, and bold italic files into `./assets/pdf-fonts`, and writes:

- `html2pdfsmith-fonts.json` - manifest for the renderer
- `fonts.css` - optional `@font-face` declarations
- `README.md` - short usage and licensing note

Use the manifest at runtime:

```ts
import { loadFontManifest, renderHtmlToPdfDetailed } from "html2pdfsmith";

const result = await renderHtmlToPdfDetailed({
  html,
  font: await loadFontManifest("./assets/pdf-fonts/html2pdfsmith-fonts.json"),
  resourcePolicy: { allowHttp: false },
});
```

Local installs are optional. Html2PdfSmith does not ship Google font files in the main package and does not create project font directories unless you run the CLI command.

Google Fonts are useful when you do not want to vendor fonts:

```ts
const pdf = await renderHtmlToPdf({
  html,
  font: { googleFont: "Inter" },
});
```

Multiple Google Fonts can be preloaded and selected inside tables with CSS:

```ts
const result = await renderHtmlToPdfDetailed({
  html,
  font: {
    googleFont: "Inter",
    googleFonts: ["Roboto", "Lato", "Merriweather"],
  },
});
```

```css
th { font-family: "Inter"; font-weight: 700; text-align: center; }
td.left { font-family: "Roboto"; text-align: left; padding-left: 14px; }
td.center { font-family: "Lato"; text-align: center; font-size: 11pt; }
td.money { font-family: "Merriweather"; text-align: right; font-weight: 700; }
```

Tables, flow blocks, inline spans, charts, watermarks, and page templates resolve CSS `font-family` through the same lightweight font resolver. The resolver respects the CSS stack, `font-weight`, and `font-style`, then falls back to the default regular/bold font when a family is unknown.

For branded and multilingual PDFs, register only the families you need:

```ts
const result = await renderHtmlToPdfDetailed({
  html,
  font: {
    googleFont: "Open Sans",
    googleFonts: ["Anton", "Noto Sans SC"],
    fallbackFonts: ["Noto Sans SC"],
  },
});
```

```css
body {
  font-family: "Open Sans", "Noto Sans SC", sans-serif;
}

.autocore-brand {
  font-family: "Anton", sans-serif;
}

table {
  font-family: "Open Sans", "Noto Sans SC", sans-serif;
}
```

Open Sans does not cover CJK text. When mixed text such as `Vehicle report / 车辆报告` is rendered with the stack above, Html2PdfSmith checks font coverage and uses the first configured fallback family that can cover the text. The current implementation performs coverage-aware whole-text fallback per inline segment/cell; it is intentionally small and keeps the path open for finer per-character font runs later.

Local fallback fonts can be registered without Google Fonts:

```ts
await renderHtmlToPdfDetailed({
  html,
  font: {
    regularPath: "/fonts/OpenSans-Regular.ttf",
    boldPath: "/fonts/OpenSans-Bold.ttf",
    fallbackFontPaths: [
      {
        family: "Noto Sans SC",
        regularPath: "/fonts/NotoSansSC-Regular.otf",
        boldPath: "/fonts/NotoSansSC-Bold.otf",
      },
    ],
  },
});
```

Runnable example:

```bash
bun run example:font-family-fallback
```

Google Fonts are downloaded on first use and cached to disk. Html2PdfSmith caches regular, bold, italic, and bold italic variants when the family provides them:

- Windows: `%LOCALAPPDATA%/html2pdfsmith/fonts`
- Linux/macOS: `$XDG_CACHE_HOME/html2pdfsmith/fonts` or `~/.cache/html2pdfsmith/fonts`
- Override: set `HTML2PDFSMITH_CACHE_DIR=/path/to/cache`

You can also pass explicit font files:

```ts
const pdf = await renderHtmlToPdf({
  html,
  font: {
    regularPath: "/fonts/NotoSans-Regular.ttf",
    boldPath: "/fonts/NotoSans-Bold.ttf",
  },
});
```

For low-memory production targets, avoid auto-discovering large CJK system fonts unless you need them.

## Performance

Current local benchmark on Windows/Bun for a 10-column, 100-row table with a text watermark:

```json
{
  "pages": 6,
  "ms": 192,
  "deltaPeakRssMb": 63.2
}
```

Run it locally:

```bash
bun run bench -- 10 100 --watermark
```

For a heavier visual benchmark, generate a styled 15-page HTML table document with SVGs, rich cells, rounded badges, sub/sup text, baseline shifts, repeated page chrome, a watermark, and an embedded final metrics page:

```bash
bun run bench:internal
```

Recent local `bench:internal` run:

```json
{
  "pages": 16,
  "measuredRenderMs": 743,
  "measuredDeltaPeakRssMb": 102.3,
  "finalRenderMs": 638,
  "finalDeltaPeakRssMb": 64.8
}
```

The internal benchmark reports memory in two ways:

- `peakRssMb`: total RSS of the current Bun process at peak.
- `deltaPeakRssMb`: additional RSS used during this render after the process is already warm.

This matters in production because Html2PdfSmith does not launch a separate Chromium process. Browser-based renderers must count both the server process and the browser process.

## Package Contents

The published npm package is intentionally small. The package includes the built `dist/` entrypoint and CLI, README, changelog, license, and the README logo. It does not ship examples, generated PDFs, visual regression PNGs, or local benchmark output.

Check the package before publishing:

```bash
npm pack --dry-run
```

Recent dry run:

```text
package size: 74.0 kB
unpacked size: 312.9 kB
total files: 10
```

## Development

```bash
bun install
bun run typecheck
bunx tsc --noEmit --noUnusedLocals --noUnusedParameters
bun run build
bun run smoke
bun run visual:update
bun run visual
npm pack --dry-run
```

Example scripts write generated PDFs to `tmp/pdfs/` so the `examples/` folder stays source-only:

```bash
bun run example
bun run example:css-table
bun run example:fonts
bun run example:bundled-fonts
bun run example:table-showcase
bun run example:resources
bun run example:font-face
bun run example:font-family-fallback
bun run example:page-wrap-repeat
bun run example:merged-table
bun run example:wide-table
bun run example:alignment
bun run example:transform
bun run example:layout
bun run example:visual-css
bun run example:production-layout
bun run example:inline-badges
bun run example:error-handling
bun run example:comparison-showcase
bun run example:html-file
bun run example:document
bun run bench -- 10 100 --watermark
bun run bench:internal
```

Visual regression tests require Poppler's `pdftoppm` command in `PATH`. Use `bun run visual:update` to refresh PNG baselines in `examples/visual-baselines/`, then `bun run visual` to compare current renders against them. Current renders and diff PNGs are written under `tmp/visual/`.

The GitHub Actions workflow runs the same guardrail set on Windows: typecheck, strict unused check, build, smoke, visual regression with Poppler, and `npm pack --dry-run`.

## License

MIT
