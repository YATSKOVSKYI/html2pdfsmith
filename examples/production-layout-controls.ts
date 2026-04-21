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
      @media screen {
        h1 { color: red; }
        .screen-only { display: block; }
      }
      @media print {
        h1 {
          color: #102a43;
          text-transform: uppercase;
        }
        .screen-only {
          display: none;
        }
        .print-only {
          display: block;
        }
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
        margin: 0 0 8px;
      }
      .print-only {
        margin: 0 0 12px;
        padding: 9px 12px;
        border-radius: 8px;
        overflow: hidden;
        background-color: #eef6ff;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.18);
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
        height: 58px;
        font-size: 9px;
        vertical-align: middle;
      }
      .id {
        white-space: nowrap;
        text-align: right;
        font-weight: 700;
      }
      .sku {
        white-space: nowrap;
      }
      .name {
        overflow-wrap: break-word;
      }
      .note {
        white-space: pre-line;
      }
      .clip {
        overflow: hidden;
        border-radius: 10px;
        background-color: #dcfce7;
        text-transform: uppercase;
      }
    </style>
  </head>
  <body>
    <h1>Production Layout Controls</h1>
    <p class="screen-only">This screen-only paragraph must not appear in the PDF.</p>
    <div class="print-only">Print media rules are applied. Auto table layout chooses column widths from content instead of fixed equal columns.</div>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>SKU</th>
          <th>Product Name</th>
          <th>Notes</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="id">1001</td>
          <td class="sku">SKU-AUTO-LONG-000001</td>
          <td class="name">Long but readable product title that should receive more width than the numeric ID column.</td>
          <td class="note">Inspection
Ready
Export</td>
          <td class="clip">approved with clipped rounded content</td>
        </tr>
        <tr>
          <td class="id">1002</td>
          <td class="sku">SKU-B-2</td>
          <td class="name">Short name</td>
          <td class="note">Warehouse
Packed</td>
          <td class="clip">pending</td>
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

const output = await writeExamplePdf("production-layout-controls.pdf", result.pdf);

console.log({
  output,
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
