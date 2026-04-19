import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";

const carSvg = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 220">
  <defs>
    <linearGradient id="body" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#d7c1b5"/>
      <stop offset=".55" stop-color="#b5978b"/>
      <stop offset="1" stop-color="#766960"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" x2="1">
      <stop offset="0" stop-color="#edf6f8"/>
      <stop offset="1" stop-color="#344044"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="12" stdDeviation="10" flood-color="#111827" flood-opacity=".22"/>
    </filter>
  </defs>
  <ellipse cx="275" cy="188" rx="190" ry="20" fill="#111827" opacity=".16"/>
  <g filter="url(#shadow)">
    <path d="M84 132c9-29 42-51 91-59l68-11c38-6 83-3 111 17l40 30 43 7c25 4 40 19 41 40l1 14H60c-2-13 6-30 24-38Z" fill="url(#body)" stroke="#4b5563" stroke-width="4" stroke-linejoin="round"/>
    <path d="M186 77h52l-7 43H132c10-20 28-34 54-43Z" fill="url(#glass)" stroke="#1f2937" stroke-width="4"/>
    <path d="M252 75h54c26 2 47 10 65 29l18 18H244l8-47Z" fill="url(#glass)" stroke="#1f2937" stroke-width="4"/>
    <path d="M80 144h396" stroke="#1f2937" stroke-width="5" opacity=".55"/>
    <rect x="83" y="137" width="76" height="15" rx="5" fill="#f3f4f6" opacity=".88"/>
    <rect x="177" y="139" width="56" height="9" rx="4" fill="#f8fafc" opacity=".65"/>
    <rect x="74" y="154" width="54" height="18" rx="3" fill="#facc15" stroke="#111827" stroke-width="3"/>
    <text x="82" y="167" font-family="Arial" font-size="10" font-weight="700" fill="#111827">AUTO</text>
    <circle cx="159" cy="171" r="33" fill="#111827"/>
    <circle cx="159" cy="171" r="22" fill="#e5e7eb"/>
    <circle cx="159" cy="171" r="9" fill="#6b7280"/>
    <circle cx="400" cy="171" r="33" fill="#111827"/>
    <circle cx="400" cy="171" r="22" fill="#e5e7eb"/>
    <circle cx="400" cy="171" r="9" fill="#6b7280"/>
    <path d="M396 116h45" stroke="#e5e7eb" stroke-width="7" stroke-linecap="round"/>
  </g>
</svg>`)}`;

const models = [
  ["Extended Range Basic Model", "Автомобиль с увеличенным запасом хода"],
  ["Pure Electric High Power Basic Model", "Чисто электрический"],
  ["Pure Electric Low Power Basic Model", "Чисто электрический"],
];

const rows = [
  ["Официальная рекомендованная цена.", "Пока нет цены.", "Пока нет цены.", "Пока нет цены."],
  ["Уровень", "-", "-", "-"],
  ["Тип энергии", ...models.map((model) => model[1])],
  ["Дата выхода на рынок", "-", "-", "-"],
  ["Электродвигатель", "231 л.с.", "245 л.с.", "204 л.с."],
  ["Запас хода CLTC", "1240 км", "650 км", "560 км"],
  ["Быстрая зарядка", "0.3 часа", "0.28 часа", "0.35 часа"],
  ["Привод", "Передний", "Передний", "Передний"],
];

