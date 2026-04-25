# Changelog

## 0.1.15 - 2026-04-25

### Fixed

- Fixed optical vertical centering (`verticalAlignMode: "optical"`) placing text ~1 pt below the visual center of table cells.
- Root cause: `measureInlineLines()` estimated `topInset` (the gap from the PDFKit line-box top to the top of the capital-letter ink) using the heuristic `min(maxSize × 0.18, extra × 0.52)`. For fonts with a tall ascender above the cap height (e.g. Open Sans: actual gap = 2.13 pt at 6 pt, heuristic = 1.08 pt), the estimate was ~50% too small. The 1.05 pt underestimate was passed directly to `opticalVerticalContentY()` as `baselineOffsetTop`, which shifted the layout box 1.05 pt too low, making text appear below center.
- Fix: replace the heuristic with the actual font metric `(ascender − capHeight) × size`, already available from `currentFontMetricRatios()`. This gives an exact, font-specific gap and zeroes the centering error for any font in the ascender/capHeight clamp range.

## 0.1.14 - 2026-04-25

### Fixed

- Guarded all three `heightOfString()` call sites (`inlineItem`, `inlineItemWithText`, `inlineTextHeight`) with `safeNumber()` fallback.
- The critical path is `inlineTextHeight()`, which calls `heightOfString()` with `lineBreak: true`; PDFKit internally calls `widthOfString()` to compute line breaks, and for text in a script whose glyphs are missing from the active font (e.g. Cyrillic text with a Latin-only fallback), `widthOfString()` returns NaN, propagating NaN into the height and then into row-height and Y-coordinate calculations.
- Hardened `opticalVerticalContentY()` to clamp all NaN metric fields (`layoutHeight`, `visualHeight`, `baselineOffsetTop`) with `safeNumber()` before arithmetic, and wraps the return value with `safeNumber(..., y)` so text always falls back to the top of the content area instead of drawing at y=0 outside the clip region.

### Details

- **Root cause:** `estimateRowHeight()` calls `inlineTextHeight()` for every cell. When the active font lacks glyphs for certain characters (Cyrillic, CJK, etc.), `heightOfString(..., {lineBreak: true})` returns NaN because the internal line-wrapping logic accumulates undefined glyph widths. `Math.max(minimumHeight, NaN + padding)` = NaN, so the entire row height becomes NaN. `ctx.y += NaN` contaminates the Y cursor for all subsequent rows. With the 0.1.13 PDFKit safety layer, NaN coordinates are silently converted to 0 instead of throwing, so rows draw at the very top of the page (outside the clip region) and appear missing or blank rather than causing an outright error.
- **Impact:** Fixes empty parameter-name column, missing rows, and blank rows in comparison-table PDFs when the primary font lacks glyphs for the document language (most visible with Cyrillic text and a Latin-only fallback font).
- **Scope:** 4 call sites across 2 modules. No API changes.

## 0.1.13 - 2026-04-24

### Fixed

- Added a PDFKit numeric safety layer that sanitizes non-finite numbers before drawing calls such as `text`, `rect`, `fontSize`, `lineWidth`, transforms, images, and opacity.
- Added `pdfkit_nonfinite_number_sanitized` warnings so production logs identify the exact PDFKit method that received a bad number.
- Hardened border strokes, box shadows, and CSS transform origins against `NaN` dimensions from CSS/layout calculations.

### Details

- This catches remaining `unsupported number: NaN` failures that occur after HTML generation, even when the original source is deep in table, chart, inline text, image, or CSS shadow/transform rendering.
- The warning is emitted once per affected PDFKit method to avoid flooding large documents.

## 0.1.11 - 2026-04-24

### Fixed

- Fixed NaN propagation from PDFKit's `widthOfString()` when font resources are blocked or uncached (e.g., "Noto Sans SC" without HTTP/cache).
- Wrapped all `widthOfString()` calls in [src/stream/inline-text.ts](src/stream/inline-text.ts), [src/stream/table.ts](src/stream/table.ts), and [src/stream/charts.ts](src/stream/charts.ts) with `safeNumber(..., 0)` fallback.
- Re-exported `safeNumber` from [src/stream/layout.ts](src/stream/layout.ts) to unify numeric safety across rendering modules.
- NaN no longer propagates into table column widths, inline item dimensions, or PDFKit drawing calls.

### Details

