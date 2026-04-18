# Scope

`Html2PdfSmith` is a lightweight browserless HTML-to-PDF renderer for printable documents.

## Primary Use Cases

- comparison tables
- invoices and price lists
- reports
- specification tables
- simple contracts with tables
- branded PDF documents with logos and watermarks

## Supported First-Class Features

- A4 and Letter pages
- portrait, landscape, or automatic orientation
- repeated table headers
- large tables with many columns
- horizontal wide-table pagination with repeated left columns
- fixed table layout with `colgroup` column widths
- cell background colors for highlights
- cell and block background images
- rounded cells/blocks and simplified shadows
- section rows
- horizontal and vertical cell alignment
- text wrapping
- nowrap, pre-line/pre-wrap, and ellipsis text overflow
- row-level pagination with rowspan group avoidance
- PNG/JPEG images
- text and image watermarks
- repeated page header/footer text
- streaming page numbers with `{page}`
- custom fonts for Latin, Cyrillic, and CJK text
- CSS `@font-face` for custom fonts loaded from external stylesheets
- multiple Google Fonts via `font.googleFonts` and CSS `font-family`
- external linked stylesheets (`<link rel="stylesheet">`)
- CSS `@page` rules for page size and margins
- optional `qpdf` owner-password protection

## Current HTML Subset

- `header`
- `div`
- `section`, `article`, `main`, `aside`
- `h1` - `h6`
- `p`
- `blockquote`
- `pre`, `code`
- `strong`, `b`, `em`, `i`, `u`, `s`, `del`, `span`, `a`
- `ul`, `ol`, `li`
- `table`, `thead`, `tbody`, `tfoot`, `colgroup`, `col`, `tr`, `th`, `td`
- `br`
- `img`
- `hr`
- `link rel="stylesheet"`, `style`
- text nodes

## Current CSS Subset

CSS support is intentionally pragmatic. The renderer recognizes common class names and inline style hints used by printable table templates:

- section/header rows
- highlighted/diff cells
- parameter/label columns
- price/header cells
- simple background colors
- table `border`
- per-side table/cell borders with solid, dashed, dotted, and none styles
- table/cell `padding`
- table `border-collapse: collapse`
- table `table-layout: fixed` and `colgroup` widths
- `colspan`, `rowspan`, and merged-cell grid normalization
- body `colspan`-aware horizontal table breaks
- row-level `background-color`, `color`, `font-size`, and `text-align`
- row/cell `height`, `min-height`, and `vertical-align`
- `white-space` and `text-overflow`
- cell image `width`, `height`, `object-fit`, and `object-position`
- image `opacity`, `transform`, `transform-origin` for `rotate`, `scale`, `translate`
- `-webkit-transform` and `-webkit-transform-origin` aliases for Apple/Safari-authored templates (same cross-platform PDF engine on Windows, Linux, macOS)
- `background-image`, `background-size`, `background-position`, and `background-repeat`
- `border-radius`
- simplified `box-shadow`
- `text-transform`
- block `margin`, `padding`, and `border`
- `line-height`
- `text-decoration`
- `font-size`
- `font-family` for registered/default fonts, bundled fonts, and configured Google Fonts
- `font-weight`
- `font-style: italic`
- `color`
- `background-color`
- `text-align`
- `margin-top`
- `margin-bottom`
- image `width` and `height`
- `display: none`
- `visibility: hidden`
- `page-break-before`, `page-break-after`, `break-before`, `break-after`
- CSS `@page { size: A4 landscape; margin: 8mm }`
- CSS `@font-face { font-family: ...; src: url(...) }` for custom fonts
- `overflow-wrap`, `word-break`
- `white-space: nowrap`, `pre-line`, `pre-wrap`
- `text-overflow: ellipsis` with `white-space: nowrap`
- `thead { display: table-header-group }` for repeated headers

Full CSS cascade, Flexbox, Grid, JavaScript execution, and arbitrary website rendering are outside the first production target. `{total}` page counts are also intentionally not resolved in streaming mode because that requires buffering or a second pass.
