import { resolve } from "node:path";
import { renderHtmlToPdfDetailed, type RenderWarning } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";

interface MemorySnapshot {
  rss: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface BenchmarkMetrics {
  label: string;
  pages: number;
  targetPages: number;
  dataPages: number;
  rows: number;
  cells: number;
  htmlBytes: number;
  pdfBytes: number;
  renderMs: number;
  before: MemorySnapshot;
  after: MemorySnapshot;
  peakRss: number;
  deltaPeakRss: number;
  warnings: RenderWarning[];
}

const targetPages = Number(Bun.argv.find((arg) => arg.startsWith("--pages="))?.split("=")[1] ?? 15);
const dataPages = Math.max(1, targetPages - 1);
const rowsPerPage = Number(Bun.argv.find((arg) => arg.startsWith("--rows-per-page="))?.split("=")[1] ?? 12);
const outputPath = resolve(process.cwd(), Bun.argv.find((arg) => arg.endsWith(".pdf")) ?? "examples/internal-benchmark.pdf");

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024 * 10) / 10;
}

function memory(): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    rss: mb(usage.rss),
    heapUsed: mb(usage.heapUsed),
    external: mb(usage.external),
    arrayBuffers: mb(usage.arrayBuffers),
  };
}

function formatMs(ms: number): string {
  return `${Math.round(ms).toLocaleString("en-US")} ms`;
}

function formatMb(value: number): string {
  return `${value.toFixed(1)} MB`;
}

