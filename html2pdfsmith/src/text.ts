import type { PDFFont } from "pdf-lib";

function isCjk(value: string): boolean {
  return /[\u3000-\u9fff\uf900-\ufaff]/u.test(value);
}

function tokenize(text: string): string[] {
  if (!text) return [];
  const parts: string[] = [];
  const lines = text.split("\n");
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) parts.push("\n");
    if (!line) return;
    if (isCjk(line) && !/\s/.test(line)) {
      parts.push(...Array.from(line));
      return;
    }
    const tokens = line.match(/\S+\s*/g) ?? [];
    parts.push(...tokens);
  });
  return parts;
}

function width(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

export function wrapText(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const cleaned = text.replace(/\r/g, "");
  if (!cleaned) return [""];

  const lines: string[] = [];
  let current = "";

  for (const token of tokenize(cleaned)) {
    if (token === "\n") {
      lines.push(current.trimEnd());
      current = "";
      continue;
    }

    const candidate = current + token;
    if (!current || width(font, candidate.trimEnd(), size) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (width(font, token.trimEnd(), size) <= maxWidth) {
      lines.push(current.trimEnd());
      current = token;
      continue;
    }

    for (const ch of Array.from(token)) {
      const charCandidate = current + ch;
      if (current && width(font, charCandidate, size) > maxWidth) {
        lines.push(current.trimEnd());
        current = ch;
      } else {
        current = charCandidate;
      }
    }
  }

  if (current || lines.length === 0) lines.push(current.trimEnd());
  return lines;
}
