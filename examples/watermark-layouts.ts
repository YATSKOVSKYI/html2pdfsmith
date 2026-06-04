import { writeFileSync } from "node:fs";
import { renderHtmlToPdf } from "../src/index";

// A deliberately non-square logo (5:2) to verify aspect-ratio handling.
const logoSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='250' height='100' viewBox='0 0 250 100'>
  <rect width='250' height='100' rx='12' fill='#1f6feb'/>
  <text x='125' y='62' font-family='Arial' font-size='38' font-weight='bold' fill='white' text-anchor='middle'>AUTOCORE</text>
</svg>`;
const logoUri = `data:image/svg+xml;base64,${Buffer.from(logoSvg).toString("base64")}`;

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<table><thead><tr><th>Параметр</th><th>BMW X3</th><th>Audi Q5</th><th>Mercedes GLC</th></tr></thead>
<tbody>
${Array.from({ length: 18 }, (_, i) => `<tr><td>Строка ${i + 1}</td><td>2.0L Turbo</td><td>2.0L TFSI</td><td>2.0L Turbo</td></tr>`).join("")}
</tbody></table>
</body></html>`;

const cases = [
  { name: "honeycomb", layout: "honeycomb" as const, logoScale: 45, density: 55 },
  { name: "grid", layout: "grid" as const, logoScale: 45, density: 55 },
  { name: "diagonal", layout: "diagonal" as const, logoScale: 45, density: 55 },
  // size vs density decoupling sanity checks
  { name: "honeycomb-big-sparse", layout: "honeycomb" as const, logoScale: 80, density: 20 },
  { name: "honeycomb-small-dense", layout: "honeycomb" as const, logoScale: 25, density: 90 },
];

for (const c of cases) {
  const pdf = await renderHtmlToPdf({
    html,
    page: { size: "A4", orientation: "portrait", marginMm: 12 },
    watermarkUrl: logoUri,
    watermarkLayout: c.layout,
    watermarkLogoScale: c.logoScale,
    watermarkDensity: c.density,
    watermarkOpacity: 22,
    watermarkLayer: "foreground",
  });
  const out = `tmp/wm-${c.name}.pdf`;
  writeFileSync(out, pdf);
  console.log(`wrote ${out} (${pdf.length} bytes)`);
}