const iconSvg = (kind: "ok" | "warn" | "ev" | "range") => {
  const fill = kind === "ok" ? "#0f766e" : kind === "warn" ? "#b45309" : kind === "ev" ? "#2563eb" : "#7c3aed";
  const path = kind === "ok"
    ? `<path d="M18 33l9 9 20-24" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`
    : kind === "warn"
      ? `<path d="M32 15v22M32 47h.1" stroke="#fff" stroke-width="7" stroke-linecap="round"/>`
      : kind === "ev"
        ? `<path d="M38 10L22 34h13l-9 20 17-27H30l8-17Z" fill="#fff"/>`
        : `<path d="M15 34h34M37 22l12 12-12 12" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="14" fill="${fill}"/>${path}</svg>`)}`;
};

const patternSvg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><rect width="36" height="36" fill="#f8fafc"/><path d="M0 36L36 0" stroke="#dbeafe" stroke-width="5"/><circle cx="30" cy="30" r="3" fill="#bfdbfe"/></svg>`)}`;

function rowHtml(page: number, row: number): string {
  const index = (page - 1) * rowsPerPage + row + 1;
  const status = index % 9 === 0 ? "review" : index % 5 === 0 ? "warn" : "ok";
  const statusText = status === "ok" ? "ready" : status === "warn" ? "watch" : "review";
  const energy = index % 3 === 0 ? "Extended Range" : "Pure Electric";
  const range = 520 + (index % 12) * 35;
  const power = 150 + (index % 9) * 14;
  const price = 21800 + index * 335;
  const rowClass = row % 2 === 1 ? " alt" : "";
  const note = index % 4 === 0
    ? `Long value wraps cleanly with CO<sub>2</sub>, m<sup>3</sup>/h and X<span class="shift-up">n+1</span>.`
    : `Stable row with SVG icon, badges, colors, E=mc<span class="shift-up">2</span> and H<span class="shift-down">2</span>O.`;

  return `<tr class="${rowClass}">
    <td class="id">BEN-${String(index).padStart(4, "0")}</td>
    <td class="model">
      <div class="mini-card">
        <span class="corner">${2024 + index % 3}</span>
        <img class="mini-icon" src="${iconSvg(index % 4 === 0 ? "range" : "ev")}" alt="">
        <strong>AION ${index % 2 === 0 ? "i60" : "V Plus"}</strong>
        <span class="subline">${energy}</span>
      </div>
    </td>
    <td class="center"><span class="badge ${status}">${statusText}</span></td>
    <td class="right">${range}<span class="unit"> km</span></td>
    <td class="right">${power}<span class="unit"> kW</span></td>
    <td class="center">H<sub>2</sub> / LiFePO<sub>4</sub></td>
    <td class="right">$${price.toLocaleString("en-US")}</td>
    <td class="note">${note}</td>
  </tr>`;
}

function sectionTable(page: number): string {
  const rows = Array.from({ length: rowsPerPage }, (_, row) => rowHtml(page, row)).join("");
  return `<section class="bench-page">
    <table class="bench-table">
      <colgroup>
        <col style="width: 70px">
        <col style="width: 168px">
        <col style="width: 72px">
        <col style="width: 78px">
        <col style="width: 74px">
        <col style="width: 112px">
        <col style="width: 90px">
        <col>
      </colgroup>
      <thead>
        <tr>
          <th colspan="2">Vehicle</th>
          <th colspan="4">Technical Data</th>
          <th colspan="2">Commercial</th>
        </tr>
        <tr>
          <th>ID</th>
          <th>Model Card</th>
          <th>Status</th>
          <th>Range</th>
          <th>Power</th>
          <th>Chemistry</th>
          <th>Price</th>
          <th>Feature Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr class="section-row"><td colspan="8">Benchmark section ${page} | ${rowsPerPage} rows</td></tr>
        ${rows}
      </tbody>
    </table>
  </section>`;
}

function metricsHtml(metrics?: BenchmarkMetrics): string {
  const pending = !metrics;
  const memoryValues = pending ? "0,0,0" : `${metrics.before.rss},${metrics.deltaPeakRss},${metrics.peakRss}`;
  const renderValues = pending
    ? "0,0,0,0"
    : `${Math.round(metrics.renderMs)},${Math.round(metrics.pdfBytes / 1024)},${metrics.rows},${metrics.cells}`;
  const footprintValues = pending
    ? "0,0,0"
    : `${Math.round(metrics.after.heapUsed)},${Math.round(metrics.after.external)},${Math.round(metrics.after.arrayBuffers)}`;
  return `<section class="metrics-page">
    <h1>Html2PdfSmith Internal Benchmark</h1>
    <p class="lead">HTML table stress document with rich table cells, SVG, rounded badges, sub/sup, baseline-shift, page chrome, watermarks, repeated table structure, wrapping and alignment.</p>
    <chart class="chart-card chart-memory" type="bar" title="Memory profile" subtitle="Warm process, extra render memory, and whole process peak RSS" unit=" MB" data-labels="Warm RSS,Render Delta,Peak RSS" data-values="${memoryValues}" data-colors="#334155,#2563eb,#0f766e"></chart>
    <chart class="chart-card chart-line" type="line" title="Render workload" subtitle="Time, output size, rows, and cells in this HTML-first benchmark" data-labels="Time ms,PDF KB,Rows,Cells" data-values="${renderValues}" data-colors="#7c3aed"></chart>
    <chart class="chart-card chart-donut" type="donut" title="Runtime memory mix" subtitle="Heap, external allocations and array buffers after render" unit=" MB" data-labels="Heap,External,Buffers" data-values="${footprintValues}" data-colors="#2563eb,#f59e0b,#0f766e"></chart>
    <table class="memory-table">
      <tbody>
        <tr>
          <td class="memory-title" colspan="4">How to read memory</td>
        </tr>
        <tr>
          <td class="memory-label">Warm process before render</td>
          <td class="memory-value">${pending ? "pending" : formatMb(metrics.before.rss)}</td>
          <td class="memory-label">Extra memory while rendering</td>
          <td class="memory-value">${pending ? "pending" : formatMb(metrics.deltaPeakRss)}</td>
        </tr>
        <tr>
          <td class="memory-label">Whole process peak RSS</td>
          <td class="memory-value">${pending ? "pending" : formatMb(metrics.peakRss)}</td>
          <td class="memory-label">RSS after render</td>
          <td class="memory-value">${pending ? "pending" : formatMb(metrics.after.rss)}</td>
        </tr>
        <tr>
          <td class="memory-note" colspan="4">RSS is the Bun process memory. Html2PdfSmith does not launch Chromium. With a browser renderer, the server process and the separate browser process must be counted together.</td>
        </tr>
      </tbody>
    </table>
    <table class="metric-grid">
      <tbody>
        <tr>
          <td class="metric"><span class="metric-label">Render time</span><br><strong>${pending ? "pending" : formatMs(metrics.renderMs)}</strong></td>
          <td class="metric"><span class="metric-label">Peak RSS delta</span><br><strong>${pending ? "pending" : formatMb(metrics.deltaPeakRss)}</strong></td>
          <td class="metric"><span class="metric-label">Peak RSS</span><br><strong>${pending ? "pending" : formatMb(metrics.peakRss)}</strong></td>
          <td class="metric"><span class="metric-label">Heap used after</span><br><strong>${pending ? "pending" : formatMb(metrics.after.heapUsed)}</strong></td>
        </tr>
        <tr>
          <td class="metric"><span class="metric-label">PDF size</span><br><strong>${pending ? "pending" : `${Math.round(metrics.pdfBytes / 1024).toLocaleString("en-US")} KB`}</strong></td>
          <td class="metric"><span class="metric-label">HTML size</span><br><strong>${pending ? "pending" : `${Math.round(metrics.htmlBytes / 1024).toLocaleString("en-US")} KB`}</strong></td>
          <td class="metric"><span class="metric-label">Rows / cells</span><br><strong>${pending ? "pending" : `${metrics.rows} / ${metrics.cells}`}</strong></td>
          <td class="metric"><span class="metric-label">Pages</span><br><strong>${pending ? targetPages : `${metrics.pages} / target ${metrics.targetPages}`}</strong></td>
        </tr>
      </tbody>
    </table>
    <p class="footnote">Warnings: ${pending ? "pending" : metrics.warnings.length === 0 ? "none" : metrics.warnings.map((warning) => warning.code).join(", ")}.</p>
  </section>`;
}

function buildBenchmarkHtml(metrics?: BenchmarkMetrics): string {
  const dataSections = Array.from({ length: dataPages }, (_, index) => sectionTable(index + 1)).join(`<div style="page-break-after: always"></div>`);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Html2PdfSmith Internal Benchmark</title>
    <style>
      @page { size: A4 landscape; margin: 6mm; }
      body { font-family: "Open Sans"; color: #172033; }
      .bench-page { padding-top: 2px; }
      .bench-table { width: 100%; table-layout: fixed; border-collapse: collapse; border: 1px solid #d5dce7; }
      th { padding: 5px 5px; border: 1px solid #b8c4d3; background-color: #e9eff7; color: #172033; font-family: "Roboto Condensed"; font-size: 8px; font-weight: 700; text-transform: uppercase; text-align: center; }
      td { padding: 3px 5px; border: 1px solid #d9e0ea; font-size: 6.9px; line-height: 1.14; vertical-align: middle; }
      tr.alt td { background-color: #fbfcfe; }
      .section-row td { padding: 6px 9px; background-color: #172033; color: #ffffff; font-family: "Roboto Condensed"; font-size: 9px; font-weight: 700; text-align: left; text-transform: uppercase; }
      .id { font-family: "Noto Sans"; color: #42526a; white-space: nowrap; }
      .model { padding: 4px; }
      .mini-card { position: relative; height: 32px; overflow: hidden; border-radius: 7px; border: 1px solid #d5dce7; background-color: #ffffff; background-image: url("${patternSvg}"); background-size: 32px 32px; background-repeat: repeat; }
      .corner { position: absolute; top: 0; left: 0; display: inline-block; width: 28px; padding: 2px 0; border-radius: 7px 0 6px 0; background-color: #e2e8f0; border: 1px solid #cbd5e1; color: #475569; font-size: 5.2px; font-weight: 800; text-align: center; vertical-align: middle; }
      .mini-icon { width: 18px; height: 18px; margin-top: 12px; margin-left: 8px; object-fit: contain; }
      .mini-card strong { position: absolute; left: 34px; top: 8px; font-size: 7.6px; color: #111827; }
      .mini-card .subline { position: absolute; left: 34px; top: 20px; font-size: 5.8px; color: #64748b; }
      .badge { display: inline-block; padding: 3px 7px; border-radius: 999px; font-size: 6.5px; font-weight: 800; text-transform: uppercase; white-space: nowrap; text-align: center; vertical-align: middle; }
      .ok { background-color: #dcfce7; color: #14532d; border: 1px solid #86efac; }
      .warn { background-color: #fff7ed; color: #9a3412; border: 1px dashed #fdba74; }
      .review { background-color: #dbeafe; color: #1e3a8a; border: 1px solid #93c5fd; }
      .center { text-align: center; }
      .right { text-align: right; white-space: nowrap; }
      .unit { color: #64748b; font-size: 6.5px; }
      .note { color: #475569; overflow-wrap: break-word; }
      .shift-up { baseline-shift: 35%; font-size: 70%; color: #0f766e; }
      .shift-down { baseline-shift: -20%; font-size: 70%; color: #9a3412; }
      .metrics-page { padding: 8px 18px; }
      .metrics-page h1 { margin: 0 0 4px; font-family: "Anton"; font-size: 23px; font-weight: 400; color: #111827; text-align: center; }
      .lead { margin: 0 0 7px; font-size: 7.8px; color: #5b677a; text-align: center; line-height: 1.3; }
      .chart-card { height: 58px; margin-bottom: 5px; padding: 7px 10px; border: 1px solid #d8e0ea; border-radius: 8px; background-color: #ffffff; box-shadow: 0 5px 14px rgba(15, 23, 42, 0.10); }
      .chart-line { height: 52px; }
      .chart-donut { height: 54px; }
      .memory-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0 0 8px; border: 1px solid #cbd5e1; }
      .memory-title { padding: 6px 8px; background-color: #172033; color: #ffffff; font-family: "Roboto Condensed"; font-size: 9px; font-weight: 700; text-transform: uppercase; }
      .memory-label { padding: 7px 8px; background-color: #eef3f8; color: #475569; font-size: 7px; font-weight: 700; text-transform: uppercase; }
      .memory-value { padding: 7px 8px; color: #0f172a; font-size: 11px; font-weight: 800; }
      .memory-note { padding: 8px; background-color: #f8fafc; color: #475569; font-size: 7.5px; line-height: 1.35; }
      .metric-grid { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 5px 0 8px; border: 0; }
      .metric { padding: 7px 8px; border: 4px solid #ffffff; border-radius: 8px; background-color: #f8fafc; }
      .metric-label { color: #64748b; font-size: 7px; text-transform: uppercase; }
      .metric strong { color: #0f172a; font-size: 10.5px; }
      .footnote { margin-top: 0; margin-bottom: 0; color: #64748b; font-size: 6.8px; text-align: center; }
    </style>
  </head>
  <body>
    ${dataSections}
    <div style="page-break-after: always"></div>
    ${metricsHtml(metrics)}
  </body>
</html>`;
}

