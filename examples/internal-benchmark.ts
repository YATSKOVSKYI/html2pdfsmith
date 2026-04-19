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
const fixedBenchmarkPages = 4; // title, formulas, charts, metrics
const dataPages = Math.max(1, targetPages - fixedBenchmarkPages);
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
    ? "Long descriptive value wraps cleanly without clipping and keeps alignment stable."
    : "Stable row with SVG icon, badges, zebra shading, colors and compact numeric cells.";

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
    <td class="center">${index % 2 === 0 ? "LFP / NMC" : "LFP pack"}</td>
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

function coverHtml(metrics?: BenchmarkMetrics): string {
  const pending = !metrics;
  return `<section class="cover-page">
    <h1>Html2PdfSmith</h1>
    <h2>Internal Rendering Benchmark</h2>
    <p class="cover-lead">Browserless HTML to PDF stress document for tables, charts, SVG, watermarks, page chrome, bundled fonts, rich cells, formula typography and memory reporting.</p>
    <table class="cover-grid">
      <tbody>
        <tr>
          <td class="cover-label">Document shape</td>
          <td class="cover-label">Table body</td>
          <td class="cover-label">Rows</td>
          <td class="cover-label">Cells</td>
        </tr>
        <tr>
          <td class="cover-value">${targetPages} pages target</td>
          <td class="cover-value">${dataPages} sections</td>
          <td class="cover-value">${pending ? dataPages * rowsPerPage : metrics.rows}</td>
          <td class="cover-value">${pending ? dataPages * rowsPerPage * 8 : metrics.cells}</td>
        </tr>
        <tr>
          <td class="cover-label">Runtime</td>
          <td class="cover-label">Renderer</td>
          <td class="cover-label">PDF pipeline</td>
          <td class="cover-label">Warnings</td>
        </tr>
        <tr>
          <td class="cover-value">Bun</td>
          <td class="cover-value">No Chromium</td>
          <td class="cover-value">Streaming</td>
          <td class="cover-value">${pending ? "pending" : metrics.warnings.length === 0 ? "none" : String(metrics.warnings.length)}</td>
        </tr>
      </tbody>
    </table>
    <table class="cover-feature-grid">
      <tbody>
        <tr>
          <td class="feature-key">Tables</td><td>fixed columns, zebra rows, badges, SVG icons, repeated headers</td>
          <td class="feature-key">Charts</td><td>bar, line and donut blocks rendered directly into PDF</td>
        </tr>
        <tr>
          <td class="feature-key">Typography</td><td>Anton headings, bundled fonts, sub/sup and baseline-shift</td>
          <td class="feature-key">Production</td><td>page chrome, watermarks, RSS accounting and warning collection</td>
        </tr>
      </tbody>
    </table>
    <p class="cover-note">The benchmark is built from plain HTML. TypeScript only prepares the fixture and records metrics.</p>
  </section>`;
}

function formulasHtml(): string {
  return `<section class="formula-page">
    <h1>Formula Typography</h1>
    <p class="lead">Subscript, superscript and baseline-shift are tested here only, so regular tables stay clean.</p>
    <table class="formula-table">
      <thead><tr><th>Feature</th><th>HTML</th><th>Rendered sample</th><th>Use case</th></tr></thead>
      <tbody>
        <tr><td>Superscript</td><td>&lt;sup&gt;</td><td class="formula-sample">E = mc<sup>2</sup>, x<sup>n+1</sup></td><td>Math powers and annotations</td></tr>
        <tr class="alt"><td>Subscript</td><td>&lt;sub&gt;</td><td class="formula-sample">H<sub>2</sub>O, CO<sub>2</sub>, LiFePO<sub>4</sub></td><td>Chemistry and engineering labels</td></tr>
        <tr><td>Baseline up</td><td>baseline-shift: 35%</td><td class="formula-sample">Signal<span class="shift-up">+12%</span></td><td>Template-driven labels</td></tr>
        <tr class="alt"><td>Baseline down</td><td>baseline-shift: -20%</td><td class="formula-sample">Batch<span class="shift-down">rev.2</span></td><td>SVG/CSS imported templates</td></tr>
        <tr><td>Mixed inline</td><td>sup + sub + text</td><td class="formula-sample">m<sup>3</sup>/h, NO<sub>x</sub>, A<span class="shift-up">top</span>B<span class="shift-down">low</span></td><td>Dense technical reports</td></tr>
      </tbody>
    </table>
  </section>`;
}

function chartsHtml(metrics?: BenchmarkMetrics): string {
  const pending = !metrics;
  const memoryValues = pending ? "0,0,0" : `${metrics.before.rss},${metrics.deltaPeakRss},${metrics.peakRss}`;
  const renderValues = pending
    ? "0,0,0,0,0"
    : `${Math.round(metrics.before.rss)},${Math.round(metrics.after.rss)},${Math.round(metrics.peakRss)},${Math.round(metrics.pdfBytes / 1024)},${Math.round(metrics.renderMs / 10)}`;
  const footprintValues = pending
    ? "0,0,0"
    : `${Math.round(metrics.after.heapUsed)},${Math.round(metrics.after.external)},${Math.round(metrics.after.arrayBuffers)}`;
  return `<section class="charts-page">
    <h1>Benchmark Charts</h1>
    <p class="lead">Large chart blocks are rendered directly by Html2PdfSmith. No canvas, no JavaScript, no browser process.</p>
    <chart class="chart-card chart-memory" type="bar" title="Memory profile" subtitle="Warm process, render delta, and whole process peak RSS" unit=" MB" data-labels="Warm,Render,Peak" data-values="${memoryValues}" data-colors="#334155,#2563eb,#0f766e"></chart>
    <chart class="chart-card chart-line" type="line" title="Render signal" subtitle="RSS before/after, peak RSS, PDF KB, and render time divided by 10" data-labels="Before,After,Peak,PDF KB,ms/10" data-values="${renderValues}" data-colors="#7c3aed"></chart>
    <chart class="chart-card chart-donut" type="donut" title="Runtime memory mix" subtitle="Heap, external allocations and array buffers after render" unit=" MB" data-labels="Heap,External,Buffers" data-values="${footprintValues}" data-colors="#2563eb,#f59e0b,#0f766e"></chart>
  </section>`;
}

