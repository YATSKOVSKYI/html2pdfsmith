import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHtmlToPdfDetailed } from "../src/index";

const outPath = fileURLToPath(new URL("../tmp/pdfs/production-comparison-table.pdf", import.meta.url));
await mkdir(dirname(outPath), { recursive: true });

const columns = Array.from({ length: 10 }, (_, index) => `Configuration ${index + 1}`);
const rows = Array.from({ length: 24 }, (_, row) => {
  const cells = columns.map((_, col) => {
    const marker = row % 3 === 0 ? "●" : row % 3 === 1 ? "○" : "-";
    return `<td>${marker} Value ${row + 1}.${col + 1}<br>Длинное описание комплектации для проверки переноса строк и плотной сетки.</td>`;
  }).join("");
  return `<tr><td>Parameter ${row + 1}<br>Параметр сравнения</td>${cells}</tr>`;
}).join("");

const html = `<!doctype html><html><head><style>
  @page { size: A4 landscape; margin: 8mm; }
  body { font-family: Helvetica, Arial, sans-serif; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  th, td { border: 1px solid #cbd5e1; vertical-align: middle; overflow-wrap: anywhere; }
  th { background-color: #eef3f8; color: #1f2937; }
  td:first-child { font-weight: 700; background-color: #f8fafc; }
</style></head><body>
  <table>
    <thead><tr><th>Parameter</th>${columns.map((column) => `<th>${column}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body></html>`;

const result = await renderHtmlToPdfDetailed({
  html,
  hideHeader: true,
  tableHeaderRepeat: "auto",
  table: {
    preset: "dense-comparison",
  },
  text: { overflowWrap: "break-word" },
});

await writeFile(outPath, result.pdf);
console.log({ outPath, pages: result.pages, warnings: result.warnings });
