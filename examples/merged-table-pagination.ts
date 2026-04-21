import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";
import { writeExamplePdf } from "./output";

const groups = Array.from({ length: 12 }, (_, groupIndex) => {
  const rows = Array.from({ length: 3 }, (_, itemIndex) => {
    const first = itemIndex === 0;
    const groupCell = first
      ? `<td rowspan="3" class="group-cell">Batch ${groupIndex + 1}<br><em>Merged across three rows. This cell should stay with its detail rows when the group fits on a fresh page.</em></td>`
      : "";
    return `
      <tr class="detail-row">
        ${groupCell}
        <td>Item ${groupIndex + 1}.${itemIndex + 1}</td>
        <td class="sku">SKU-${groupIndex + 1}-${itemIndex + 1}-${"LONGMERGEDTOKEN".repeat(3)}</td>
        <td class="center">${itemIndex % 2 === 0 ? "Ready" : "Review"}</td>
        <td class="right">$${(950 + groupIndex * 120 + itemIndex * 45).toLocaleString("en-US")}</td>
      </tr>
    `;
  }).join("");

  return `
    <tr class="section-row"><td colspan="5">Merged group ${groupIndex + 1}</td></tr>
    ${rows}
  `;
}).join("");

const html = `
<!doctype html>
<html>
  <head>
    <style>
      @page {
        size: A4 portrait;
        margin: 7mm;
      }
      body {
        font-family: "Open Sans";
        color: #1f2933;
      }
      h1 {
        font-family: "Anton";
        font-size: 25px;
        font-weight: 400;
        color: #16213e;
        text-align: center;
        margin: 0 0 8px;
      }
      p {
        text-align: center;
        color: #637083;
        margin: 0 0 12px;
        font-size: 10px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        border: 2px solid #213547;
      }
      thead {
        display: table-header-group;
      }
      th {
        padding: 8px 7px;
        border: 1px solid #9aa8b5;
        background-color: #eaf0f6;
        font-weight: 700;
        text-align: center;
      }
      td {
        padding: 8px 7px;
        border: 1px solid #c8d2dc;
        font-size: 8.8px;
        line-height: 1.35;
        overflow-wrap: break-word;
      }
      .section-row td {
        background-color: #172033;
        color: white;
        font-weight: 700;
        text-align: center;
      }
      .detail-row {
        break-inside: avoid;
      }
      .group-cell {
        background-color: #f8fafc;
        color: #334155;
        font-family: "Merriweather";
        font-style: italic;
      }
      .sku {
        color: #2f62d9;
        overflow-wrap: anywhere;
      }
      .center {
        text-align: center;
      }
      .right {
        text-align: right;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <h1>Merged Table Pagination</h1>
    <p>Rowspan-connected detail rows are kept together when they fit on a fresh page. Headers repeat on every page.</p>
    <table>
      <thead>
        <tr>
          <th rowspan="2">Batch</th>
          <th colspan="2">Item</th>
          <th colspan="2">State</th>
        </tr>
        <tr>
          <th>Name</th>
          <th>Long SKU</th>
          <th>Status</th>
          <th>Amount</th>
        </tr>
      </thead>
      <tbody>
        ${groups}
      </tbody>
    </table>
  </body>
</html>
`;

const result = await renderHtmlToPdfDetailed({
  html,
  hideHeader: true,
  tableHeaderRepeat: "auto",
  table: { rowspanPagination: "avoid" },
  text: { overflowWrap: "break-word" },
  pageHeader: { text: "Html2PdfSmith merged table pagination", align: "left" },
  pageNumbers: { enabled: true, format: "Page {page}", align: "center" },
  watermarkText: "MERGED",
  watermarkOpacity: 0.05,
  font: {
    bundled: bundledFonts.openSans,
    bundledFonts: [bundledFonts.anton, bundledFonts.merriweather],
  },
});

const output = await writeExamplePdf("merged-table-pagination.pdf", result.pdf);

console.log({
  output,
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