function metricsHtml(metrics?: BenchmarkMetrics): string {
  const pending = !metrics;
  return `<section class="metrics-page">
    <h1>Memory & Output</h1>
    <p class="lead">These numbers separate a warm Bun process from extra memory used by a PDF render.</p>
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
      .cover-page, .formula-page, .charts-page, .metrics-page { padding: 10px 18px; }
      .cover-page h1, .formula-page h1, .charts-page h1, .metrics-page h1 { margin: 0 0 3px; font-family: "Anton"; font-size: 31px; font-weight: 400; color: #101827; text-align: center; }
      .cover-page h2 { margin: 0 0 12px; font-family: "Roboto Condensed"; font-size: 13px; font-weight: 700; color: #475569; text-align: center; text-transform: uppercase; }
      .cover-lead { margin: 0 36px 22px; font-size: 11px; line-height: 1.55; color: #475569; text-align: center; }
      .cover-grid { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 10px 0 18px; border: 1px solid #d8e0ea; }
      .cover-grid td { border: 1px solid #d8e0ea; background-color: #f8fafc; text-align: center; }
      .cover-label { padding: 12px 12px 4px; color: #64748b; font-size: 7.5px; text-transform: uppercase; }
      .cover-value { padding: 4px 12px 14px; color: #0f172a; font-size: 15px; font-weight: 800; }
      .cover-feature-grid { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 18px 0 14px; border: 1px solid #d8e0ea; }
      .cover-feature-grid td { padding: 12px 14px; border: 1px solid #d8e0ea; font-size: 8.5px; line-height: 1.4; }
      .feature-key { background-color: #e7edf6; color: #172033; font-family: "Roboto Condensed"; font-size: 9px; font-weight: 700; text-transform: uppercase; }
      .cover-note { margin-top: 20px; font-size: 9px; color: #64748b; text-align: center; }
      .bench-page { padding-top: 2px; }
      .bench-table { width: 100%; table-layout: fixed; border-collapse: collapse; border: 1px solid #cfd8e6; }
      th { padding: 5px 5px; border: 1px solid #b8c4d3; background-color: #e7edf6; color: #172033; font-family: "Roboto Condensed"; font-size: 8px; font-weight: 700; text-transform: uppercase; text-align: center; }
      td { padding: 3px 5px; border: 1px solid #d8e1ec; font-size: 6.9px; line-height: 1.14; vertical-align: middle; }
      tr.alt td { background-color: #f2f6fb; }
      .bench-table tbody tr:not(.alt):not(.section-row) td { background-color: #ffffff; }
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
      .lead { margin: 0 0 12px; font-size: 8.5px; color: #5b677a; text-align: center; line-height: 1.35; }
      .formula-table { width: 100%; table-layout: fixed; border-collapse: collapse; border: 1px solid #d8e0ea; margin-top: 18px; }
      .formula-table th { padding: 9px 8px; font-size: 8.5px; background-color: #172033; color: #ffffff; }
      .formula-table td { padding: 13px 12px; font-size: 10px; line-height: 1.55; }
      .formula-sample { font-size: 14px; text-align: center; color: #0f172a; }
      .charts-page .chart-card { height: 112px; margin-bottom: 12px; padding: 13px 16px; border: 1px solid #d8e0ea; border-radius: 8px; background-color: #ffffff; box-shadow: 0 5px 14px rgba(15, 23, 42, 0.10); }
      .charts-page .chart-line { height: 104px; }
      .charts-page .chart-donut { height: 102px; }
      .memory-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0 0 8px; border: 1px solid #cbd5e1; }
      .memory-title { padding: 10px 10px; background-color: #172033; color: #ffffff; font-family: "Roboto Condensed"; font-size: 10px; font-weight: 700; text-transform: uppercase; }
      .memory-label { padding: 12px 10px; background-color: #eef3f8; color: #475569; font-size: 8px; font-weight: 700; text-transform: uppercase; }
      .memory-value { padding: 12px 10px; color: #0f172a; font-size: 14px; font-weight: 800; }
      .memory-note { padding: 10px; background-color: #f8fafc; color: #475569; font-size: 8.5px; line-height: 1.4; }
      .metric-grid { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 14px 0 8px; border: 0; }
      .metric { padding: 15px 12px; border: 5px solid #ffffff; border-radius: 8px; background-color: #f8fafc; }
      .metric-label { color: #64748b; font-size: 7.5px; text-transform: uppercase; }
      .metric strong { color: #0f172a; font-size: 13px; }
      .footnote { margin-top: 12px; margin-bottom: 0; color: #64748b; font-size: 7.5px; text-align: center; }
    </style>
  </head>
  <body>
    ${coverHtml(metrics)}
    <div style="page-break-after: always"></div>
    ${dataSections}
    <div style="page-break-after: always"></div>
    ${formulasHtml()}
    <div style="page-break-after: always"></div>
    ${chartsHtml(metrics)}
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
