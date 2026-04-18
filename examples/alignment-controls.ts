import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";

const iconSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <rect x="8" y="8" width="80" height="80" rx="14" fill="#2563eb"/>
  <circle cx="48" cy="38" r="16" fill="#ffffff"/>
  <path d="M24 76c5-16 17-24 24-24s19 8 24 24" fill="#bfdbfe"/>
</svg>
`);

const icon = `data:image/svg+xml;charset=utf-8,${iconSvg}`;

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
        border-collapse: collapse;
        border: 2px solid #243447;
      }
      th {
        background-color: #e7eef7;
        border: 1px solid #90a4b8;
        padding: 8px;
        text-align: center;
        vertical-align: middle;
      }
      td {
        border: 1px solid #c3cfda;
        padding: 8px;
        height: 92px;
        font-size: 10px;
        line-height: 1.3;
      }
      .top { vertical-align: top; }
      .middle { vertical-align: middle; }
      .bottom { vertical-align: bottom; }
      .left { text-align: left; }
      .center { text-align: center; }
      .right { text-align: right; }
      .icon-cell {
        min-height: 112px;
      }
      .icon-cell img {
        width: 42px;
        height: 42px;
        object-fit: contain;
      }
      .cover img {
        width: 70px;
        height: 42px;
        object-fit: cover;
        object-position: center center;
      }
      .fill img {
        width: 70px;
        height: 42px;
        object-fit: fill;
      }
    </style>
  </head>
  <body>
    <h1>Cell Alignment Controls</h1>
    <table>
      <thead>
        <tr>
          <th>Top</th>
          <th>Middle</th>
          <th>Bottom</th>
          <th>Icon Top Left</th>
          <th>Icon Center</th>
          <th>Icon Bottom Right</th>
          <th>Object Fit</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="top left">Text aligned to the top left of a tall cell.</td>
          <td class="middle center">Text centered horizontally and vertically.</td>
          <td class="bottom right">Text aligned to the bottom right.</td>
          <td class="icon-cell top left"><img src="${icon}"></td>
          <td class="icon-cell middle center"><img src="${icon}"></td>
          <td class="icon-cell bottom right"><img src="${icon}"></td>
          <td class="icon-cell middle center cover"><img src="${icon}"></td>
        </tr>
        <tr>
          <td class="middle left">Middle left with normal wrapping and padding.</td>
          <td class="top center">Top center second line</td>
          <td class="bottom center">Bottom center second line</td>
          <td class="icon-cell middle left"><img src="${icon}" style="object-position: left center"></td>
          <td class="icon-cell middle center fill"><img src="${icon}"></td>
          <td class="icon-cell middle right"><img src="${icon}" style="object-position: right center"></td>
          <td class="icon-cell bottom center"><img src="${icon}" style="width: 54px; height: 54px; object-fit: contain;"></td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;

const result = await renderHtmlToPdfDetailed({
  html,
  hideHeader: true,
  resourcePolicy: { allowData: true },
  font: {
    bundled: bundledFonts.openSans,
    bundledFonts: [bundledFonts.anton],
  },
});

await Bun.write("examples/alignment-controls.pdf", result.pdf);

console.log({
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
