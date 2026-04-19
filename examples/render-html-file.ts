import { dirname, extname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { renderHtmlToPdfDetailed } from "../src/index";
import { bundledFonts } from "../packages/fonts/src/index";

function usage(): never {
  console.error("Usage: bun run examples/render-html-file.ts <input.html> [output.pdf]");
  process.exit(1);
}

const inputArg = Bun.argv[2];
if (!inputArg || inputArg === "--help" || inputArg === "-h") usage();

const inputPath = resolve(process.cwd(), inputArg);
if (!existsSync(inputPath)) {
  console.error(`Input HTML file does not exist: ${inputPath}`);
  process.exit(1);
}

const outputArg = Bun.argv[3];
const outputPath = outputArg
  ? resolve(process.cwd(), outputArg)
  : inputPath.slice(0, -extname(inputPath).length) + ".pdf";

const html = await Bun.file(inputPath).text();
const result = await renderHtmlToPdfDetailed({
  html,
  baseUrl: dirname(inputPath),
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

await Bun.write(outputPath, result.pdf);

console.log({
  input: inputPath,
  output: outputPath,
  pages: result.pages,
  bytes: result.pdf.byteLength,
  warnings: result.warnings.length,
});
