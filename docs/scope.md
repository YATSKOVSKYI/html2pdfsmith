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
- cell background colors for highlights
- section rows
- text wrapping
- row-level pagination with rowspan group avoidance
- PNG/JPEG images
- text and image watermarks
- repeated page header/footer text
- streaming page numbers with `{page}`
- custom fonts for Latin, Cyrillic, and CJK text
- multiple Google Fonts via `font.googleFonts` and CSS `font-family`
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
- `table`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`
- `br`
- `img`
- `hr`
- text nodes

## Current CSS Subset

CSS support is intentionally pragmatic. The renderer recognizes common class names and inline style hints used by printable table templates:

- section/header rows
- highlighted/diff cells
- parameter/label columns
- price/header cells
- simple background colors
- table `border`
- table/cell `padding`
- table `border-collapse: collapse`
- `colspan`, `rowspan`, and merged-cell grid normalization
- body `colspan`-aware horizontal table breaks
- row-level `background-color`, `color`, `font-size`, and `text-align`
- block `margin`, `padding`, and `border`
- `line-height`
- `text-decoration`
- `font-size`
- `font-family` for registered/default fonts and configured Google Fonts
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

Full CSS cascade, Flexbox, Grid, JavaScript execution, and arbitrary website rendering are outside the first production target. `{total}` page counts are also intentionally not resolved in streaming mode because that requires buffering or a second pass.
