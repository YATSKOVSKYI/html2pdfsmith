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
- cell background colors for highlights
- section rows
- text wrapping
- row-level pagination
- PNG/JPEG images
- text and image watermarks
- repeated page header/footer text
- streaming page numbers with `{page}`
- custom fonts for Latin, Cyrillic, and CJK text
- optional `qpdf` owner-password protection

## Current HTML Subset

- `header`
- `div`
- `h1` - `h6`
- `p`
- `ul`, `ol`, `li`
- `table`, `thead`, `tbody`, `tr`, `th`, `td`
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
- `colspan` and basic `rowspan` grid normalization
- `font-size`
- `font-weight`
- `color`
- `background-color`
- `text-align`
- `margin-top`
- `margin-bottom`
- image `width` and `height`

Full CSS cascade, Flexbox, Grid, JavaScript execution, and arbitrary website rendering are outside the first production target. `{total}` page counts are also intentionally not resolved in streaming mode because that requires buffering or a second pass.
