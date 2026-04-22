import { execFile } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PdfProtectionError } from "./errors";

const execFileAsync = promisify(execFile);

function ownerPassword(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

function validateQpdfPath(qpdfPath: string): void {
  if (!qpdfPath || qpdfPath.trim() === "") {
    throw new PdfProtectionError("qpdfPath must not be empty");
  }
  // Reject paths containing shell metacharacters or null bytes that could
  // be used to inject additional arguments or escape the intended command.
  if (/[\0;&|`$<>'"!{}()[\]]/.test(qpdfPath)) {
    throw new PdfProtectionError(`qpdfPath contains disallowed characters: "${qpdfPath}"`);
  }
}

export async function protectPdfWithQpdf(pdf: Uint8Array, qpdfPath = "qpdf"): Promise<Uint8Array> {
  validateQpdfPath(qpdfPath);
  const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const inPath = join(tmpdir(), `html2pdfsmith_in_${suffix}.pdf`);
  const outPath = join(tmpdir(), `html2pdfsmith_out_${suffix}.pdf`);
  const password = ownerPassword();

  try {
    await writeFile(inPath, pdf);
    const args = [
      "--encrypt",
      "",
      password,
      "256",
      "--print=full",
      "--modify=none",
      "--",
      inPath,
      outPath,
    ];

    try {
      await execFileAsync(qpdfPath, args, { windowsHide: true });
    } catch (error) {
      const stderr = typeof (error as { stderr?: unknown }).stderr === "string"
        ? (error as { stderr: string }).stderr.trim()
        : "";
      const message = error instanceof Error ? error.message : String(error);
      throw new PdfProtectionError(stderr ? `${message}: ${stderr}` : message);
    }

    return new Uint8Array(await readFile(outPath));
  } finally {
    try { await unlink(inPath); } catch {}
    try { await unlink(outPath); } catch {}
  }
}
