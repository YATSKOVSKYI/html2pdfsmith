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
        margin: 0 0 12px;
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
        border-bottom: 2px solid #243447;
        padding: 8px;
        text-align: center;
        vertical-align: middle;
      }
      td {
        border: 1px solid #c3cfda;
        padding: 8px;
        height: 62px;
        font-size: 9px;
        line-height: 1.3;
      }
      .nowrap {
        white-space: nowrap;
      }
      .ellipsis {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pre-line {
        white-space: pre-line;
      }
      .pre-wrap {
        white-space: pre-wrap;
        font-family: "Merriweather";
        font-size: 8px;
      }
      .side-borders {
        border-left: 3px solid #2563eb;
        border-right: 2px dashed #d97706;
        border-bottom: 2px dotted #059669;
      }
      .right {
        text-align: right;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <h1>Layout Controls</h1>
    <table>
      <colgroup>
        <col style="width: 90px">
        <col style="width: 120px">
        <col style="width: 150px">
        <col style="width: 20%">
        <col style="width: 25%">
        <col>
      </colgroup>
      <thead>
        <tr>
          <th>ID</th>
          <th>No wrap</th>
          <th>Ellipsis</th>
          <th>Pre-line</th>
          <th>Pre-wrap</th>
          <th>Side borders</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="right">1</td>
          <td class="nowrap">VIN-WBA5R7C04LFH12345</td>
          <td class="ellipsis">Mercedes-Benz GLE 450 4MATIC AMG Premium Plus Very Long Vehicle Title</td>
          <td class="pre-line">Line one
Line two
Line three</td>
          <td class="pre-wrap">Code:   A-100
Keep   spacing
Final line</td>
          <td class="side-borders">Custom left, right, and bottom border styles.</td>
        </tr>
        <tr>
          <td class="right">2</td>
          <td class="nowrap">SKU-UNBROKEN-0000000001</td>
          <td class="ellipsis">Long commercial description that should stay on one line and end with ellipsis</td>
          <td class="pre-line">Ready
Inspection
Delivered</td>
          <td class="pre-wrap">A    B    C
1    2    3</td>
          <td class="side-borders">Dashed and dotted borders are drawn side by side.</td>
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
    bundledFonts: [bundledFonts.anton, bundledFonts.merriweather],
  },
});

await Bun.write("examples/layout-controls.pdf", result.pdf);

console.log({
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
