import { writeFile } from "node:fs/promises";
import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";

const html = `
<!doctype html>
<html>
  <head>
    <style>
      body {
        font-family: "Open Sans";
        color: #17202a;
      }
      h1 {
        font-family: "Anton";
        font-size: 34px;
        font-weight: 400;
        margin: 0 0 14px;
        color: #16213e;
        text-align: center;
      }
      .lead {
        font-family: "Ubuntu";
        font-size: 13px;
        margin: 0 0 16px;
        text-align: center;
        color: #526070;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        border: 2px solid #213547;
        margin-top: 8px;
      }
      th {
        font-family: "Roboto Condensed";
        font-size: 14px;
        font-weight: 700;
        padding: 10px 8px;
        border: 1px solid #9aa8b5;
        background: #edf2f7;
        text-align: center;
      }
      td {
        padding: 9px 8px;
        border: 1px solid #c8d2dc;
        font-size: 11px;
      }
      .anton {
        font-family: "Anton";
        font-size: 18px;
        color: #2f62d9;
        text-align: center;
      }
      .ubuntu {
        font-family: "Ubuntu";
      }
      .merri {
        font-family: "Merriweather";
      }
      .noto {
        font-family: "Noto Sans";
      }
      .right {
        text-align: right;
      }
      .center {
        text-align: center;
      }
      .soft {
        background: #f8fafc;
      }
    </style>
  </head>
  <body>
    <h1>Bundled Fonts Report</h1>
    <p class="lead">Offline font package test: regular, bold, italic, alignment, padding, borders and page numbers.</p>

    <table>
      <thead>
        <tr>
          <th>Family</th>
          <th>Regular</th>
          <th>Bold / Italic</th>
          <th>Alignment</th>
          <th>Usage</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="anton">Anton</td>
          <td class="anton">DISPLAY</td>
          <td class="anton"><strong>HEADLINE</strong></td>
          <td class="center">Center</td>
          <td>Large headings and badges</td>
        </tr>
        <tr class="soft">
          <td class="ubuntu">Ubuntu</td>
          <td class="ubuntu">Clean interface text</td>
          <td class="ubuntu"><strong>Bold</strong> / <em>Italic</em> / <strong><em>Both</em></strong></td>
          <td class="right">$12,450</td>
          <td>Compact UI-like reports</td>
        </tr>
        <tr>
          <td>Open Sans</td>
          <td>Default bundled font</td>
          <td><strong>Strong text</strong> / <em>Italic note</em></td>
          <td class="center">Centered cell</td>
          <td>General tables</td>
        </tr>
        <tr class="soft">
          <td class="merri">Merriweather</td>
          <td class="merri">Editorial paragraph text</td>
          <td class="merri"><strong>Bold serif</strong> / <em>Italic serif</em></td>
          <td class="right">Right</td>
          <td>Readable long-form blocks</td>
        </tr>
        <tr>
          <td class="noto">Noto Sans</td>
          <td class="noto">Broad Latin coverage</td>
          <td class="noto"><strong>Bold</strong> / <em>Italic</em></td>
          <td class="center">Center</td>
          <td>Fallback-friendly documents</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
`;

const result = await renderHtmlToPdfDetailed({
  html,
  recordId: "bundled-fonts",
  font: {
    bundled: bundledFonts.openSans,
    bundledFonts: [
      bundledFonts.anton,
      bundledFonts.ubuntu,
      bundledFonts.robotoCondensed,
      bundledFonts.merriweather,
      bundledFonts.notoSans,
    ],
  },
  pageHeader: {
    text: "Html2PdfSmith bundled fonts",
    align: "left",
  },
  pageFooter: {
    text: "Offline font package",
    align: "right",
  },
  pageNumbers: {
    enabled: true,
    format: "Page {page}",
    align: "center",
  },
  repeatHeaders: true,
  watermarkText: "HTML2PDFSMITH",
  watermarkOpacity: 0.08,
});

await writeFile("examples/bundled-fonts.pdf", result.pdf);

console.log({
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