async function measuredRender(html: string, label: string): Promise<{ pdf: Uint8Array; metrics: BenchmarkMetrics }> {
  Bun.gc?.(true);
  const before = memory();
  let peakRss = before.rss;
  const timer = setInterval(() => {
    peakRss = Math.max(peakRss, memory().rss);
  }, 5);
  const start = performance.now();
  const result = await renderHtmlToPdfDetailed({
    html,
    hideHeader: true,
    tableHeaderRepeat: "auto",
    repeatHeaders: true,
    text: { overflowWrap: "break-word" },
    pageHeader: { text: "Html2PdfSmith internal benchmark", align: "left", fontSize: 7, color: "#64748b" },
    pageFooter: { text: "Browserless HTML to PDF - Bun runtime", align: "right", fontSize: 7, color: "#64748b" },
    pageNumbers: { enabled: true, format: "Page {page}", align: "center", fontSize: 7, color: "#64748b" },
    watermarkText: "HTML2PDFSMITH",
    watermarkLayer: "background",
    watermarkOpacity: 0.035,
    watermarkScale: 44,
    font: {
      bundled: bundledFonts.openSans,
      bundledFonts: [
        bundledFonts.anton,
        bundledFonts.robotoCondensed,
        bundledFonts.notoSans,
      ],
    },
    resourcePolicy: { allowData: true, allowFile: false, allowHttp: false },
  });
  clearInterval(timer);
  Bun.gc?.(true);
  const after = memory();
  peakRss = Math.max(peakRss, after.rss);
  const rows = dataPages * rowsPerPage;
  const metrics: BenchmarkMetrics = {
    label,
    pages: result.pages,
    targetPages,
    dataPages,
    rows,
    cells: rows * 8,
    htmlBytes: html.length,
    pdfBytes: result.pdf.byteLength,
    renderMs: performance.now() - start,
    before,
    after,
    peakRss,
    deltaPeakRss: Math.round((peakRss - before.rss) * 10) / 10,
    warnings: result.warnings,
  };
  return { pdf: result.pdf, metrics };
}

