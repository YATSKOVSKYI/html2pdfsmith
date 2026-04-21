import { fileURLToPath } from "node:url";
import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";
import { writeExamplePdf } from "./output";

const html = `
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="assets/base-url-table.css">
  </head>
  <body>
    <img class="logo" src="assets/base-url-logo.svg" alt="Html2PdfSmith">
    <h1>Base URL Resources</h1>
    <p class="from-option">This paragraph is styled by the stylesheets option, not by the HTML link.</p>
    <table>
      <thead>
        <tr>
          <th>Resource</th>
          <th>Resolved By</th>
          <th>Status</th>
          <th>Bytes</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>assets/base-url-table.css</td>
          <td>baseUrl + link rel=stylesheet</td>
          <td class="center accent">Loaded</td>
          <td class="right">CSS</td>
        </tr>
        <tr>
          <td>assets/base-url-logo.svg</td>
          <td>baseUrl + img src</td>
          <td class="center accent">Loaded</td>
          <td class="right">SVG</td>
        </tr>
        <tr>
          <td>inline stylesheet option</td>
          <td>options.stylesheets</td>
          <td class="center accent">Loaded</td>
          <td class="right">Inline</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
`;

const result = await renderHtmlToPdfDetailed({
  html,
  baseUrl: fileURLToPath(new URL("./", import.meta.url)),
  stylesheets: [{
    content: ".from-option { text-align: center; color: #637083; margin: 0 0 14px; font-size: 11px; }",
  }],
  resourcePolicy: {
    allowHttp: false,
    allowFile: true,
    allowData: true,
    maxImageBytes: 500_000,
    maxStylesheetBytes: 100_000,
  },
  hideHeader: true,
  watermarkText: "LOCAL RESOURCES",
  watermarkLayer: "background",
  watermarkOpacity: 0.06,
  font: {
    bundled: bundledFonts.openSans,
    bundledFonts: [bundledFonts.anton, bundledFonts.robotoCondensed],
  },
});

const output = await writeExamplePdf("base-url-resources.pdf", result.pdf);

console.log({
  output,
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
