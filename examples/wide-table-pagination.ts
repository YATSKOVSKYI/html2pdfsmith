import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";
import { writeExamplePdf } from "./output";

const metricHeaders = Array.from({ length: 16 }, (_, i) => `<th>M${i + 1}</th>`).join("");

function metricCells(group: number, row: number): string {
  const cells: string[] = [];
  for (let col = 0; col < 16;) {
    if (row === 0 && col === 4) {
      cells.push(`<td colspan="3" class="merged-note">Combined forecast ${group + 1}: ${"ALONGMERGEDVALUE".repeat(2)}</td>`);
      col += 3;
      continue;
    }
    cells.push(`<td class="${col % 3 === 0 ? "right" : "center"}">${col % 3 === 0 ? `$${(group * 120 + row * 31 + col * 9 + 75).toLocaleString("en-US")}` : `S-${group + 1}-${row + 1}-${col + 1}`}</td>`);
    col += 1;
  }
  return cells.join("");
}

const body = Array.from({ length: 7 }, (_, group) => {
  const rows = Array.from({ length: 2 }, (_, row) => `
    <tr class="detail">
      ${row === 0 ? `<td rowspan="2" class="account">Account ${group + 1}<br><em>rowspan group</em></td>` : ""}
      <td class="line">Line ${row + 1}</td>
      ${metricCells(group, row)}
    </tr>
  `).join("");

  return `
    <tr class="section"><td colspan="18">Wide merged section ${group + 1}</td></tr>
    ${rows}
  `;
}).join("");

const html = `<!doctype html>
<html>
  <head>
    <style>
      @page {
        size: A4 landscape;
        margin: 7mm;
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
        margin: 0 0 10px;
        color: #102a43;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        border: 2px solid #203040;
      }
      thead {
        display: table-header-group;
      }
      th {
        background-color: #e8eef5;
        border: 1px solid #8ea0b4;
        color: #172033;
        font-size: 8.5px;
        font-weight: 700;
        padding: 7px 6px;
        text-align: center;
      }
      td {
        border: 1px solid #c2ceda;
        padding: 6px 5px;
        font-size: 7.8px;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }
      .section td {
        background-color: #172033;
        color: #ffffff;
        font-weight: 700;
        text-align: center;
      }
      .detail {
        break-inside: avoid;
      }
      .account {
        background-color: #f7fafc;
        font-family: "Merriweather";
        font-style: italic;
      }
      .line {
        font-weight: 700;
        background-color: #f3f7fb;
      }
      .center {
        text-align: center;
      }
      .right {
        text-align: right;
        font-weight: 700;
      }
      .merged-note {
        background-color: #fff5d6;
        color: #6b4e00;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <h1>Wide Table Horizontal Pagination</h1>
    <table>
      <thead>
        <tr>
          <th rowspan="2">Account</th>
          <th rowspan="2">Line</th>
          <th colspan="5">North</th>
          <th colspan="5">South</th>
          <th colspan="6">International</th>
        </tr>
        <tr>${metricHeaders}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </body>
</html>`;

const result = await renderHtmlToPdfDetailed({
  html,
  hideHeader: true,
  tableHeaderRepeat: "auto",
  table: {
    horizontalPagination: "always",
    horizontalPageColumns: 5,
    repeatColumns: 2,
    rowspanPagination: "avoid",
  },
  text: { overflowWrap: "break-word" },
  pageHeader: { text: "Html2PdfSmith wide table pagination", align: "left" },
  pageNumbers: { enabled: true, format: "Page {page}", align: "right" },
  watermarkText: "WIDE TABLE",
  watermarkOpacity: 0.035,
  font: {
    bundled: bundledFonts.openSans,
    bundledFonts: [bundledFonts.anton, bundledFonts.merriweather],
  },
});

const output = await writeExamplePdf("wide-table-pagination.pdf", result.pdf);

console.log({
  output,
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
