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

const fontFace = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><head>
    <link rel="stylesheet" href="assets/font-face.css">
  </head><body>
    <h1>Font Face Smoke</h1>
    <table><tbody><tr><td>Regular</td><td><strong><em>Bold italic</em></strong></td></tr></tbody></table>
  </body></html>`,
  baseUrl: fileURLToPath(new URL("./", import.meta.url)),
  resourcePolicy: {
    allowHttp: false,
    allowFile: true,
    allowData: true,
    maxFontBytes: 1_000_000,
    maxStylesheetBytes: 100_000,
  },
});
const fontFaceLoaded = await PDFDocument.load(fontFace.pdf);
if (fontFaceLoaded.getPageCount() !== fontFace.pages) {
  throw new Error("font face: reported page count mismatch");
}
if (fontFace.warnings.length !== 0) {
  throw new Error(`font face: unexpected warnings ${JSON.stringify(fontFace.warnings)}`);
}
console.log({ name: "font-face-css", pages: fontFace.pages, bytes: fontFace.pdf.byteLength, warnings: fontFace.warnings.length });

const pageWrapRepeat = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><head><style>
    @page { size: A4 landscape; margin: 8mm; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    th, td { border: 1px solid #bbb; padding: 6px; overflow-wrap: anywhere; }
  </style></head><body>
    <table>
      <thead><tr><th>ID</th><th>Long token</th></tr></thead>
      <tbody>${Array.from({ length: 28 }, (_, i) => `<tr><td>${i + 1}</td><td>LONG_UNBROKEN_TOKEN_${"X".repeat(80)}</td></tr>`).join("")}</tbody>
    </table>
  </body></html>`,
  hideHeader: true,
  tableHeaderRepeat: "auto",
  text: { overflowWrap: "break-word" },
});
const pageWrapLoaded = await PDFDocument.load(pageWrapRepeat.pdf);
if (pageWrapLoaded.getPageCount() !== pageWrapRepeat.pages || pageWrapRepeat.orientation !== "landscape") {
  throw new Error("page wrap repeat: page count or orientation mismatch");
}
console.log({ name: "page-wrap-repeat", pages: pageWrapRepeat.pages, bytes: pageWrapRepeat.pdf.byteLength, warnings: pageWrapRepeat.warnings.length });

const mergedTable = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><head><style>
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    th, td { border: 1px solid #bbb; padding: 9px; overflow-wrap: anywhere; }
    .group { break-inside: avoid; }
  </style></head><body>
    <table>
      <thead><tr><th rowspan="2">Group</th><th colspan="2">Data</th></tr><tr><th>Name</th><th>Long value</th></tr></thead>
      <tbody>${Array.from({ length: 12 }, (_, i) => `
        <tr class="group"><td rowspan="2">Group ${i + 1}</td><td>A</td><td>${"MERGED_LONG_VALUE_".repeat(5)}</td></tr>
        <tr class="group"><td>B</td><td>${"MERGED_LONG_VALUE_".repeat(5)}</td></tr>
      `).join("")}</tbody>
    </table>
  </body></html>`,
  hideHeader: true,
  tableHeaderRepeat: "auto",
  table: { rowspanPagination: "avoid" },
  text: { overflowWrap: "break-word" },
});
const mergedLoaded = await PDFDocument.load(mergedTable.pdf);
if (mergedLoaded.getPageCount() !== mergedTable.pages) {
  throw new Error("merged table: reported page count mismatch");
}
console.log({ name: "merged-table-pagination", pages: mergedTable.pages, bytes: mergedTable.pdf.byteLength, warnings: mergedTable.warnings.length });

const wideTable = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><head><style>
    @page { size: A4 landscape; margin: 8mm; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    th, td { border: 1px solid #bbb; padding: 6px; overflow-wrap: anywhere; }
  </style></head><body>
    <table>
      <thead>
        <tr><th rowspan="2">Pinned</th><th colspan="8">Wide metrics</th></tr>
        <tr>${Array.from({ length: 8 }, (_, i) => `<th>M${i + 1}</th>`).join("")}</tr>
      </thead>
      <tbody>${Array.from({ length: 8 }, (_, row) => `
        <tr><td>Row ${row + 1}</td>${Array.from({ length: 8 }, (_, col) => `<td>${row + 1}-${col + 1}-${"LONGVALUE".repeat(3)}</td>`).join("")}</tr>
      `).join("")}</tbody>
    </table>
  </body></html>`,
  hideHeader: true,
  tableHeaderRepeat: "auto",
  table: {
    horizontalPagination: "always",
    horizontalPageColumns: 3,
    repeatColumns: 1,
    rowspanPagination: "avoid",
  },
  text: { overflowWrap: "break-word" },
});
const wideLoaded = await PDFDocument.load(wideTable.pdf);
if (wideLoaded.getPageCount() !== wideTable.pages || wideTable.pages < 2) {
  throw new Error("wide table: horizontal pagination did not produce multiple pages");
}
console.log({ name: "wide-table-pagination", pages: wideTable.pages, bytes: wideTable.pdf.byteLength, warnings: wideTable.warnings.length });

