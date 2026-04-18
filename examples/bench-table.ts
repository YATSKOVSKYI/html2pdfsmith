import { renderHtmlToPdfDetailed } from "../src/index";

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024 * 10) / 10;
}

function memory() {
  const usage = process.memoryUsage();
  return {
    rss: mb(usage.rss),
    heapUsed: mb(usage.heapUsed),
    external: mb(usage.external),
    arrayBuffers: mb(usage.arrayBuffers),
  };
}

function buildTableHtml(columns: number, rows: number): string {
  const head = Array.from({ length: columns }, (_, i) =>
    `<th data-column-id="c${i}">Column ${i + 1} Long Header 中文 Кириллица</th>`,
  ).join("");

  const prices = Array.from({ length: columns }, (_, i) =>
    `<th class="price" data-column-id="c${i}">$${199 + i * 25}</th>`,
  ).join("");

  const body: string[] = [];
  for (let row = 0; row < rows; row++) {
    if (row % 25 === 0) {
      body.push(`<tr class="section-title"><td colspan="${columns + 1}" class="section-header">Section ${Math.floor(row / 25) + 1}</td></tr>`);
    }
    const cells = Array.from({ length: columns }, (_, col) =>
      `<td${(row + col) % 4 === 0 ? ' class="diff"' : ""}>Value ${row}-${col}<br>中文 параметр ${"x".repeat((row + col) % 18)}</td>`,
    ).join("");
    body.push(`<tr><td class="param-name">Metric ${row + 1}</td>${cells}</tr>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <header class="header"><div class="brand-name">MEMORY BENCH</div></header>
    <div class="table-container"><table>
      <thead><tr><th class="param-name">Metric</th>${head}</tr><tr><th class="param-name"></th>${prices}</tr></thead>
      <tbody>${body.join("\n")}</tbody>
    </table></div>
  </body></html>`;
}

const columns = Number(process.argv[2] ?? 10);
const rows = Number(process.argv[3] ?? 100);
const watermark = process.argv.includes("--watermark");
const autoDiscoverFonts = process.argv.includes("--auto-font");

Bun.gc?.(true);
const before = memory();
let peakRss = before.rss;
const timer = setInterval(() => {
  peakRss = Math.max(peakRss, memory().rss);
}, 5);

const html = buildTableHtml(columns, rows);
const start = performance.now();
const result = await renderHtmlToPdfDetailed({
  html,
  repeatHeaders: true,
  ...(autoDiscoverFonts ? { font: { autoDiscover: true } } : {}),
  ...(watermark ? { watermarkText: "CONFIDENTIAL", watermarkScale: 35, watermarkOpacity: 15 } : {}),
});

clearInterval(timer);
Bun.gc?.(true);
const after = memory();
peakRss = Math.max(peakRss, after.rss);

console.log(JSON.stringify({
  columns,
  rows,
  watermark,
  autoDiscoverFonts,
  htmlBytes: html.length,
  pdfBytes: result.pdf.byteLength,
  pages: result.pages,
  ms: Math.round(performance.now() - start),
  before,
  after,
  peakRssMb: peakRss,
  deltaPeakRssMb: Math.round((peakRss - before.rss) * 10) / 10,
  warnings: result.warnings,
}, null, 2));