- **Root cause:** When a font is unavailable, PDFKit's `widthOfString()` returns NaN. Without validation, this flowed through `Math.max(1, NaN + 2)` → NaN → downstream dimension calculations → "unsupported number: NaN" error in PDFKit.
- **Impact:** Rendering now gracefully falls back to 0-width items instead of throwing. Column widths, text layout, and chart dimensions continue safely.
- **Scope:** 4 modules, 8 `widthOfString()` call sites now guarded. No API changes.

## 0.1.10 - 2026-04-24

### Enhanced

- Added `safeNumber` validation for all dimension parameters (x, y, width, height) in rendering functions: `drawAsset()`, `drawAssetInBox()`, `drawWatermark()`, and `positionedStart()`.
- Added `safeNumber` checks for opacity values to prevent NaN and infinite values from being passed to PDF rendering APIs.
- Enhanced `asOpacity()` and `cssOpacity()` with safer numeric parsing and value clamping (0.01–1.0 range).
- Improved safety in `drawShadowShape()` with dimension and opacity validation before shadow rendering.
- All numeric parameters in asset rendering now use explicit fallback values for undefined, null, or non-finite inputs.

### Notes

- Safety enhancements are internal and maintain full backward compatibility.
- Rendering continues gracefully with sensible defaults when invalid numeric inputs are provided.

## 0.1.9 - 2026-04-24

### Enhanced

- Added `safeNumber` validation for all dimension parameters (x, y, width, height) in rendering functions: `drawAsset()`, `drawAssetInBox()`, `drawWatermark()`, and `positionedStart()`.
- Added `safeNumber` checks for opacity values to prevent NaN and infinite values from being passed to PDF rendering APIs.
- Enhanced `asOpacity()` and `cssOpacity()` with safer numeric parsing and value clamping (0.01–1.0 range).
- Improved safety in `drawShadowShape()` with dimension and opacity validation before shadow rendering.
- All numeric parameters in asset rendering now use explicit fallback values for undefined, null, or non-finite inputs.

### Notes

- Safety enhancements are internal and maintain full backward compatibility.
- Rendering continues gracefully with sensible defaults when invalid numeric inputs are provided.

## 0.1.8 - 2026-04-24

### Added

- Added `table.preset: "comparison" | "compact-comparison" | "dense-comparison"` as a generic shortcut for production comparison tables.
- Added `table.columnWeights` for exact generated column-width control without requiring a CSS `colgroup`.
- Added table-level generated alignment defaults: `table.cellTextAlign`, `table.headerTextAlign`, and `table.firstColumnTextAlign`.
- Added smoke coverage for comparison presets, generated column weights, CSS alignment precedence, rich text pagination, split-mode owner-rowspan pagination, conservative avoid-mode rowspan fallback, and split-mode rowspan placeholder pagination.

### Changed

- Comparison presets now compose the stable table features introduced in `0.1.7`: page-width fitting, optical middle alignment, text cell pagination, density defaults, centered generated value columns, and left-aligned first columns.
- Generated column widths now use one consistent weighting path for `columnWeights`, `firstColumnWeight`, fixed tables, and page-width fitted tables.
- `cellPagination: "rich-text"` now paginates structural rich text/heading content, including text nested inside rich boxes, while preserving inline styles.
- Image, positioned, and fixed-height rich content now follows atomic whole-block rules: move to a fresh page when it fits, otherwise emit deterministic warnings before using the clipped fallback.
- `rowspanPagination: "split"` can now paginate long text in rows that start an owner `rowspan > 1` cell and in rows that contain rowspan placeholders, while `rowspanPagination: "avoid"` keeps the conservative grouped behavior.
- Explicit CSS continues to have priority over presets and table-level defaults for `text-align`, `padding`, `font-size`, `line-height`, and `colgroup` widths.
- The production comparison example now uses `preset: "dense-comparison"` to document the recommended high-level API.

### Warnings and fallbacks

- `table_cell_pagination_rich_content_unsupported` now describes atomic image, positioned, and fixed-height rich content that cannot be text-split.
- `table_cell_pagination_rowspan_unsupported` is now limited to conservative `rowspanPagination: "avoid"` cases; `rowspanPagination: "split"` supports text fragments inside rowspan groups.
- `table_cell_pagination_clipped_block` remains the explicit signal for an atomic rich/image block that cannot fit even on a fresh page.
- `table_cell_pagination_no_progress`, `table_cell_pagination_fragment_too_small`, and `table_cell_pagination_forced_line` continue to protect pagination from infinite loops and impossible fragments.

