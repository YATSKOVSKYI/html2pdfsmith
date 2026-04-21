import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const outputDir = fileURLToPath(new URL("../tmp/pdfs/", import.meta.url));

export async function outputPdfPath(filename: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  return join(outputDir, basename(filename));
}

export async function writeExamplePdf(filename: string, pdf: Uint8Array): Promise<string> {
  const target = await outputPdfPath(filename);
  try {
    await Bun.write(target, pdf);
    return target;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("EBUSY")) throw error;
    const fallback = await outputPdfPath(filename.replace(/\.pdf$/i, `-${Date.now()}.pdf`));
    await Bun.write(fallback, pdf);
    return fallback;
  }
}
