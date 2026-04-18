# Memory Budget

The production target for the default renderer is less than 100 MB incremental RSS for a 10-column, 100-row table with a text watermark and standard PDF fonts.

Run:

```bash
bun run bench -- 10 100 --watermark
```

Current Windows/Bun sample:

```json
{
  "columns": 10,
  "rows": 100,
  "pages": 6,
  "ms": 118,
  "deltaPeakRssMb": 46.4
}
```

Large CJK fonts are the main exception. A full Chinese variable font can push incremental RSS well above 100 MB because the font engine parses and subsets a large font. For low-memory production with CJK text, use explicit small subset fonts instead of automatic system font discovery.

Run the heavier font case explicitly:

```bash
bun run bench -- 10 100 --watermark --auto-font
```

The default renderer intentionally does not auto-load large system fonts.