const firstHtml = buildBenchmarkHtml();
const measured = await measuredRender(firstHtml, "measured");
const finalHtml = buildBenchmarkHtml(measured.metrics);
const final = await measuredRender(finalHtml, "final");

await Bun.write(outputPath, final.pdf);

console.log(JSON.stringify({
  output: outputPath,
  measured: {
    pages: measured.metrics.pages,
    renderMs: Math.round(measured.metrics.renderMs),
    rssBeforeMb: measured.metrics.before.rss,
    rssAfterMb: measured.metrics.after.rss,
    peakRssMb: measured.metrics.peakRss,
    deltaPeakRssMb: measured.metrics.deltaPeakRss,
    pdfBytes: measured.metrics.pdfBytes,
    warnings: measured.metrics.warnings,
    memoryMeaning: "deltaPeakRssMb is the extra RSS used by the render inside the already-running Bun process. peakRssMb is the whole Bun process RSS, not a separate browser.",
  },
  final: {
    pages: final.metrics.pages,
    renderMs: Math.round(final.metrics.renderMs),
    rssBeforeMb: final.metrics.before.rss,
    rssAfterMb: final.metrics.after.rss,
    peakRssMb: final.metrics.peakRss,
    deltaPeakRssMb: final.metrics.deltaPeakRss,
    pdfBytes: final.metrics.pdfBytes,
    warnings: final.metrics.warnings,
    memoryMeaning: "This pass writes the measured-pass numbers into the final PDF.",
  },
}, null, 2));
