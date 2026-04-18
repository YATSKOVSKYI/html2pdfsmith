import { PDFDocument } from "pdf-lib";
import { renderHtmlToPdfDetailed } from "../src/index";

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
