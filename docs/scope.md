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
- content-aware automatic table layout
- cell background colors for highlights
- cell and block background images
- rounded cells/blocks and simplified shadows
- section rows
- horizontal and vertical cell alignment
- text wrapping
- nowrap, pre-line/pre-wrap, and ellipsis text overflow
- inline badges/chips with `display: inline-block`, padding, borders, rounded backgrounds, and text transforms
- print media rules with `@media print` / `@media all`
- overflow clipping for rounded cell/block content
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



Full CSS cascade, Flexbox, Grid, JavaScript execution, and arbitrary website rendering are outside the first production target. `{total}` page counts are also intentionally not resolved in streaming mode because that requires buffering or a second pass.
