import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";

const arrowSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <rect x="8" y="8" width="80" height="80" rx="14" fill="#0f766e"/>
  <path d="M24 48h36" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>
  <path d="M52 28l20 20-20 20" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`);

const arrow = `data:image/svg+xml;charset=utf-8,${arrowSvg}`;

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
        text-align: center;
        margin: 0 0 10px;
        font-size: 26px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        border: 2px solid #243447;
      }
      th {
        background-color: #e8eef5;
        border: 1px solid #90a4b8;
        padding: 8px;
        text-align: center;
      }
      td {
        height: 108px;
        border: 1px solid #c3cfda;
        padding: 10px;
        text-align: center;
        vertical-align: middle;
        font-size: 9px;
      }
      img {
        width: 44px;
        height: 44px;
        object-fit: contain;
        object-position: center center;
      }
      .mirror-x img {
        transform: scaleX(-1);
        transform-origin: center center;
      }
      .mirror-y img {
        transform: scaleY(-1);
        transform-origin: center center;
      }
      .rotate img {
        transform: rotate(35deg);
      }
      .scale img {
        transform: scale(1.35);
      }
      .translate img {
        transform: translate(14px, -10px);
      }
      .webkit img {
        -webkit-transform: rotate(-25deg) scaleX(-1);
        -webkit-transform-origin: center center;
      }
      .faded img {
        opacity: 0.35;
      }
    </style>
  </head>
  <body>
    <h1>CSS Transform Controls</h1>
    <table>
      <thead>
        <tr>
          <th>Original</th>
          <th>scaleX(-1)</th>
          <th>scaleY(-1)</th>
          <th>rotate</th>
          <th>scale</th>
          <th>translate</th>
          <th>-webkit-transform</th>
          <th>opacity</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><img src="${arrow}"></td>
          <td class="mirror-x"><img src="${arrow}"></td>
          <td class="mirror-y"><img src="${arrow}"></td>
          <td class="rotate"><img src="${arrow}"></td>
          <td class="scale"><img src="${arrow}"></td>
          <td class="translate"><img src="${arrow}"></td>
          <td class="webkit"><img src="${arrow}"></td>
          <td class="faded"><img src="${arrow}"></td>
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

await Bun.write("examples/transform-controls.pdf", result.pdf);

console.log({
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
