# Changelog

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
