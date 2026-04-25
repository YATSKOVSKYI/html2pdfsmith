# Changelog

## 0.1.17 — 2026-04-25

### Fixed

- **Text in rowspan cells appears slightly below visual centre** — when a small text block sits inside a tall merged cell (e.g. a `rowspan="3"` param-name spanning three sub-rows), the mathematical ink-centre coincides with the geometric cell centre, but the human eye perceives it as sitting below centre. This is the classic typographic optical-centre effect: in a large field of whitespace the brain expects text to be placed above the 50 % mark to *appear* centred.

  **Fix:** `opticalVerticalContentY()` now distributes whitespace at 46 % above / 54 % below instead of 50 / 50. The 4 % upward correction scales with the amount of whitespace, so for tight single-row cells the shift is ≈ 0.1 pt (invisible), while for a three-row merged cell it is ≈ 0.8–1 pt — exactly the amount needed to eliminate the perceived downward drift. Regular (non-merged) cells are unaffected.

---

## 0.1.16 — 2026-04-25

### Fixed

- **Rowspan cell text not centered across merged rows** — `drawRow()` was centering text and drawing the background fill using the height of only the *first* row, not the full merged area. For a `rowspan="3"` param-name cell spanning three sub-rows, text was pinned to the first row's height and appeared at the top (or off-center) of the visual merge block.

  **Fix:** added `groupHeight?: number` parameter to `drawRow()`, `drawRowSequentially()`, and `drawRowSequentiallyFallback()`. `drawRowGroups()` now passes `group.height` (the pre-computed sum of all rows in the rowspan group) as the drawing height for the first row of every rowspan group. Cells with `rowspan > 1` use this height for their background fill, border, and `contentHeight`, so text is centered across the full merged area.

- **Span placeholder cells overwriting merged background** — placeholder cells (the ghost entries for rows 1+ of a rowspan group) were processed after the fill and shadow calls, so they could overwrite the owning cell's fill with a different color (e.g. zebra stripe). Moved the `isSpanPlaceholder` early-exit to the top of the cell loop so placeholders are skipped before any drawing.

- **Row height too large for dense tables with small fonts** — `minimumRowHeight()` returned `22 + 8 × paddingScale` (≈ 26 pt for 11-column tables) regardless of font size. At the dense preset with a 5–6 pt font the natural row height is ~9 pt, so the constant floor inflated every row to 3× the content height.

  **Fix:** replaced the constant with `baseFontSize × 1.4 + cellPaddingY × 2` — one line of text plus density-adjusted top/bottom padding. This automatically scales with both font size and the active density preset. Header rows keep a 2× multiple; price rows keep their existing floor.

## 0.1.15 — 2026-04-25

### Fixed

- **Optical vertical centering off by ~1 pt** — `verticalAlignMode: "optical"` placed text visibly below the visual center of table cells.

**Root cause:** `measureInlineLines()` estimated `baselineOffsetTop` (the gap from the PDFKit line-box top to the top of the capital-letter ink) with the heuristic `min(maxSize × 0.18, extra × 0.52)`. For fonts with a tall ascender above the cap height the estimate was ~50 % too small: Open Sans at 6 pt gives an actual gap of 2.13 pt while the heuristic returned 1.08 pt. The 1.05 pt error was passed directly to `opticalVerticalContentY()`, shifting every line ~1 pt too low.

**Fix:** replaced the heuristic with the exact font metric `(ascender − capHeight) × size`, already available from `currentFontMetricRatios()`. Centering error is now zero for any font within the ascender/capHeight clamp range. No API changes.

---

## 0.1.14 — 2026-04-25

### Fixed

- **Blank rows and missing content with Cyrillic / CJK text** — after updating to 0.1.13, tables containing non-Latin text could render with an entirely empty first column, missing rows, or rows where all cells were blank.

**Root cause:** `inlineTextHeight()` calls `heightOfString()` with `lineBreak: true`. PDFKit internally calls `widthOfString()` per word to compute line breaks; for text whose glyphs are missing from the active font (Cyrillic with a Latin-only base font, CJK, etc.) `widthOfString()` returns NaN. This propagated through `estimateRowHeight()` → row height = NaN → `ctx.y += NaN` → Y cursor contaminated for all subsequent rows. With the 0.1.13 PDFKit safety layer NaN coordinates were silently converted to 0, so rows drew at the very top of the page outside the clip region — invisible, not an error.

**Fix:**
- Guarded all three `heightOfString()` call sites (`inlineItem`, `inlineItemWithText`, `inlineTextHeight`) with `safeNumber(result, size × 1.2)` fallback.
- Hardened `opticalVerticalContentY()` to clamp all NaN metric fields (`layoutHeight`, `visualHeight`, `baselineOffsetTop`) with `safeNumber()` before arithmetic; return value is also wrapped so text falls back to the top of the content area rather than y = 0.
- Scope: 4 call sites across 2 modules. No API changes.

---

## 0.1.13 — 2026-04-24

### Fixed

