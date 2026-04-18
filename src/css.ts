import type { Element } from "domhandler";

export type StyleMap = Record<string, string>;

export interface BoxSpacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface BorderStyle {
  width: number;
  color?: string;
}

export interface CssRule {
  selector: string;
  declarations: StyleMap;
  specificity: number;
  order: number;
}

export interface CssFontFaceRule {
  family: string;
  srcs: string[];
  fontWeight?: string;
  fontStyle?: string;
}

export function parseStyleDeclarations(style: string): StyleMap {
  const out: StyleMap = {};
  for (const part of style.split(";")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function specificity(selector: string): number {
  let score = 0;
  score += (selector.match(/#/g) ?? []).length * 100;
  score += (selector.match(/\./g) ?? []).length * 10;
  if (/^[a-z]/i.test(selector.trim())) score += 1;
  return score;
}

export function parseCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const cleaned = stripCssComments(css).replace(/@media[^{]*\{([\s\S]*)\}\s*/g, "$1");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  let order = 0;
  while ((match = re.exec(cleaned))) {
    const selectors = (match[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const declarations = parseStyleDeclarations(match[2] ?? "");
    for (const selector of selectors) {
      if (selector.includes(">") || selector.includes("+") || selector.includes("~") || selector.includes("[")) continue;
      rules.push({ selector, declarations, specificity: specificity(selector), order: order++ });
    }
  }
  return rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseFontFaceSrcs(src: string | undefined): string[] {
  if (!src) return [];
  const out: string[] = [];
  for (const match of src.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    const value = match[2]?.trim();
    if (value) out.push(value);
  }
  return out;
}

export function parseCssFontFaces(css: string): CssFontFaceRule[] {
  const faces: CssFontFaceRule[] = [];
  const cleaned = stripCssComments(css);
  const re = /@font-face\s*\{([^{}]*)\}/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned))) {
    const declarations = parseStyleDeclarations(match[1] ?? "");
    const family = unquote(declarations["font-family"] ?? "");
    const srcs = parseFontFaceSrcs(declarations["src"]);
    if (!family || srcs.length === 0) continue;

    const face: CssFontFaceRule = { family, srcs };
    if (declarations["font-weight"]) face.fontWeight = declarations["font-weight"];
    if (declarations["font-style"]) face.fontStyle = declarations["font-style"];
    faces.push(face);
  }
  return faces;
}

function classList(el: Element): string[] {
  return (el.attribs?.["class"] ?? "").split(/\s+/).filter(Boolean);
}

function simpleSelectorMatches(el: Element, selector: string): boolean {
  const simple = selector.trim();
  if (!simple) return false;

  const id = el.attribs?.["id"] ?? "";
  const tag = el.name.toLowerCase();
  const classes = classList(el);
  const tagMatch = /^([a-z][a-z0-9-]*)/i.exec(simple);
  if (tagMatch && tagMatch[1]?.toLowerCase() !== tag) return false;

  const idMatches = [...simple.matchAll(/#([a-z0-9_-]+)/gi)];
  if (idMatches.length && idMatches.some((m) => m[1] !== id)) return false;

  const classMatches = [...simple.matchAll(/\.([a-z0-9_-]+)/gi)];
  if (classMatches.some((m) => !classes.includes(m[1] ?? ""))) return false;

  return Boolean(tagMatch || idMatches.length || classMatches.length);
}

function parentElement(el: Element): Element | undefined {
  const parent = el.parent;
  return parent?.type === "tag" ? parent : undefined;
}

function selectorMatches(el: Element, selector: string): boolean {
  const parts = selector.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.some((part) => part.includes(">") || part.includes("+") || part.includes("~") || part.includes("["))) return false;
  if (!simpleSelectorMatches(el, parts[parts.length - 1]!)) return false;

  let current = parentElement(el);
  for (let i = parts.length - 2; i >= 0; i--) {
    const expected = parts[i]!;
    while (current && !simpleSelectorMatches(current, expected)) current = parentElement(current);
    if (!current) return false;
    current = parentElement(current);
  }
  return true;
}

export function resolveElementStyle(el: Element, rules: CssRule[]): StyleMap {
  const style: StyleMap = {};
  for (const rule of rules) {
    if (selectorMatches(el, rule.selector)) Object.assign(style, rule.declarations);
  }
  Object.assign(style, parseStyleDeclarations(el.attribs?.["style"] ?? ""));
  return style;
}

export function parseCssColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (!v || v === "transparent" || v === "inherit") return undefined;
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgb) {
    const parts = (rgb[1] ?? "").split(",").map((p) => Number.parseFloat(p.trim()));
    if (parts.length >= 3 && parts.every((p, i) => i > 2 || Number.isFinite(p))) {
      const [r = 0, g = 0, b = 0] = parts;
      return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
    }
  }
  const named: Record<string, string> = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    green: "#008000",
    blue: "#0000ff",
    gray: "#808080",
    grey: "#808080",
    yellow: "#ffff00",
    orange: "#ffa500",
    transparent: "",
    silver: "#c0c0c0",
    maroon: "#800000",
    purple: "#800080",
    fuchsia: "#ff00ff",
    lime: "#00ff00",
    olive: "#808000",
    navy: "#000080",
    teal: "#008080",
    aqua: "#00ffff",
  };
  return named[v] || undefined;
}

export function parseLengthPx(value: string | undefined, base = 0): number | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return undefined;
  if (v.endsWith("mm")) return n * 96 / 25.4;
  if (v.endsWith("cm")) return n * 96 / 2.54;
  if (v.endsWith("in")) return n * 96;
  if (v.endsWith("pt")) return n * 96 / 72;
  if (v.endsWith("%")) return base ? base * n / 100 : undefined;
  return n;
}

function parseBoxTokens(value: string | undefined): string[] {
  if (!value) return [];
  return value.trim().split(/\s+/).filter(Boolean).slice(0, 4);
}

export function parseBoxSpacing(styles: StyleMap, property: "padding" | "margin", fallback: BoxSpacing): BoxSpacing {
  const tokens = parseBoxTokens(styles[property]);
  const values = tokens.map((token) => parseLengthPx(token)).map((value) => value ?? 0);
  let box = { ...fallback };
  if (values.length === 1) {
    box = { top: values[0]!, right: values[0]!, bottom: values[0]!, left: values[0]! };
  } else if (values.length === 2) {
    box = { top: values[0]!, right: values[1]!, bottom: values[0]!, left: values[1]! };
  } else if (values.length === 3) {
    box = { top: values[0]!, right: values[1]!, bottom: values[2]!, left: values[1]! };
  } else if (values.length >= 4) {
    box = { top: values[0]!, right: values[1]!, bottom: values[2]!, left: values[3]! };
  }

  for (const side of ["top", "right", "bottom", "left"] as const) {
    const value = parseLengthPx(styles[`${property}-${side}`]);
    if (value != null) box[side] = value;
  }
  return box;
}

function borderWidthPx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "thin") return 1;
  if (v === "medium") return 3;
  if (v === "thick") return 5;
  return parseLengthPx(v);
}

export function parseBorderStyle(styles: StyleMap, fallback: BorderStyle): BorderStyle {
  const out: BorderStyle = { ...fallback };
  const shorthand = styles["border"];
  if (shorthand) {
    const tokens = shorthand.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      const width = borderWidthPx(token);
      if (width != null) out.width = width;
      const color = parseCssColor(token);
      if (color) out.color = color;
    }
  }

  const width = borderWidthPx(styles["border-width"]);
  if (width != null) out.width = width;
  const color = parseCssColor(styles["border-color"]);
  if (color) out.color = color;
  return out;
}
