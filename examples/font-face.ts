import { fileURLToPath } from "node:url";
import { renderHtmlToPdfDetailed } from "../src/index";
import { writeExamplePdf } from "./output";

const html = `
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="assets/font-face.css">
  </head>
  <body>
    <h1>CSS Font Face</h1>
    <p class="lead">Fonts are declared only through CSS @font-face and loaded through baseUrl/resourcePolicy.</p>
    <table>
      <thead>
        <tr>
          <th>Case</th>
          <th>Text</th>
          <th>Style</th>
          <th>Align</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Regular</td>
          <td>Open Sans loaded from @font-face</td>
          <td>font-weight: 400</td>
          <td class="center">Center</td>
        </tr>
        <tr>
          <td>Bold</td>
          <td><strong>Bold variant selected from CSS font-weight.</strong></td>
          <td class="blue">font-weight: 700</td>
          <td class="right">$12,450</td>
        </tr>
        <tr>
          <td>Italic</td>
          <td><em>Italic variant selected from CSS font-style.</em></td>
          <td>font-style: italic</td>
          <td class="center">OK</td>
        </tr>
        <tr>
          <td>Bold italic</td>
          <td><strong><em>Bold italic variant selected from both CSS properties.</em></strong></td>
          <td>font-weight + font-style</td>
          <td class="right">100%</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
`;

const result = await renderHtmlToPdfDetailed({
  html,
  baseUrl: fileURLToPath(new URL("./", import.meta.url)),
  resourcePolicy: {
    allowHttp: false,
    allowFile: true,
    allowData: true,
    maxFontBytes: 1_000_000,
    maxStylesheetBytes: 100_000,
  },
  hideHeader: true,
  watermarkText: "FONT FACE",
  watermarkOpacity: 0.06,
});

const output = await writeExamplePdf("font-face.pdf", result.pdf);

console.log({
  output,
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
