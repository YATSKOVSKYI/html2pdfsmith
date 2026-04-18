import { PDFDocument } from "pdf-lib";
import { fileURLToPath } from "node:url";
import { renderHtmlToPdfDetailed } from "../src/index";

process.env.HTML2PDFSMITH_CACHE_DIR ??= fileURLToPath(new URL("../tmp/cache", import.meta.url));

async function assertPdf(name: string, html: string, expectedPagesMin: number): Promise<void> {
  const result = await renderHtmlToPdfDetailed({ html, watermarkText: "SMOKE", watermarkOpacity: 10 });
  const loaded = await PDFDocument.load(result.pdf);
  const actualPages = loaded.getPageCount();
  if (actualPages !== result.pages) {
    throw new Error(`${name}: reported pages ${result.pages}, actual pages ${actualPages}`);
  }
  if (actualPages < expectedPagesMin) {
    throw new Error(`${name}: expected at least ${expectedPagesMin} pages, got ${actualPages}`);
  }
  console.log({ name, pages: actualPages, bytes: result.pdf.byteLength, warnings: result.warnings.length });
}

await assertPdf("document", `<!doctype html><html><body>
  <h1>Report</h1>
  <p>This is a browserless printable HTML document.</p>
  <ul><li>First item</li><li>Second item</li></ul>
  <hr>
  <p>End.</p>
</body></html>`, 1);

await assertPdf("table", `<!doctype html><html><body>
  <style>
    table { width: 100%; border-collapse: collapse; border: 1px solid #999; }
    th, td { border: 1px solid #bbb; padding: 6px 8px; }
    th { background-color: #eef3f8; text-align: center; }
  </style>
  <table>
    <thead><tr><th>Metric</th><th>A</th><th>B</th></tr></thead>
    <tbody>
      <tr><td>One</td><td>10</td><td>20</td></tr>
      <tr><td rowspan="2">Two</td><td colspan="2">30 / 40</td></tr>
      <tr><td>50</td><td>60</td></tr>
    </tbody>
  </table>
</body></html>`, 1);

const baseUrlResources = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><head>
    <link rel="stylesheet" href="assets/base-url-table.css">
  </head><body>
    <img class="logo" src="assets/base-url-logo.svg">
    <h1>Base URL Smoke</h1>
    <table><tbody><tr><td class="accent">External CSS</td><td class="right">OK</td></tr></tbody></table>
  </body></html>`,
  baseUrl: fileURLToPath(new URL("./", import.meta.url)),
  resourcePolicy: {
    allowHttp: false,
    allowFile: true,
    allowData: true,
    maxImageBytes: 500_000,
    maxStylesheetBytes: 100_000,
  },
});
const baseUrlLoaded = await PDFDocument.load(baseUrlResources.pdf);
if (baseUrlLoaded.getPageCount() !== baseUrlResources.pages) {
  throw new Error("base url resources: reported page count mismatch");
}
if (baseUrlResources.warnings.length > 1) {
  throw new Error(`base url resources: unexpected warnings ${JSON.stringify(baseUrlResources.warnings)}`);
}
console.log({ name: "base-url-resources", pages: baseUrlResources.pages, bytes: baseUrlResources.pdf.byteLength, warnings: baseUrlResources.warnings.length });

await assertPdf("document-blocks", `<!doctype html><html><body>
  <style>
    .quote { background-color: #f6f8fa; border-color: #94a3b8; }
    .boxed { border: 1px solid #94a3b8; padding: 8px 10px; margin: 6px 12px; line-height: 1.5; }
    tr.total { background-color: #eef7ee; font-weight: bold; text-align: right; }
  </style>
  <section>
    <div class="boxed">This plain div should render as a paragraph with <strong>bold</strong>, <em>italic</em>, <u>underline</u>, <span style="color: #2563eb">blue span</span>, <code>inlineCode()</code>, and <a href="https://example.com">a link</a>.</div>
    <blockquote class="quote">A blockquote should keep its own visual treatment.</blockquote>
    <pre>const answer = 42;
console.log(answer);</pre>
    <img style="width: 32px" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8Dwn6Hh/38AEXkEfRkE0tIAAAAASUVORK5CYII=">
  </section>
  <div style="page-break-after: always"></div>
  <table>
    <tbody>
      <tr><td>Subtotal</td><td>100</td></tr>
      <tr class="total"><td>Total</td><td>120</td></tr>
    </tbody>
  </table>
</body></html>`, 2);

const numbered = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><body><p>Numbered document.</p></body></html>`,
  pageHeader: { text: "Smoke Header", align: "right" },
  pageFooter: { text: "Smoke Footer", align: "left" },
  pageNumbers: { format: "Page {page}", align: "right" },
});
const numberedLoaded = await PDFDocument.load(numbered.pdf);
if (numberedLoaded.getPageCount() !== numbered.pages) {
  throw new Error("page chrome: reported page count mismatch");
}
console.log({ name: "page-chrome", pages: numbered.pages, bytes: numbered.pdf.byteLength, warnings: numbered.warnings.length });

const fontFallback = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><body>
    <table>
      <tbody>
        <tr>
          <td style="font-family: 'Roboto'; text-align: left; padding-left: 14px; font-size: 9pt">Left</td>
          <td style="font-family: 'Lato'; text-align: center; font-size: 11pt; font-weight: 400">Center</td>
          <td style="font-family: 'Merriweather'; text-align: right; font-size: 8pt; font-weight: 700; padding-right: 16px">Right</td>
        </tr>
      </tbody>
    </table>
  </body></html>`,
  font: { googleFonts: ["Roboto", "Lato", "Merriweather"] },
});
const fontFallbackLoaded = await PDFDocument.load(fontFallback.pdf);
if (fontFallbackLoaded.getPageCount() !== fontFallback.pages) {
  throw new Error("font table: reported page count mismatch");
}
console.log({ name: "font-table-css", pages: fontFallback.pages, bytes: fontFallback.pdf.byteLength, warnings: fontFallback.warnings.length });

for (const layer of ["background", "foreground", "both"] as const) {
  const watermarked = await renderHtmlToPdfDetailed({
    html: `<!doctype html><html><body>
      <p style="page-break-after: always">Watermark layer ${layer} page 1.</p>
      <p>Watermark layer ${layer} page 2.</p>
    </body></html>`,
    watermarkText: layer.toUpperCase(),
    watermarkLayer: layer,
    watermarkOpacity: 0.08,
  });
  const loaded = await PDFDocument.load(watermarked.pdf);
  if (loaded.getPageCount() !== watermarked.pages || watermarked.pages !== 2) {
    throw new Error(`watermark ${layer}: expected 2 pages, got ${watermarked.pages}`);
  }
  console.log({ name: `watermark-${layer}`, pages: watermarked.pages, bytes: watermarked.pdf.byteLength, warnings: watermarked.warnings.length });
}