### Notes

- `table.preset` is opt-in and backward-compatible. Existing tables without a preset keep their previous behavior.
- Presets are generic and not tied to AutoCore or automotive content; they are intended for any wide comparison/report table.
- `0.1.8` does not slice raster images or fixed-height positioned boxes across pages pixel-by-pixel; those remain atomic by design for stable PDF output.

## 0.1.7 - 2026-04-24

### Added

- Added `table.cellPagination: "off" | "text" | "rich-text"` for splitting oversized table-cell text across vertical page fragments.
- Added `table.verticalAlignMode: "layout" | "optical"` so `vertical-align: middle` can use optical text metrics in table cells.
- Added reusable production table fit presets: `table.density`, `table.fit`, `table.firstColumnWeight`, `table.minFontSize`, and `table.maxFontSize`.
- Added `examples/production-comparison-table.ts` and the `example:production-comparison` script for A4 landscape comparison-table rendering.
- Added smoke coverage for long text cell continuation, multiple continuation cells, unsupported rich blocks, unsupported rowspan cases, dense table fit, Cyrillic/Latin mixed text, bullets, and repeated headers.

### Changed

- Table cell pagination now splits by wrapped inline layout lines rather than source text chunks, preserving inline styles inside fragments.
- Multiple tall cells in the same row now maintain independent continuation cursors while short neighboring cells preserve the table grid, background, borders, and padding.
- Continued cell fragments top-align their remaining text; cells that fully fit inside a fragment keep their requested `vertical-align`.
- `compact` and `dense` density presets reduce only generated table font sizes, default padding, and default line-height, while explicit CSS remains stronger.
- `fit: "page-width"` and `firstColumnWeight` provide predictable generated column widths for wide tables while preserving explicit `colgroup` widths.
- README now documents the new pagination, optical alignment, density, fit, and production comparison-table APIs.

### Warnings

- Added `table_cell_pagination_rich_content_unsupported` for rich blocks/images that cannot be safely split yet.
- Added `table_cell_pagination_rowspan_unsupported` when rowspan-connected rows cannot safely use cell content pagination.
- Added `table_cell_pagination_no_progress` to stop pathological pagination loops deterministically.
- Added `table_cell_pagination_fragment_too_small` and `table_cell_pagination_forced_line` for wrapped lines taller than the available fragment.
- Added `table_cell_pagination_clipped_block` when a whole rich/image block must fall back to clipping.

### Notes

- Cell content pagination is intentionally scoped to non-rowspan text/inlines in this release. Rowspan groups keep the existing `rowspanPagination` behavior, and unsupported rowspan split cases emit `table_cell_pagination_rowspan_unsupported`.
- Horizontal table pagination continues to work through the existing column-slice renderer.
- Rich text block splitting is not claimed yet; `rich-text` currently paginates plain text/inlines and warns for rich blocks/images.
- `table.verticalAlignMode` defaults to `"layout"` for backward compatibility. Enable `"optical"` explicitly for visually centered table text.
- `table.density: "normal"` preserves current defaults. `compact` and `dense` are opt-in presets for production tables.

## 0.1.5 - 2026-04-23

### Added

- Added a package CLI: `html2pdfsmith fonts install`.
- Added project-local Google Fonts installation with generated `html2pdfsmith-fonts.json`, `fonts.css`, and usage notes.
- Added `loadFontManifest()` and `fontOptionsFromManifest()` helpers for offline font manifests.
- Added CSS `font-family` resolution across flow content, tables, inline text, charts, watermarks, and page templates.
- Added coverage-aware font fallback for configured fallback families, including CJK-oriented stacks such as Open Sans plus Noto Sans SC.
- Added Node.js runtime smoke coverage and CLI smoke coverage in CI.

### Changed

- Tables now use the shared font resolver instead of hardcoded regular/bold font names.
- Google Fonts can be registered as named CSS families through `font.googleFonts` and fallback families through `font.fallbackFonts`.
- README now documents Node.js and Bun support, error handling, font fallback, local font installs, package contents, and visual/smoke checks.
- Package lock metadata is synchronized with the current dependency set.

### Notes

- Google font files are not bundled in the main package. Local font assets are created only when the user explicitly runs the CLI installer.
- The current CJK fallback strategy is coverage-aware whole-text fallback per inline segment/cell; the architecture leaves room for per-run fallback later.