const alignmentIcon = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" rx="10" fill="#2563eb"/><circle cx="32" cy="30" r="11" fill="#fff"/></svg>`)}`;
const alignment = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><head><style>
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #bbb; padding: 6px; height: 72px; }
    .top { vertical-align: top; text-align: left; }
    .middle { vertical-align: middle; text-align: center; }
    .bottom { vertical-align: bottom; text-align: right; }
    img { width: 28px; height: 28px; object-fit: contain; }
  </style></head><body>
    <table>
      <tbody>
        <tr><td class="top">Top</td><td class="middle">Middle</td><td class="bottom">Bottom</td></tr>
        <tr><td class="top"><img src="${alignmentIcon}"></td><td class="middle"><img src="${alignmentIcon}"></td><td class="bottom"><img src="${alignmentIcon}"></td></tr>
      </tbody>
    </table>
  </body></html>`,
  hideHeader: true,
  resourcePolicy: { allowData: true },
});
const alignmentLoaded = await PDFDocument.load(alignment.pdf);
if (alignmentLoaded.getPageCount() !== alignment.pages) {
  throw new Error("alignment: reported page count mismatch");
}
console.log({ name: "alignment-controls", pages: alignment.pages, bytes: alignment.pdf.byteLength, warnings: alignment.warnings.length });

const transformIcon = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" rx="9" fill="#0f766e"/><path d="M18 32h22" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M36 20l12 12-12 12" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`)}`;
const transforms = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><head><style>
    table { width: 100%; border-collapse: collapse; }
    td { border: 1px solid #bbb; padding: 8px; height: 72px; text-align: center; vertical-align: middle; }
    img { width: 30px; height: 30px; object-fit: contain; transform-origin: center center; }
    .mirror img { transform: scaleX(-1); }
    .rotate img { -webkit-transform: rotate(20deg) scale(1.1); -webkit-transform-origin: center center; }
    .faded img { opacity: 0.4; transform: translate(6px, -3px); }
  </style></head><body>
    <table><tbody><tr>
      <td><img src="${transformIcon}"></td>
      <td class="mirror"><img src="${transformIcon}"></td>
      <td class="rotate"><img src="${transformIcon}"></td>
      <td class="faded"><img src="${transformIcon}"></td>
    </tr></tbody></table>
    <img style="width: 40px; height: 40px; transform: rotate(-15deg); opacity: .6" src="${transformIcon}">
  </body></html>`,
  hideHeader: true,
  resourcePolicy: { allowData: true },
});
const transformsLoaded = await PDFDocument.load(transforms.pdf);
if (transformsLoaded.getPageCount() !== transforms.pages) {
  throw new Error("transforms: reported page count mismatch");
}
console.log({ name: "transform-controls", pages: transforms.pages, bytes: transforms.pdf.byteLength, warnings: transforms.warnings.length });

