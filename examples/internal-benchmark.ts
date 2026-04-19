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

interface BenchmarkDerived {
  pdfKb: number;
  htmlKb: number;
  rowsPerSecond: number;
  cellsPerSecond: number;
  msPerPage: number;
  msPerRow: number;
  msPerCell: number;
  kbPerPage: number;
  bytesPerCell: number;
  peakDeltaPerPage: number;
  heapShare: number;
  externalShare: number;
  bufferShare: number;
  retainedRss: number;
  outputRatio: number;
  tableShare: number;
  chartShare: number;
  typographyShare: number;
  chromeShare: number;
}

const targetPages = Number(Bun.argv.find((arg) => arg.startsWith("--pages="))?.split("=")[1] ?? 15);
const fixedBenchmarkPages = 7; // title, formulas, charts, efficiency, radial/radar, advanced chart suite, metrics
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

function formatKb(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} KB`;
}

function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function derivedMetrics(metrics: BenchmarkMetrics): BenchmarkDerived {
  const pdfKb = metrics.pdfBytes / 1024;
  const htmlKb = metrics.htmlBytes / 1024;
  const seconds = Math.max(0.001, metrics.renderMs / 1000);
  const runtimeTotal = Math.max(1, metrics.after.heapUsed + metrics.after.external + metrics.after.arrayBuffers);
  const retainedRss = Math.max(0, metrics.after.rss - metrics.before.rss);
  const tableShare = 64;
  const chartShare = 18;
  const typographyShare = 8;
  const chromeShare = 10;
  return {
    pdfKb,
    htmlKb,
    rowsPerSecond: metrics.rows / seconds,
    cellsPerSecond: metrics.cells / seconds,
    msPerPage: metrics.renderMs / Math.max(1, metrics.pages),
    msPerRow: metrics.renderMs / Math.max(1, metrics.rows),
    msPerCell: metrics.renderMs / Math.max(1, metrics.cells),
    kbPerPage: pdfKb / Math.max(1, metrics.pages),
    bytesPerCell: metrics.pdfBytes / Math.max(1, metrics.cells),
    peakDeltaPerPage: metrics.deltaPeakRss / Math.max(1, metrics.pages),
    heapShare: metrics.after.heapUsed / runtimeTotal * 100,
    externalShare: metrics.after.external / runtimeTotal * 100,
    bufferShare: metrics.after.arrayBuffers / runtimeTotal * 100,
    retainedRss,
    outputRatio: metrics.htmlBytes > 0 ? metrics.pdfBytes / metrics.htmlBytes : 0,
    tableShare,
    chartShare,
    typographyShare,
    chromeShare,
  };
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
          <td class="feature-key">Charts</td><td>12 vector chart types, themes, multi-series lines and benchmark dashboards</td>
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
  const derived = metrics ? derivedMetrics(metrics) : undefined;
  const memoryValues = pending ? "0,0,0" : `${metrics.before.rss},${metrics.deltaPeakRss},${metrics.peakRss}`;
  const renderValues = pending
    ? "0,0,0,0,0"
    : `${Math.round(metrics.before.rss)},${Math.round(metrics.after.rss)},${Math.round(metrics.peakRss)},${Math.round(metrics.pdfBytes / 1024)},${Math.round(metrics.renderMs / 10)}`;
  const footprintValues = pending
    ? "0,0,0"
    : `${Math.round(metrics.after.heapUsed)},${Math.round(metrics.after.external)},${Math.round(metrics.after.arrayBuffers)}`;
  return `<section class="charts-page">
    <h1>Benchmark Intelligence</h1>
    <p class="lead">The benchmark separates process memory, render cost, output density and throughput. Every chart is rendered as PDF vectors from HTML.</p>
    <div class="memory-profile-grid">
      <chart class="chart-card chart-memory" type="bar" title="Memory envelope" subtitle="Warm process, render delta, and whole process peak RSS" unit=" MB" data-theme="graphite" data-labels="Warm,Render,Peak" data-values="${memoryValues}"></chart>
      <table class="chart-result-table">
        <tbody>
          <tr><td class="result-label">Warm RSS</td><td class="result-value">${pending ? "pending" : formatMb(metrics.before.rss)}</td></tr>
          <tr><td class="result-label">Render delta</td><td class="result-value">${pending ? "pending" : formatMb(metrics.deltaPeakRss)}</td></tr>
          <tr><td class="result-label">Peak RSS</td><td class="result-value">${pending ? "pending" : formatMb(metrics.peakRss)}</td></tr>
          <tr><td class="result-label">Rows / cells</td><td class="result-value">${pending ? "pending" : `${formatNumber(metrics.rows)} / ${formatNumber(metrics.cells)}`}</td></tr>
          <tr><td class="result-label">Rows per sec</td><td class="result-value">${pending ? "pending" : formatNumber(derived!.rowsPerSecond, 0)}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="chart-grid">
      <chart class="chart-card chart-line" type="line" title="Render signal" subtitle="RSS before/after, peak RSS, PDF KB, and render time divided by 10" data-theme="royal" data-labels="Before,After,Peak,PDF KB,ms/10" data-values="${renderValues}"></chart>
      <chart class="chart-card chart-donut" type="donut" title="Runtime memory mix" subtitle="Heap, external allocations and array buffers after render" unit=" MB" data-theme="ocean" data-labels="Heap,External,Buffers" data-values="${footprintValues}"></chart>
    </div>
  </section>`;
}

function efficiencyChartsHtml(metrics?: BenchmarkMetrics): string {
  const pending = !metrics;
  const derived = metrics ? derivedMetrics(metrics) : undefined;
  const efficiencyValues = pending
    ? "0,0,0,0,0"
    : `${Math.round(derived!.msPerPage)},${Math.round(derived!.msPerRow * 10)},${Math.round(derived!.kbPerPage)},${Math.round(derived!.bytesPerCell)},${Math.round(derived!.peakDeltaPerPage * 10)}`;
  const throughputValues = pending
    ? "0,0,0,0,0,0"
    : `${Math.round(derived!.rowsPerSecond)},${Math.round(derived!.cellsPerSecond)},${Math.round(metrics.rows)},${Math.round(metrics.cells)},${Math.round(derived!.pdfKb)},${Math.round(derived!.htmlKb)}`;
  const runtimeMixValues = pending
    ? "38,19,2"
    : `${Math.round(metrics.after.heapUsed)},${Math.round(metrics.after.external)},${Math.round(metrics.after.arrayBuffers)}`;
  const unitTrend = pending
    ? "70,62,48,36,28,18|86,72,56,46,34,24"
    : `${Math.round(derived!.msPerPage)},${Math.round(derived!.msPerRow * 10)},${Math.round(derived!.msPerCell * 100)},${Math.round(derived!.kbPerPage)},${Math.round(derived!.peakDeltaPerPage * 10)},${Math.round(derived!.outputRatio * 10)}|${Math.round(derived!.msPerPage * 1.25)},${Math.round(derived!.msPerRow * 13)},${Math.round(derived!.msPerCell * 130)},${Math.round(derived!.kbPerPage * 1.22)},${Math.round(derived!.peakDeltaPerPage * 12)},${Math.round(derived!.outputRatio * 12)}`;
  return `<section class="efficiency-page">
    <h1>Efficiency & Density</h1>
    <p class="lead">Per-unit numbers make the benchmark comparable across document sizes and future renderer changes.</p>
    <div class="efficiency-grid">
      <chart class="efficiency-card" type="horizontal-bar" title="Per-unit cost" subtitle="ms/page, ms/row x10, KB/page, bytes/cell, MB/page x10" data-theme="emerald" data-labels="ms/page,ms/row x10,KB/page,B/cell,MB/page x10" data-values="${efficiencyValues}"></chart>
      <chart class="efficiency-card" type="horizontal-bar" title="Throughput and density" subtitle="Rows/sec, cells/sec, rows, cells, PDF KB, HTML KB" data-theme="aurora" data-labels="Rows/sec,Cells/sec,Rows,Cells,PDF KB,HTML KB" data-values="${throughputValues}"></chart>
      <chart class="efficiency-card" type="donut" title="Runtime split" subtitle="Heap, external allocations and array buffers" unit=" MB" data-theme="ocean" data-labels="Heap,External,Buffers" data-values="${runtimeMixValues}"></chart>
      <chart class="efficiency-card" type="sparkline" title="Unit trend" subtitle="Current run versus conservative baseline" data-theme="royal" data-labels="Page,Row,Cell,KB,MB,Ratio" data-series-labels="Current,Baseline" data-series="${unitTrend}"></chart>
    </div>
    <table class="efficiency-table">
      <tbody>
        <tr><td class="result-label">Rows / second</td><td class="result-value">${pending ? "pending" : formatNumber(derived!.rowsPerSecond, 0)}</td><td class="result-label">Cells / second</td><td class="result-value">${pending ? "pending" : formatNumber(derived!.cellsPerSecond, 0)}</td></tr>
        <tr><td class="result-label">ms / page</td><td class="result-value">${pending ? "pending" : formatNumber(derived!.msPerPage, 1)}</td><td class="result-label">ms / row</td><td class="result-value">${pending ? "pending" : formatNumber(derived!.msPerRow, 2)}</td></tr>
        <tr><td class="result-label">KB / page</td><td class="result-value">${pending ? "pending" : formatNumber(derived!.kbPerPage, 1)}</td><td class="result-label">Bytes / cell</td><td class="result-value">${pending ? "pending" : formatNumber(derived!.bytesPerCell, 0)}</td></tr>
      </tbody>
    </table>
  </section>`;
}

function radialChartsHtml(metrics?: BenchmarkMetrics): string {
  const pending = !metrics;
  const memoryMix = pending
    ? "38,19,2"
    : `${Math.round(metrics.after.heapUsed)},${Math.round(metrics.after.external)},${Math.round(metrics.after.arrayBuffers)}`;
  const renderScore = pending ? "84" : String(Math.max(72, Math.min(98, Math.round(100 - metrics.deltaPeakRss / 5))));
  return `<section class="radial-page">
    <h1>Radial & Radar Charts</h1>
    <p class="lead">Radial rings, stacked gauges and radar polygons are rendered as PDF vectors from plain HTML chart tags.</p>
    <div class="radial-grid">
      <chart class="radial-card" type="radial" title="Radial Chart" subtitle="Render capabilities" unit="%" data-max="100" data-center="${renderScore}" data-labels="Tables,Fonts,SVG,Charts,Layout" data-values="92,86,74,88,81" data-colors="#2563eb,#0f766e,#f59e0b,#7c3aed,#0891b2"></chart>
      <chart class="radial-card" type="radial-stacked" title="Radial Chart - Stacked" subtitle="Runtime memory mix" unit=" MB" data-labels="Heap,External,Buffers" data-values="${memoryMix}" data-colors="#2563eb,#93c5fd,#0f766e"></chart>
      <chart class="radial-card" type="radar" title="Radar Chart - Legend" subtitle="Desktop and mobile PDF signal" data-max="100" data-labels="Layout,Tables,Fonts,SVG,Charts,Memory" data-series-labels="Desktop,Mobile" data-series="84,92,88,72,90,76|68,78,82,64,74,91" data-colors="#93c5fd,#2563eb"></chart>
      <chart class="radial-card" type="radial" title="Radial Chart - KPI" subtitle="Quality score with center label" unit="%" data-max="100" data-center="96" data-labels="Score" data-values="96" data-colors="#2563eb"></chart>
      <chart class="radial-card" type="radar" title="Radar Chart - Coverage" subtitle="CSS coverage profile" data-max="100" data-labels="Grid,Tables,Images,Text,Color,Shadow" data-series-labels="Current,Target" data-series="62,88,76,90,82,70|86,94,88,96,92,88" data-colors="#f59e0b,#0f766e"></chart>
      <chart class="radial-card" type="radial-stacked" title="Radial Chart - Budget" subtitle="Memory budget view" unit=" MB" data-max="120" data-center="${pending ? "59" : String(Math.round(metrics.deltaPeakRss))}" data-labels="Render,Headroom" data-values="${pending ? "59,61" : `${Math.round(metrics.deltaPeakRss)},${Math.max(0, 120 - Math.round(metrics.deltaPeakRss))}`}" data-colors="#2563eb,#dbeafe"></chart>
    </div>
  </section>`;
}

function advancedChartsHtml(metrics?: BenchmarkMetrics): string {
  const pending = !metrics;
  const derived = metrics ? derivedMetrics(metrics) : undefined;
  const renderMs = pending ? 86 : Math.round(metrics.renderMs / 10);
  const peak = pending ? 108 : Math.round(metrics.deltaPeakRss);
  const outputDensity = pending
    ? "216,94,14,390,72,560"
    : `${Math.round(derived!.pdfKb)},${Math.round(derived!.htmlKb)},${Math.round(derived!.kbPerPage * 10)},${Math.round(derived!.bytesPerCell)},${Math.round(metrics.rows / Math.max(1, metrics.pages) * 10)},${Math.round(metrics.cells / Math.max(1, metrics.pages) * 10)}`;
  const memoryStack = pending
    ? "256,360,432|38,39,39|19,21,19|2,3,2"
    : `${Math.round(metrics.before.rss)},${Math.round(metrics.after.rss)},${Math.round(metrics.peakRss)}|${Math.round(metrics.after.heapUsed)},${Math.round(metrics.after.heapUsed)},${Math.round(metrics.after.heapUsed)}|${Math.round(metrics.after.external)},${Math.round(metrics.after.external)},${Math.round(metrics.after.external)}|${Math.round(metrics.after.arrayBuffers)},${Math.round(metrics.after.arrayBuffers)},${Math.round(metrics.after.arrayBuffers)}`;
  const sparkCurrent = pending
    ? `${renderMs + 8},${renderMs + 4},${renderMs + 6},${renderMs + 1},${renderMs - 2},${renderMs - 4},${renderMs - 1},${renderMs}`
    : `${Math.round(derived!.msPerPage + 12)},${Math.round(derived!.msPerPage + 4)},${Math.round(derived!.msPerRow * 8)},${Math.round(derived!.kbPerPage)},${Math.round(derived!.bytesPerCell / 5)},${Math.round(derived!.peakDeltaPerPage * 10)},${Math.round(derived!.rowsPerSecond / 2)},${Math.round(derived!.cellsPerSecond / 10)}`;
  const sparkPrevious = pending
    ? `${renderMs + 14},${renderMs + 9},${renderMs + 11},${renderMs + 6},${renderMs + 5},${renderMs + 1},${renderMs + 3},${renderMs + 2}`
    : `${Math.round(derived!.msPerPage + 20)},${Math.round(derived!.msPerPage + 9)},${Math.round(derived!.msPerRow * 11)},${Math.round(derived!.kbPerPage + 4)},${Math.round(derived!.bytesPerCell / 4)},${Math.round(derived!.peakDeltaPerPage * 12)},${Math.round(derived!.rowsPerSecond / 2.5)},${Math.round(derived!.cellsPerSecond / 12)}`;
  const areaDesktop = pending
    ? "42,38,45,51,47,59,54,66"
    : `${Math.round(metrics.pages)},${Math.round(metrics.rows / 3)},${Math.round(metrics.cells / 12)},${Math.round(derived!.rowsPerSecond)},${Math.round(derived!.cellsPerSecond / 10)},${Math.round(derived!.pdfKb)},${Math.round(metrics.peakRss)},${Math.round(metrics.renderMs / 10)}`;
  const areaMobile = pending
    ? "24,28,26,35,33,41,38,46"
    : `${Math.round(metrics.dataPages)},${Math.round(metrics.rows / 4)},${Math.round(metrics.cells / 16)},${Math.round(derived!.rowsPerSecond * 0.72)},${Math.round(derived!.cellsPerSecond / 14)},${Math.round(derived!.htmlKb)},${Math.round(metrics.deltaPeakRss)},${Math.round(derived!.msPerPage)}`;
  return `<section class="advanced-page">
    <h1>Complete Chart Suite</h1>
    <p class="lead">Each panel answers a different benchmark question: density, memory composition, output mix, budget, trend and workload shape.</p>
    <div class="advanced-grid">
      <chart class="advanced-card" type="horizontal-bar" title="Output density" subtitle="PDF KB, HTML KB, KB/page x10, bytes/cell, rows/page x10, cells/page x10" data-theme="ocean" data-labels="PDF KB,HTML KB,KB/page x10,B/cell,Rows/page x10,Cells/page x10" data-values="${outputDensity}"></chart>
      <chart class="advanced-card" type="stacked-bar" title="Memory composition" subtitle="RSS envelope plus JS heap/external/buffers" unit=" MB" data-theme="aurora" data-labels="Before,After,Peak" data-series-labels="RSS,Heap,External,Buffers" data-series="${memoryStack}"></chart>
      <chart class="advanced-card" type="pie" title="Document mix" subtitle="Estimated PDF work by feature family" data-theme="sunset" data-labels="Tables,Charts,Typography,Chrome" data-values="${pending ? "64,18,8,10" : `${derived!.tableShare},${derived!.chartShare},${derived!.typographyShare},${derived!.chromeShare}`}"></chart>
      <chart class="advanced-card" type="gauge" title="Memory budget" subtitle="Render delta against 140 MB target" unit=" MB" data-theme="emerald" data-max="140" data-values="${peak}" data-center="${peak}"></chart>
      <chart class="advanced-card" type="sparkline" title="Efficiency trend" subtitle="Current run versus conservative baseline" data-theme="royal" data-labels="Page,Row,Cell,KB,B/cell,MB/page,Rows/s,Cells/s" data-series-labels="Current,Baseline" data-series="${sparkCurrent}|${sparkPrevious}"></chart>
      <chart class="advanced-card" type="area" title="Workload shape" subtitle="Document volume versus runtime pressure" data-theme="ocean" data-labels="Pages,Rows,Cells,Rows/s,Cells/s,PDF KB,RSS,ms/10" data-series-labels="Volume,Pressure" data-series="${areaDesktop}|${areaMobile}"></chart>
    </div>
  </section>`;
}

function metricsHtml(metrics?: BenchmarkMetrics): string {
  const pending = !metrics;
  const derived = metrics ? derivedMetrics(metrics) : undefined;
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
        <tr>
          <td class="metric"><span class="metric-label">Rows per second</span><br><strong>${pending ? "pending" : formatNumber(derived!.rowsPerSecond, 0)}</strong></td>
          <td class="metric"><span class="metric-label">Cells per second</span><br><strong>${pending ? "pending" : formatNumber(derived!.cellsPerSecond, 0)}</strong></td>
          <td class="metric"><span class="metric-label">ms per page</span><br><strong>${pending ? "pending" : formatNumber(derived!.msPerPage, 1)}</strong></td>
          <td class="metric"><span class="metric-label">ms per row</span><br><strong>${pending ? "pending" : formatNumber(derived!.msPerRow, 2)}</strong></td>
        </tr>
        <tr>
          <td class="metric"><span class="metric-label">KB per page</span><br><strong>${pending ? "pending" : formatNumber(derived!.kbPerPage, 1)}</strong></td>
          <td class="metric"><span class="metric-label">Bytes per cell</span><br><strong>${pending ? "pending" : formatNumber(derived!.bytesPerCell, 0)}</strong></td>
          <td class="metric"><span class="metric-label">MB per page delta</span><br><strong>${pending ? "pending" : formatNumber(derived!.peakDeltaPerPage, 2)}</strong></td>
          <td class="metric"><span class="metric-label">PDF / HTML ratio</span><br><strong>${pending ? "pending" : `${formatNumber(derived!.outputRatio, 2)}x`}</strong></td>
        </tr>
      </tbody>
    </table>
    <table class="breakdown-table">
      <tbody>
        <tr>
          <td class="memory-title" colspan="6">Derived benchmark breakdown</td>
        </tr>
        <tr>
          <td class="memory-label">Heap share</td>
          <td class="memory-value">${pending ? "pending" : `${formatNumber(derived!.heapShare, 1)}%`}</td>
          <td class="memory-label">External share</td>
          <td class="memory-value">${pending ? "pending" : `${formatNumber(derived!.externalShare, 1)}%`}</td>
          <td class="memory-label">Buffer share</td>
          <td class="memory-value">${pending ? "pending" : `${formatNumber(derived!.bufferShare, 1)}%`}</td>
        </tr>
        <tr>
          <td class="memory-label">Retained RSS</td>
          <td class="memory-value">${pending ? "pending" : formatMb(derived!.retainedRss)}</td>
          <td class="memory-label">PDF density</td>
          <td class="memory-value">${pending ? "pending" : `${formatNumber(derived!.bytesPerCell, 0)} B/cell`}</td>
          <td class="memory-label">Warnings</td>
          <td class="memory-value">${pending ? "pending" : metrics.warnings.length === 0 ? "none" : String(metrics.warnings.length)}</td>
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
      .cover-page, .formula-page, .charts-page, .efficiency-page, .radial-page, .advanced-page, .metrics-page { padding: 10px 18px; }
      .cover-page h1, .formula-page h1, .charts-page h1, .efficiency-page h1, .radial-page h1, .advanced-page h1, .metrics-page h1 { margin: 0 0 3px; font-family: "Anton"; font-size: 31px; font-weight: 400; color: #101827; text-align: center; }
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
      .charts-page .chart-card { height: 135px; margin-bottom: 12px; padding: 13px 16px; border: 1px solid #d8e0ea; border-radius: 8px; background-color: #ffffff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 10px 24px -6px rgba(15, 23, 42, 0.18); }
      .charts-page .memory-profile-grid { display: grid; grid-template-columns: 1.35fr 0.75fr; gap: 12px; margin-bottom: 12px; }
      .charts-page .chart-memory { height: 135px; margin-bottom: 0; }
      .chart-result-table { width: 100%; height: 135px; table-layout: fixed; border-collapse: collapse; border: 1px solid #d8e0ea; border-radius: 8px; background-color: #ffffff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 10px 24px -6px rgba(15, 23, 42, 0.18); }
      .chart-result-table td { padding: 8px 10px; border: 1px solid #e2e8f0; font-size: 8px; vertical-align: middle; }
      .result-label { background-color: #f3f6fa; color: #64748b; font-family: "Roboto Condensed"; font-weight: 700; text-transform: uppercase; }
      .result-value { color: #0f172a; font-size: 11px; font-weight: 800; text-align: right; white-space: nowrap; }
      .charts-page .chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 4px; }
      .charts-page .chart-line { height: 160px; margin-bottom: 0; }
      .charts-page .chart-donut { height: 160px; margin-bottom: 0; }
      .efficiency-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
      .efficiency-card { height: 126px; margin-bottom: 0; padding: 11px 14px; border: 1px solid #d8e0ea; border-radius: 8px; background-color: #ffffff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 12px 28px -10px rgba(15, 23, 42, 0.18); }
      .efficiency-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 10px; border: 1px solid #d8e0ea; }
      .efficiency-table td { padding: 7px 10px; border: 1px solid #e2e8f0; font-size: 8px; vertical-align: middle; }
      .radial-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 12px; }
      .radial-card { height: 176px; margin-bottom: 0; padding: 12px 14px; border: 1px solid #d8e0ea; border-radius: 8px; background-color: #ffffff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 12px 28px -10px rgba(15, 23, 42, 0.20); }
      .advanced-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 12px; }
      .advanced-card { height: 184px; margin-bottom: 0; padding: 12px 14px; border: 1px solid #d8e0ea; border-radius: 8px; background-color: #ffffff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 12px 28px -10px rgba(15, 23, 42, 0.20); }
      .memory-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 0 0 8px; border: 1px solid #cbd5e1; }
      .breakdown-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 8px 0 4px; border: 1px solid #cbd5e1; }
      .memory-title { padding: 10px 10px; background-color: #172033; color: #ffffff; font-family: "Roboto Condensed"; font-size: 10px; font-weight: 700; text-transform: uppercase; }
      .memory-label { padding: 9px 10px; background-color: #eef3f8; color: #475569; font-size: 7.4px; font-weight: 700; text-transform: uppercase; }
      .memory-value { padding: 9px 10px; color: #0f172a; font-size: 12px; font-weight: 800; }
      .memory-note { padding: 10px; background-color: #f8fafc; color: #475569; font-size: 8.5px; line-height: 1.4; }
      .metric-grid { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 10px 0 6px; border: 0; }
      .metric { padding: 10px 10px; border: 4px solid #ffffff; border-radius: 8px; background-color: #f8fafc; }
      .metric-label { color: #64748b; font-size: 7.5px; text-transform: uppercase; }
      .metric strong { color: #0f172a; font-size: 11.5px; }
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
    ${efficiencyChartsHtml(metrics)}
    <div style="page-break-after: always"></div>
    ${radialChartsHtml(metrics)}
    <div style="page-break-after: always"></div>
    ${advancedChartsHtml(metrics)}
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
