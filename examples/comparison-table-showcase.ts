import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";
import { writeExamplePdf } from "./output";

const fixturePath = fileURLToPath(new URL("./fixtures/comparison-rich-table.html", import.meta.url));
const html = await Bun.file(fixturePath).text();

const result = await renderHtmlToPdfDetailed({
  html,
  baseUrl: dirname(fixturePath),
  hideHeader: true,
  font: {
    bundled: bundledFonts.openSans,
  },
  resourcePolicy: {
    allowData: true,
    allowFile: true,
    allowHttp: false,
  },
});

const outputPath = await writeExamplePdf("comparison-table-showcase.pdf", result.pdf);

console.log({
  input: fixturePath,
  output: outputPath,
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
