import { fileURLToPath } from "node:url";
import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";

const html = `<!doctype html>
<html>
  <head>
    <style>
      @page {
        size: A4 landscape;
        margin: 8mm;
      }
      body {
        font-family: "Open Sans";
        color: #172033;
      }
      h1 {
        font-family: "Anton";
        font-size: 26px;
        font-weight: 400;
        text-align: center;
        text-transform: uppercase;
        margin: 0 0 12px;
      }
      .card {
        margin: 0 0 14px;
        padding: 12px 16px;
        border: 1px solid #b6c2d1;
        border-radius: 8px;
        background-color: #ffffff;
        background-image: url("assets/visual-bg.svg");
        background-size: 64px 64px;
        background-repeat: repeat;
        box-shadow: 0 6px 16px rgba(15, 23, 42, 0.25);
        text-transform: capitalize;
      }
      table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        border: 2px solid #243447;
      }
      th {
        background-color: #e8eef5;
        border: 1px solid #90a4b8;
        padding: 8px;
        text-align: center;
        text-transform: uppercase;
      }
      td {
        height: 86px;
        border: 1px solid #c3cfda;
        padding: 8px;
        vertical-align: middle;
        font-size: 9px;
      }
      .badge {
        text-align: center;
        border-radius: 8px;
        background-color: #dcfce7;
        color: #14532d;
        text-transform: uppercase;
        box-shadow: 0 4px 10px rgba(20, 83, 45, 0.22);
      }
      .watermarked {
        background-color: #eff6ff;
        background-image: url("assets/visual-bg.svg");
        background-size: contain;
        background-position: center center;
        background-repeat: no-repeat;
        border-radius: 8px;
      }
      .pattern {
        background-image: url("assets/visual-bg.svg");
        background-size: 38px 38px;
        background-repeat: repeat;
        border-radius: 8px;
      }
      .shadow {
        background-color: #ffffff;
        border-radius: 8px;
        box-shadow: 0 7px 18px rgba(15, 23, 42, 0.28);
      }
    </style>
  </head>
  <body>
    <h1>Visual CSS Controls</h1>
    <div class="card">browserless pdf cards can now use background images, rounded corners, shadows, and text transform.</div>
    <table>
      <thead>
        <tr>
          <th>badge</th>
          <th>background image</th>
          <th>repeating pattern</th>
          <th>shadow</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="badge">approved</td>
          <td class="watermarked">Centered SVG background with contain sizing.</td>
          <td class="pattern">Repeating SVG pattern clipped to a rounded cell.</td>
          <td class="shadow">Simple PDF shadow with rounded background.</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;

const result = await renderHtmlToPdfDetailed({
  html,
  baseUrl: fileURLToPath(new URL("./", import.meta.url)),
  hideHeader: true,
  resourcePolicy: {
    allowFile: true,
    allowData: true,
    maxImageBytes: 500_000,
  },
  font: {
    bundled: bundledFonts.openSans,
    bundledFonts: [bundledFonts.anton],
  },
});

await Bun.write("examples/visual-css-controls.pdf", result.pdf);

console.log({
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