const html = `<!doctype html>
<html>
  <head>
    <style>
      @page { size: A4 landscape; margin: 5mm; }
      body {
        font-family: "Open Sans";
        color: #202638;
      }
      table.compare {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        border: 1px solid #e5e8ee;
      }
      col.param { width: 172px; }
      col.model { width: 31.5%; }
      th, td {
        border: 1px solid #e2e6ed;
        padding: 0;
        vertical-align: middle;
        background-color: #ffffff;
      }
      td.param {
        padding: 13px 12px;
        color: #667085;
        font-size: 9px;
        font-weight: 600;
        text-align: left;
        background-color: #fbfcfe;
      }
      td.param-top {
        vertical-align: top;
        letter-spacing: 2px;
        line-height: 1.75;
        font-size: 8px;
        text-transform: uppercase;
      }
      td.model-cell {
        padding: 9px;
        height: 190px;
        vertical-align: top;
      }
      .model-card {
        position: relative;
        height: 172px;
        overflow: hidden;
        border: 1px solid #dfe4ec;
        border-radius: 11px;
        background-color: #ffffff;
        box-shadow: 0 8px 24px rgba(15, 23, 42, .08);
      }
      .year,
      .brand,
      .price-tag {
        position: absolute;
        display: inline-block;
        padding: 5px 12px;
        border: 1px solid #cfd4dc;
        background-color: #d9dadd;
        color: #555b66;
        font-size: 7.5px;
        font-weight: 800;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .year { left: -1px; top: -1px; border-radius: 0 0 8px 0; }
      .brand {
        right: -1px;
        top: -1px;
        border-radius: 0 0 0 8px;
        letter-spacing: 2px;
        color: #202226;
      }
      .brand code {
        color: #12b8c4;
        background-color: transparent;
        padding: 0;
        border: 0;
        font-size: 4px;
        letter-spacing: 0;
      }
      .price-tag {
        left: -1px;
        top: 96px;
        color: #9ca3af;
        border-radius: 0 8px 0 0;
      }
      .hero-car {
        width: 182px;
        height: 82px;
        margin-top: 26px;
        margin-bottom: 14px;
        text-align: center;
        object-fit: contain;
        object-position: center center;
      }
      .model-card h3 {
        margin: 0 13px 7px;
        font-size: 13px;
        line-height: 1.05;
        color: #07111f;
      }
      .model-card p {
        margin: 0 13px;
        color: #646b7a;
        font-size: 8px;
        font-weight: 700;
        line-height: 1.35;
      }
      .section td {
        height: 30px;
        background-color: #f6f7f9;
        color: #20242c;
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 1px;
        text-transform: uppercase;
        padding: 0 12px;
      }
      .section .count {
        color: #b8bec8;
        font-size: 6px;
        font-weight: 700;
      }
      td.value {
        height: 35px;
        padding: 9px 12px;
        text-align: center;
        color: #26324a;
        font-size: 9px;
        line-height: 1.35;
      }
      tr.alt td { background-color: #fbfbfc; }
      .dash { color: #30364a; font-size: 13px; }
    </style>
  </head>
  <body>
    <table class="compare">
      <colgroup>
        <col class="param">
        <col class="model">
        <col class="model">
        <col class="model">
      </colgroup>
      <tbody>
        <tr>
          <td class="param param-top">Группа<br>Параметр</td>
          ${models.map((model) => `
            <td class="model-cell">
              <div class="model-card">
                <span class="year">2025</span>
                <span class="brand"><code>AION</code> AION</span>
                <img class="hero-car" src="${carSvg}" alt="AION i60">
                <span class="price-tag">Нет цены</span>
                <h3>AION i60</h3>
                <p>${model[0]}</p>
              </div>
            </td>
          `).join("")}
        </tr>
        <tr class="section">
          <td colspan="4">⌄ Основная информация <span class="count">(12)</span></td>
        </tr>
        ${rows.map((row, index) => `
          <tr class="${index % 2 === 1 ? "alt" : ""}">
            <td class="param">${row[0]}</td>
            ${row.slice(1).map((value) => `<td class="value">${value === "-" ? `<span class="dash">-</span>` : value}</td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  </body>
</html>`;

const result = await renderHtmlToPdfDetailed({
  html,
  hideHeader: true,
  font: {
    bundled: bundledFonts.openSans,
  },
  resourcePolicy: {
    allowData: true,
  },
});

await Bun.write("examples/comparison-table-showcase.pdf", result.pdf);

console.log({
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
