import { PDFDocument } from "pdf-lib";
import { fileURLToPath } from "node:url";
import { renderHtmlToPdfDetailed } from "../src/index";
import { writeExamplePdf } from "./output";

process.env.HTML2PDFSMITH_CACHE_DIR ??= fileURLToPath(new URL("../tmp/cache", import.meta.url));

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      body {
        font-family: "Open Sans", "Noto Sans SC", sans-serif;
      }
      .autocore-brand {
        font-family: "Anton", sans-serif;
        font-size: 30px;
        letter-spacing: 0;
        margin-bottom: 10px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        font-family: "Open Sans", "Noto Sans SC", sans-serif;
      }
      th, td {
        border: 1px solid #d7dce3;
        padding: 7px 9px;
      }
      th {
        background-color: #f0f4f8;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <h1 class="autocore-brand">AutoCore</h1>
    <p>English and Chinese text share one CSS font stack: Vehicle report / 车辆报告.</p>
    <table>
      <thead><tr><th>Metric</th><th>Value / 值</th></tr></thead>
      <tbody>
        <tr><td>Inventory</td><td>128 vehicles / 128 辆车</td></tr>
        <tr><td>Status</td><td>Ready / 已准备</td></tr>
      </tbody>
    </table>
  </body>
</html>`;

const result = await renderHtmlToPdfDetailed({
  html,
  hideHeader: true,
  font: {
    googleFont: "Open Sans",
    googleFonts: ["Anton", "Noto Sans SC"],
    fallbackFonts: ["Noto Sans SC"],
  },
});

const loaded = await PDFDocument.load(result.pdf);
if (loaded.getPageCount() !== result.pages) {
  throw new Error(`reported pages ${result.pages}, actual pages ${loaded.getPageCount()}`);
}
if (result.warnings.some((warning) => warning.code === "font_fallback")) {
  throw new Error(`unexpected font fallback warning: ${JSON.stringify(result.warnings)}`);
}

const output = await writeExamplePdf("font-family-fallback.pdf", result.pdf);
console.log({
  output,
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
