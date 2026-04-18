import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";

const rows = Array.from({ length: 34 }, (_, index) => {
  const id = `INV-${String(index + 1).padStart(4, "0")}`;
  const status = index % 5 === 0 ? "Review" : index % 3 === 0 ? "Pending" : "Paid";
  const statusClass = status.toLowerCase();
  const owner = ["North team", "West team", "Partner channel", "Online sales"][index % 4]!;
  const amount = 1290 + index * 175;
  const discount = index % 4 === 0 ? 12 : index % 3 === 0 ? 8 : 0;
  const net = Math.round(amount * (1 - discount / 100));
  const note = index % 7 === 0
    ? `<td rowspan="2" class="note">Two-row note with rowspan and wrapped text.</td>`
    : index % 7 === 1
      ? ""
      : `<td class="note">Standard row note.</td>`;

  return `
    <tr>
      <td class="mono">${id}</td>
      <td>${owner}</td>
      <td class="status ${statusClass}">${status}</td>
      <td class="right">$${amount.toLocaleString("en-US")}</td>
      <td class="center">${discount}%</td>
      <td class="right strong">$${net.toLocaleString("en-US")}</td>
      ${note}
    </tr>
  `;
}).join("");

const html = `
<!doctype html>
<html>
  <head>
    <style>
      body {
        font-family: "Open Sans";
        color: #1f2933;
      }
      h1 {
        font-family: "Anton";
        font-size: 28px;
        font-weight: 400;
        margin: 0 0 6px;
        text-align: center;
        color: #132238;
      }
      .lead {
        margin: 0 0 14px;
        text-align: center;
        color: #637083;
        font-size: 11px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        border: 2px solid #213547;
      }
      th {
        font-family: "Roboto Condensed";
        font-size: 12px;
        font-weight: 700;
        padding: 9px 8px;
        border: 1px solid #9aa8b5;
        background-color: #eaf0f6;
        color: #172033;
        text-align: center;
      }
      td {
        padding: 7px 8px;
        border: 1px solid #c8d2dc;
        font-size: 9.5px;
        line-height: 1.25;
      }
      tbody tr:nth-child(even) td {
        background-color: #f8fafc;
      }
      .section td {
        background-color: #172033;
        color: white;
        font-family: "Roboto Condensed";
        font-size: 12px;
        font-weight: 700;
        text-align: center;
        padding: 8px;
      }
      .mono {
        font-family: "Noto Sans";
        color: #334155;
      }
      .right {
        text-align: right;
      }
      .center {
        text-align: center;
      }
      .strong {
        font-weight: 700;
      }
      .note {
        font-family: "Merriweather";
        font-style: italic;
        color: #526070;
      }
      .status {
        font-weight: 700;
        text-align: center;
      }
      .paid {
        color: #0f766e;
      }
      .pending {
        color: #b45309;
      }
      .review {
        color: #2f62d9;
      }
    </style>
  </head>
  <body>
    <h1>Table Showcase</h1>
    <p class="lead">Borders, padding, colors, alignment, colspan, rowspan, repeated headers, page numbers and watermark layers.</p>
    <table>
      <thead>
        <tr>
          <th colspan="3">Document</th>
          <th colspan="3">Amount</th>
          <th rowspan="2">Notes</th>
        </tr>
        <tr>
          <th>ID</th>
          <th>Owner</th>
          <th>Status</th>
          <th>Gross</th>
          <th>Discount</th>
          <th>Net</th>
        </tr>
      </thead>
      <tbody>
        <tr class="section"><td colspan="7">Q2 report data</td></tr>
        ${rows}
      </tbody>
    </table>
  </body>
</html>
`;

const result = await renderHtmlToPdfDetailed({
  html,
  recordId: "table-showcase",
  repeatHeaders: true,
  hideHeader: true,
  page: { size: "A4", orientation: "landscape", marginMm: 6 },
  pageHeader: {
    text: "Html2PdfSmith - table showcase",
    align: "left",
  },
  pageFooter: {
    text: "Generated without Chromium",
    align: "right",
  },
  pageNumbers: {
    enabled: true,
    format: "Page {page}",
    align: "center",
  },
  watermarkText: "HTML2PDFSMITH",
  watermarkLayer: "both",
  watermarkOpacity: 0.08,
  watermarkScale: 42,
  font: {
    bundled: bundledFonts.openSans,
    bundledFonts: [
      bundledFonts.anton,
      bundledFonts.robotoCondensed,
      bundledFonts.merriweather,
      bundledFonts.notoSans,
    ],
  },
});

await Bun.write("examples/table-showcase.pdf", result.pdf);

console.log({
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
