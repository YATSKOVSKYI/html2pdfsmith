import { Buffer } from "node:buffer";

function ownerPassword(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

export async function protectPdfWithQpdf(pdf: Uint8Array, qpdfPath = "qpdf"): Promise<Uint8Array> {
  const tmpDir = process.env["TMPDIR"] ?? process.env["TEMP"] ?? "/tmp";
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const inPath = `${tmpDir}/html_pdf_lite_in_${suffix}.pdf`;
  const outPath = `${tmpDir}/html_pdf_lite_out_${suffix}.pdf`;
  const password = ownerPassword();

  try {
    await Bun.write(inPath, pdf);
    const proc = Bun.spawn([
      qpdfPath,
      "--encrypt",
      "",
      password,
      "256",
      "--print=full",
      "--modify=none",
      "--",
      inPath,
      outPath,
    ], { stderr: "pipe" });

    const code = await proc.exited;
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      throw new Error(`qpdf exited ${code}: ${err.trim()}`);
    }

    return new Uint8Array(await Bun.file(outPath).arrayBuffer());
  } finally {
    try { await Bun.file(inPath).delete(); } catch {}
    try { await Bun.file(outPath).delete(); } catch {}
    Buffer.alloc(0);
  }
}
