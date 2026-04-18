# @html2pdfsmith/fonts

Optional bundled fonts for Html2PdfSmith.

Use this package when PDF rendering must be fully offline and deterministic:

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

Then regular HTML/CSS can select fonts:

```html
<h1 style="font-family: Anton">Report</h1>
<td style="font-family: Ubuntu; font-style: italic">Italic cell</td>
```

The main `html2pdfsmith` package does not depend on these files. This keeps the core renderer small and lets production deployments choose whether to ship offline fonts.

## Included Families

- Open Sans: OFL-1.1
- Ubuntu: Ubuntu Font Licence 1.0
- Anton: OFL-1.1
- Roboto Condensed: OFL-1.1
- Merriweather: OFL-1.1
- Noto Sans: OFL-1.1

License files are stored in `licenses/`.

## Update Fonts

```bash
bun run download
```

The downloader uses Python `fontTools` to instantiate static 400/700 TTF files from upstream variable fonts:

```bash
python -m pip install fonttools
```