- **`unsupported number: NaN` crashes** — added a PDFKit numeric safety layer that sanitizes non-finite values before drawing calls (`text`, `rect`, `fontSize`, `lineWidth`, transforms, images, opacity).
- Hardened border strokes, box shadows, and CSS transform origins against NaN dimensions from CSS/layout calculations.
- Added `pdfkit_nonfinite_number_sanitized` warning (emitted once per affected method) so production logs can identify the origin of bad numbers.

---

## 0.1.11 — 2026-04-24

### Fixed

- **NaN column widths and inline dimensions when a font is unavailable** — `widthOfString()` returns NaN for uncached or blocked fonts (e.g. "Noto Sans SC" without network access). Without guards this flowed through `Math.max(1, NaN + 2)` → NaN → "unsupported number: NaN" in PDFKit.
- Wrapped all `widthOfString()` calls in `inline-text.ts`, `table.ts`, and `charts.ts` with `safeNumber(…, 0)` fallback.
- Re-exported `safeNumber` from `layout.ts` to unify numeric safety across rendering modules.
- Scope: 4 modules, 8 call sites. No API changes.

---

## 0.1.10 — 2026-04-24

### Fixed

- Added `safeNumber` guards for all dimension parameters (`x`, `y`, `width`, `height`) in `drawAsset()`, `drawAssetInBox()`, `drawWatermark()`, and `positionedStart()`.
- Hardened `asOpacity()` and `cssOpacity()` against NaN and Infinity; values are clamped to the 0.01–1.0 range.
- Added `safeNumber` check for opacity in `drawShadowShape()`.

---

## 0.1.8 — 2026-04-24

### Added

- `table.preset: "comparison" | "compact-comparison" | "dense-comparison"` — one-line shortcut that composes page-width fit, optical middle alignment, cell pagination, density defaults, centered value columns, and left-aligned first column.
- `table.columnWeights` — explicit generated column-width ratios without a CSS `colgroup`.
- `table.cellTextAlign`, `table.headerTextAlign`, `table.firstColumnTextAlign` — table-level alignment defaults; explicit CSS always wins.

### Changed

- `cellPagination: "rich-text"` now paginates structural rich-text and heading content nested inside rich boxes while preserving inline styles.
- Image, positioned, and fixed-height rich blocks follow atomic whole-block rules: move to a fresh page when they fit; otherwise emit a deterministic warning and fall back to clipping.
- `rowspanPagination: "split"` can paginate long text in rows that start an owner `rowspan > 1` cell and in placeholder rows; `"avoid"` keeps the conservative grouped behavior.
- Generated column widths use one consistent weighting path for `columnWeights`, `firstColumnWeight`, fixed tables, and page-width-fitted tables.

### Warnings

- `table_cell_pagination_rich_content_unsupported` — atomic image / positioned / fixed-height block that cannot be text-split.
- `table_cell_pagination_rowspan_unsupported` — now limited to `rowspanPagination: "avoid"` cases only.
- `table_cell_pagination_clipped_block` — atomic block that cannot fit even on a fresh page.

---

## 0.1.7 — 2026-04-24

### Added

- `table.cellPagination: "off" | "text" | "rich-text"` — splits oversized table-cell text across vertical page fragments.
- `table.verticalAlignMode: "layout" | "optical"` — optical mode uses font cap-height metrics for `vertical-align: middle` instead of raw layout height.
- Production table presets: `table.density` (`normal` / `compact` / `dense`), `table.fit` (`page-width`), `table.firstColumnWeight`, `table.minFontSize`, `table.maxFontSize`.
- `examples/production-comparison-table.ts` — A4 landscape comparison-table reference example.

### Changed

- Cell pagination splits by wrapped inline layout lines, preserving inline styles inside fragments.
- Multiple tall cells in the same row maintain independent continuation cursors; short neighbours keep the grid, background, borders, and padding.
- Continued cell fragments top-align remaining text; cells that fully fit keep their requested `vertical-align`.
- `compact` / `dense` density reduces only generated font sizes, padding, and line-height; explicit CSS always takes priority.

### Notes

- `verticalAlignMode` defaults to `"layout"` for backward compatibility.
- `density: "normal"` preserves existing defaults; `compact` and `dense` are opt-in.

---

## 0.1.5 — 2026-04-23

### Added

- **CLI:** `html2pdfsmith fonts install` — installs project-local Google Fonts and generates `html2pdfsmith-fonts.json`, `fonts.css`, and usage notes.
- `loadFontManifest()` and `fontOptionsFromManifest()` helpers for offline font manifests.
- CSS `font-family` resolution across flow content, tables, inline text, charts, watermarks, and page templates.
- Coverage-aware font fallback for configured fallback families (e.g. Open Sans + Noto Sans SC for CJK).
- Node.js runtime smoke coverage and CLI smoke coverage in CI.

### Changed

- Tables use the shared font resolver instead of hardcoded regular/bold font names.
- `font.googleFonts` registers named CSS families; `font.fallbackFonts` registers coverage-aware fallback families.

### Notes

- Google font files are not bundled; they are created only when the user explicitly runs the CLI installer.
- Current CJK fallback is coverage-aware whole-text fallback per inline segment/cell; per-run fallback is architecturally possible in a future release.
