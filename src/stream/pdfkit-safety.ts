import type { WarningSink } from "../warnings";
import type { PdfKitDocument } from "./layout";

type PdfKitMethod = (...args: unknown[]) => unknown;
type MutablePdfKitDocument = PdfKitDocument & Record<string, unknown>;

const METHODS_WITH_NUMBERS = [
  "bezierCurveTo",
  "circle",
  "dash",
  "ellipse",
  "fontSize",
  "image",
  "lineTo",
  "lineWidth",
  "moveTo",
  "opacity",
  "fillOpacity",
  "strokeOpacity",
  "quadraticCurveTo",
  "rect",
  "roundedRect",
  "rotate",
  "scale",
  "text",
  "translate",
] as const;

const POSITIVE_KEYS = new Set([
  "width",
  "height",
  "lineWidth",
  "fontSize",
  "radius",
  "r",
  "rx",
  "ry",
  "space",
  "columns",
  "columnGap",
]);

const ZERO_KEYS = new Set([
  "lineGap",
  "characterSpacing",
  "wordSpacing",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function fallbackNumber(method: string, path: string): number {
  const key = path.split(".").pop() ?? "";
  if (method === "scale") return 1;
  if (method === "opacity" || method === "fillOpacity" || method === "strokeOpacity" || key.toLowerCase().includes("opacity")) return 1;
  if (method === "fontSize" || method === "lineWidth" || POSITIVE_KEYS.has(key)) return 1;
  if (ZERO_KEYS.has(key)) return 0;
  return 0;
}

function clampOpacity(method: string, path: string, value: number): number {
  const key = path.split(".").pop() ?? "";
  if (method !== "opacity" && method !== "fillOpacity" && method !== "strokeOpacity" && !key.toLowerCase().includes("opacity")) return value;
  return Math.max(0, Math.min(1, value));
}

function sanitizePdfKitValue(
  method: string,
  value: unknown,
  path: string,
): { value: unknown; changed: boolean; samples: string[] } {
  if (typeof value === "number") {
    if (Number.isFinite(value)) return { value: clampOpacity(method, path, value), changed: false, samples: [] };
    return {
      value: fallbackNumber(method, path),
      changed: true,
      samples: [`${path}=${String(value)}`],
    };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const samples: string[] = [];
    const sanitized = value.map((item, index) => {
      const result = sanitizePdfKitValue(method, item, `${path}[${index}]`);
      changed ||= result.changed;
      samples.push(...result.samples);
      return result.value;
    });
    return { value: changed ? sanitized : value, changed, samples };
  }

  if (isPlainRecord(value)) {
    let changed = false;
    const samples: string[] = [];
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = sanitizePdfKitValue(method, item, `${path}.${key}`);
      changed ||= result.changed;
      samples.push(...result.samples);
      sanitized[key] = result.value;
    }
    return { value: changed ? sanitized : value, changed, samples };
  }

  return { value, changed: false, samples: [] };
}

export function patchPdfKitNumberSafety(doc: PdfKitDocument, warnings: WarningSink): void {
  const mutableDoc = doc as MutablePdfKitDocument;
  const methodBag = mutableDoc as Record<string, unknown>;
  const warned = new Set<string>();

  for (const method of METHODS_WITH_NUMBERS) {
    const original = methodBag[method];
    if (typeof original !== "function") continue;

    methodBag[method] = function patchedPdfKitMethod(this: PdfKitDocument, ...args: unknown[]): unknown {
      let changed = false;
      const samples: string[] = [];
      const sanitized = args.map((arg, index) => {
        const result = sanitizePdfKitValue(method, arg, `arg${index}`);
        changed ||= result.changed;
        samples.push(...result.samples);
        return result.value;
      });

      if (changed && !warned.has(method)) {
        warned.add(method);
        warnings.add(
          "pdfkit_nonfinite_number_sanitized",
          `Sanitized non-finite number before PDFKit ${method}(${samples.slice(0, 3).join(", ")}).`,
        );
      }

      return (original as PdfKitMethod).apply(this, sanitized);
    };
  }
}
