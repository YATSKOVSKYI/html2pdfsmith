import { renderHtmlToPdfDetailed } from "../src/index";

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Quarterly Report</title>
  <style>
    h1 { color: #1f2329; font-size: 26px; margin-bottom: 12px; }
    h2 { color: #374151; font-size: 16px; margin-top: 12px; margin-bottom: 8px; }
    p { font-size: 11px; line-height: 1.45; margin-bottom: 8px; }
    .note { background-color: #f4f6f8; color: #22252a; }
  </style>
</head>
<body>
  <header class="header">
    <div class="brand-name">ACME REPORTS</div>
  </header>
  <h1>Quarterly Report</h1>
  <p class="note">This document is rendered without Chromium. It contains headings, paragraphs, lists, a divider and text watermark.</p>
  <h2>Highlights</h2>
  <ul>
    <li>Revenue increased by 18 percent compared with the previous quarter.</li>
    <li>Enterprise customers adopted the new reporting workflow.</li>
    <li>Operational costs remained within the planned budget.</li>
  </ul>
  <hr>
  <p>Use this mode for printable documents that do not require full browser CSS. Tables can be mixed into the same document when needed.</p>
</body>
</html>`;

const result = await renderHtmlToPdfDetailed({
  html,
  watermarkText: "DRAFT",
  watermarkScale: 30,
  watermarkOpacity: 12,
});

await Bun.write(new URL("./simple-document.pdf", import.meta.url), result.pdf);
console.log({
  pages: result.pages,
  columns: result.columns,
  orientation: result.orientation,
  warnings: result.warnings,
});
