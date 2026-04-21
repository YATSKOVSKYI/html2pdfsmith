import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";
import { writeExamplePdf } from "./output";

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
        font-weight: 400;
        font-size: 26px;
        text-align: center;
        margin: 0 0 12px;
      }
      p {
        margin: 0 0 12px;
        font-size: 11px;
        line-height: 1.5;
      }
      .badge {
        display: inline-block;
        padding: 3px 7px;
        border-radius: 999px;
        font-size: 8px;
        font-weight: 700;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .ok {
        background-color: #dcfce7;
        color: #14532d;
        border: 1px solid #86efac;
      }
      .warn {
        background-color: #fff7ed;
        color: #9a3412;
        border: 1px dashed #fdba74;
      }
      .info {
        background-color: #dbeafe;
        color: #1e3a8a;
        border: 1px solid #93c5fd;
      }
      table {
        width: 100%;
        table-layout: auto;
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
        border: 1px solid #c3cfda;
        padding: 8px;
        height: 64px;
        vertical-align: middle;
        font-size: 9px;
      }
      .note {
        overflow-wrap: break-word;
      }
    </style>
  </head>
  <body>
    <h1>Inline Badges</h1>
    <p>
      This paragraph contains inline styled spans:
      <span class="badge ok">approved</span>
      <span class="badge warn">review</span>
      <span class="badge info">export ready</span>
      rendered without a browser.
    </p>
    <table>
      <thead>
        <tr>
          <th>Order</th>
          <th>Status</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>#1001</td>
          <td><span class="badge ok">approved</span> <span class="badge info">paid</span></td>
          <td class="note">Inline badges can live inside table cells and wrap with surrounding text.</td>
        </tr>
        <tr>
          <td>#1002</td>
          <td><span class="badge warn">needs review</span></td>
          <td class="note">Dashed borders, rounded backgrounds, padding, and uppercase transform are applied per span.</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;

const result = await renderHtmlToPdfDetailed({
  html,
  hideHeader: true,
  font: {
    bundled: bundledFonts.openSans,
    bundledFonts: [bundledFonts.anton],
  },
});

const output = await writeExamplePdf("inline-badges.pdf", result.pdf);

console.log({
  output,
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
