import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";
import { writeExamplePdf } from "./output";

const rows = Array.from({ length: 42 }, (_, index) => {
  const token = `ORDER-${String(index + 1).padStart(3, "0")}-THIS_IS_A_VERY_LONG_UNBROKEN_IDENTIFIER_${"X".repeat(34 + index % 12)}`;
  return `
    <tr>
      <td>${index + 1}</td>
      <td class="wrap">${token}</td>
      <td class="right">$${(1200 + index * 91).toLocaleString("en-US")}</td>
      <td>${index % 3 === 0 ? "Needs manual review before export" : "Ready"}</td>
    </tr>
  `;
}).join("");

const html = `
<!doctype html>
<html>
  <head>
    <style>
      @page {
        size: A4 landscape;
        margin: 8mm;
      }
      body {
        font-family: "Open Sans";
        color: #202833;
      }
      h1 {
        font-family: "Anton";
        font-size: 28px;
        font-weight: 400;
        text-align: center;
        margin: 0 0 8px;
        color: #16213e;
      }
      p {
        text-align: center;
        color: #637083;
        margin: 0 0 12px;
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
        padding: 8px;
        border: 1px solid #9aa8b5;
        background-color: #eaf0f6;
        font-weight: 700;
        text-align: center;
      }
      td {
        padding: 7px 8px;
        border: 1px solid #c8d2dc;
        font-size: 9px;
        overflow-wrap: break-word;
      }
      tbody tr:nth-child(even) td {
        background-color: #f8fafc;
      }
      .wrap {
        font-family: "Noto Sans";
        overflow-wrap: anywhere;
        color: #2f62d9;
      }
      .right {
        text-align: right;
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <h1>Page + Wrap + Repeated Header</h1>
    <p>CSS @page controls landscape/margins. The table header repeats on every page. Long identifiers wrap instead of clipping.</p>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Long Identifier</th>
          <th>Amount</th>
          <th>State</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </body>
</html>
`;

const result = await renderHtmlToPdfDetailed({
  html,
  hideHeader: true,
  tableHeaderRepeat: "auto",
  text: { overflowWrap: "break-word" },
  pageHeader: { text: "Html2PdfSmith @page / wrap / repeated headers", align: "left" },
  pageNumbers: { enabled: true, format: "Page {page}", align: "center" },
  watermarkText: "WRAP TEST",
  watermarkOpacity: 0.06,
  font: {
    bundled: bundledFonts.openSans,
    bundledFonts: [bundledFonts.anton, bundledFonts.notoSans],
  },
});

const output = await writeExamplePdf("page-wrap-repeat.pdf", result.pdf);

console.log({
  output,
  pages: result.pages,
  bytes: result.pdf.byteLength,
  orientation: result.orientation,
  warnings: result.warnings,
});