const layoutControls = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><head><style>
    table { width: 100%; table-layout: fixed; border-collapse: collapse; }
    th, td { border: 1px solid #bbb; padding: 6px; height: 48px; }
    th { border-bottom: 2px solid #222; }
    .nowrap { white-space: nowrap; }
    .ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pre { white-space: pre-line; }
    .sides { border-left: 3px solid #2563eb; border-right: 2px dashed #d97706; border-bottom: 2px dotted #059669; }
  </style></head><body>
    <table>
      <colgroup><col style="width: 70px"><col style="width: 120px"><col style="width: 30%"><col></colgroup>
      <thead><tr><th>ID</th><th>No wrap</th><th>Ellipsis</th><th>Pre</th></tr></thead>
      <tbody><tr><td class="sides">1</td><td class="nowrap">VIN-UNBROKEN-123456789</td><td class="ellipsis">Very long text value that should be shortened with an ellipsis</td><td class="pre">One
Two</td></tr></tbody>
    </table>
  </body></html>`,
  hideHeader: true,
});
const layoutLoaded = await PDFDocument.load(layoutControls.pdf);
if (layoutLoaded.getPageCount() !== layoutControls.pages) {
  throw new Error("layout controls: reported page count mismatch");
}
console.log({ name: "layout-controls", pages: layoutControls.pages, bytes: layoutControls.pdf.byteLength, warnings: layoutControls.warnings.length });

const visualBg = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#eff6ff"/><path d="M0 32L32 0" stroke="#93c5fd" stroke-width="4"/></svg>`)}`;
const visualCss = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><head><style>
    .card { padding: 10px; margin-bottom: 8px; border-radius: 6px; background-color: #fff; background-image: url("${visualBg}"); background-size: 32px 32px; background-repeat: repeat; box-shadow: 0 4px 10px rgba(15, 23, 42, .22); text-transform: capitalize; }
    table { width: 100%; border-collapse: collapse; }
    td { height: 60px; border: 1px solid #bbb; padding: 6px; border-radius: 6px; background-image: url("${visualBg}"); background-size: contain; background-repeat: no-repeat; background-position: center center; text-transform: uppercase; }
  </style></head><body>
    <div class="card">visual css controls</div>
    <table><tbody><tr><td>approved</td><td style="box-shadow: 0 4px 8px rgba(0,0,0,.2)">shadow cell</td></tr></tbody></table>
  </body></html>`,
  hideHeader: true,
  resourcePolicy: { allowData: true },
});
const visualLoaded = await PDFDocument.load(visualCss.pdf);
if (visualLoaded.getPageCount() !== visualCss.pages) {
  throw new Error("visual css: reported page count mismatch");
}
console.log({ name: "visual-css-controls", pages: visualCss.pages, bytes: visualCss.pdf.byteLength, warnings: visualCss.warnings.length });

const productionLayout = await renderHtmlToPdfDetailed({
  html: `<!doctype html><html><head><style>
    @media screen { h1 { color: red; } .screen-only { display: block; } }
    @media print { h1 { color: #102a43; text-transform: uppercase; } .screen-only { display: none; } .print-only { display: block; } }
    .print-only { border-radius: 6px; overflow: hidden; background-color: #eef6ff; padding: 8px; box-shadow: 0 3px 8px rgba(0,0,0,.18); }
    table { width: 100%; table-layout: auto; border-collapse: collapse; }
    th, td { border: 1px solid #bbb; padding: 6px; }
    .sku { white-space: nowrap; }
    .name { overflow-wrap: break-word; }
    .clip { border-radius: 8px; overflow: hidden; background-color: #dcfce7; text-transform: uppercase; }
  </style></head><body>
    <h1>production layout</h1>
    <p class="screen-only">screen only</p>
    <div class="print-only">print only</div>
    <table><thead><tr><th>ID</th><th>SKU</th><th>Name</th><th>Status</th></tr></thead>
      <tbody><tr><td>1</td><td class="sku">SKU-LONG-00001</td><td class="name">Long content-driven column title</td><td class="clip">approved status</td></tr></tbody></table>
  </body></html>`,
  hideHeader: true,
});
const productionLoaded = await PDFDocument.load(productionLayout.pdf);
if (productionLoaded.getPageCount() !== productionLayout.pages) {
  throw new Error("production layout: reported page count mismatch");
}
console.log({ name: "production-layout-controls", pages: productionLayout.pages, bytes: productionLayout.pdf.byteLength, warnings: productionLayout.warnings.length });

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
