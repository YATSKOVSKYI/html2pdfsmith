import {
  FontLoadError,
  Html2PdfError,
  PdfProtectionError,
  ResourceLoadError,
  ResourcePolicyError,
  WarningSink,
  getGoogleFontCacheDir,
  isGoogleFontCached,
  resolveGoogleFont
} from "./chunk-HQEHU4SA.js";

// src/html.ts
import { parseDocument } from "htmlparser2";
import { DomUtils } from "htmlparser2";

// src/css.ts
function parseStyleDeclarations(style) {
  const out = {};
  for (const part of style.split(";")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}
function matchingBraceIndex(css, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < css.length; i++) {
    const char = css[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function mediaAppliesToPrint(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes("not print")) return false;
  if (normalized.includes("screen") && !normalized.includes("print")) return false;
  return normalized.includes("print") || normalized.includes("all");
}
function printCss(css) {
  let out = "";
  let cursor = 0;
  const mediaRe = /@media\s+([^{]+)\{/gi;
  let match;
  while (match = mediaRe.exec(css)) {
    const start = match.index;
    const open = mediaRe.lastIndex - 1;
    const close = matchingBraceIndex(css, open);
    if (close < 0) break;
    out += css.slice(cursor, start);
    if (mediaAppliesToPrint(match[1] ?? "")) out += css.slice(open + 1, close);
    cursor = close + 1;
    mediaRe.lastIndex = close + 1;
  }
  out += css.slice(cursor);
  return out;
}
function specificity(selector) {
  let score = 0;
  score += (selector.match(/#/g) ?? []).length * 100;
  score += (selector.match(/\./g) ?? []).length * 10;
  if (/^[a-z]/i.test(selector.trim())) score += 1;
  return score;
}
function parseCssRules(css) {
  const rules = [];
  const cleaned = printCss(stripCssComments(css));
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  let order = 0;
  while (match = re.exec(cleaned)) {
    const selectors = (match[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const declarations = parseStyleDeclarations(match[2] ?? "");
    for (const selector of selectors) {
      if (selector.includes(">") || selector.includes("+") || selector.includes("~") || selector.includes("[")) continue;
      rules.push({ selector, declarations, specificity: specificity(selector), order: order++ });
    }
  }
  return rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
}
function unquote(value) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}
function parseFontFaceSrcs(src) {
  if (!src) return [];
  const out = [];
  for (const match of src.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    const value = match[2]?.trim();
    if (value) out.push(value);
  }
  return out;
}
function parseCssFontFaces(css) {
  const faces = [];
  const cleaned = printCss(stripCssComments(css));
  const re = /@font-face\s*\{([^{}]*)\}/gi;
  let match;
  while (match = re.exec(cleaned)) {
    const declarations = parseStyleDeclarations(match[1] ?? "");
    const family = unquote(declarations["font-family"] ?? "");
    const srcs = parseFontFaceSrcs(declarations["src"]);
    if (!family || srcs.length === 0) continue;
    const face = { family, srcs };
    if (declarations["font-weight"]) face.fontWeight = declarations["font-weight"];
    if (declarations["font-style"]) face.fontStyle = declarations["font-style"];
    faces.push(face);
  }
  return faces;
}
function lengthToMm(value) {
  const px = parseLengthPx(value);
  return px == null ? void 0 : px * 25.4 / 96;
}
function parsePageSize(value) {
  const out = {};
  const tokens = (value ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.includes("a4")) out.size = "A4";
  if (tokens.includes("letter")) out.size = "LETTER";
  if (tokens.includes("landscape")) out.orientation = "landscape";
  if (tokens.includes("portrait")) out.orientation = "portrait";
  return out;
}
function parseCssPageRule(css) {
  const cleaned = printCss(stripCssComments(css));
  const match = /@page(?:\s+[^{:]+|\s*)\{([^{}]*)\}/i.exec(cleaned);
  if (!match?.[1]) return void 0;
  const declarations = parseStyleDeclarations(match[1]);
  const size = parsePageSize(declarations["size"]);
  const margin = lengthToMm(declarations["margin"]?.trim().split(/\s+/)[0]);
  const marginTop = lengthToMm(declarations["margin-top"]);
  const page = {};
  if (size.size) page.size = size.size;
  if (size.orientation) page.orientation = size.orientation;
  if (marginTop != null) page.marginMm = marginTop;
  else if (margin != null) page.marginMm = margin;
  return Object.keys(page).length > 0 ? page : void 0;
}
function classList(el) {
  return (el.attribs?.["class"] ?? "").split(/\s+/).filter(Boolean);
}
function simpleSelectorMatches(el, selector) {
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
function parentElement(el) {
  const parent = el.parent;
  return parent?.type === "tag" ? parent : void 0;
}
function selectorMatches(el, selector) {
  const parts = selector.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.some((part) => part.includes(">") || part.includes("+") || part.includes("~") || part.includes("["))) return false;
  if (!simpleSelectorMatches(el, parts[parts.length - 1])) return false;
  let current = parentElement(el);
  for (let i = parts.length - 2; i >= 0; i--) {
    const expected = parts[i];
    while (current && !simpleSelectorMatches(current, expected)) current = parentElement(current);
    if (!current) return false;
    current = parentElement(current);
  }
  return true;
}
function resolveElementStyle(el, rules) {
  const style = {};
  for (const rule of rules) {
    if (selectorMatches(el, rule.selector)) Object.assign(style, rule.declarations);
  }
  Object.assign(style, parseStyleDeclarations(el.attribs?.["style"] ?? ""));
  return style;
}
function parseCssColor(value) {
  if (!value) return void 0;
  const v = value.trim().toLowerCase();
  if (!v || v === "transparent" || v === "inherit") return void 0;
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  const rgb = /^rgba?\(([^)]+)\)$/.exec(v);
  if (rgb) {
    const parts = (rgb[1] ?? "").split(",").map((p) => Number.parseFloat(p.trim()));
    if (parts.length >= 3 && parts.every((p, i) => i > 2 || Number.isFinite(p))) {
      const [r = 0, g = 0, b = 0] = parts;
      return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
    }
  }
  const named = {
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
    aqua: "#00ffff"
  };
  return named[v] || void 0;
}
function parseLengthPx(value, base = 0) {
  if (!value) return void 0;
  const v = value.trim().toLowerCase();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return void 0;
  if (v.endsWith("mm")) return n * 96 / 25.4;
  if (v.endsWith("cm")) return n * 96 / 2.54;
  if (v.endsWith("in")) return n * 96;
  if (v.endsWith("pt")) return n * 96 / 72;
  if (v.endsWith("%")) return base ? base * n / 100 : void 0;
  return n;
}
function parseBoxTokens(value) {
  if (!value) return [];
  return value.trim().split(/\s+/).filter(Boolean).slice(0, 4);
}
function parseBoxSpacing(styles, property, fallback) {
  const tokens = parseBoxTokens(styles[property]);
  const values = tokens.map((token) => parseLengthPx(token)).map((value) => value ?? 0);
  let box = { ...fallback };
  if (values.length === 1) {
    box = { top: values[0], right: values[0], bottom: values[0], left: values[0] };
  } else if (values.length === 2) {
    box = { top: values[0], right: values[1], bottom: values[0], left: values[1] };
  } else if (values.length === 3) {
    box = { top: values[0], right: values[1], bottom: values[2], left: values[1] };
  } else if (values.length >= 4) {
    box = { top: values[0], right: values[1], bottom: values[2], left: values[3] };
  }
  for (const side of ["top", "right", "bottom", "left"]) {
    const value = parseLengthPx(styles[`${property}-${side}`]);
    if (value != null) box[side] = value;
  }
  return box;
}
function borderWidthPx(value) {
  if (!value) return void 0;
  const v = value.trim().toLowerCase();
  if (v === "thin") return 1;
  if (v === "medium") return 3;
  if (v === "thick") return 5;
  return parseLengthPx(v);
}
function borderLineStyle(value) {
  if (!value) return void 0;
  const v = value.trim().toLowerCase();
  if (v === "solid" || v === "dashed" || v === "dotted" || v === "none") return v;
  return void 0;
}
function applyBorderTokens(out, value) {
  if (!value) return;
  const tokens = value.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const width = borderWidthPx(token);
    if (width != null) out.width = width;
    const color = parseCssColor(token);
    if (color) out.color = color;
    const style = borderLineStyle(token);
    if (style) out.style = style;
  }
}
function parseBorderStyle(styles, fallback) {
  const out = { ...fallback };
  applyBorderTokens(out, styles["border"]);
  const width = borderWidthPx(styles["border-width"]);
  if (width != null) out.width = width;
  const color = parseCssColor(styles["border-color"]);
  if (color) out.color = color;
  const style = borderLineStyle(styles["border-style"]);
  if (style) out.style = style;
  return out;
}
function parseBorderSideStyle(styles, side, fallback) {
  const out = parseBorderStyle(styles, fallback);
  applyBorderTokens(out, styles[`border-${side}`]);
  const width = borderWidthPx(styles[`border-${side}-width`]);
  if (width != null) out.width = width;
  const color = parseCssColor(styles[`border-${side}-color`]);
  if (color) out.color = color;
  const style = borderLineStyle(styles[`border-${side}-style`]);
  if (style) out.style = style;
  if (out.style === "none") out.width = 0;
  return out;
}

// src/html.ts
function isElement(node) {
  return !!node && (node.type === "tag" || node.type === "style" || node.type === "script");
}
function attr(el, name) {
  return el.attribs?.[name] ?? "";
}
function className(el) {
  return attr(el, "class");
}
function hasClass(el, name) {
  return className(el).split(/\s+/).includes(name);
}
function findFirst(root, predicate) {
  const nodes = Array.isArray(root) ? root : [root];
  return DomUtils.findOne((node) => isElement(node) && predicate(node), nodes, true);
}
function findAll(root, predicate) {
  const nodes = Array.isArray(root) ? root : [root];
  const found = [];
  const visit = (node) => {
    if (isElement(node) && predicate(node)) found.push(node);
    if ("children" in node && node.children) {
      for (const child of node.children) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return found;
}
function directElementChildren(el, tagName) {
  return (el.children ?? []).filter((child) => {
    if (!isElement(child)) return false;
    return tagName ? child.name.toLowerCase() === tagName : true;
  });
}
function normalizeWhitespace(value) {
  return value.replace(/\u00a0/g, " ").replace(/[ \t\r\f\v]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function normalizePreText(value) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/^\n+|\n+$/g, "");
}
function textWithBreaks(node) {
  if (node.type === "text") return node.data ?? "";
  if (!("children" in node) || !node.children) return "";
  if (isElement(node) && node.name.toLowerCase() === "br") return "\n";
  let out = "";
  for (const child of node.children) {
    out += textWithBreaks(child);
    if (isElement(child)) {
      const name = child.name.toLowerCase();
      if (name === "div" || name === "p" || name === "li") out += "\n";
    }
  }
  return out;
}
function preText(node) {
  if (node.type === "text") return node.data ?? "";
  if (!("children" in node) || !node.children) return "";
  if (isElement(node) && node.name.toLowerCase() === "br") return "\n";
  return node.children.map((child) => preText(child)).join("");
}
function mergeStyle(base, next) {
  return { ...base, ...next };
}
function isInlineBoxElement(name) {
  return name === "span" || name === "a" || name === "code" || name === "em" || name === "i" || name === "strong" || name === "b" || name === "u" || name === "s" || name === "del";
}
function hasInlineBoxStyle(style) {
  const display = (style["display"] ?? "").trim().toLowerCase();
  return display === "inline-block" || display === "inline-flex" || !!style["background-color"] || !!style["border"] || !!style["border-width"] || !!style["border-radius"] || !!style["padding"] || !!style["padding-left"] || !!style["padding-right"] || !!style["padding-top"] || !!style["padding-bottom"];
}
function sameInlineStyle(a, b) {
  if (a.href !== b.href) return false;
  if (!!a.inlineBox !== !!b.inlineBox) return false;
  const aEntries = Object.entries(a.styles);
  const bEntries = Object.entries(b.styles);
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([key, value]) => b.styles[key] === value);
}
function normalizeInlineSegments(segments) {
  const normalized = [];
  for (const segment of segments) {
    const whiteSpace = (segment.styles["white-space"] ?? "").trim().toLowerCase();
    const text = whiteSpace === "pre-line" ? segment.text.replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t\f\v]+/g, " ") : whiteSpace === "pre-wrap" ? segment.text.replace(/\u00a0/g, " ").replace(/\r\n/g, "\n").replace(/\r/g, "\n") : segment.text.replace(/\u00a0/g, " ").replace(/[ \t\r\f\v\n]+/g, " ");
    if (!text) continue;
    const previous = normalized[normalized.length - 1];
    if (previous && sameInlineStyle(previous, segment)) {
      previous.text += text;
    } else {
      const next = { text, styles: segment.styles };
      if (segment.href) next.href = segment.href;
      if (segment.inlineBox) next.inlineBox = true;
      normalized.push(next);
    }
  }
  if (normalized[0]) normalized[0].text = normalized[0].text.trimStart();
  const last = normalized[normalized.length - 1];
  if (last) last.text = last.text.trimEnd();
  return normalized.filter((segment) => segment.text);
}
function parseInlineSegments(node, rules, inherited = {}, inheritedInlineBox = false) {
  if (node.type === "text") {
    const text = node.data ?? "";
    if (!text) return [];
    const segment = { text, styles: inherited };
    if (inheritedInlineBox) segment.inlineBox = true;
    return [segment];
  }
  if (!("children" in node) || !node.children) return [];
  if (isElement(node) && node.name.toLowerCase() === "br") {
    const segment = { text: "\n", styles: inherited };
    if (inheritedInlineBox) segment.inlineBox = true;
    return [segment];
  }
  let style = inherited;
  let href;
  let inlineBox = inheritedInlineBox;
  if (isElement(node)) {
    const name = node.name.toLowerCase();
    const ownStyle = resolveElementStyle(node, rules);
    style = mergeStyle(inherited, ownStyle);
    if (name === "strong" || name === "b") style = mergeStyle(style, { "font-weight": "700" });
    if (name === "em" || name === "i") style = mergeStyle(style, { "font-style": "italic" });
    if (name === "u") style = mergeStyle(style, { "text-decoration": "underline" });
    if (name === "s" || name === "del") style = mergeStyle(style, { "text-decoration": "line-through" });
    if (name === "sup") style = mergeStyle(style, {
      "vertical-align": ownStyle["vertical-align"] ?? "super",
      "font-size": ownStyle["font-size"] ?? "75%"
    });
    if (name === "sub") style = mergeStyle(style, {
      "vertical-align": ownStyle["vertical-align"] ?? "sub",
      "font-size": ownStyle["font-size"] ?? "75%"
    });
    if (name === "code") style = mergeStyle(style, { "font-family": "monospace", "background-color": style["background-color"] ?? "#f6f8fa" });
    inlineBox = inlineBox || isInlineBoxElement(name) && (name === "code" || hasInlineBoxStyle(ownStyle));
    if (style["display"]?.trim().toLowerCase() === "none" || style["visibility"]?.trim().toLowerCase() === "hidden") return [];
    if (name === "a") href = attr(node, "href").trim() || void 0;
  }
  const segments = node.children.flatMap((child) => parseInlineSegments(child, rules, style, inlineBox));
  if (!href) return segments;
  return segments.map((segment) => ({ ...segment, href: segment.href ?? href }));
}
function inlineText(segments) {
  return normalizeWhitespace(segments.map((segment) => segment.text).join(""));
}
function firstImageInfo(el, rules) {
  const img = findFirst(el, (node) => node.name.toLowerCase() === "img");
  const src = img ? attr(img, "src").trim() : "";
  if (!img || !src) return void 0;
  const styles = resolveElementStyle(img, rules);
  const width = attr(img, "width").trim();
  const height = attr(img, "height").trim();
  if (width && !styles["width"]) styles["width"] = width;
  if (height && !styles["height"]) styles["height"] = height;
  return { src, styles };
}
function imageInfo(el, rules) {
  const src = attr(el, "src").trim();
  if (!src) return void 0;
  const styles = resolveElementStyle(el, rules);
  const width = attr(el, "width").trim();
  const height = attr(el, "height").trim();
  if (width && !styles["width"]) styles["width"] = width;
  if (height && !styles["height"]) styles["height"] = height;
  return { src, alt: attr(el, "alt").trim(), styles };
}
function isHiddenStyle(style) {
  return style["display"]?.trim().toLowerCase() === "none" || style["visibility"]?.trim().toLowerCase() === "hidden";
}
function isRichCellContainer(name) {
  return name === "div" || name === "section" || name === "article" || name === "main" || name === "aside" || name === "header" || name === "footer" || name === "figure";
}
function isCellTextElement(name) {
  return name === "p" || name === "address" || name === "blockquote" || name === "pre" || name === "span" || name === "a" || name === "code" || name === "strong" || name === "b" || name === "em" || name === "i" || name === "u" || name === "s" || name === "del";
}
function isHeadingName(name) {
  return /^h[1-6]$/.test(name);
}
function inheritableStyle(style) {
  const keys = [
    "color",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "letter-spacing",
    "line-height",
    "text-align",
    "text-decoration",
    "text-transform",
    "vertical-align",
    "baseline-shift",
    "white-space",
    "word-break",
    "word-wrap",
    "overflow-wrap"
  ];
  const out = {};
  for (const key of keys) {
    if (style[key] != null) out[key] = style[key];
  }
  return out;
}
function hasAbsoluteDescendant(el, rules) {
  const descendants = findAll(el, () => true);
  return descendants.some((node) => (resolveElementStyle(node, rules)["position"] ?? "").trim().toLowerCase() === "absolute");
}
function hasRichCellContent(el, rules) {
  return directElementChildren(el).some((child) => {
    const name = child.name.toLowerCase();
    if (name === "img" || isRichCellContainer(name) || isHeadingName(name) || name === "p") return true;
    return hasAbsoluteDescendant(child, rules);
  });
}
function parsedTextCellBlock(el, rules, inherited) {
  const inheritedText = inheritableStyle(inherited);
  const style = mergeStyle(inheritedText, resolveElementStyle(el, rules));
  if (isHiddenStyle(style)) return void 0;
  const textStyle = inheritableStyle(style);
  const inlines = normalizeInlineSegments((el.children ?? []).flatMap((child) => parseInlineSegments(child, rules, textStyle)));
  const text = inlineText(inlines) || normalizeWhitespace(textWithBreaks(el));
  if (!text && inlines.length === 0) return void 0;
  const name = el.name.toLowerCase();
  if (isHeadingName(name)) {
    return { type: "heading", level: Number(name[1]), text, inlines, style };
  }
  return { type: "text", text, inlines, style };
}
function parseCellBlocksFromChildren(nodes, rules, inherited) {
  const blocks = [];
  for (const child of nodes) {
    if (child.type === "text") {
      const text = normalizeWhitespace(child.data ?? "");
      const style2 = inheritableStyle(inherited);
      if (text) blocks.push({ type: "text", text, inlines: [{ text, styles: style2 }], style: style2 });
      continue;
    }
    if (!isElement(child)) continue;
    const name = child.name.toLowerCase();
    if (name === "br") continue;
    const inheritedText = inheritableStyle(inherited);
    const style = mergeStyle(inheritedText, resolveElementStyle(child, rules));
    if (isHiddenStyle(style)) continue;
    if (name === "img") {
      const image = imageInfo(child, rules);
      if (image) blocks.push({ type: "image", src: image.src, alt: image.alt, style: image.styles });
      continue;
    }
    if (isRichCellContainer(name)) {
      blocks.push({ type: "box", blocks: parseCellBlocksFromChildren(child.children ?? [], rules, inheritableStyle(style)), className: className(child), style });
      continue;
    }
    if (isHeadingName(name) || isCellTextElement(name)) {
      const block = parsedTextCellBlock(child, rules, inherited);
      if (block) blocks.push(block);
      continue;
    }
    const nested = parseCellBlocksFromChildren(child.children ?? [], rules, inheritableStyle(style));
    if (nested.length > 0) blocks.push({ type: "box", blocks: nested, className: className(child), style });
  }
  return blocks;
}
function parseIntAttr(el, name, fallback) {
  const value = Number.parseInt(attr(el, name), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
function splitList(value) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
    } catch {
    }
  }
  return trimmed.split(/[|,;]/).map((item) => item.trim()).filter(Boolean);
}
function splitNumberList(value) {
  return splitList(value).map((item) => Number.parseFloat(item.replace(/\s+/g, ""))).filter((item) => Number.isFinite(item));
}
function parseChartSeries(value) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((series2) => Array.isArray(series2) ? series2.map((item) => Number.parseFloat(String(item).replace(/\s+/g, ""))).filter((item) => Number.isFinite(item)) : []).filter((series2) => series2.length > 0);
      }
    } catch {
    }
  }
  return trimmed.split("|").map((series2) => splitNumberList(series2)).filter((series2) => series2.length > 0);
}
function parseChart(el) {
  const rawType = (attr(el, "type") || attr(el, "data-chart")).trim().toLowerCase();
  const chartTypeMap = {
    area: "area",
    bar: "bar",
    donut: "donut",
    doughnut: "donut",
    gauge: "gauge",
    hbar: "horizontal-bar",
    "horizontal-bar": "horizontal-bar",
    line: "line",
    pie: "pie",
    radar: "radar",
    radial: "radial",
    "radial-stacked": "radial-stacked",
    spark: "sparkline",
    sparkline: "sparkline",
    stacked: "stacked-bar",
    "stacked-bar": "stacked-bar"
  };
  const chartType = chartTypeMap[rawType] ?? "bar";
  const series2 = parseChartSeries(attr(el, "data-series") || attr(el, "series"));
  const values = splitNumberList(attr(el, "data-values") || attr(el, "values"));
  const chartValues = values.length > 0 ? values : series2[0] ?? [];
  if (chartValues.length === 0) return void 0;
  const labels = splitList(attr(el, "data-labels") || attr(el, "labels"));
  const seriesLabels = splitList(attr(el, "data-series-labels") || attr(el, "series-labels"));
  const colors = splitList(attr(el, "data-colors") || attr(el, "colors"));
  const gradient = splitList(attr(el, "data-gradient") || attr(el, "gradient"));
  const max = Number.parseFloat((attr(el, "data-max") || attr(el, "max")).trim());
  const chart = {
    chartType,
    values: chartValues,
    labels: labels.length > 0 ? labels : chartValues.map((_, index) => String(index + 1))
  };
  const title = attr(el, "title").trim();
  const subtitle = attr(el, "subtitle").trim();
  const unit = attr(el, "unit").trim();
  const center = (attr(el, "data-center") || attr(el, "center")).trim();
  const theme = (attr(el, "data-theme") || attr(el, "theme")).trim().toLowerCase();
  if (title) chart.title = title;
  if (subtitle) chart.subtitle = subtitle;
  if (unit) chart.unit = unit;
  if (center) chart.center = center;
  if (theme) chart.theme = theme;
  if (series2.length > 0) chart.series = series2;
  if (seriesLabels.length > 0) chart.seriesLabels = seriesLabels;
  if (Number.isFinite(max) && max > 0) chart.max = max;
  if (colors.length > 0) chart.colors = colors;
  if (gradient.length > 0) chart.gradient = gradient;
  return chart;
}
function parseCell(el, rules) {
  const cls = className(el);
  const style = attr(el, "style");
  const styles = resolveElementStyle(el, rules);
  const inlines = normalizeInlineSegments(parseInlineSegments(el, rules, styles));
  const text = inlineText(inlines) || normalizeWhitespace(textWithBreaks(el));
  const richBlocks = hasRichCellContent(el, rules) ? parseCellBlocksFromChildren(el.children ?? [], rules, styles) : [];
  const lower = `${cls} ${style} ${Object.entries(styles).map(([k, v]) => `${k}:${v}`).join(";")}`.toLowerCase();
  const isHeader = el.name.toLowerCase() === "th";
  const isPrice = /\bprice\b/.test(cls) || lower.includes("data-price");
  const isParam = /\bparam-name\b/.test(cls) || lower.includes("background-color: #f4f6f8");
  const isDiff = /\bdiff\b/.test(cls) || lower.includes("#fff3cd") || lower.includes("#fff1bf") || lower.includes("255, 165, 0");
  const isSection = /\bsection-header\b|\bsection-title\b/.test(cls) || lower.includes("background-color: #22252a") || lower.includes("background-color: #1f2329");
  const cell = {
    text,
    inlines,
    className: cls,
    style,
    styles,
    colspan: parseIntAttr(el, "colspan", 1),
    rowspan: parseIntAttr(el, "rowspan", 1),
    isHeader,
    isParam,
    isPrice,
    isDiff,
    isSection
  };
  if (richBlocks.length > 0) cell.richBlocks = richBlocks;
  const image = firstImageInfo(el, rules);
  if (image && richBlocks.length === 0) {
    cell.imageSrc = image.src;
    cell.imageStyles = image.styles;
  }
  return cell;
}
function parseRow(el, fallbackKind, rules) {
  const styles = resolveElementStyle(el, rules);
  const cells = directElementChildren(el).filter((child) => {
    const name = child.name.toLowerCase();
    return name === "td" || name === "th";
  }).map((cell) => parseCell(cell, rules));
  const cls = className(el);
  const hasPrice = cells.some((cell) => cell.isPrice);
  const hasSection = /\bsection-title\b/.test(cls) || cells.some((cell) => cell.isSection || cell.colspan > 1 && cell.text && cells.length === 1);
  let kind = fallbackKind;
  if (hasSection) kind = "section";
  else if (hasPrice) kind = "price";
  return { cells, kind, styles };
}
function maxColumns(rows) {
  return Math.max(
    0,
    ...rows.map((row) => row.cells.reduce((sum, cell) => sum + Math.max(1, cell.colspan), 0))
  );
}
function parseColumnStyles(tableEl, rules) {
  const colgroup = findFirst(tableEl, (el) => el.name.toLowerCase() === "colgroup");
  if (!colgroup) return [];
  return directElementChildren(colgroup, "col").map((col) => {
    const styles = resolveElementStyle(col, rules);
    const width = attr(col, "width").trim();
    if (width && !styles["width"]) styles["width"] = width;
    return styles;
  });
}
function normalizeRowspans(rows, columnCount) {
  const active = [];
  const normalized = [];
  for (const row of rows) {
    const cells = [];
    let sourceIndex = 0;
    for (let col = 0; col < columnCount; ) {
      const activeCell = active[col];
      if (activeCell && activeCell.remaining > 0) {
        const { imageSrc: _imageSrc, imageStyles: _imageStyles, ...cellWithoutImage } = activeCell.cell;
        const placeholder = {
          ...cellWithoutImage,
          text: "",
          inlines: [],
          colspan: 1,
          rowspan: 1,
          isSpanPlaceholder: true,
          isSpanPlaceholderEnd: activeCell.remaining === 1
        };
        cells.push(placeholder);
        activeCell.remaining -= 1;
        col += 1;
        continue;
      }
      const source = row.cells[sourceIndex++];
      if (!source) {
        cells.push({
          text: "",
          inlines: [],
          className: "",
          style: "",
          styles: {},
          colspan: 1,
          rowspan: 1,
          isHeader: false,
          isParam: col === 0,
          isPrice: false,
          isDiff: false,
          isSection: false
        });
        col += 1;
        continue;
      }
      cells.push(source);
      const span = Math.max(1, source.colspan);
      if (source.rowspan > 1) {
        for (let i = 0; i < span; i++) {
          active[col + i] = { remaining: source.rowspan - 1, cell: source };
        }
      }
      col += span;
    }
    normalized.push({ ...row, cells });
  }
  return normalized;
}
function parseTable(tableEl, rules) {
  const thead = findFirst(tableEl, (el) => el.name.toLowerCase() === "thead");
  const tbody = findFirst(tableEl, (el) => el.name.toLowerCase() === "tbody");
  const theadStyles = thead ? resolveElementStyle(thead, rules) : {};
  const headRows = thead ? directElementChildren(thead, "tr").map((row) => parseRow(row, "header", rules)) : [];
  const bodyRows = tbody ? directElementChildren(tbody, "tr").map((row) => parseRow(row, "body", rules)) : directElementChildren(tableEl, "tr").map((row) => parseRow(row, "body", rules));
  const tfoot = findFirst(tableEl, (el) => el.name.toLowerCase() === "tfoot");
  const footRows = tfoot ? directElementChildren(tfoot, "tr").map((row) => parseRow(row, "body", rules)) : [];
  const columnCount = Math.max(1, maxColumns([...headRows, ...bodyRows, ...footRows]));
  const columnStyles = parseColumnStyles(tableEl, rules);
  return {
    headRows: normalizeRowspans(headRows, columnCount),
    bodyRows: normalizeRowspans([...bodyRows, ...footRows], columnCount),
    columnCount,
    columnStyles,
    repeatHeader: theadStyles["display"]?.trim().toLowerCase() === "table-header-group"
  };
}
function styleText(root) {
  return findAll(root, (el) => el.name.toLowerCase() === "style").map((el) => textWithBreaks(el)).join("\n");
}
function bodyChildren(roots) {
  const body = findFirst(roots, (el) => el.name.toLowerCase() === "body");
  return body?.children ?? roots;
}
function parseFlowBlocks(nodes, rules, blocks = []) {
  let listStack = [];
  const isHidden = (style) => style["display"]?.trim().toLowerCase() === "none" || style["visibility"]?.trim().toLowerCase() === "hidden";
  const isPageBreak = (value) => {
    const v = value?.trim().toLowerCase();
    return v === "always" || v === "page" || v === "left" || v === "right";
  };
  const visit = (node) => {
    if (!isElement(node)) return;
    const name = node.name.toLowerCase();
    if (name === "script" || name === "style" || name === "meta" || name === "title") return;
    if (hasClass(node, "contact-card") || hasClass(node, "brand-name") || name === "header") return;
    const style = resolveElementStyle(node, rules);
    if (isHidden(style)) return;
    if (isPageBreak(style["page-break-before"]) || isPageBreak(style["break-before"])) {
      blocks.push({ type: "page-break", style });
    }
    if (name === "table") {
      blocks.push({ type: "table", table: parseTable(node, rules), style });
      if (isPageBreak(style["page-break-after"]) || isPageBreak(style["break-after"])) blocks.push({ type: "page-break", style });
      return;
    }
    if (name === "chart" || attr(node, "data-chart")) {
      const chart = parseChart(node);
      if (chart) blocks.push({ type: "chart", chart, style });
      if (isPageBreak(style["page-break-after"]) || isPageBreak(style["break-after"])) blocks.push({ type: "page-break", style });
      return;
    }
    if (/^h[1-6]$/.test(name)) {
      const inlines = normalizeInlineSegments(parseInlineSegments(node, rules, style));
      const text = inlineText(inlines) || normalizeWhitespace(textWithBreaks(node));
      if (text) blocks.push({ type: "heading", level: Number(name.slice(1)), text, inlines, style });
      if (isPageBreak(style["page-break-after"]) || isPageBreak(style["break-after"])) blocks.push({ type: "page-break", style });
      return;
    }
    if (name === "p" || name === "address") {
      const inlines = normalizeInlineSegments(parseInlineSegments(node, rules, style));
      const text = inlineText(inlines) || normalizeWhitespace(textWithBreaks(node));
      if (text) blocks.push({ type: "paragraph", text, inlines, style });
      if (isPageBreak(style["page-break-after"]) || isPageBreak(style["break-after"])) blocks.push({ type: "page-break", style });
      return;
    }
    if (name === "blockquote") {
      const inlines = normalizeInlineSegments(parseInlineSegments(node, rules, style));
      const text = inlineText(inlines) || normalizeWhitespace(textWithBreaks(node));
      if (text) blocks.push({ type: "blockquote", text, inlines, style });
      if (isPageBreak(style["page-break-after"]) || isPageBreak(style["break-after"])) blocks.push({ type: "page-break", style });
      return;
    }
    if (name === "pre") {
      const text = normalizePreText(preText(node));
      const preStyle = mergeStyle(style, { "font-family": style["font-family"] ?? "monospace" });
      if (text) blocks.push({ type: "preformatted", text, inlines: [{ text, styles: preStyle }], style: preStyle });
      if (isPageBreak(style["page-break-after"]) || isPageBreak(style["break-after"])) blocks.push({ type: "page-break", style });
      return;
    }
    if (name === "img") {
      const src = attr(node, "src").trim();
      const width = attr(node, "width").trim();
      const height = attr(node, "height").trim();
      if (width && !style["width"]) style["width"] = width;
      if (height && !style["height"]) style["height"] = height;
      if (src) blocks.push({ type: "image", src, alt: attr(node, "alt"), style });
      if (isPageBreak(style["page-break-after"]) || isPageBreak(style["break-after"])) blocks.push({ type: "page-break", style });
      return;
    }
    if (name === "hr") {
      blocks.push({ type: "hr", style });
      if (isPageBreak(style["page-break-after"]) || isPageBreak(style["break-after"])) blocks.push({ type: "page-break", style });
      return;
    }
    if (name === "ul" || name === "ol") {
      const previous = listStack;
      listStack = [...listStack, { ordered: name === "ol", index: 0 }];
      for (const child of node.children ?? []) visit(child);
      listStack = previous;
      return;
    }
    if (name === "li") {
      const current = listStack[listStack.length - 1] ?? { ordered: false, index: 0 };
      current.index += 1;
      if (listStack.length) listStack[listStack.length - 1] = current;
      const text = normalizeWhitespace(textWithBreaks(node));
      const inlines = normalizeInlineSegments(parseInlineSegments(node, rules, style));
      if (text) blocks.push({ type: "list-item", text, inlines, ordered: current.ordered, index: current.index, style });
      return;
    }
    if (name === "div" || name === "section" || name === "article" || name === "main" || name === "aside") {
      if ((style["display"] ?? "").trim().toLowerCase() === "grid") {
        const childBlocks = parseFlowBlocks(node.children ?? [], rules, []);
        if (childBlocks.length > 0) blocks.push({ type: "grid", blocks: childBlocks, style });
        if (isPageBreak(style["page-break-after"]) || isPageBreak(style["break-after"])) blocks.push({ type: "page-break", style });
        return;
      }
      const before = blocks.length;
      for (const child of node.children ?? []) visit(child);
      const producedChildBlock = blocks.length > before;
      const inlines = normalizeInlineSegments(parseInlineSegments(node, rules, style));
      const text = inlineText(inlines) || normalizeWhitespace(textWithBreaks(node));
      if (!producedChildBlock && text) blocks.push({ type: "paragraph", text, inlines, style });
      if (isPageBreak(style["page-break-after"]) || isPageBreak(style["break-after"])) blocks.push({ type: "page-break", style });
      return;
    }
    for (const child of node.children ?? []) visit(child);
    if (isPageBreak(style["page-break-after"]) || isPageBreak(style["break-after"])) blocks.push({ type: "page-break", style });
  };
  for (const node of nodes) visit(node);
  return blocks;
}
function parseContactItems(root) {
  const card = findFirst(root, (el) => hasClass(el, "contact-card"));
  if (!card) return { items: [] };
  const itemEls = findAll(card, (el) => hasClass(el, "contact-item"));
  const items = itemEls.map((el) => normalizeWhitespace(textWithBreaks(el))).filter(Boolean);
  const qr = findFirst(card, (el) => hasClass(el, "contact-qr"));
  const img = qr ? findFirst(qr, (el) => el.name.toLowerCase() === "img") : void 0;
  const qrSrc = img ? attr(img, "src").trim() : "";
  return qrSrc ? { items, qrSrc } : { items };
}
function parsePrintableHtml(html) {
  const doc = parseDocument(html, { decodeEntities: true });
  const roots = doc.children ?? [];
  const css = styleText(roots);
  const rules = parseCssRules(css);
  const fontFaces = parseCssFontFaces(css);
  const page = parseCssPageRule(css);
  const brandEl = findFirst(roots, (el) => hasClass(el, "brand-name"));
  const titleEl = findFirst(roots, (el) => el.name.toLowerCase() === "title");
  const brandText = brandEl ? normalizeWhitespace(textWithBreaks(brandEl)) : titleEl ? normalizeWhitespace(textWithBreaks(titleEl)) : "DOCUMENT";
  const contacts = parseContactItems(roots);
  const blocks = parseFlowBlocks(bodyChildren(roots), rules);
  if (blocks.length === 0) {
    const text = normalizeWhitespace(textWithBreaks(doc));
    if (text) blocks.push({ type: "paragraph", text, inlines: [{ text, styles: {} }], style: {} });
  }
  const primaryTable = blocks.find((block) => block.type === "table")?.table;
  const parsed = {
    brandText: brandText || "DOCUMENT",
    contactItems: contacts.items,
    fontFaces,
    blocks
  };
  if (page) parsed.page = page;
  if (primaryTable) parsed.primaryTable = primaryTable;
  if (contacts.qrSrc) parsed.contactQrSrc = contacts.qrSrc;
  return parsed;
}

// src/dashboard.ts
function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function attr2(name, value) {
  return value === void 0 || value === "" ? "" : ` ${name}="${escapeHtml(String(value))}"`;
}
function list(value) {
  if (value === void 0 || typeof value === "string") {
    return value;
  }
  return value.map(String).join(",");
}
function series(value) {
  if (value === void 0 || typeof value === "string") {
    return value;
  }
  return value.map((line) => line.map(String).join(",")).join("|");
}
function dashboardCss({
  gridClassName,
  cardClassName,
  columns,
  gap,
  cardHeight,
  cardPadding
}) {
  return `<style>
    .${gridClassName} { display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: ${gap}; margin-top: 12px; }
    .${cardClassName} { height: ${cardHeight}; margin-bottom: 0; padding: ${cardPadding}; border: 1px solid #d8e0ea; border-radius: 8px; background-color: #ffffff; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 12px 28px -10px rgba(15, 23, 42, 0.18); }
  </style>`;
}
function dashboardCardHtml(card, cardClassName) {
  return `<chart${attr2("class", cardClassName)}${attr2("type", card.type)}${attr2("title", card.title)}${attr2("subtitle", card.subtitle)}${attr2("unit", card.unit)}${attr2("data-theme", card.theme)}${attr2("data-labels", list(card.labels))}${attr2("data-values", list(card.values))}${attr2("data-series", series(card.series))}${attr2("data-series-labels", list(card.seriesLabels))}${attr2("data-max", card.max)}${attr2("data-center", card.center)}${attr2("data-colors", list(card.colors))}${attr2("data-gradient", list(card.gradient))}></chart>`;
}
function createChartDashboardHtml(options) {
  const className2 = options.className ?? "h2ps-dashboard";
  const gridClassName = options.gridClassName ?? "h2ps-dashboard-grid";
  const cardClassName = options.cardClassName ?? "h2ps-dashboard-card";
  const columns = options.columns ?? 3;
  const gap = options.gap ?? "10px";
  const cardHeight = options.cardHeight ?? "166px";
  const cardPadding = options.cardPadding ?? "12px 14px";
  const includeStyles = options.includeStyles ?? true;
  const css = includeStyles ? `${dashboardCss({ gridClassName, cardClassName, columns, gap, cardHeight, cardPadding })}
` : "";
  const lead = options.lead ? `
    <p class="lead">${escapeHtml(options.lead)}</p>` : "";
  const charts = options.charts.map((chart) => `      ${dashboardCardHtml(chart, cardClassName)}`).join("\n");
  return `${css}<section class="${escapeHtml(className2)}">
    <h1>${escapeHtml(options.title)}</h1>${lead}
    <div class="${escapeHtml(gridClassName)}">
${charts}
    </div>
  </section>`;
}

// src/compat.ts
import { Buffer as Buffer5 } from "buffer";

// src/stream-render.ts
import PDFDocument from "pdfkit";

// src/resources.ts
import { existsSync, statSync } from "fs";
import { readFile } from "fs/promises";
import { Buffer } from "buffer";
import { dirname, isAbsolute, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { parseDocument as parseDocument2 } from "htmlparser2";
import { DomUtils as DomUtils2 } from "htmlparser2";
function isElement2(node) {
  return !!node && (node.type === "tag" || node.type === "style" || node.type === "script");
}
function policyValue(policy, key, fallback) {
  const value = policy?.[key];
  return typeof value === "boolean" ? value : fallback;
}
function timeoutMs(policy) {
  return policy?.timeoutMs ?? 1e4;
}
function maxBytes(policy, type) {
  if (type === "image") return policy?.maxImageBytes ?? Number.POSITIVE_INFINITY;
  if (type === "font") return policy?.maxFontBytes ?? 1e7;
  return policy?.maxStylesheetBytes ?? 1e6;
}
function isDataUrl(value) {
  return /^data:/i.test(value);
}
function isHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}
function isFileUrl(value) {
  return /^file:\/\//i.test(value);
}
function baseToUrl(baseUrl) {
  if (!baseUrl) return void 0;
  if (isHttpUrl(baseUrl) || isFileUrl(baseUrl)) {
    const url = new URL(baseUrl);
    if (!url.pathname.endsWith("/") && !/\.[^/]+$/.test(url.pathname)) {
      url.pathname += "/";
    }
    return url;
  }
  const absolute = isAbsolute(baseUrl) ? baseUrl : resolve(baseUrl);
  let basePath = absolute;
  try {
    if (existsSync(absolute) && statSync(absolute).isFile()) basePath = dirname(absolute);
  } catch {
  }
  return pathToFileURL(basePath.endsWith("/") || basePath.endsWith("\\") ? basePath : `${basePath}/`);
}
function resolveResource(src, baseUrl) {
  const trimmed = src.trim();
  if (isDataUrl(trimmed)) return { kind: "data", value: trimmed, display: "data URL" };
  if (isHttpUrl(trimmed)) return { kind: "http", value: trimmed, display: trimmed };
  if (isFileUrl(trimmed)) {
    const filePath2 = fileURLToPath(trimmed);
    return { kind: "file", value: filePath2, display: filePath2 };
  }
  if (isAbsolute(trimmed)) return { kind: "file", value: trimmed, display: trimmed };
  const base = baseToUrl(baseUrl);
  if (base) {
    const resolvedUrl = new URL(trimmed, base);
    if (resolvedUrl.protocol === "http:" || resolvedUrl.protocol === "https:") {
      return { kind: "http", value: resolvedUrl.toString(), display: resolvedUrl.toString() };
    }
    if (resolvedUrl.protocol === "file:") {
      const filePath2 = fileURLToPath(resolvedUrl);
      return { kind: "file", value: filePath2, display: filePath2 };
    }
  }
  const filePath = resolve(trimmed);
  return { kind: "file", value: filePath, display: filePath };
}
function parseDataUrl(src) {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/is.exec(src);
  if (!match) throw new ResourcePolicyError("Invalid data URL");
  const mime = (match[1] || "application/octet-stream").toLowerCase();
  const payload = match[2] ?? "";
  const isBase64 = /^data:[^,]*;base64,/i.test(src);
  const bytes = isBase64 ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
  return { bytes, mime };
}
function enforceAllowed(resource, type, policy) {
  if (resource.kind === "data" && !policyValue(policy, "allowData", true)) {
    throw new ResourcePolicyError(`${type} data URLs are blocked by resourcePolicy.allowData=false`);
  }
  if (resource.kind === "http" && !policyValue(policy, "allowHttp", true)) {
    throw new ResourcePolicyError(`${type} HTTP resources are blocked by resourcePolicy.allowHttp=false`);
  }
  if (resource.kind === "file" && !policyValue(policy, "allowFile", true)) {
    throw new ResourcePolicyError(`${type} file resources are blocked by resourcePolicy.allowFile=false`);
  }
}
function enforceSize(size, limit, type, display) {
  if (size > limit) {
    throw new ResourcePolicyError(`${type} resource is too large (${size} bytes > ${limit} bytes): ${display}`);
  }
}
async function loadResource(src, type, warnings, options = {}) {
  const resource = resolveResource(src, options.baseUrl);
  const limit = maxBytes(options.resourcePolicy, type);
  try {
    enforceAllowed(resource, type, options.resourcePolicy);
    if (resource.kind === "data") {
      const data = parseDataUrl(resource.value);
      enforceSize(data.bytes.byteLength, limit, type, resource.display);
      return { bytes: data.bytes, mime: data.mime, display: resource.display };
    }
    if (resource.kind === "http") {
      const response = await fetch(resource.value, { signal: AbortSignal.timeout(timeoutMs(options.resourcePolicy)) });
      if (!response.ok) throw new ResourceLoadError(`HTTP ${response.status}`);
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength)) enforceSize(contentLength, limit, type, resource.display);
      const bytes2 = new Uint8Array(await response.arrayBuffer());
      enforceSize(bytes2.byteLength, limit, type, resource.display);
      return { bytes: bytes2, mime: response.headers.get("content-type") ?? "application/octet-stream", display: resource.display };
    }
    const stat = statSync(resource.value);
    enforceSize(stat.size, limit, type, resource.display);
    const bytes = new Uint8Array(await readFile(resource.value));
    return { bytes, mime: "application/octet-stream", display: resource.display };
  } catch (error) {
    warnings.add(`${type}_load_failed`, `Failed to load ${type} ${resource.display.slice(0, 120)}: ${String(error)}`);
    return null;
  }
}
function extractLinkedStylesheets(html) {
  const doc = parseDocument2(html, { decodeEntities: true });
  const roots = doc.children ?? [];
  const links = DomUtils2.findAll((node) => {
    if (!isElement2(node) || node.name.toLowerCase() !== "link") return false;
    const rel = node.attribs?.["rel"]?.toLowerCase().split(/\s+/) ?? [];
    return rel.includes("stylesheet") && Boolean(node.attribs?.["href"]);
  }, roots);
  return links.map((link) => link.attribs?.["href"]?.trim()).filter((href) => Boolean(href));
}
async function loadStylesheetSource(source, warnings, options) {
  if (typeof source !== "string") {
    if (source.content != null) return source.content;
    if (!source.href) return "";
    source = source.href;
  }
  const loaded = await loadResource(source, "stylesheet", warnings, options);
  if (!loaded) return "";
  return rebaseCssUrls(Buffer.from(loaded.bytes).toString("utf8"), source, options.baseUrl);
}
function cssUrlValue(resource) {
  if (resource.kind === "data" || resource.kind === "http") return resource.value;
  return resource.value.replace(/\\/g, "/");
}
function rebaseCssUrls(css, stylesheetHref, documentBaseUrl) {
  const stylesheet = resolveResource(stylesheetHref, documentBaseUrl);
  let stylesheetBase = documentBaseUrl;
  if (stylesheet.kind === "http") {
    stylesheetBase = new URL(".", stylesheet.value).toString();
  } else if (stylesheet.kind === "file") {
    stylesheetBase = dirname(stylesheet.value);
  }
  return css.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_full, quote, raw) => {
    const value = raw.trim();
    if (!value || value.startsWith("#") || isDataUrl(value) || isHttpUrl(value) || isFileUrl(value) || isAbsolute(value)) {
      return `url(${quote}${value}${quote})`;
    }
    const resolved = resolveResource(value, stylesheetBase);
    return `url(${quote}${cssUrlValue(resolved)}${quote})`;
  });
}
function injectStyles(html, css) {
  if (!css.trim()) return html;
  const style = `<style data-html2pdfsmith="external">
${css}
</style>`;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${style}`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${style}</head>`);
  return `${style}
${html}`;
}
async function prepareHtmlForRender(options, warnings) {
  const configured = options.stylesheets ?? [];
  const linked = extractLinkedStylesheets(options.html);
  if (configured.length === 0 && linked.length === 0) return options.html;
  const cssParts = [];
  for (const source of configured) {
    const css = await loadStylesheetSource(source, warnings, options);
    if (css.trim()) cssParts.push(css);
  }
  for (const href of linked) {
    const css = await loadStylesheetSource(href, warnings, options);
    if (css.trim()) cssParts.push(css);
  }
  return injectStyles(options.html, cssParts.join("\n"));
}

// src/protect.ts
import { execFile } from "child_process";
import { readFile as readFile2, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
function ownerPassword() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}
function validateQpdfPath(qpdfPath) {
  if (!qpdfPath || qpdfPath.trim() === "") {
    throw new PdfProtectionError("qpdfPath must not be empty");
  }
  if (/[\0;&|`$<>'"!{}()[\]]/.test(qpdfPath)) {
    throw new PdfProtectionError(`qpdfPath contains disallowed characters: "${qpdfPath}"`);
  }
}
async function protectPdfWithQpdf(pdf, qpdfPath = "qpdf") {
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
      outPath
    ];
    try {
      await execFileAsync(qpdfPath, args, { windowsHide: true });
    } catch (error) {
      const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
      const message = error instanceof Error ? error.message : String(error);
      throw new PdfProtectionError(stderr ? `${message}: ${stderr}` : message);
    }
    return new Uint8Array(await readFile2(outPath));
  } finally {
    try {
      await unlink(inPath);
    } catch {
    }
    try {
      await unlink(outPath);
    } catch {
    }
  }
}

// src/stream/layout.ts
import { Buffer as Buffer3 } from "buffer";
import { existsSync as existsSync3 } from "fs";

// src/assets.ts
import { existsSync as existsSync2 } from "fs";
import { readFile as readFile3 } from "fs/promises";
import { Buffer as Buffer2 } from "buffer";
function imageKind(mime, bytes) {
  if (mime.includes("png") || bytes[0] === 137 && bytes[1] === 80) return "png";
  if (mime.includes("jpeg") || mime.includes("jpg") || bytes[0] === 255 && bytes[1] === 216) return "jpg";
  if (mime.includes("svg") || Buffer2.from(bytes.subarray(0, 128)).toString("utf8").includes("<svg")) return "svg";
  return "unsupported";
}
async function loadImage(src, warnings, options = {}) {
  const trimmed = src.trim();
  if (!trimmed) return null;
  const loaded = await loadResource(trimmed, "image", warnings, options);
  if (!loaded) return null;
  return { bytes: loaded.bytes, kind: imageKind(loaded.mime, loaded.bytes), mime: loaded.mime };
}
function discoverFontPaths() {
  const candidates = [
    {
      regularPath: "C:/Windows/Fonts/NotoSansSC-VF.ttf",
      boldPath: "C:/Windows/Fonts/NotoSansSC-VF.ttf"
    },
    {
      regularPath: "C:/Windows/Fonts/msyh.ttc",
      boldPath: "C:/Windows/Fonts/msyhbd.ttc"
    },
    {
      regularPath: "C:/Windows/Fonts/arial.ttf",
      boldPath: "C:/Windows/Fonts/arialbd.ttf"
    },
    {
      regularPath: "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      boldPath: "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
    },
    {
      regularPath: "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
      boldPath: "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"
    },
    {
      regularPath: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      boldPath: "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    }
  ];
  for (const item of candidates) {
    if (existsSync2(item.regularPath)) {
      const result = { regularPath: item.regularPath };
      if (existsSync2(item.boldPath)) result.boldPath = item.boldPath;
      return result;
    }
  }
  return {};
}
async function resolveFontPaths(fontOptions, warnings, resourcePolicy) {
  if (fontOptions?.regularPath || fontOptions?.regularBytes) {
    const result = {};
    if (fontOptions.regularPath) result.regularPath = fontOptions.regularPath;
    const bp = fontOptions.boldPath ?? fontOptions.regularPath;
    if (bp) result.boldPath = bp;
    const ip = fontOptions.italicPath ?? fontOptions.regularPath;
    if (ip) result.italicPath = ip;
    const bip = fontOptions.boldItalicPath ?? fontOptions.boldPath ?? fontOptions.italicPath ?? fontOptions.regularPath;
    if (bip) result.boldItalicPath = bip;
    return result;
  }
  if (fontOptions?.bundled) {
    return {
      regularPath: fontOptions.bundled.regularPath,
      boldPath: fontOptions.bundled.boldPath ?? fontOptions.bundled.regularPath,
      italicPath: fontOptions.bundled.italicPath ?? fontOptions.bundled.regularPath,
      boldItalicPath: fontOptions.bundled.boldItalicPath ?? fontOptions.bundled.boldPath ?? fontOptions.bundled.italicPath ?? fontOptions.bundled.regularPath
    };
  }
  if (fontOptions?.googleFont) {
    if (resourcePolicy?.allowHttp === false && !isGoogleFontCached(fontOptions.googleFont)) {
      warnings.add("google_font_http_blocked", `Google Font "${fontOptions.googleFont}" is not cached and HTTP resources are blocked.`);
    } else {
      const result = await resolveGoogleFont(fontOptions.googleFont, warnings);
      if (result) return result;
    }
  }
  if (fontOptions?.autoDiscover) {
    return discoverFontPaths();
  }
  return {};
}

// src/units.ts
var MM_TO_PT = 72 / 25.4;
function mm(value) {
  return safeNumber(value, 0) * MM_TO_PT;
}
function clamp(value, min, max) {
  const safeMin = safeNumber(min, 0);
  const safeMax = safeNumber(max, safeMin);
  const lower = Math.min(safeMin, safeMax);
  const upper = Math.max(safeMin, safeMax);
  return Math.max(lower, Math.min(upper, safeNumber(value, lower)));
}
function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function calculateFontScale(columns) {
  if (columns <= 1) return 85;
  if (columns <= 3) return 80;
  if (columns <= 5) return 75;
  if (columns <= 6) return 72;
  if (columns <= 8) return 68;
  if (columns <= 9) return 65;
  if (columns <= 11) return 62;
  if (columns <= 12) return 60;
  if (columns <= 14) return 58;
  if (columns <= 16) return 55;
  return 52;
}
function calculatePaddingScale(columns) {
  if (columns <= 1) return 1;
  if (columns <= 3) return 0.9;
  if (columns <= 5) return 0.75;
  if (columns <= 6) return 0.7;
  if (columns <= 8) return 0.65;
  if (columns <= 9) return 0.6;
  if (columns <= 11) return 0.55;
  if (columns <= 12) return 0.5;
  if (columns <= 14) return 0.45;
  if (columns <= 16) return 0.4;
  return 0.35;
}
function calculateHeaderCellHeight(columns) {
  if (columns <= 1) return 100;
  if (columns <= 3) return 90;
  if (columns <= 5) return 80;
  if (columns <= 6) return 70;
  if (columns <= 8) return 65;
  if (columns <= 9) return 60;
  if (columns <= 10) return 55;
  if (columns <= 11) return 50;
  if (columns <= 12) return 45;
  if (columns <= 14) return 42;
  return 38;
}
function determineOrientation(columns) {
  return columns <= 3 ? "portrait" : "landscape";
}

// src/stream/layout.ts
var FontResolver = class {
  constructor(doc, defaults, families, fallbackFamilies) {
    this.doc = doc;
    this.defaults = defaults;
    this.families = families;
    this.fallbackFamilies = fallbackFamilies;
  }
  doc;
  defaults;
  families;
  fallbackFamilies;
  coverageCache = /* @__PURE__ */ new Map();
  resolve(request = {}) {
    const style = request.style ?? {};
    const fallbackFont = request.fallbackFont ?? this.defaults.regular;
    const fontStyle = (style["font-style"] ?? "").trim().toLowerCase();
    const weightRaw = (style["font-weight"] ?? "").trim().toLowerCase();
    const weight = Number.parseInt(weightRaw, 10);
    const bold = weightRaw ? weightRaw === "bold" || Number.isFinite(weight) && weight >= 600 : request.defaultBold ?? (fallbackFont === this.defaults.bold || fallbackFont === this.defaults.boldItalic);
    const italic = fontStyle ? fontStyle === "italic" || fontStyle === "oblique" : request.defaultItalic ?? (fallbackFont === this.defaults.italic || fallbackFont === this.defaults.boldItalic);
    const stack = parseFontFamilyStack(style["font-family"]);
    const candidates = this.candidateFonts(stack, bold, italic, fallbackFont);
    return this.bestCoveredFont(candidates, request.text);
  }
  candidateFonts(stack, bold, italic, fallbackFont) {
    const candidates = [];
    for (const family of stack) {
      const generic = genericFont(family, bold, italic);
      if (generic) candidates.push(generic);
      const pair = this.families.get(family);
      if (pair) candidates.push(pairFont(pair, bold, italic));
    }
    for (const family of this.fallbackFamilies) {
      const pair = this.families.get(family);
      if (pair) candidates.push(pairFont(pair, bold, italic));
    }
    candidates.push(fallbackFont, pairFont(this.defaults, bold, italic), this.defaults.regular);
    return [...new Set(candidates)];
  }
  bestCoveredFont(candidates, text) {
    if (!text || !significantCodePoints(text).some((codePoint) => !isBasicWhitespace(codePoint))) {
      return candidates[0] ?? this.defaults.regular;
    }
    const scored = candidates.map((font) => ({ font, score: this.coverageScore(font, text) }));
    const full = scored.find((item) => item.score === 1);
    return full?.font ?? scored.sort((a, b) => b.score - a.score)[0]?.font ?? candidates[0] ?? this.defaults.regular;
  }
  coverageScore(fontName, text) {
    const points = significantCodePoints(text).filter((codePoint) => !isBasicWhitespace(codePoint));
    if (points.length === 0) return 1;
    let covered = 0;
    for (const codePoint of points) {
      if (this.coversCodePoint(fontName, codePoint)) covered += 1;
    }
    return covered / points.length;
  }
  coversCodePoint(fontName, codePoint) {
    let cache = this.coverageCache.get(fontName);
    if (!cache) {
      cache = /* @__PURE__ */ new Map();
      this.coverageCache.set(fontName, cache);
    }
    const cached = cache.get(codePoint);
    if (cached != null) return cached;
    const covered = this.computeCoversCodePoint(fontName, codePoint);
    cache.set(codePoint, covered);
    return covered;
  }
  computeCoversCodePoint(fontName, codePoint) {
    if (codePoint <= 127) return true;
    if (/^(Helvetica|Times|Courier)/.test(fontName)) return codePoint <= 255;
    try {
      this.doc.font(fontName);
      const current = this.doc._font;
      if (current?.font?.hasGlyphForCodePoint) return current.font.hasGlyphForCodePoint(codePoint);
      const glyph = current?.font?.glyphForCodePoint?.(codePoint);
      if (glyph?.id != null) return glyph.id !== 0;
      if (current?.characterSet) return current.characterSet.includes(codePoint);
      return true;
    } catch {
      return false;
    }
  }
};
var COLORS = {
  text: "#22252a",
  border: "#d7dce3",
  grid: "#e4e7ec",
  headerBg: "#f7f8fa",
  paramBg: "#f4f6f8",
  evenBg: "#fafbfc",
  sectionBg: "#1f2329",
  sectionText: "#ffffff",
  diffBg: "#fff1bf"
};
var CHART_COLORS = ["#2563eb", "#0f766e", "#f59e0b", "#7c3aed", "#dc2626", "#0891b2", "#4f46e5", "#65a30d"];
var CHART_THEMES = {
  default: { colors: CHART_COLORS, grid: "#e2e8f0", muted: "#64748b", text: "#0f172a", track: "#edf2f7", areaEnd: "#ffffff" },
  aurora: { colors: ["#2563eb", "#14b8a6", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4"], grid: "#dbeafe", muted: "#5b6b84", text: "#0f172a", track: "#eef4ff", areaEnd: "#ffffff" },
  emerald: { colors: ["#047857", "#10b981", "#84cc16", "#0ea5e9", "#64748b", "#f59e0b"], grid: "#d1fae5", muted: "#526b61", text: "#10231d", track: "#ecfdf5", areaEnd: "#ffffff" },
  graphite: { colors: ["#334155", "#64748b", "#0f766e", "#2563eb", "#9333ea", "#f59e0b"], grid: "#e2e8f0", muted: "#64748b", text: "#111827", track: "#f1f5f9", areaEnd: "#ffffff" },
  royal: { colors: ["#7c3aed", "#2563eb", "#db2777", "#0891b2", "#f59e0b", "#4f46e5"], grid: "#e9d5ff", muted: "#665f7a", text: "#17132e", track: "#f5f3ff", areaEnd: "#ffffff" },
  sunset: { colors: ["#f97316", "#dc2626", "#f59e0b", "#be123c", "#7c2d12", "#2563eb"], grid: "#fed7aa", muted: "#795548", text: "#28150f", track: "#fff7ed", areaEnd: "#ffffff" },
  ocean: { colors: ["#0284c7", "#0891b2", "#2563eb", "#0f766e", "#38bdf8", "#6366f1"], grid: "#bae6fd", muted: "#516b7d", text: "#0b1f2a", track: "#ecfeff", areaEnd: "#ffffff" }
};
function asOpacity(value, fallback) {
  const fallbackOpacity = clamp(safeNumber(fallback, 0.22), 0.01, 1);
  const numeric = safeNumber(value, fallbackOpacity);
  if (numeric <= 1) return clamp(numeric, 0.01, 1);
  return clamp(0.15 + (1 - 0.15) * ((numeric - 1) / 99), 0.01, 1);
}
function pageLayout(orientation) {
  return orientation === "portrait" ? "portrait" : "landscape";
}
function effectivePageOptions(options, pageRule) {
  return {
    size: options.page?.size ?? pageRule?.size ?? "A4",
    orientation: options.page?.orientation ?? pageRule?.orientation ?? "auto",
    marginMm: options.page?.marginMm ?? pageRule?.marginMm ?? 2.5
  };
}
function computeColumnWidths(columns, contentWidth) {
  const safeColumns = Math.max(1, Math.floor(safeNumber(columns, 1)));
  const safeContentWidth = Math.max(1, safeNumber(contentWidth, 1));
  if (safeColumns <= 1) return [safeContentWidth];
  const dataColumns = safeColumns - 1;
  const labelWidth = clamp(118 - Math.max(0, dataColumns - 4) * 4.5, 58, Math.min(155, safeContentWidth * 0.28));
  const dataWidth = (safeContentWidth - labelWidth) / dataColumns;
  return [labelWidth, ...Array.from({ length: dataColumns }, () => dataWidth)];
}
function pxToPt(value) {
  return safeNumber(value, 0) * 72 / 96;
}
function cssLengthPt(value, base = 0) {
  const px = parseLengthPx(value, base ? base * 96 / 72 : 0);
  return px == null ? void 0 : pxToPt(px);
}
function boxPxToPt(box) {
  return {
    top: pxToPt(box.top),
    right: pxToPt(box.right),
    bottom: pxToPt(box.bottom),
    left: pxToPt(box.left)
  };
}
function cellPadding(ctx, cell) {
  return boxPxToPt(parseBoxSpacing(cell.styles, "padding", {
    top: ctx.cellPaddingY * 96 / 72,
    right: ctx.cellPaddingX * 96 / 72,
    bottom: ctx.cellPaddingY * 96 / 72,
    left: ctx.cellPaddingX * 96 / 72
  }));
}
function cssRadiusTokenPt(value, base) {
  const token = value?.trim().split(/\s+/)[0];
  return cssLengthPt(token, base);
}
function boxRadiusPt(styles, width, height) {
  const safeWidth = Math.max(0, safeNumber(width, 0));
  const safeHeight = Math.max(0, safeNumber(height, 0));
  const base = Math.min(safeWidth, safeHeight);
  const raw = (styles["border-radius"] ?? "").split("/")[0]?.trim() ?? "";
  const tokens = raw ? raw.split(/\s+/).filter(Boolean).slice(0, 4) : [];
  const values = tokens.map((token) => cssLengthPt(token, base) ?? 0);
  let radius = { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 };
  if (values.length === 1) {
    radius = { topLeft: values[0], topRight: values[0], bottomRight: values[0], bottomLeft: values[0] };
  } else if (values.length === 2) {
    radius = { topLeft: values[0], topRight: values[1], bottomRight: values[0], bottomLeft: values[1] };
  } else if (values.length === 3) {
    radius = { topLeft: values[0], topRight: values[1], bottomRight: values[2], bottomLeft: values[1] };
  } else if (values.length >= 4) {
    radius = { topLeft: values[0], topRight: values[1], bottomRight: values[2], bottomLeft: values[3] };
  }
  radius.topLeft = cssRadiusTokenPt(styles["border-top-left-radius"], base) ?? radius.topLeft;
  radius.topRight = cssRadiusTokenPt(styles["border-top-right-radius"], base) ?? radius.topRight;
  radius.bottomRight = cssRadiusTokenPt(styles["border-bottom-right-radius"], base) ?? radius.bottomRight;
  radius.bottomLeft = cssRadiusTokenPt(styles["border-bottom-left-radius"], base) ?? radius.bottomLeft;
  radius = normalizeBoxRadius(radius, safeWidth, safeHeight);
  return radius;
}
function borderRadiusPt(styles, width, height) {
  const radius = boxRadiusPt(styles, width, height);
  return Math.max(radius.topLeft, radius.topRight, radius.bottomRight, radius.bottomLeft);
}
function normalizeBoxRadius(radius, width, height) {
  const safeWidth = Math.max(0, safeNumber(width, 0));
  const safeHeight = Math.max(0, safeNumber(height, 0));
  const maxRadius = Math.max(0, Math.min(safeWidth, safeHeight) / 2);
  const out = typeof radius === "number" ? { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius } : { ...radius };
  out.topLeft = clamp(out.topLeft, 0, maxRadius);
  out.topRight = clamp(out.topRight, 0, maxRadius);
  out.bottomRight = clamp(out.bottomRight, 0, maxRadius);
  out.bottomLeft = clamp(out.bottomLeft, 0, maxRadius);
  const top = out.topLeft + out.topRight;
  const right = out.topRight + out.bottomRight;
  const bottom = out.bottomLeft + out.bottomRight;
  const left = out.topLeft + out.bottomLeft;
  const scale = Math.min(
    1,
    top > 0 ? safeWidth / top : 1,
    right > 0 ? safeHeight / right : 1,
    bottom > 0 ? safeWidth / bottom : 1,
    left > 0 ? safeHeight / left : 1
  );
  if (scale < 1) {
    out.topLeft *= scale;
    out.topRight *= scale;
    out.bottomRight *= scale;
    out.bottomLeft *= scale;
  }
  return out;
}
function maxBoxRadius(radius) {
  if (typeof radius === "number") return safeNumber(radius, 0);
  return Math.max(
    safeNumber(radius.topLeft, 0),
    safeNumber(radius.topRight, 0),
    safeNumber(radius.bottomRight, 0),
    safeNumber(radius.bottomLeft, 0)
  );
}
function roundedBoxPath(ctx, x, y, width, height, radiusInput) {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(1, safeNumber(width, 1));
  const safeHeight = Math.max(1, safeNumber(height, 1));
  const radius = normalizeBoxRadius(radiusInput, safeWidth, safeHeight);
  ctx.doc.moveTo(safeX + radius.topLeft, safeY).lineTo(safeX + safeWidth - radius.topRight, safeY);
  if (radius.topRight > 0) ctx.doc.quadraticCurveTo(safeX + safeWidth, safeY, safeX + safeWidth, safeY + radius.topRight);
  else ctx.doc.lineTo(safeX + safeWidth, safeY);
  ctx.doc.lineTo(safeX + safeWidth, safeY + safeHeight - radius.bottomRight);
  if (radius.bottomRight > 0) ctx.doc.quadraticCurveTo(safeX + safeWidth, safeY + safeHeight, safeX + safeWidth - radius.bottomRight, safeY + safeHeight);
  else ctx.doc.lineTo(safeX + safeWidth, safeY + safeHeight);
  ctx.doc.lineTo(safeX + radius.bottomLeft, safeY + safeHeight);
  if (radius.bottomLeft > 0) ctx.doc.quadraticCurveTo(safeX, safeY + safeHeight, safeX, safeY + safeHeight - radius.bottomLeft);
  else ctx.doc.lineTo(safeX, safeY + safeHeight);
  ctx.doc.lineTo(safeX, safeY + radius.topLeft);
  if (radius.topLeft > 0) ctx.doc.quadraticCurveTo(safeX, safeY, safeX + radius.topLeft, safeY);
  else ctx.doc.lineTo(safeX, safeY);
  ctx.doc.closePath();
}
function fillBox(ctx, x, y, width, height, color, radius = 0) {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(1, safeNumber(width, 1));
  const safeHeight = Math.max(1, safeNumber(height, 1));
  if (maxBoxRadius(radius) > 0) roundedBoxPath(ctx, safeX, safeY, safeWidth, safeHeight, radius);
  else ctx.doc.rect(safeX, safeY, safeWidth, safeHeight);
  ctx.doc.fill(color);
}
function strokeBox(ctx, x, y, width, height, border, radius = 0) {
  const borderWidth = safeNumber(border.width, 0);
  if (borderWidth <= 0 || border.style === "none") return;
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(1, safeNumber(width, 1));
  const safeHeight = Math.max(1, safeNumber(height, 1));
  ctx.doc.save();
  ctx.doc.strokeColor(border.color ?? COLORS.border).lineWidth(borderWidth);
  if (border.style === "dashed") ctx.doc.dash(Math.max(2, borderWidth * 3), { space: Math.max(2, borderWidth * 2) });
  if (border.style === "dotted") ctx.doc.dash(Math.max(0.7, borderWidth), { space: Math.max(1.4, borderWidth * 2) });
  if (maxBoxRadius(radius) > 0) roundedBoxPath(ctx, safeX, safeY, safeWidth, safeHeight, radius);
  else ctx.doc.rect(safeX, safeY, safeWidth, safeHeight);
  ctx.doc.stroke();
  ctx.doc.undash();
  ctx.doc.restore();
}
function clipBox(ctx, x, y, width, height, radius = 0) {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(1, safeNumber(width, 1));
  const safeHeight = Math.max(1, safeNumber(height, 1));
  if (maxBoxRadius(radius) > 0) roundedBoxPath(ctx, safeX, safeY, safeWidth, safeHeight, radius);
  else ctx.doc.rect(safeX, safeY, safeWidth, safeHeight);
  ctx.doc.clip();
}
function spacingPt(styles, property, fallback) {
  return boxPxToPt(parseBoxSpacing(styles, property, {
    top: fallback.top * 96 / 72,
    right: fallback.right * 96 / 72,
    bottom: fallback.bottom * 96 / 72,
    left: fallback.left * 96 / 72
  }));
}
function borderPxToPt(border) {
  const out = { width: pxToPt(border.width) };
  if (border.color) out.color = border.color;
  if (border.style) out.style = border.style;
  return out;
}
function cellBorders(ctx, cell) {
  const fallback = {
    width: ctx.currentTableStyle.border.width * 96 / 72,
    color: cell.isParam ? COLORS.border : ctx.currentTableStyle.border.color ?? COLORS.grid,
    style: ctx.currentTableStyle.border.style ?? "solid"
  };
  return {
    top: borderPxToPt(parseBorderSideStyle(cell.styles, "top", fallback)),
    right: borderPxToPt(parseBorderSideStyle(cell.styles, "right", fallback)),
    bottom: borderPxToPt(parseBorderSideStyle(cell.styles, "bottom", fallback)),
    left: borderPxToPt(parseBorderSideStyle(cell.styles, "left", fallback))
  };
}
function strokeBorderLine(ctx, border, x1, y1, x2, y2, fallbackColor) {
  const borderWidth = Math.max(0, safeNumber(border.width, 0));
  if (borderWidth <= 0 || border.style === "none") return;
  const lineWidth = ctx.currentTableStyle.borderCollapse ? Math.max(0.2, borderWidth * 0.75) : borderWidth;
  const sx1 = safeNumber(x1, 0);
  const sy1 = safeNumber(y1, 0);
  const sx2 = safeNumber(x2, sx1);
  const sy2 = safeNumber(y2, sy1);
  ctx.doc.save();
  ctx.doc.strokeColor(border.color ?? fallbackColor).lineWidth(lineWidth);
  if (border.style === "dashed") ctx.doc.dash(Math.max(2, lineWidth * 3), { space: Math.max(2, lineWidth * 2) });
  if (border.style === "dotted") ctx.doc.dash(Math.max(0.7, lineWidth), { space: Math.max(1.4, lineWidth * 2) });
  ctx.doc.moveTo(sx1, sy1).lineTo(sx2, sy2).stroke();
  ctx.doc.undash();
  ctx.doc.restore();
}
function strokeCellBorder(ctx, cell, x, y, width, height, border) {
  const fallbackColor = cell.isParam ? COLORS.border : COLORS.grid;
  strokeBorderLine(ctx, border.left, x, y, x, y + height, fallbackColor);
  strokeBorderLine(ctx, border.right, x + width, y, x + width, y + height, fallbackColor);
  if (!cell.isSpanPlaceholder) strokeBorderLine(ctx, border.top, x, y, x + width, y, fallbackColor);
  if (!cell.isSpanPlaceholder && cell.rowspan <= 1 || cell.isSpanPlaceholderEnd) {
    strokeBorderLine(ctx, border.bottom, x, y + height, x + width, y + height, fallbackColor);
  }
}
function tableStyle(style) {
  return {
    borderCollapse: (style["border-collapse"] ?? "").trim().toLowerCase() === "collapse",
    border: borderPxToPt(parseBorderStyle(style, { width: 0.45 * 96 / 72, color: COLORS.grid, style: "solid" })),
    layout: (style["table-layout"] ?? "").trim().toLowerCase() === "fixed" ? "fixed" : "auto"
  };
}
function textBoxStyle(block) {
  const margin = spacingPt(block.style, "margin", {
    top: blockMarginTop(block),
    right: 0,
    bottom: blockMarginBottom(block),
    left: 0
  });
  const defaultPadding = block.type === "preformatted" ? { top: 6, right: 7, bottom: 6, left: 7 } : block.type === "blockquote" ? { top: 2, right: 0, bottom: 2, left: 10 } : { top: 0, right: 0, bottom: 0, left: 0 };
  const padding = spacingPt(block.style, "padding", defaultPadding);
  const border = borderPxToPt(parseBorderStyle(block.style, {
    width: block.type === "blockquote" ? 0 : 0,
    color: COLORS.border
  }));
  return { margin, padding, border };
}
function maxDocumentColumns(parsed) {
  return Math.max(
    1,
    ...parsed.blocks.map((block) => block.type === "table" ? block.table.columnCount : 1)
  );
}
function chunksToBuffer(doc) {
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  return new Promise((resolve3, reject) => {
    doc.on("end", () => resolve3(Buffer3.concat(chunks)));
    doc.on("error", reject);
  });
}
function normalizeFontFamily(value) {
  if (!value) return void 0;
  const first = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  return first ? first.toLowerCase() : void 0;
}
function parseFontFamilyStack(value) {
  if (!value) return [];
  const families = [];
  let current = "";
  let quote = null;
  for (const char of value) {
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (char === "," && !quote) {
      const normalized2 = normalizeFontFamily(current);
      if (normalized2) families.push(normalized2);
      current = "";
      continue;
    }
    current += char;
  }
  const normalized = normalizeFontFamily(current);
  if (normalized) families.push(normalized);
  return families;
}
function genericFont(family, bold, italic) {
  if (family.includes("mono") || family.includes("courier")) {
    if (bold && italic) return "Courier-BoldOblique";
    if (italic) return "Courier-Oblique";
    return bold ? "Courier-Bold" : "Courier";
  }
  if (family === "serif" || family.includes("times")) {
    if (bold && italic) return "Times-BoldItalic";
    if (italic) return "Times-Italic";
    return bold ? "Times-Bold" : "Times-Roman";
  }
  return void 0;
}
function pairFont(pair, bold, italic) {
  if (bold && italic) return pair.boldItalic;
  if (bold) return pair.bold;
  if (italic) return pair.italic;
  return pair.regular;
}
function significantCodePoints(text) {
  return Array.from(text).map((char) => char.codePointAt(0)).filter((codePoint) => codePoint != null);
}
function isBasicWhitespace(codePoint) {
  return codePoint === 9 || codePoint === 10 || codePoint === 13 || codePoint === 32;
}
function fontForStyle(ctx, style, fallbackFont, text, defaultBold, defaultItalic) {
  const request = { style, fallbackFont };
  if (text !== void 0) request.text = text;
  if (defaultBold !== void 0) request.defaultBold = defaultBold;
  if (defaultItalic !== void 0) request.defaultItalic = defaultItalic;
  return ctx.fontResolver.resolve(request);
}
function blockMarginBottom(block) {
  if (block.type === "heading") return cssLengthPt(block.style["margin-bottom"]) ?? 8;
  if (block.type === "paragraph" || block.type === "list-item" || block.type === "blockquote" || block.type === "preformatted") return cssLengthPt(block.style["margin-bottom"]) ?? 6;
  if (block.type === "image") return cssLengthPt(block.style["margin-bottom"]) ?? 8;
  if (block.type === "chart") return cssLengthPt(block.style["margin-bottom"]) ?? 8;
  return cssLengthPt(block.style["margin-bottom"]) ?? 4;
}
function blockMarginTop(block) {
  return cssLengthPt(block.style["margin-top"]) ?? 0;
}
function googleFontFamilies(options) {
  const families = [options.font?.googleFont, ...options.font?.googleFonts ?? [], ...options.font?.fallbackFonts ?? []].map((family) => family?.trim()).filter((family) => Boolean(family));
  return [...new Map(families.map((family) => [family.toLowerCase(), family])).values()];
}
async function resolveConfiguredGoogleFont(family, options, warnings) {
  if (options.resourcePolicy?.allowHttp === false && !isGoogleFontCached(family)) {
    warnings.add("google_font_http_blocked", `Google Font "${family}" is not cached and HTTP resources are blocked.`);
    return null;
  }
  return resolveGoogleFont(family, warnings);
}
function bundledFontFaces(options) {
  const faces = [options.font?.bundled, ...options.font?.bundledFonts ?? []].filter((face) => Boolean(face?.family && face.regularPath));
  return [...new Map(faces.map((face) => [face.family.trim().toLowerCase(), face])).values()];
}
function fallbackFontPathFaces(options) {
  const faces = options.font?.fallbackFontPaths ?? [];
  return [...new Map(faces.filter((face) => Boolean(face.family && face.regularPath)).map((face) => [face.family.trim().toLowerCase(), face])).values()];
}
function configuredFallbackFamilies(options) {
  const families = [
    ...options.font?.fallbackFonts ?? [],
    ...(options.font?.fallbackFontPaths ?? []).map((face) => face.family)
  ];
  return families.map((family) => normalizeFontFamily(family)).filter((family) => Boolean(family));
}
function registerFontPair(doc, family, paths, warnings) {
  const regularPath = paths.regularPath;
  const boldPath = paths.boldPath ?? regularPath;
  const italicPath = paths.italicPath ?? regularPath;
  const boldItalicPath = paths.boldItalicPath ?? boldPath ?? italicPath;
  if (!regularPath || !existsSync3(regularPath)) return null;
  const slug = normalizeFontFamily(family)?.replace(/[^a-z0-9_-]+/g, "-") ?? `font-${Date.now()}`;
  const regularName = `font-${slug}-regular`;
  const boldName = `font-${slug}-bold`;
  const italicName = `font-${slug}-italic`;
  const boldItalicName = `font-${slug}-bold-italic`;
  try {
    doc.registerFont(regularName, regularPath);
    if (boldPath && existsSync3(boldPath)) doc.registerFont(boldName, boldPath);
    else doc.registerFont(boldName, regularPath);
    if (italicPath && existsSync3(italicPath)) doc.registerFont(italicName, italicPath);
    else doc.registerFont(italicName, regularPath);
    if (boldItalicPath && existsSync3(boldItalicPath)) doc.registerFont(boldItalicName, boldItalicPath);
    else doc.registerFont(boldItalicName, boldPath ?? italicPath ?? regularPath);
    return { regular: regularName, bold: boldName, italic: italicName, boldItalic: boldItalicName };
  } catch (error) {
    warnings.add("font_family_register_failed", `Could not register font family "${family}": ${String(error)}`);
    return null;
  }
}
function fontFaceSlot(face) {
  const weight = (face.fontWeight ?? "400").toLowerCase();
  const style = (face.fontStyle ?? "normal").toLowerCase();
  const bold = weight === "bold" || Number.parseFloat(weight) >= 600;
  const italic = style === "italic" || style === "oblique";
  if (bold && italic) return "boldItalic";
  if (italic) return "italic";
  return bold ? "bold" : "regular";
}
async function registerCssFontFace(doc, face, index, options, warnings) {
  const slot = fontFaceSlot(face);
  const slug = normalizeFontFamily(face.family)?.replace(/[^a-z0-9_-]+/g, "-") ?? `css-font-${index}`;
  const name = `css-${slug}-${slot}-${index}`;
  for (const src of face.srcs) {
    const loaded = await loadResource(src, "font", warnings, options);
    if (!loaded) continue;
    try {
      doc.registerFont(name, Buffer3.from(loaded.bytes));
      return { family: face.family, slot, name };
    } catch (error) {
      warnings.add("font_face_register_failed", `Could not register @font-face "${face.family}" from ${loaded.display}: ${String(error)}`);
    }
  }
  warnings.add("font_face_unavailable", `No usable src was found for @font-face "${face.family}".`);
  return null;
}
async function registerCssFontFaces(doc, parsed, options, warnings) {
  const partials = /* @__PURE__ */ new Map();
  for (let i = 0; i < parsed.fontFaces.length; i++) {
    const registered = await registerCssFontFace(doc, parsed.fontFaces[i], i, options, warnings);
    const normalized = normalizeFontFamily(registered?.family);
    if (!registered || !normalized) continue;
    const partial = partials.get(normalized) ?? {};
    partial[registered.slot] = registered.name;
    partials.set(normalized, partial);
  }
  const families = /* @__PURE__ */ new Map();
  for (const [family, partial] of partials) {
    const fallback = partial.regular ?? partial.bold ?? partial.italic ?? partial.boldItalic;
    if (!fallback) continue;
    families.set(family, {
      regular: partial.regular ?? fallback,
      bold: partial.bold ?? partial.regular ?? fallback,
      italic: partial.italic ?? partial.regular ?? fallback,
      boldItalic: partial.boldItalic ?? partial.bold ?? partial.italic ?? partial.regular ?? fallback
    });
  }
  return families;
}
async function registerFonts(doc, parsed, options, warnings) {
  const resolved = await resolveFontPaths(options.font, warnings, options.resourcePolicy);
  const regularPath = resolved.regularPath;
  const boldPath = resolved.boldPath ?? regularPath;
  const families = /* @__PURE__ */ new Map();
  for (const family of googleFontFamilies(options)) {
    const paths = await resolveConfiguredGoogleFont(family, options, warnings);
    if (!paths) continue;
    const pair = registerFontPair(doc, family, paths, warnings);
    const normalized = normalizeFontFamily(family);
    if (pair && normalized) families.set(normalized, pair);
  }
  for (const face of bundledFontFaces(options)) {
    const pair = registerFontPair(doc, face.family, face, warnings);
    const normalized = normalizeFontFamily(face.family);
    if (pair && normalized) families.set(normalized, pair);
  }
  for (const face of fallbackFontPathFaces(options)) {
    const pair = registerFontPair(doc, face.family, face, warnings);
    const normalized = normalizeFontFamily(face.family);
    if (pair && normalized) families.set(normalized, pair);
  }
  const cssFamilies = await registerCssFontFaces(doc, parsed, options, warnings);
  for (const [family, pair] of cssFamilies) families.set(family, pair);
  if (regularPath && existsSync3(regularPath)) {
    try {
      doc.registerFont("regular", regularPath);
      if (boldPath && existsSync3(boldPath)) doc.registerFont("bold", boldPath);
      else doc.registerFont("bold", regularPath);
      if (resolved.italicPath && existsSync3(resolved.italicPath)) doc.registerFont("italic", resolved.italicPath);
      else doc.registerFont("italic", regularPath);
      if (resolved.boldItalicPath && existsSync3(resolved.boldItalicPath)) doc.registerFont("boldItalic", resolved.boldItalicPath);
      else doc.registerFont("boldItalic", boldPath ?? resolved.italicPath ?? regularPath);
      return { regular: "regular", bold: "bold", italic: "italic", boldItalic: "boldItalic", families, fallbackFamilies: configuredFallbackFamilies(options) };
    } catch (error) {
      warnings.add("font_register_failed", `Could not register custom font: ${String(error)}`);
    }
  }
  if (families.size === 0) {
    warnings.add("font_fallback", "Falling back to Helvetica; pass explicit fonts for non-Latin text. This keeps the default memory footprint low.");
  }
  return { regular: "Helvetica", bold: "Helvetica-Bold", italic: "Helvetica-Oblique", boldItalic: "Helvetica-BoldOblique", families, fallbackFamilies: configuredFallbackFamilies(options) };
}

// src/stream/assets.ts
import SVGtoPDF from "svg-to-pdfkit";
import { Buffer as Buffer4 } from "buffer";
async function loadPdfKitAsset(src, warnings, options) {
  if (!src) return null;
  const loaded = await loadImage(src, warnings, options);
  if (!loaded) return null;
  if (loaded.kind !== "png" && loaded.kind !== "jpg" && loaded.kind !== "svg") return null;
  const bytes = Buffer4.from(loaded.bytes);
  const asset = { bytes, kind: loaded.kind };
  if (loaded.kind === "svg") asset.svgText = bytes.toString("utf8");
  return asset;
}
function getAsset(ctx, src) {
  let asset = ctx.assetCache.get(src);
  if (!asset) {
    asset = loadPdfKitAsset(src, ctx.warnings, ctx.options);
    ctx.assetCache.set(src, asset);
  }
  return asset;
}
function drawAsset(doc, asset, x, y, width, height, opacity = 1, preserveAspectRatio = "xMidYMid meet") {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(1, safeNumber(width, 1));
  const safeHeight = Math.max(1, safeNumber(height, 1));
  const safeOpacity = clamp(safeNumber(opacity, 1), 0, 1);
  doc.save();
  doc.opacity(safeOpacity);
  if (asset.kind === "svg" && asset.svgText) {
    SVGtoPDF(doc, asset.svgText, safeX, safeY, { width: safeWidth, height: safeHeight, preserveAspectRatio });
  } else {
    doc.image(asset.bytes, safeX, safeY, { width: safeWidth, height: safeHeight });
  }
  doc.restore();
}
function drawAssetSafely(ctx, asset, x, y, width, height, opacity = 1, label = "image") {
  drawAssetInBox(ctx, asset, x, y, width, height, {}, opacity, label);
}
function objectFitFromStyle(styles) {
  const value = styles?.["object-fit"]?.trim().toLowerCase();
  if (value === "cover") return "cover";
  if (value === "fill") return "fill";
  return "contain";
}
function objectPositionFromStyle(styles) {
  const tokens = (styles?.["object-position"] ?? "center center").trim().toLowerCase().split(/\s+/).filter(Boolean);
  let x = "center";
  let y = "center";
  for (const token of tokens) {
    if (token === "left" || token === "right") x = token;
    else if (token === "top" || token === "bottom") y = token;
    else if (token === "center") {
      x = x ?? "center";
      y = y ?? "center";
    }
  }
  return { x, y };
}
function positionedStart(containerStart, containerSize, itemSize, align) {
  const start = safeNumber(containerStart, 0);
  const size = safeNumber(containerSize, 0);
  const item = safeNumber(itemSize, 0);
  if (align === "right" || align === "bottom") return start + size - item;
  if (align === "center") return start + (size - item) / 2;
  return start;
}
function cssOpacity(styles, fallback = 1) {
  const raw = styles?.["opacity"];
  if (!raw) return fallback;
  const trimmed = raw.trim();
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) return fallback;
  return clamp(trimmed.endsWith("%") ? value / 100 : value, 0, 1);
}
function cssUrl(value) {
  if (!value) return void 0;
  const match = /url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(value);
  const url = match?.[2]?.trim();
  return url || void 0;
}
function backgroundPositionStyles(styles) {
  return {
    "object-fit": styles["background-size"] ?? "cover",
    "object-position": styles["background-position"] ?? "center center"
  };
}
function backgroundTileSize(asset, width, height, styles) {
  const safeWidth = Math.max(1, safeNumber(width, 1));
  const safeHeight = Math.max(1, safeNumber(height, 1));
  const raw = (styles["background-size"] ?? "cover").trim().toLowerCase();
  const natural = imageDimensions(asset);
  if (raw === "cover" || raw === "contain") return { width: safeWidth, height: safeHeight };
  if (raw === "auto") {
    return natural ? { width: Math.max(1, pxToPt(natural.width)), height: Math.max(1, pxToPt(natural.height)) } : { width: safeWidth, height: safeHeight };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  const cssWidth = cssLengthPt(parts[0], safeWidth);
  const cssHeight = cssLengthPt(parts[1], safeHeight);
  let tileWidth = cssWidth ?? (natural ? pxToPt(natural.width) : safeWidth);
  let tileHeight = cssHeight ?? (natural ? pxToPt(natural.height) : safeHeight);
  if (natural && cssWidth != null && cssHeight == null) tileHeight = tileWidth * natural.height / natural.width;
  if (natural && cssHeight != null && cssWidth == null) tileWidth = tileHeight * natural.width / natural.height;
  return { width: Math.max(1, tileWidth), height: Math.max(1, tileHeight) };
}
async function drawBackgroundImage(ctx, styles, x, y, width, height, radius = 0) {
  const src = cssUrl(styles["background-image"]);
  if (!src) return;
  const asset = await getAsset(ctx, src);
  if (!asset) return;
  const repeat = (styles["background-repeat"] ?? "no-repeat").trim().toLowerCase();
  const tile = backgroundTileSize(asset, width, height, styles);
  const positionStyles = backgroundPositionStyles(styles);
  ctx.doc.save();
  clipBox(ctx, x, y, width, height, radius);
  if (repeat === "repeat" || repeat === "repeat-x" || repeat === "repeat-y") {
    const maxX = repeat === "repeat-y" ? x : x + width;
    const maxY = repeat === "repeat-x" ? y : y + height;
    for (let ty = y; ty < maxY; ty += tile.height) {
      for (let tx = x; tx < maxX; tx += tile.width) {
        drawAssetInBox(ctx, asset, tx, ty, tile.width, tile.height, positionStyles, cssOpacity(styles), "background image");
      }
    }
  } else {
    const position = objectPositionFromStyle(positionStyles);
    const tx = positionedStart(x, width, tile.width, position.x);
    const ty = positionedStart(y, height, tile.height, position.y);
    drawAssetInBox(ctx, asset, tx, ty, tile.width, tile.height, positionStyles, cssOpacity(styles), "background image");
  }
  ctx.doc.restore();
}
function colorOpacity(value) {
  if (!value) return 1;
  const hex = /^#([0-9a-f]{8})$/i.exec(value.trim());
  if (hex?.[1]) {
    const alpha2 = Number.parseInt(hex[1].slice(6, 8), 16) / 255;
    return Number.isFinite(alpha2) ? clamp(alpha2, 0, 1) : 1;
  }
  const rgba = /rgba?\(([^)]+)\)/i.exec(value);
  if (!rgba?.[1]) return 1;
  const parts = rgba[1].split(",").map((part) => part.trim());
  const alpha = Number.parseFloat(parts[3] ?? "1");
  return Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
}
function splitShadowList(value) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === "," && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out.filter(Boolean);
}
function shadowColor(value) {
  const parsed = parseCssColor(value) ?? "#000000";
  const opacity = value && /^rgba?\(/i.test(value.trim()) ? colorOpacity(value) : value && /^#[0-9a-f]{8}$/i.test(value.trim()) ? colorOpacity(value) : 0.22;
  return {
    color: parsed.length === 9 ? parsed.slice(0, 7) : parsed,
    opacity
  };
}
function parseBoxShadowPart(rawPart) {
  const part = rawPart.trim();
  if (!part || part === "none") return void 0;
  const inset = /\binset\b/i.test(part);
  const withoutInset = part.replace(/\binset\b/gi, "").trim();
  const rgbaMatch = /rgba?\([^)]+\)/i.exec(withoutInset);
  const hexMatch = /#[0-9a-f]{3,8}/i.exec(withoutInset);
  const namedMatch = withoutInset.split(/\s+/).find((token) => parseCssColor(token) && !/[0-9]/.test(token));
  const colorRaw = rgbaMatch?.[0] ?? hexMatch?.[0] ?? namedMatch;
  const { color, opacity } = shadowColor(colorRaw);
  const lengthSource = colorRaw ? withoutInset.replace(colorRaw, "") : withoutInset;
  const lengths = lengthSource.trim().split(/\s+/).map((token) => cssLengthPt(token)).filter((value) => value != null);
  if (lengths.length < 2) return void 0;
  return {
    offsetX: lengths[0] ?? 0,
    offsetY: lengths[1] ?? 0,
    blur: Math.max(0, lengths[2] ?? 0),
    spread: lengths[3] ?? 0,
    color,
    opacity,
    inset
  };
}
function parseBoxShadows(styles) {
  const raw = styles["box-shadow"]?.trim();
  if (!raw || raw === "none") return [];
  return splitShadowList(raw).map(parseBoxShadowPart).filter((shadow) => !!shadow);
}
function drawShadowShape(ctx, x, y, width, height, radius, color, opacity) {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(0, safeNumber(width, 0));
  const safeHeight = Math.max(0, safeNumber(height, 0));
  const safeRadius = Math.max(0, safeNumber(radius, 0));
  const safeOpacity = clamp(safeNumber(opacity, 0), 0, 0.65);
  if (safeWidth <= 0 || safeHeight <= 0 || safeOpacity < 5e-4) return;
  ctx.doc.save();
  ctx.doc.opacity(safeOpacity);
  fillBox(ctx, safeX, safeY, safeWidth, safeHeight, color, safeRadius);
  ctx.doc.restore();
  ctx.doc.opacity(1);
}
function drawOuterBoxShadow(ctx, shadow, x, y, width, height, radius) {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(0, safeNumber(width, 0));
  const safeHeight = Math.max(0, safeNumber(height, 0));
  const safeRadius = Math.max(0, safeNumber(radius, 0));
  const blur = Math.max(0, safeNumber(shadow.blur, 0));
  const spread = safeNumber(shadow.spread, 0);
  const offsetX = safeNumber(shadow.offsetX, 0);
  const offsetY = safeNumber(shadow.offsetY, 0);
  const opacity = safeNumber(shadow.opacity, 0);
  const layers = blur > 0 ? clamp(Math.ceil(blur * 1.65), 10, 36) : 1;
  const weights = Array.from({ length: layers }, (_, index) => {
    const ratio = (index + 1) / layers;
    return Math.pow(1 - ratio, 2.15);
  });
  const weightTotal = Math.max(1e-3, weights.reduce((sum, weight) => sum + weight, 0));
  for (let i = layers; i >= 1; i--) {
    const ratio = i / layers;
    const eased = 1 - Math.pow(1 - ratio, 1.35);
    const expansion = spread + blur * eased;
    const sx = safeX + offsetX - expansion;
    const sy = safeY + offsetY - expansion;
    const sw = safeWidth + expansion * 2;
    const sh = safeHeight + expansion * 2;
    const alpha = blur > 0 ? opacity * 1.08 * weights[i - 1] / weightTotal : opacity;
    drawShadowShape(ctx, sx, sy, sw, sh, Math.max(0, safeRadius + expansion), shadow.color, alpha);
  }
}
function drawInsetBoxShadow(ctx, shadow, x, y, width, height, radius) {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(0, safeNumber(width, 0));
  const safeHeight = Math.max(0, safeNumber(height, 0));
  const safeRadius = Math.max(0, safeNumber(radius, 0));
  const blur = Math.max(0, safeNumber(shadow.blur, 0));
  const spread = Math.max(0, safeNumber(shadow.spread, 0));
  const offsetX = safeNumber(shadow.offsetX, 0);
  const offsetY = safeNumber(shadow.offsetY, 0);
  const edge = Math.max(1, blur * 0.45 + spread);
  ctx.doc.save();
  clipBox(ctx, safeX, safeY, safeWidth, safeHeight, safeRadius);
  const opacity = clamp(safeNumber(shadow.opacity, 0) * 0.55, 5e-3, 0.35);
  ctx.doc.opacity(opacity);
  ctx.doc.rect(safeX + offsetX, safeY + offsetY, safeWidth, Math.min(edge, safeHeight)).fill(shadow.color);
  ctx.doc.rect(safeX + offsetX, safeY + safeHeight - edge + offsetY, safeWidth, Math.min(edge, safeHeight)).fill(shadow.color);
  ctx.doc.rect(safeX + offsetX, safeY + offsetY, Math.min(edge, safeWidth), safeHeight).fill(shadow.color);
  ctx.doc.rect(safeX + safeWidth - edge + offsetX, safeY + offsetY, Math.min(edge, safeWidth), safeHeight).fill(shadow.color);
  ctx.doc.restore();
  ctx.doc.opacity(1);
}
function drawBoxShadow(ctx, styles, x, y, width, height, radius = 0) {
  const shadows = parseBoxShadows(styles);
  for (const shadow of shadows) {
    if (shadow.inset) drawInsetBoxShadow(ctx, shadow, x, y, width, height, radius);
    else drawOuterBoxShadow(ctx, shadow, x, y, width, height, radius);
  }
}
function transformValue(styles) {
  return (styles?.["transform"] ?? styles?.["-webkit-transform"] ?? "").trim();
}
function transformOriginValue(styles) {
  return (styles?.["transform-origin"] ?? styles?.["-webkit-transform-origin"] ?? "center center").trim();
}
function splitTransformArgs(args) {
  return args.trim().split(/\s*,\s*|\s+/).filter(Boolean);
}
function angleDeg(value) {
  if (!value) return 0;
  const raw = value.trim().toLowerCase();
  const numeric = Number.parseFloat(raw);
  if (!Number.isFinite(numeric)) return 0;
  if (raw.endsWith("rad")) return numeric * 180 / Math.PI;
  if (raw.endsWith("turn")) return numeric * 360;
  if (raw.endsWith("grad")) return numeric * 0.9;
  return numeric;
}
function translateLength(value, base) {
  if (!value) return 0;
  return cssLengthPt(value, base) ?? 0;
}
function transformOriginAxis(token, base, axis) {
  if (!token) return void 0;
  const raw = token.trim().toLowerCase();
  if (axis === "x") {
    if (raw === "left") return 0;
    if (raw === "center") return base / 2;
    if (raw === "right") return base;
    if (raw === "top" || raw === "bottom") return void 0;
  } else {
    if (raw === "top") return 0;
    if (raw === "center") return base / 2;
    if (raw === "bottom") return base;
    if (raw === "left" || raw === "right") return void 0;
  }
  return cssLengthPt(raw, base);
}
function transformOrigin(styles, width, height) {
  const safeWidth = safeNumber(width, 0);
  const safeHeight = safeNumber(height, 0);
  const tokens = transformOriginValue(styles).toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { x: safeWidth / 2, y: safeHeight / 2 };
  let x;
  let y;
  for (const token of tokens) {
    x ??= transformOriginAxis(token, safeWidth, "x");
    y ??= transformOriginAxis(token, safeHeight, "y");
  }
  if (tokens.length >= 2) {
    x = transformOriginAxis(tokens[0], safeWidth, "x") ?? x;
    y = transformOriginAxis(tokens[1], safeHeight, "y") ?? y;
  }
  return { x: safeNumber(x, safeWidth / 2), y: safeNumber(y, safeHeight / 2) };
}
function applyCssTransform(doc, styles, x, y, width, height) {
  const raw = transformValue(styles);
  if (!raw || raw.toLowerCase() === "none") return;
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = safeNumber(width, 0);
  const safeHeight = safeNumber(height, 0);
  const origin = transformOrigin(styles, safeWidth, safeHeight);
  doc.translate(safeX + origin.x, safeY + origin.y);
  for (const match of raw.matchAll(/([a-z0-9-]+)\(([^)]*)\)/gi)) {
    const fn = (match[1] ?? "").toLowerCase();
    const args = splitTransformArgs(match[2] ?? "");
    if (fn === "rotate") {
      doc.rotate(angleDeg(args[0]));
    } else if (fn === "scale") {
      const sx = Number.parseFloat(args[0] ?? "1");
      const sy = Number.parseFloat(args[1] ?? args[0] ?? "1");
      doc.scale(Number.isFinite(sx) ? sx : 1, Number.isFinite(sy) ? sy : 1);
    } else if (fn === "scalex") {
      const sx = Number.parseFloat(args[0] ?? "1");
      doc.scale(Number.isFinite(sx) ? sx : 1, 1);
    } else if (fn === "scaley") {
      const sy = Number.parseFloat(args[0] ?? "1");
      doc.scale(1, Number.isFinite(sy) ? sy : 1);
    } else if (fn === "translate") {
      doc.translate(translateLength(args[0], safeWidth), translateLength(args[1], safeHeight));
    } else if (fn === "translatex") {
      doc.translate(translateLength(args[0], safeWidth), 0);
    } else if (fn === "translatey") {
      doc.translate(0, translateLength(args[0], safeHeight));
    }
  }
  doc.translate(-safeX - origin.x, -safeY - origin.y);
}
function drawAssetInBox(ctx, asset, x, y, width, height, styles, opacity = 1, label = "image") {
  const safeX = safeNumber(x, 0);
  const safeY = safeNumber(y, 0);
  const safeWidth = Math.max(1, safeNumber(width, 1));
  const safeHeight = Math.max(1, safeNumber(height, 1));
  const fit = objectFitFromStyle(styles);
  const position = objectPositionFromStyle(styles);
  const natural = imageDimensions(asset);
  const cssWidth = cssLengthPt(styles?.["width"], safeWidth);
  const cssHeight = cssLengthPt(styles?.["height"], safeHeight);
  let drawWidth = cssWidth ?? safeWidth;
  let drawHeight = cssHeight ?? safeHeight;
  if (fit !== "fill" && natural) {
    const targetRatio = safeWidth / Math.max(1, safeHeight);
    const naturalRatio = natural.width / Math.max(1, natural.height);
    const scale = fit === "cover" ? naturalRatio > targetRatio ? safeHeight / natural.height : safeWidth / natural.width : naturalRatio > targetRatio ? safeWidth / natural.width : safeHeight / natural.height;
    if (cssWidth == null) drawWidth = natural.width * scale;
    if (cssHeight == null) drawHeight = natural.height * scale;
    if (cssWidth != null && cssHeight == null) drawHeight = drawWidth / naturalRatio;
    if (cssHeight != null && cssWidth == null) drawWidth = drawHeight * naturalRatio;
  }
  drawWidth = Math.max(1, safeNumber(fit === "fill" && cssWidth == null ? safeWidth : drawWidth, 1));
  drawHeight = Math.max(1, safeNumber(fit === "fill" && cssHeight == null ? safeHeight : drawHeight, 1));
  const drawX = positionedStart(safeX, safeWidth, drawWidth, position.x);
  const drawY = positionedStart(safeY, safeHeight, drawHeight, position.y);
  const preserveAspectRatio = fit === "fill" ? "none" : `x${position.x === "left" ? "Min" : position.x === "right" ? "Max" : "Mid"}Y${position.y === "top" ? "Min" : position.y === "bottom" ? "Max" : "Mid"} ${fit === "cover" ? "slice" : "meet"}`;
  const effectiveOpacity = clamp(opacity * cssOpacity(styles), 0, 1);
  try {
    ctx.doc.save();
    ctx.doc.rect(safeX, safeY, safeWidth, safeHeight).clip();
    applyCssTransform(ctx.doc, styles, drawX, drawY, drawWidth, drawHeight);
    drawAsset(ctx.doc, asset, drawX, drawY, drawWidth, drawHeight, effectiveOpacity, preserveAspectRatio);
    ctx.doc.restore();
  } catch (error) {
    ctx.warnings.add("image_draw_failed", `Failed to draw ${label}: ${String(error)}`);
  }
}
function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes[0] !== 137 || bytes[1] !== 80) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
function jpgDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 255) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker && marker >= 192 && marker <= 195) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}
function svgDimensions(svgText) {
  if (!svgText) return null;
  const svgTag = /<svg\b([^>]*)>/i.exec(svgText);
  if (!svgTag?.[1]) return null;
  const attrs = svgTag[1];
  const widthRaw = /\bwidth\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
  const heightRaw = /\bheight\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
  const viewBoxRaw = /\bviewBox\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
  const width = parseLengthPx(widthRaw);
  const height = parseLengthPx(heightRaw);
  const viewBox = viewBoxRaw?.trim().split(/[\s,]+/).map((part) => Number.parseFloat(part));
  const viewBoxWidth = viewBox && viewBox.length >= 4 ? viewBox[2] : void 0;
  const viewBoxHeight = viewBox && viewBox.length >= 4 ? viewBox[3] : void 0;
  if (width && height) return { width, height };
  if (width && viewBoxWidth && viewBoxHeight) return { width, height: width * viewBoxHeight / viewBoxWidth };
  if (height && viewBoxWidth && viewBoxHeight) return { width: height * viewBoxWidth / viewBoxHeight, height };
  if (viewBoxWidth && viewBoxHeight) return { width: viewBoxWidth, height: viewBoxHeight };
  return null;
}
function imageDimensions(asset) {
  if (asset.kind === "png") return pngDimensions(asset.bytes);
  if (asset.kind === "jpg") return jpgDimensions(asset.bytes);
  if (asset.kind === "svg") return svgDimensions(asset.svgText);
  return null;
}

// src/stream/contacts.ts
import SVGtoPDF2 from "svg-to-pdfkit";
var ICONS = {
  phone: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${COLORS.text}" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.05-.24 12.36 12.36 0 0 0 3.54.57 1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1C10.07 20.01 3.99 13.93 3.99 5a1 1 0 0 1 1-1H8.5a1 1 0 0 1 1 1c0 1.21.2 2.42.57 3.54a1 1 0 0 1-.24 1.05l-2.2 2.2z"/></svg>`,
  email: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.4" fill="none" stroke="${COLORS.text}" stroke-width="1.7"/><path d="M3.2 6.6 12 13l8.8-6.4" fill="none" stroke="${COLORS.text}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  globe: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${COLORS.text}" stroke-width="1.7"/><path d="M3 12h18M12 3c3.2 2.6 3.2 15.4 0 18M12 3c-3.2 2.6-3.2 15.4 0 18" fill="none" stroke="${COLORS.text}" stroke-width="1.7"/></svg>`,
  telegram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#229ED9"/><path fill="#fff" d="M5.5 11.8 17 7.3c.6-.23 1.12.14.92.99l-1.96 9.23c-.14.66-.54.82-1.1.51l-3.04-2.24-1.46 1.41c-.16.16-.3.3-.6.3l.21-3.06 5.56-5.02c.24-.21-.05-.33-.37-.12l-6.87 4.33-2.96-.92c-.64-.2-.66-.64.14-.95z"/></svg>`,
  wechat: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#07C160"/><path fill="#fff" d="M9.3 6.2c-2.9 0-5.3 1.94-5.3 4.36 0 1.4.79 2.65 2.03 3.46l-.5 1.5 1.78-.9c.63.16 1.3.25 1.99.25.18 0 .35-.01.52-.03a3.9 3.9 0 0 1-.16-1.1c0-2.3 2.2-4.06 4.86-4.06l.34.01C14.4 7.74 12.06 6.2 9.3 6.2zm-1.74 2.4a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4zm3.5 0a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4z"/><path fill="#fff" d="M20 13.9c0-2-2-3.62-4.45-3.62-2.52 0-4.45 1.62-4.45 3.62s1.93 3.62 4.45 3.62c.55 0 1.08-.08 1.57-.22l1.45.78-.4-1.27c.93-.66 1.83-1.6 1.83-2.91zm-5.9-.98a.58.58 0 1 1 0 1.16.58.58 0 0 1 0-1.16zm2.9 0a.58.58 0 1 1 0 1.16.58.58 0 0 1 0-1.16z"/></svg>`,
  whatsapp: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#25D366"/><path fill="#fff" d="M12 5.4a6.5 6.5 0 0 0-5.56 9.86L5.6 18.6l3.43-.9A6.5 6.5 0 1 0 12 5.4zm0 1.5a5 5 0 0 1 4.2 7.7l-.18.28.5 1.83-1.88-.49-.27.16a5 5 0 1 1-2.37-9.49zm-2.5 2.5c-.13 0-.34.05-.52.24-.18.2-.68.67-.68 1.62 0 .96.7 1.88.8 2.01.1.13 1.37 2.18 3.4 2.98 1.68.66 2.02.53 2.39.5.37-.04 1.18-.49 1.35-.96.17-.47.17-.87.12-.96-.05-.08-.18-.13-.38-.23-.2-.1-1.18-.58-1.36-.65-.18-.07-.31-.1-.45.1-.13.2-.51.65-.63.78-.12.13-.23.15-.43.05-.2-.1-.85-.31-1.62-1-.6-.53-1-1.19-1.12-1.39-.12-.2-.01-.3.09-.4.09-.09.2-.23.3-.35.1-.12.13-.2.2-.34.06-.13.03-.25-.02-.35-.05-.1-.44-1.1-.62-1.5-.16-.39-.32-.34-.44-.34z"/></svg>`,
  instagram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" rx="6" fill="#E4405F"/><rect x="5" y="5" width="14" height="14" rx="4.4" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="16.4" cy="7.6" r="1.1" fill="#fff"/></svg>`,
  facebook: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path fill="#fff" d="M13.3 19v-6h2l.4-2.4h-2.4V9.1c0-.7.2-1.18 1.2-1.18h1.27V5.8c-.22-.03-.98-.1-1.86-.1-1.84 0-3.1 1.12-3.1 3.18v1.72H8.6V13h2.21v6z"/></svg>`,
  youtube: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1.5" y="5" width="21" height="14" rx="4.5" fill="#FF0000"/><path fill="#fff" d="M10 9.2v5.6l4.8-2.8z"/></svg>`,
  viber: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#7360F2"/><path fill="#fff" d="M12 5.6c-3.3 0-6 2.4-6 5.7 0 1.5.6 2.9 1.6 3.9l-.5 2.2 2.3-1.1c.8.3 1.7.5 2.6.5 3.3 0 6-2.4 6-5.5s-2.7-5.7-6-5.7zm-2.6 3.1c.13 0 .35.04.52.43.13.3.45 1.1.49 1.18.04.08.07.18.01.3-.06.12-.1.18-.19.28-.09.1-.19.22-.27.3-.09.08-.18.17-.08.34.1.17.46.74 1 1.2.69.6 1.27.78 1.45.86.18.08.28.07.39-.04.1-.12.45-.52.57-.7.12-.18.24-.15.4-.09.17.06 1.06.5 1.24.59.18.09.3.13.34.2.04.08.04.43-.12.84-.16.41-.94.79-1.28.82-.34.03-.66.16-2.22-.46-1.88-.74-3.05-2.65-3.14-2.77-.09-.12-.74-.98-.74-1.87 0-.89.47-1.33.63-1.51.16-.18.35-.23.47-.23z"/></svg>`,
  linkedin: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0A66C2"/><path fill="#fff" d="M7.2 9.6H4.9V19h2.3V9.6zM6.05 8.5a1.34 1.34 0 1 0 0-2.68 1.34 1.34 0 0 0 0 2.68zM19.1 19v-5.16c0-2.76-1.47-4.04-3.44-4.04-1.59 0-2.3.87-2.69 1.49V9.6H10.7c.03.65 0 9.4 0 9.4h2.27v-5.25c0-.2.01-.41.07-.55.17-.4.54-.83 1.18-.83.83 0 1.16.63 1.16 1.56V19z"/></svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#000"/><path fill="#fff" d="M13.94 10.78 18.5 5.5h-1.3l-3.84 4.46L10.2 5.5H6.2l4.78 6.96L6.2 18.5h1.3l4.06-4.72 3.34 4.72h4l-4.96-7.72zm-1.44 1.67-.47-.67-3.85-5.5h1.86l3.02 4.32.47.67 3.93 5.62h-1.86l-3.1-4.46z"/></svg>`
};
function drawContactIcon(ctx, icon, x, y, size) {
  if (!icon) return;
  const svg = ICONS[icon];
  if (!svg) return;
  try {
    ctx.doc.save();
    SVGtoPDF2(ctx.doc, svg, x, y, { width: size, height: size, assumePt: true, preserveAspectRatio: "xMidYMid meet" });
    ctx.doc.restore();
  } catch (error) {
    ctx.warnings.add("contact_icon_failed", `Failed to draw contact icon "${icon}": ${String(error)}`);
  }
}
var ROW_GAP = 7;
var ICON_TEXT_GAP = 6;
var ICON_SIZE = 11;
var TEXT_SIZE = 9;
function drawHeaderContacts(ctx, top, headerHeight) {
  const contacts = ctx.options.headerContacts;
  if (!contacts) return ctx.pageWidth - ctx.margin;
  let right = ctx.pageWidth - ctx.margin;
  if (ctx.qrAsset && contacts.qr) {
    const size = Math.min(80, Math.max(40, headerHeight - 6));
    const qx = right - size;
    const qy = top + Math.max(0, (headerHeight - size) / 2);
    drawAssetSafely(ctx, ctx.qrAsset, qx, qy, size, size, 1, "qr");
    if (contacts.qr.badge) {
      const cx = qx + size / 2;
      const cy = qy + size / 2;
      const disc = size * 0.26;
      ctx.doc.save();
      ctx.doc.circle(cx, cy, disc / 2 + 2.2).fill("#ffffff");
      ctx.doc.restore();
      drawContactIcon(ctx, contacts.qr.badge, cx - disc / 2, cy - disc / 2, disc);
    }
    right = qx - 12;
  }
  const items = (contacts.items ?? []).filter((item) => safeNumber(item.text?.length, 0) > 0).slice(0, 5);
  if (items.length === 0) return right;
  const font = ctx.regularFontName;
  ctx.doc.font(font).fontSize(TEXT_SIZE);
  const leftRoom = right - ctx.margin - 150;
  const maxTextWidth = Math.max(60, Math.min(240, leftRoom));
  let textWidth = 0;
  for (const item of items) {
    textWidth = Math.max(textWidth, Math.min(maxTextWidth, ctx.doc.widthOfString(item.text)));
  }
  const blockWidth = ICON_SIZE + ICON_TEXT_GAP + textWidth;
  const blockX = right - blockWidth;
  const rowHeight = Math.max(ICON_SIZE, TEXT_SIZE) + ROW_GAP;
  const blockHeight = items.length * rowHeight - ROW_GAP;
  let y = top + Math.max(0, (headerHeight - blockHeight) / 2);
  for (const item of items) {
    drawContactIcon(ctx, item.icon, blockX, y + (rowHeight - ROW_GAP - ICON_SIZE) / 2, ICON_SIZE);
    const textX = blockX + ICON_SIZE + ICON_TEXT_GAP;
    const textY = y + (rowHeight - ROW_GAP - TEXT_SIZE) / 2;
    ctx.doc.font(font).fontSize(TEXT_SIZE).fillColor(COLORS.text).text(item.text, textX, textY, {
      width: textWidth,
      align: "left",
      lineBreak: false,
      ellipsis: true
    });
    if (item.href) {
      try {
        ctx.doc.link(textX, textY - 1, textWidth, TEXT_SIZE + 2, item.href);
      } catch {
      }
    }
    y += rowHeight;
  }
  return blockX;
}

// src/stream/watermark.ts
function watermarkLayer(options) {
  return options.watermarkLayer ?? "background";
}
function shouldDrawWatermark(ctx, layer) {
  const configured = watermarkLayer(ctx.options);
  return configured === "both" || configured === layer;
}
var LAYOUTS = ["honeycomb", "grid", "diagonal", "single"];
var LEGACY_LAYOUT_MAP = {
  honeycomb: "honeycomb",
  triangle: "honeycomb",
  corners: "honeycomb",
  diagonal: "diagonal",
  grid: "grid",
  minimal: "single",
  single: "single"
};
function resolveWatermarkLayout(options) {
  const explicit = options.watermarkLayout;
  if (explicit && LAYOUTS.includes(explicit)) return explicit;
  const legacy = (options.patternType ?? "").toString().trim().toLowerCase();
  return LEGACY_LAYOUT_MAP[legacy] ?? "honeycomb";
}
var LOGO_MIN_PT = 26;
var LOGO_MAX_PT = 120;
var GAP_MIN_PT = 14;
var GAP_MAX_PT = 165;
var HEX_ROW_RATIO = 0.8660254;
function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}
function resolveAspect(asset) {
  const dims = asset ? imageDimensions(asset) : null;
  if (dims && dims.width > 0 && dims.height > 0) return dims.width / dims.height;
  return 1;
}
function computeGeometry(ctx, layout, box) {
  const o = ctx.options;
  const combined = clamp(o.watermarkScale ?? 50, 1, 100);
  const density = clamp(o.watermarkDensity ?? combined, 1, 100);
  const gap = lerp(GAP_MAX_PT, GAP_MIN_PT, (density - 1) / 99);
  const cellW = box.w + gap;
  const cellH = box.h + gap;
  const defaultAngle = layout === "honeycomb" ? 30 : layout === "diagonal" ? 45 : 0;
  const angle = Number.isFinite(o.watermarkAngle) ? o.watermarkAngle : defaultAngle;
  const stepY = layout === "honeycomb" ? cellH * HEX_ROW_RATIO : cellH;
  const rowOffset = layout === "honeycomb" || layout === "diagonal";
  return { logoW: box.w, logoH: box.h, stepX: cellW, stepY, rowOffset, angle };
}
function logoBox(ctx, asset) {
  const o = ctx.options;
  const combined = clamp(o.watermarkScale ?? 50, 1, 100);
  const logoScale = clamp(o.watermarkLogoScale ?? combined, 1, 100);
  const aspect = resolveAspect(asset);
  let w = lerp(LOGO_MIN_PT, LOGO_MAX_PT, (logoScale - 1) / 99);
  let h = w / aspect;
  const maxDim = Math.min(ctx.pageWidth, ctx.pageHeight) * 0.5;
  if (w > maxDim) {
    h *= maxDim / w;
    w = maxDim;
  }
  if (h > maxDim) {
    w *= maxDim / h;
    h = maxDim;
  }
  return { w, h };
}
function drawImageTile(ctx, opened, asset, centerX, centerY, geom, opacity) {
  const x = centerX - geom.logoW / 2;
  const y = centerY - geom.logoH / 2;
  if (opened) {
    ctx.doc.image(opened, x, y, { width: geom.logoW, height: geom.logoH });
  } else {
    drawAsset(ctx.doc, asset, x, y, geom.logoW, geom.logoH, opacity, "xMidYMid meet");
  }
}
function drawTextTile(ctx, text, font, fontSize, centerX, centerY, width) {
  ctx.doc.font(font).fontSize(fontSize).fillColor("#555555").text(text, centerX - width / 2, centerY - fontSize / 2, {
    lineBreak: false
  });
}
function drawWatermark(ctx, layer) {
  if (!shouldDrawWatermark(ctx, layer)) return;
  const text = ctx.options.watermarkText?.trim();
  const asset = ctx.watermarkAsset;
  if (!text && !asset) return;
  const opacity = asOpacity(ctx.options.watermarkOpacity, 0.22);
  const layout = resolveWatermarkLayout(ctx.options);
  let textFont = "";
  let textSize = 0;
  let box;
  if (asset) {
    box = logoBox(ctx, asset);
  } else {
    const combined = clamp(ctx.options.watermarkScale ?? 50, 1, 100);
    const logoScale = clamp(ctx.options.watermarkLogoScale ?? combined, 1, 100);
    textSize = lerp(11, 40, (logoScale - 1) / 99);
    textFont = ctx.fontResolver.resolve({ fallbackFont: ctx.boldFontName, text, defaultBold: true });
    ctx.doc.font(textFont).fontSize(textSize);
    box = { w: Math.max(1, ctx.doc.widthOfString(text)), h: textSize };
  }
  const geom = computeGeometry(ctx, layout, box);
  if (!Number.isFinite(geom.stepX) || geom.stepX <= 0 || !Number.isFinite(geom.stepY) || geom.stepY <= 0) return;
  const cx = safeNumber(ctx.pageWidth / 2, 0);
  const cy = safeNumber(ctx.pageHeight / 2, 0);
  let opened = null;
  if (asset && (asset.kind === "png" || asset.kind === "jpg")) {
    try {
      opened = ctx.doc.openImage(asset.bytes);
    } catch {
      opened = null;
    }
  }
  ctx.doc.save();
  if (ctx.options.watermarkAvoidHeader) {
    const clipTop = safeNumber(ctx.watermarkClipTop, ctx.contentTop);
    if (clipTop > 0) {
      ctx.doc.rect(0, clipTop, ctx.pageWidth, Math.max(0, ctx.pageHeight - clipTop)).clip();
    }
  }
  ctx.doc.opacity(opacity);
  if (geom.angle) ctx.doc.rotate(geom.angle, { origin: [cx, cy] });
  const draw = (centerX, centerY) => {
    if (asset) drawImageTile(ctx, opened, asset, centerX, centerY, geom, opacity);
    else if (text) drawTextTile(ctx, text, textFont, textSize, centerX, centerY, box.w);
  };
  if (layout === "single") {
    draw(cx, cy);
  } else {
    const reach = Math.hypot(ctx.pageWidth, ctx.pageHeight) / 2 + Math.max(geom.stepX, geom.stepY);
    let row = 0;
    for (let y = cy - reach; y <= cy + reach; y += geom.stepY, row++) {
      const shift = geom.rowOffset && row % 2 !== 0 ? geom.stepX / 2 : 0;
      for (let x = cx - reach - shift; x <= cx + reach; x += geom.stepX) {
        draw(x + shift, y);
      }
    }
  }
  ctx.doc.restore();
  ctx.doc.opacity(1);
}

// src/stream/page.ts
function pageTemplateHeight(template) {
  if (!template?.text) return 0;
  return mm(safeNumber(template.heightMm, 8));
}
var HEADER_LOGO_MAX_OFFSET_MM = 20;
function headerLogoBox(input) {
  const logoScale = clamp(safeNumber(input.logoScale, 100), 1, 200);
  const k = logoScale / 100;
  const heightPt = clamp(40 * k, 12, 84);
  const widthPt = Math.min(Math.max(0, input.contentWidthPt) * 0.6, heightPt * 8);
  const maxOff = HEADER_LOGO_MAX_OFFSET_MM;
  const offXMm = clamp(safeNumber(input.offsetXMm, 0), -maxOff, maxOff);
  const offYMm = clamp(safeNumber(input.offsetYMm, 0), -maxOff, maxOff);
  const marginPt = Math.max(0, safeNumber(input.marginPt, 0));
  const xOffsetPt = clamp(mm(offXMm), -marginPt, Math.max(0, input.contentWidthPt - widthPt + marginPt));
  const yOffsetPt = Math.max(mm(offYMm), -marginPt);
  return { xOffsetPt, yOffsetPt, widthPt, heightPt };
}
function pageNumberSettings(options) {
  if (!options.pageNumbers) {
    return { enabled: false, format: "", align: "center", fontSize: 8, color: COLORS.text };
  }
  if (typeof options.pageNumbers === "boolean") {
    return { enabled: options.pageNumbers, format: "Page {page}", align: "center", fontSize: 8, color: COLORS.text };
  }
  return {
    enabled: options.pageNumbers.enabled ?? true,
    format: options.pageNumbers.format ?? "Page {page}",
    align: options.pageNumbers.align ?? "center",
    fontSize: Math.max(1, safeNumber(options.pageNumbers.fontSize, 8)),
    color: options.pageNumbers.color ?? COLORS.text
  };
}
function reservedHeaderHeight(options) {
  return pageTemplateHeight(options.pageHeader);
}
function reservedFooterHeight(options) {
  const footer = pageTemplateHeight(options.pageFooter);
  const numbers = pageNumberSettings(options).enabled ? mm(8) : 0;
  return Math.max(footer, numbers);
}
function drawPageTemplate(ctx, template, y, height) {
  const text = template?.text?.trim();
  if (!template || !text || height <= 0) return;
  const fontSize = Math.max(1, safeNumber(template.fontSize, 8));
  const font = ctx.fontResolver.resolve({
    style: template.fontFamily ? { "font-family": template.fontFamily } : {},
    fallbackFont: ctx.regularFontName,
    text
  });
  ctx.doc.font(font).fontSize(fontSize).fillColor(template.color ?? "#59606b").text(text, ctx.margin, y + Math.max(0, (height - fontSize) / 2) - 1, {
    width: ctx.tableWidth,
    align: template.align ?? "left",
    lineBreak: false,
    ellipsis: true
  });
}
function drawPageChrome(ctx) {
  const headerHeight = reservedHeaderHeight(ctx.options);
  const footerHeight = reservedFooterHeight(ctx.options);
  if (headerHeight > 0) {
    drawPageTemplate(ctx, ctx.options.pageHeader, ctx.margin, headerHeight);
  }
  if (footerHeight > 0) {
    drawPageTemplate(ctx, ctx.options.pageFooter, ctx.pageHeight - ctx.margin - footerHeight, footerHeight);
  }
  const pageNumbers = pageNumberSettings(ctx.options);
  if (!pageNumbers.enabled) return;
  const text = pageNumbers.format.replace(/\{page\}/g, String(ctx.pages)).replace(/\{total\}/g, "?");
  const font = ctx.fontResolver.resolve({ fallbackFont: ctx.regularFontName, text });
  ctx.doc.font(font).fontSize(pageNumbers.fontSize).fillColor(pageNumbers.color).text(text, ctx.margin, ctx.pageHeight - ctx.margin - footerHeight + Math.max(0, (footerHeight - pageNumbers.fontSize) / 2) - 1, {
    width: ctx.tableWidth,
    align: pageNumbers.align,
    lineBreak: false,
    ellipsis: true
  });
}
function finishPage(ctx) {
  drawWatermark(ctx, "foreground");
}
function addPage(ctx) {
  finishPage(ctx);
  ctx.doc.addPage({ size: ctx.pageSize, layout: pageLayout(ctx.orientation), margin: 0 });
  ctx.y = ctx.contentTop;
  ctx.watermarkClipTop = ctx.contentTop;
  drawWatermark(ctx, "background");
  drawPageChrome(ctx);
}
function fitFontSize(doc, fontName, text, size, width, min = 6) {
  let current = size;
  doc.font(fontName);
  while (current > min) {
    doc.fontSize(current);
    if (doc.widthOfString(text) <= width) break;
    current -= 0.5;
  }
  return current;
}
function drawHeader(ctx) {
  if (ctx.options.hideHeader) return;
  const structuredContacts = ctx.options.headerContacts;
  const hasStructured = !!structuredContacts && ((structuredContacts.items?.length ?? 0) > 0 || !!structuredContacts.qr);
  const hasContacts = hasStructured || ctx.parsed.contactItems.length > 0 || !!ctx.qrAsset;
  const headerHeight = hasContacts ? mm(31) : mm(18);
  const top = safeNumber(ctx.y, ctx.contentTop);
  if (ctx.logoAsset) {
    const box = headerLogoBox({
      logoScale: ctx.options.logoScale,
      contentWidthPt: ctx.tableWidth,
      headerHeightPt: headerHeight,
      marginPt: ctx.margin,
      offsetXMm: ctx.options.logoOffsetXMm,
      offsetYMm: ctx.options.logoOffsetYMm
    });
    drawAssetInBox(ctx, ctx.logoAsset, ctx.margin + box.xOffsetPt, top + box.yOffsetPt, box.widthPt, box.heightPt, { "object-position": "left center" }, 1, "logo");
  } else {
    const brand = ctx.parsed.brandText || "DOCUMENT";
    const brandFont = ctx.fontResolver.resolve({ fallbackFont: ctx.boldFontName, text: brand, defaultBold: true });
    const fontSize = fitFontSize(ctx.doc, brandFont, brand, 21, ctx.tableWidth * 0.42, 11);
    ctx.doc.font(brandFont).fontSize(fontSize).fillColor(COLORS.text).text(brand, ctx.margin, top, {
      width: ctx.tableWidth * 0.45,
      lineBreak: false
    });
  }
  if (hasStructured) {
    drawHeaderContacts(ctx, top, headerHeight);
    ctx.y += headerHeight + 8;
    return;
  }
  let right = ctx.pageWidth - ctx.margin;
  if (ctx.qrAsset) {
    const size = Math.min(76, headerHeight - 4);
    right -= size;
    drawAssetSafely(ctx, ctx.qrAsset, right, top, size, size, 1, "qr");
    right -= 10;
  }
  if (ctx.parsed.contactItems.length > 0) {
    const maxWidth = Math.max(1, Math.min(235, right - ctx.margin - 160));
    let y = top;
    for (const item of ctx.parsed.contactItems.slice(0, 5)) {
      const font = ctx.fontResolver.resolve({ fallbackFont: ctx.regularFontName, text: item });
      const fontSize = fitFontSize(ctx.doc, font, item, 8.5, maxWidth, 6.5);
      ctx.doc.font(font).fontSize(fontSize).fillColor(COLORS.text).text(item, right - maxWidth, y, {
        width: maxWidth,
        align: "right",
        lineBreak: false
      });
      y += fontSize + 4;
    }
  }
  ctx.y += headerHeight + 8;
}
function ensureSpace(ctx, height) {
  if (safeNumber(ctx.y, 0) + Math.max(0, safeNumber(height, 0)) > ctx.contentBottom) addPage(ctx);
}

// src/stream/inline-text.ts
function lineGapForStyle(style, size, fallbackFactor) {
  const raw = style["line-height"];
  if (!raw || raw.trim().toLowerCase() === "normal") return size * fallbackFactor;
  const trimmed = raw.trim();
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return size * fallbackFactor;
  if (/^[0-9.]+$/.test(trimmed)) return Math.max(0, size * numeric - size);
  if (trimmed.endsWith("%")) return Math.max(0, size * numeric / 100 - size);
  const length = cssLengthPt(trimmed);
  return length == null ? size * fallbackFactor : Math.max(0, length - size);
}
function inlineFont(ctx, segment, fallbackFont) {
  return fontForStyle(ctx, segment.styles, fallbackFont, segment.text);
}
function cssFontSizePt(value, fallbackSize) {
  const raw = value?.trim().toLowerCase();
  if (!raw) return fallbackSize;
  const numeric = Number.parseFloat(raw);
  if (Number.isFinite(numeric)) {
    if (raw.endsWith("%")) return Math.max(1, fallbackSize * numeric / 100);
    if (raw.endsWith("em")) return Math.max(1, fallbackSize * numeric);
    if (raw.endsWith("rem")) return Math.max(1, 12 * numeric);
  }
  return cssLengthPt(raw) ?? fallbackSize;
}
function inlineSize(segment, fallbackSize) {
  return cssFontSizePt(segment.styles["font-size"], fallbackSize);
}
function inlineColor(segment, fallbackColor) {
  return parseCssColor(segment.styles["color"]) ?? fallbackColor;
}
function wrapModeFromStyle(style, fallback) {
  const whiteSpace = (style["white-space"] ?? "").trim().toLowerCase();
  if (whiteSpace === "nowrap" || whiteSpace === "pre") return "normal";
  const overflowWrap = (style["overflow-wrap"] ?? style["word-wrap"] ?? "").trim().toLowerCase();
  const wordBreak = (style["word-break"] ?? "").trim().toLowerCase();
  if (overflowWrap === "anywhere" || wordBreak === "break-all") return "anywhere";
  if (overflowWrap === "break-word" || wordBreak === "break-word") return "break-word";
  return fallback ?? "normal";
}
function applyTextTransform(value, style) {
  const transform = (style["text-transform"] ?? "").trim().toLowerCase();
  if (transform === "uppercase") return value.toUpperCase();
  if (transform === "lowercase") return value.toLowerCase();
  if (transform === "capitalize") return value.replace(/\b([\p{L}\p{N}])/gu, (match) => match.toUpperCase());
  return value;
}
function isNoWrapStyle(style) {
  const value = (style["white-space"] ?? "").trim().toLowerCase();
  return value === "nowrap" || value === "pre";
}
function wantsEllipsis(style) {
  return (style["text-overflow"] ?? "").trim().toLowerCase() === "ellipsis";
}
function isOverflowHidden(style) {
  return (style["overflow"] ?? "").trim().toLowerCase() === "hidden";
}
function hasInlineBoxStyle2(segment) {
  if (!segment.inlineBox) return false;
  const display = (segment.styles["display"] ?? "").trim().toLowerCase();
  return display === "inline-block" || display === "inline-flex" || !!segment.styles["background-color"] || !!segment.styles["border"] || !!segment.styles["border-width"] || !!segment.styles["border-radius"] || !!segment.styles["padding"] || !!segment.styles["padding-left"] || !!segment.styles["padding-right"] || !!segment.styles["padding-top"] || !!segment.styles["padding-bottom"];
}
function inlineBaselineShift(segment, size) {
  const value = (segment.styles["baseline-shift"] ?? segment.styles["vertical-align"] ?? "").trim().toLowerCase();
  if (!value || value === "baseline") return 0;
  if (value === "super" || value === "sup" || value === "text-top") return -size * 0.38;
  if (value === "sub" || value === "text-bottom") return size * 0.22;
  if (value.endsWith("%")) {
    const percent = Number.parseFloat(value);
    if (Number.isFinite(percent)) return -size * percent / 100;
  }
  const length = cssLengthPt(value, size);
  return length == null ? 0 : -length;
}
function needsManualInlineLayout(inlines) {
  return inlines.some((segment) => hasInlineBoxStyle2(segment) || inlineBaselineShift(segment, inlineSize(segment, 10)) !== 0);
}
function breakLongToken(doc, font, size, token, width) {
  doc.font(font).fontSize(size);
  if (doc.widthOfString(token) <= width) return token;
  let out = "";
  let current = "";
  for (const char of token) {
    const candidate = current + char;
    if (current && doc.widthOfString(candidate) > width) {
      out += `${current}
`;
      current = char;
    } else {
      current = candidate;
    }
  }
  return out + current;
}
function wrapSegmentText(ctx, segment, fallbackFont, fallbackSize, width) {
  const transformedText = applyTextTransform(segment.text, segment.styles);
  const mode = wrapModeFromStyle(segment.styles, ctx.options.text?.overflowWrap);
  if (mode === "normal" || width <= 0) return transformedText;
  const font = inlineFont(ctx, segment, fallbackFont);
  const size = inlineSize(segment, fallbackSize);
  if (mode === "anywhere") return breakLongToken(ctx.doc, font, size, transformedText, width);
  return transformedText.split(/(\s+)/).map((part) => /\s+/.test(part) ? part : breakLongToken(ctx.doc, font, size, part, width)).join("");
}
function wrappedInlineSegments(ctx, inlines, fallbackFont, fallbackSize, width) {
  return inlines.map((segment) => ({ ...segment, text: wrapSegmentText(ctx, segment, fallbackFont, fallbackSize, width) }));
}
function ellipsizeText(ctx, text, font, size, width) {
  const marker = "...";
  ctx.doc.font(font).fontSize(size);
  if (ctx.doc.widthOfString(text) <= width) return text;
  if (ctx.doc.widthOfString(marker) > width) return "";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.doc.widthOfString(text.slice(0, mid) + marker) <= width) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + marker;
}
function displayInlineSegments(ctx, text, inlines, fallbackFont, fallbackSize, width, style) {
  const base = inlines.length > 0 ? inlines : [{ text, styles: style }];
  if (isNoWrapStyle(style) && wantsEllipsis(style)) {
    const plain = base.map((segment) => applyTextTransform(segment.text, { ...style, ...segment.styles })).join("").replace(/\n+/g, " ");
    return [{ text: ellipsizeText(ctx, plain, fallbackFont, fallbackSize, width), styles: base[0]?.styles ?? style }];
  }
  return wrappedInlineSegments(ctx, base, fallbackFont, fallbackSize, width);
}
function inlineBoxPadding(styles) {
  return boxPxToPt(parseBoxSpacing(styles, "padding", { top: 0, right: 0, bottom: 0, left: 0 }));
}
function inlineBoxBorder(styles) {
  return borderPxToPt(parseBorderStyle(styles, { width: 0, color: COLORS.border, style: "solid" }));
}
function inlineItem(ctx, segment, text, fallbackFont, fallbackSize, fallbackColor, boxed, whitespace) {
  const font = inlineFont(ctx, segment, fallbackFont);
  const size = inlineSize(segment, fallbackSize);
  const padding = boxed ? inlineBoxPadding(segment.styles) : { top: 0, right: 0, bottom: 0, left: 0 };
  const border = boxed ? inlineBoxBorder(segment.styles) : { width: 0, style: "none" };
  const background = parseCssColor(segment.styles["background-color"]);
  const textValue = applyTextTransform(text, segment.styles);
  const baselineShift = boxed ? 0 : inlineBaselineShift(segment, size);
  ctx.doc.font(font).fontSize(size);
  const textWidth = safeNumber(ctx.doc.widthOfString(textValue), 0);
  const textHeight = safeNumber(ctx.doc.heightOfString(textValue || " ", { width: Math.max(1, textWidth + 2), lineBreak: false }), size * 1.2);
  const width = textWidth + padding.left + padding.right + border.width * 2;
  const height = Math.max(size * 1.15, textHeight) + padding.top + padding.bottom + border.width * 2;
  const visualTop = Math.min(0, baselineShift);
  const visualBottom = Math.max(height, baselineShift + height);
  const visualHeight = visualBottom - visualTop;
  const item = {
    segment,
    text: textValue,
    font,
    size,
    color: inlineColor(segment, fallbackColor),
    width,
    height,
    visualHeight,
    baselineShift,
    visualTop,
    visualBottom,
    textWidth,
    padding,
    border,
    radius: boxed ? boxRadiusPt(segment.styles, width, height) : boxRadiusPt({}, width, height),
    decoration: (segment.styles["text-decoration"] ?? "").toLowerCase(),
    boxed,
    whitespace
  };
  if (background) item.background = background;
  if (segment.href) item.link = segment.href;
  return item;
}
function inlineItemWithText(ctx, item, text) {
  ctx.doc.font(item.font).fontSize(item.size);
  const textWidth = safeNumber(ctx.doc.widthOfString(text), 0);
  const textHeight = safeNumber(ctx.doc.heightOfString(text || " ", { width: Math.max(1, textWidth + 2), lineBreak: false }), item.size * 1.2);
  const width = textWidth + item.padding.left + item.padding.right + item.border.width * 2;
  const height = Math.max(item.size * 1.15, textHeight) + item.padding.top + item.padding.bottom + item.border.width * 2;
  const visualTop = Math.min(0, item.baselineShift);
  const visualBottom = Math.max(height, item.baselineShift + height);
  const visualHeight = visualBottom - visualTop;
  return {
    ...item,
    text,
    width,
    height,
    visualHeight,
    visualTop,
    visualBottom,
    textWidth,
    radius: item.boxed ? boxRadiusPt(item.segment.styles, width, height) : boxRadiusPt({}, width, height)
  };
}
function inlineLayoutItems(ctx, inlines, fallbackFont, fallbackSize, fallbackColor, noWrap) {
  const items = [];
  for (const segment of inlines) {
    const boxed = hasInlineBoxStyle2(segment);
    const text = segment.text;
    if (boxed || noWrap) {
      items.push(inlineItem(ctx, segment, text, fallbackFont, fallbackSize, fallbackColor, boxed, false));
      continue;
    }
    for (const part of text.split(/(\s+)/)) {
      if (!part) continue;
      items.push(inlineItem(ctx, segment, part, fallbackFont, fallbackSize, fallbackColor, false, /^\s+$/.test(part)));
    }
  }
  return items;
}
function layoutInlineLines(ctx, items, width, noWrap) {
  const lines = [];
  let current = [];
  let currentWidth = 0;
  let currentHeight = 0;
  const flush = () => {
    while (current[0]?.whitespace) {
      currentWidth -= current[0].width;
      current.shift();
    }
    while (current[current.length - 1]?.whitespace) {
      currentWidth -= current[current.length - 1].width;
      current.pop();
    }
    if (current.length > 0) {
      const top = Math.min(0, ...current.map((item) => item.visualTop));
      const bottom = Math.max(1, ...current.map((item) => item.visualBottom));
      lines.push({ items: current, width: Math.max(0, currentWidth), height: Math.max(1, bottom - top) });
    }
    current = [];
    currentWidth = 0;
    currentHeight = 0;
  };
  for (const item of items) {
    if (!noWrap && item.text.includes("\n")) {
      const parts = item.text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          const next = inlineItemWithText(ctx, item, parts[i]);
          next.whitespace = false;
          current.push(next);
          currentWidth += next.width;
          currentHeight = Math.max(currentHeight, next.visualHeight);
        }
        if (i < parts.length - 1) flush();
      }
      continue;
    }
    if (!noWrap && !item.whitespace && current.length > 0 && currentWidth + item.width > width) flush();
    if (!noWrap && item.whitespace && current.length === 0) continue;
    current.push(item);
    currentWidth += item.width;
    currentHeight = Math.max(currentHeight, item.visualHeight);
  }
  flush();
  return lines.length > 0 ? lines : [{ items: [], width: 0, height: fallbackLineHeight(items) }];
}
function fallbackLineHeight(items) {
  return Math.max(1, ...items.map((item) => item.visualHeight));
}
function inlineLinesLayoutHeight(lines, lineGap) {
  if (lines.length === 0) return 0;
  return lines.reduce((sum, line) => sum + line.height, 0) + lineGap * Math.max(0, lines.length - 1);
}
function currentFontMetricRatios(ctx, font) {
  ctx.doc.font(font);
  const source = ctx.doc._font;
  const units = Math.max(1, Math.abs(source?.unitsPerEm ?? 1e3));
  const rawAscender = Math.abs(source?.ascender ?? units * 0.76);
  const ascender = Math.max(0.65, Math.min(1.15, rawAscender / units));
  const descender = Math.max(0.12, Math.min(0.45, Math.abs(source?.descender ?? units * 0.24) / units));
  const rawCap = Math.abs(source?.capHeight ?? 0);
  const rawX = Math.abs(source?.xHeight ?? 0);
  const threshold = rawAscender * 0.3;
  const capRaw = rawCap > threshold ? rawCap : rawX > threshold ? rawX : rawAscender * 0.72;
  const capHeight = Math.max(0.5, Math.min(0.9, capRaw / units));
  return { ascender, descender, capHeight };
}
function measureInlineLines(ctx, lines, lineGap) {
  const layoutHeight = inlineLinesLayoutHeight(lines, lineGap);
  if (lines.length === 0) {
    return { visualHeight: 0, layoutHeight: 0, baselineOffsetTop: 0, baselineOffsetBottom: 0, lineCount: 0 };
  }
  const metricsCache = /* @__PURE__ */ new Map();
  const getRatios = (fontName) => {
    let r = metricsCache.get(fontName);
    if (!r) {
      r = currentFontMetricRatios(ctx, fontName);
      metricsCache.set(fontName, r);
    }
    return r;
  };
  let firstInsetTop = 0;
  let lastInsetBottom = 0;
  lines.forEach((line, index) => {
    const contentItems = line.items.filter((item) => item.text.trim().length > 0);
    const measureItems = contentItems.length > 0 ? contentItems : line.items;
    if (measureItems.length === 0) return;
    const lineTop = Math.min(0, ...line.items.map((item) => item.visualTop));
    let minInkTop = Infinity;
    let maxInkBottom = -Infinity;
    for (const item of measureItems) {
      const r = getRatios(item.font);
      const drawRelTop = -lineTop + item.baselineShift + item.border.width + item.padding.top;
      const inkTop = drawRelTop + Math.max(0, (r.ascender - r.capHeight) * item.size);
      const inkBottom = drawRelTop + (r.ascender + r.descender) * item.size;
      if (inkTop < minInkTop) minInkTop = inkTop;
      if (inkBottom > maxInkBottom) maxInkBottom = inkBottom;
    }
    const maxSize = Math.max(1, ...measureItems.map((item) => item.size));
    const topInset = Math.min(line.height * 0.45, Math.max(0, minInkTop));
    const bottomInset = Math.min(maxSize * 0.22, Math.max(0, line.height - maxInkBottom));
    if (index === 0) firstInsetTop = topInset;
    if (index === lines.length - 1) lastInsetBottom = bottomInset;
  });
  const visualHeight = Math.max(1, layoutHeight - firstInsetTop - lastInsetBottom);
  return {
    visualHeight,
    layoutHeight,
    baselineOffsetTop: firstInsetTop,
    baselineOffsetBottom: lastInsetBottom,
    lineCount: lines.length
  };
}
function inlineManualHeight(ctx, inlines, fallbackFont, fallbackSize, fallbackColor, width, noWrap) {
  const items = inlineLayoutItems(ctx, inlines, fallbackFont, fallbackSize, fallbackColor, noWrap);
  return layoutInlineLines(ctx, items, width, noWrap).reduce((sum, line) => sum + line.height, 0);
}
function drawManualInlineText(ctx, inlines, x, y, width, fallbackFont, fallbackSize, fallbackColor, align, noWrap) {
  const items = inlineLayoutItems(ctx, inlines, fallbackFont, fallbackSize, fallbackColor, noWrap);
  const lines = layoutInlineLines(ctx, items, width, noWrap);
  drawInlineLayoutLines(ctx, lines, x, y, width, align);
}
function drawInlineLayoutLines(ctx, lines, x, y, width, align, lineGap = 0) {
  let cursorY = y;
  for (const line of lines) {
    let cursorX = align === "right" ? x + width - line.width : align === "center" ? x + (width - line.width) / 2 : x;
    const lineTop = Math.min(0, ...line.items.map((item) => item.visualTop));
    for (const item of line.items) {
      const itemY = cursorY - lineTop + item.baselineShift;
      if (item.background) fillBox(ctx, cursorX, itemY, item.width, item.height, item.background, item.radius);
      strokeBox(ctx, cursorX, itemY, item.width, item.height, item.border, item.radius);
      ctx.doc.font(item.font).fontSize(item.size).fillColor(item.color).text(item.text, cursorX + item.border.width + item.padding.left, itemY + item.border.width + item.padding.top, {
        width: Math.max(1, item.textWidth + 2),
        lineBreak: false,
        continued: false,
        underline: item.decoration.includes("underline"),
        strike: item.decoration.includes("line-through"),
        link: item.link
      });
      cursorX += item.width;
    }
    cursorY += line.height + lineGap;
  }
}
function inlineTextHeight(ctx, text, inlines, fallbackFont, fallbackSize, width, lineGap, noWrap = false) {
  const maxSize = Math.max(fallbackSize, ...inlines.map((segment) => inlineSize(segment, fallbackSize)));
  const source = inlines.length > 0 ? inlines : [{ text, styles: {} }];
  if (needsManualInlineLayout(source)) return safeNumber(inlineManualHeight(ctx, source, fallbackFont, fallbackSize, COLORS.text, width, noWrap), maxSize * 1.2);
  const wrappedText = (noWrap ? source : wrappedInlineSegments(ctx, source, fallbackFont, fallbackSize, width)).map((segment) => segment.text).join("");
  ctx.doc.font(fontForStyle(ctx, {}, fallbackFont, wrappedText)).fontSize(maxSize);
  return safeNumber(ctx.doc.heightOfString(wrappedText || " ", { width: noWrap ? 1e5 : width, lineGap, lineBreak: !noWrap }), maxSize * 1.2);
}
function drawInlineText(ctx, text, inlines, x, y, width, fallbackFont, fallbackSize, fallbackColor, lineGap, align, noWrap = false) {
  const source = inlines.length > 0 ? inlines : [{ text, styles: {} }];
  if (needsManualInlineLayout(source)) {
    drawManualInlineText(ctx, source, x, y, width, fallbackFont, fallbackSize, fallbackColor, align, noWrap);
    return;
  }
  const segments = noWrap ? source : wrappedInlineSegments(ctx, source, fallbackFont, fallbackSize, width);
  const noWrapWidth = noWrap ? Math.max(1, segments.reduce((sum, segment) => {
    ctx.doc.font(inlineFont(ctx, segment, fallbackFont)).fontSize(inlineSize(segment, fallbackSize));
    return sum + safeNumber(ctx.doc.widthOfString(segment.text), 0);
  }, 0)) : width;
  const drawX = noWrap && align === "right" ? x + width - noWrapWidth : noWrap && align === "center" ? x + (width - noWrapWidth) / 2 : x;
  const drawWidth = noWrap ? Math.max(width, noWrapWidth + 2) : width;
  const drawAlign = noWrap ? "left" : align;
  let first = true;
  for (const segment of segments) {
    const decoration = (segment.styles["text-decoration"] ?? "").toLowerCase();
    const options = {
      width: drawWidth,
      lineGap,
      align: drawAlign,
      lineBreak: !noWrap,
      continued: !segment.text.endsWith("\n") && segment !== segments[segments.length - 1],
      underline: decoration.includes("underline"),
      strike: decoration.includes("line-through"),
      link: segment.href
    };
    ctx.doc.font(inlineFont(ctx, segment, fallbackFont)).fontSize(inlineSize(segment, fallbackSize)).fillColor(inlineColor(segment, fallbackColor));
    if (first) {
      ctx.doc.text(segment.text, drawX, y, options);
      first = false;
    } else {
      ctx.doc.text(segment.text, options);
    }
  }
  if (!first) ctx.doc.text("", { continued: false });
}

// src/stream/charts.ts
function chartTheme(block) {
  return CHART_THEMES[block.chart.theme ?? ""] ?? CHART_THEMES.default;
}
function chartColor(block, index) {
  const theme = chartTheme(block);
  const raw = block.chart.colors?.[index] ?? theme.colors[index % theme.colors.length] ?? CHART_COLORS[index % CHART_COLORS.length] ?? "#2563eb";
  return parseCssColor(raw) ?? raw;
}
function chartTitleHeight(ctx, block, width) {
  let height = 0;
  if (block.chart.title) {
    ctx.doc.font(fontForStyle(ctx, block.style, ctx.boldFontName)).fontSize(cssLengthPt(block.style["font-size"]) ?? 11);
    height += ctx.doc.heightOfString(block.chart.title, { width, lineGap: 1 });
  }
  if (block.chart.subtitle) {
    ctx.doc.font(ctx.regularFontName).fontSize(7.5);
    height += ctx.doc.heightOfString(block.chart.subtitle, { width, lineGap: 1 }) + 2;
  }
  return height > 0 ? height + 8 : 0;
}
function drawChartHeader(ctx, block, x, y, width) {
  let cursor = y;
  if (block.chart.title) {
    ctx.doc.font(fontForStyle(ctx, block.style, ctx.boldFontName)).fontSize(cssLengthPt(block.style["font-size"]) ?? 11).fillColor(parseCssColor(block.style["color"]) ?? "#0f172a").text(block.chart.title, x, cursor, { width, lineBreak: false });
    cursor += 14;
  }
  if (block.chart.subtitle) {
    ctx.doc.font(ctx.regularFontName).fontSize(7.5).fillColor("#64748b").text(block.chart.subtitle, x, cursor, { width, lineBreak: false });
    cursor += 12;
  }
  return cursor + (cursor > y ? 4 : 0);
}
function drawBarChart(ctx, block, x, y, width, height) {
  const values = block.chart.values;
  const max = Math.max(1, ...values);
  const plotLeft = x + 30;
  const plotBottom = y + height - 18;
  const plotTop = y + 10;
  const plotWidth = Math.max(1, width - 38);
  const plotHeight = Math.max(1, plotBottom - plotTop);
  const gap = Math.min(10, plotWidth / Math.max(1, values.length) * 0.22);
  const barWidth = Math.max(4, (plotWidth - gap * (values.length - 1)) / Math.max(1, values.length));
  ctx.doc.save();
  ctx.doc.strokeColor("#e2e8f0").lineWidth(0.5);
  for (let i = 0; i <= 3; i++) {
    const gy = plotTop + plotHeight * i / 3;
    ctx.doc.moveTo(plotLeft, gy).lineTo(plotLeft + plotWidth, gy).stroke();
  }
  ctx.doc.font(ctx.regularFontName).fontSize(6.2).fillColor("#94a3b8");
  ctx.doc.text(`${Math.round(max)}${block.chart.unit ?? ""}`, x, plotTop - 2, { width: 26, align: "right", lineBreak: false });
  ctx.doc.text(`0${block.chart.unit ?? ""}`, x, plotBottom - 5, { width: 26, align: "right", lineBreak: false });
  for (let i = 0; i < values.length; i++) {
    const value = values[i] ?? 0;
    const barHeight = plotHeight * Math.max(0, value) / max;
    const bx = plotLeft + i * (barWidth + gap);
    const by = plotBottom - barHeight;
    const color = chartColor(block, i);
    fillBox(ctx, bx, by, barWidth, barHeight, color, { topLeft: 3, topRight: 3, bottomRight: 0, bottomLeft: 0 });
    ctx.doc.font(ctx.boldFontName).fontSize(7).fillColor("#334155").text(String(Math.round(value)), bx - 5, by - 11, { width: barWidth + 10, align: "center", lineBreak: false });
    ctx.doc.font(ctx.regularFontName).fontSize(6.3).fillColor("#64748b").text(block.chart.labels[i] ?? "", bx - 10, plotBottom + 5, { width: barWidth + 20, align: "center", lineBreak: false });
  }
  ctx.doc.restore();
}
function chartSeries(block) {
  return block.chart.series?.length ? block.chart.series : [block.chart.values];
}
function pointsForSeries(values, min, max, plotLeft, plotTop, plotWidth, plotHeight) {
  const range = Math.max(1, max - min);
  return values.map((value, index) => ({
    x: plotLeft + plotWidth * (values.length === 1 ? 0 : index / (values.length - 1)),
    y: plotTop + plotHeight - (value - min) / range * plotHeight
  }));
}
function drawSmoothPath(ctx, points) {
  if (points.length === 0) return;
  ctx.doc.moveTo(points[0].x, points[0].y);
  if (points.length === 1) return;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.doc.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}
function fillSeriesArea(ctx, points, bottom, color, opacity) {
  if (points.length < 2) return;
  ctx.doc.save();
  ctx.doc.moveTo(points[0].x, bottom);
  ctx.doc.lineTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.doc.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
  ctx.doc.lineTo(points[points.length - 1].x, bottom).closePath();
  ctx.doc.opacity(clamp(opacity, 0, 1));
  ctx.doc.fill(color);
  ctx.doc.restore();
  ctx.doc.opacity(1);
}
function drawLineChart(ctx, block, x, y, width, height) {
  const theme = chartTheme(block);
  const series2 = chartSeries(block).map((items) => items.filter((value) => Number.isFinite(value)));
  const allValues = series2.flat();
  const max = block.chart.max && block.chart.max > 0 ? block.chart.max : Math.max(1, ...allValues);
  const min = Math.min(0, ...allValues);
  const plotLeft = x + 30;
  const plotRight = x + width - 10;
  const plotTop = y + 10;
  const legendSpace = series2.length > 1 ? 18 : 0;
  const plotBottom = y + height - 21 - legendSpace;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);
  const isArea = block.chart.chartType === "area";
  ctx.doc.save();
  ctx.doc.strokeColor(theme.grid).lineWidth(0.45);
  for (let i = 0; i <= 4; i++) {
    const gy = plotTop + plotHeight * i / 4;
    ctx.doc.moveTo(plotLeft, gy).lineTo(plotRight, gy).stroke();
  }
  ctx.doc.font(ctx.regularFontName).fontSize(5.8).fillColor(theme.muted);
  ctx.doc.text(`${Math.round(max)}${block.chart.unit ?? ""}`, x, plotTop - 3, { width: 26, align: "right", lineBreak: false });
  ctx.doc.text(`${Math.round(min)}${block.chart.unit ?? ""}`, x, plotBottom - 5, { width: 26, align: "right", lineBreak: false });
  for (let seriesIndex = 0; seriesIndex < series2.length; seriesIndex++) {
    const values = series2[seriesIndex];
    const points = pointsForSeries(values, min, max, plotLeft, plotTop, plotWidth, plotHeight);
    const color = chartColor(block, seriesIndex);
    if (isArea) fillSeriesArea(ctx, points, plotBottom, color, seriesIndex === 0 ? 0.16 : 0.09);
  }
  for (let seriesIndex = 0; seriesIndex < series2.length; seriesIndex++) {
    const values = series2[seriesIndex];
    const points = pointsForSeries(values, min, max, plotLeft, plotTop, plotWidth, plotHeight);
    const color = chartColor(block, seriesIndex);
    drawSmoothPath(ctx, points);
    ctx.doc.strokeColor(color).lineWidth(seriesIndex === 0 ? 2.2 : 1.8).stroke();
    for (const point of points) {
      ctx.doc.circle(point.x, point.y, 2.7).fill(color);
      ctx.doc.circle(point.x, point.y, 2.7).strokeColor("#ffffff").lineWidth(0.9).stroke();
    }
  }
  const labelStep = Math.max(1, Math.ceil(block.chart.labels.length / 6));
  ctx.doc.font(ctx.regularFontName).fontSize(5.8).fillColor(theme.muted);
  for (let i = 0; i < block.chart.labels.length; i += labelStep) {
    const lx = plotLeft + plotWidth * (block.chart.labels.length === 1 ? 0 : i / (block.chart.labels.length - 1));
    ctx.doc.text(block.chart.labels[i] ?? "", lx - 18, plotBottom + 6, { width: 36, align: "center", lineBreak: false });
  }
  if (series2.length > 1) drawChartLegend(ctx, block, x, y + height - 12, width, series2.length);
  ctx.doc.restore();
}
function drawChartLegend(ctx, block, x, y, width, count) {
  const legendCount = Math.min(count, 6);
  const labels = Array.from({ length: legendCount }, (_, index) => block.chart.seriesLabels?.[index] ?? block.chart.labels[index] ?? `Series ${index + 1}`);
  ctx.doc.font(ctx.boldFontName).fontSize(6.4);
  const marker = 7;
  const markerGap = 5;
  const itemGap = 18;
  const itemWidths = labels.map((label) => marker + markerGap + Math.min(72, safeNumber(ctx.doc.widthOfString(label), 0)));
  const rawTotal = itemWidths.reduce((sum, item) => sum + item, 0) + itemGap * Math.max(0, legendCount - 1);
  const total = Math.min(width, rawTotal);
  let legendX = x + Math.max(0, (width - total) / 2);
  for (let i = 0; i < legendCount; i++) {
    ctx.doc.roundedRect(legendX, y + 2, 7, 7, 2).fill(chartColor(block, i));
    ctx.doc.font(ctx.boldFontName).fontSize(6.4).fillColor(chartTheme(block).text).text(labels[i], legendX + marker + markerGap, y, { width: Math.min(72, Math.max(1, itemWidths[i] - marker - markerGap)), lineBreak: false });
    legendX += itemWidths[i] + itemGap;
  }
}
function drawSparklineChart(ctx, block, x, y, width, height) {
  const theme = chartTheme(block);
  const series2 = chartSeries(block).map((items) => items.filter((value) => Number.isFinite(value)));
  const allValues = series2.flat();
  const max = Math.max(1, ...allValues);
  const min = Math.min(...allValues);
  const padX = 10;
  const plotLeft = x + padX;
  const plotRight = x + width - padX;
  const plotTop = y + 17;
  const plotBottom = y + height - (series2.length > 1 ? 25 : 14);
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);
  ctx.doc.save();
  ctx.doc.strokeColor(theme.grid).lineWidth(0.4);
  for (let i = 0; i <= 2; i++) {
    const gy = plotTop + plotHeight * i / 2;
    ctx.doc.moveTo(plotLeft, gy).lineTo(plotRight, gy).stroke();
  }
  for (let seriesIndex = 0; seriesIndex < series2.length; seriesIndex++) {
    const points = pointsForSeries(series2[seriesIndex], min, max, plotLeft, plotTop, plotWidth, plotHeight);
    const color = chartColor(block, seriesIndex);
    if (seriesIndex === 0) fillSeriesArea(ctx, points, plotBottom, color, 0.1);
    drawSmoothPath(ctx, points);
    ctx.doc.strokeColor(color).lineWidth(seriesIndex === 0 ? 2.1 : 1.7).stroke();
    const last = points[points.length - 1];
    if (last) {
      ctx.doc.circle(last.x, last.y, 3.2).fill(color);
      ctx.doc.circle(last.x, last.y, 3.2).strokeColor("#ffffff").lineWidth(1).stroke();
    }
  }
  const latest = series2[0]?.[series2[0].length - 1] ?? block.chart.values[block.chart.values.length - 1] ?? 0;
  ctx.doc.font(ctx.boldFontName).fontSize(12).fillColor(theme.text).text(`${Math.round(latest)}${block.chart.unit ?? ""}`, x + width - 62, y + 3, { width: 54, align: "right", lineBreak: false });
  if (series2.length > 1) drawChartLegend(ctx, block, x, y + height - 13, width, series2.length);
  ctx.doc.restore();
}
function drawHorizontalBarChart(ctx, block, x, y, width, height) {
  const theme = chartTheme(block);
  const values = block.chart.values.map((value) => Math.max(0, value));
  const max = block.chart.max && block.chart.max > 0 ? block.chart.max : Math.max(1, ...values);
  const plotLeft = x + Math.min(76, width * 0.32);
  const plotRight = x + width - 36;
  const plotTop = y + 8;
  const rowHeight = Math.min(22, Math.max(14, (height - 16) / Math.max(1, values.length)));
  const barHeight = Math.max(6, rowHeight * 0.48);
  const plotWidth = Math.max(1, plotRight - plotLeft);
  ctx.doc.save();
  ctx.doc.font(ctx.regularFontName).fontSize(6.8).fillColor("#475569");
  for (let i = 0; i < values.length; i++) {
    const rowY = plotTop + i * rowHeight;
    const centerY = rowY + rowHeight / 2;
    const label = block.chart.labels[i] ?? String(i + 1);
    const value = values[i];
    const barWidth = plotWidth * clamp(value / max, 0, 1);
    ctx.doc.text(label, x, centerY - 4, { width: plotLeft - x - 8, align: "right", lineBreak: false });
    fillBox(ctx, plotLeft, centerY - barHeight / 2, plotWidth, barHeight, theme.track, 999);
    fillBox(ctx, plotLeft, centerY - barHeight / 2, barWidth, barHeight, chartColor(block, i), 999);
    ctx.doc.font(ctx.boldFontName).fontSize(6.8).fillColor("#0f172a").text(`${Math.round(value)}${block.chart.unit ?? ""}`, plotRight + 4, centerY - 4, { width: 32, align: "right", lineBreak: false });
    ctx.doc.font(ctx.regularFontName).fontSize(6.8).fillColor("#475569");
  }
  ctx.doc.restore();
}
function drawStackedBarChart(ctx, block, x, y, width, height) {
  const series2 = chartSeries(block).map((items) => items.map((value) => Math.max(0, value)));
  const categoryCount = Math.max(1, block.chart.labels.length, ...series2.map((items) => items.length));
  const totals = Array.from({ length: categoryCount }, (_, index) => series2.reduce((sum, items) => sum + (items[index] ?? 0), 0));
  const max = block.chart.max && block.chart.max > 0 ? block.chart.max : Math.max(1, ...totals);
  const plotLeft = x + 28;
  const plotBottom = y + height - 24;
  const plotTop = y + 10;
  const plotWidth = Math.max(1, width - 40);
  const plotHeight = Math.max(1, plotBottom - plotTop);
  const gap = Math.min(11, plotWidth / categoryCount * 0.26);
  const barWidth = Math.max(6, (plotWidth - gap * Math.max(0, categoryCount - 1)) / categoryCount);
  ctx.doc.save();
  ctx.doc.strokeColor("#e2e8f0").lineWidth(0.5);
  for (let i = 0; i <= 3; i++) {
    const gy = plotTop + plotHeight * i / 3;
    ctx.doc.moveTo(plotLeft, gy).lineTo(plotLeft + plotWidth, gy).stroke();
  }
  for (let category = 0; category < categoryCount; category++) {
    let cursorBottom = plotBottom;
    const bx = plotLeft + category * (barWidth + gap);
    for (let seriesIndex = 0; seriesIndex < series2.length; seriesIndex++) {
      const value = series2[seriesIndex]?.[category] ?? 0;
      const segmentHeight = plotHeight * value / max;
      if (segmentHeight > 0) {
        fillBox(ctx, bx, cursorBottom - segmentHeight, barWidth, segmentHeight, chartColor(block, seriesIndex), seriesIndex === series2.length - 1 ? { topLeft: 3, topRight: 3, bottomRight: 0, bottomLeft: 0 } : 0);
        cursorBottom -= segmentHeight;
      }
    }
    ctx.doc.font(ctx.regularFontName).fontSize(6.1).fillColor("#64748b").text(block.chart.labels[category] ?? String(category + 1), bx - 10, plotBottom + 6, { width: barWidth + 20, align: "center", lineBreak: false });
  }
  drawChartLegend(ctx, block, x, y + height - 10, width, series2.length);
  ctx.doc.restore();
}
function donutSegmentPath(ctx, cx, cy, outerRadius, innerRadius, startDeg, endDeg) {
  const steps = Math.max(8, Math.ceil(Math.abs(endDeg - startDeg) / 8));
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (startDeg + (endDeg - startDeg) * i / steps) * Math.PI / 180;
    outer.push({ x: cx + Math.cos(angle) * outerRadius, y: cy + Math.sin(angle) * outerRadius });
    inner.push({ x: cx + Math.cos(angle) * innerRadius, y: cy + Math.sin(angle) * innerRadius });
  }
  ctx.doc.moveTo(outer[0].x, outer[0].y);
  for (const point of outer.slice(1)) ctx.doc.lineTo(point.x, point.y);
  for (const point of inner.reverse()) ctx.doc.lineTo(point.x, point.y);
  ctx.doc.closePath();
}
function fillAnnularSegment(ctx, cx, cy, outerRadius, innerRadius, startDeg, endDeg, color, opacity = 1) {
  if (outerRadius <= 0 || innerRadius < 0 || endDeg <= startDeg) return;
  ctx.doc.save();
  ctx.doc.opacity(clamp(opacity, 0, 1));
  donutSegmentPath(ctx, cx, cy, outerRadius, innerRadius, startDeg, endDeg);
  ctx.doc.fill(color);
  ctx.doc.restore();
  ctx.doc.opacity(1);
}
function chartMax(block, values) {
  if (block.chart.max && block.chart.max > 0) return block.chart.max;
  const max = Math.max(1, ...values.map((value) => Math.max(0, value)));
  return max <= 100 ? 100 : max;
}
function drawCenteredChartValue(ctx, text, unit, cx, cy, width, color = "#0f172a") {
  const unitText = unit?.trim() ?? "";
  const valueSize = clamp(width * 0.18, 12, 22);
  const unitSize = clamp(width * 0.07, 5.5, 8);
  const valueHeight = valueSize * 0.9;
  const unitHeight = unitText ? unitSize * 1.05 : 0;
  const gap = unitText ? 2 : 0;
  const stackHeight = valueHeight + gap + unitHeight;
  const top = cy - stackHeight / 2;
  ctx.doc.font(ctx.boldFontName).fontSize(valueSize).fillColor(color).text(text, cx - width / 2, top, { width, align: "center", lineBreak: false });
  if (unitText) {
    ctx.doc.font(ctx.regularFontName).fontSize(unitSize).fillColor("#64748b").text(unitText, cx - width / 2, top + valueHeight + gap, { width, align: "center", lineBreak: false });
  }
}
function drawDonutChart(ctx, block, x, y, width, height) {
  const values = block.chart.values.map((value) => Math.max(0, value));
  const total = Math.max(1, values.reduce((sum, value) => sum + value, 0));
  const radius = Math.min(height * 0.34, width * 0.16, 48);
  const innerRadius = radius * 0.62;
  const cx = x + width * 0.24;
  const cy = y + height * 0.48;
  let angle = -90;
  ctx.doc.save();
  for (let i = 0; i < values.length; i++) {
    const sweep = values[i] / total * 360;
    if (sweep > 0) {
      donutSegmentPath(ctx, cx, cy, radius, innerRadius, angle + 1, angle + sweep - 1);
      ctx.doc.fill(chartColor(block, i));
    }
    angle += sweep;
  }
  ctx.doc.circle(cx, cy, innerRadius).fill("#ffffff");
  ctx.doc.restore();
  const valueText = String(Math.round(total));
  const unitText = block.chart.unit?.trim() ?? "";
  const valueSize = Math.max(11, Math.min(16, innerRadius * 0.5));
  const unitSize = Math.max(5, Math.min(7, innerRadius * 0.2));
  const valueHeight = valueSize * 0.9;
  const unitHeight = unitText ? unitSize * 1.05 : 0;
  const gap = unitText ? 2 : 0;
  const stackHeight = valueHeight + gap + unitHeight;
  const textTop = cy - stackHeight / 2;
  const textWidth = innerRadius * 2;
  ctx.doc.font(ctx.boldFontName).fontSize(valueSize).fillColor("#0f172a").text(valueText, cx - innerRadius, textTop, { width: textWidth, align: "center", lineBreak: false });
  if (unitText) {
    ctx.doc.font(ctx.regularFontName).fontSize(unitSize).fillColor("#64748b").text(unitText, cx - innerRadius, textTop + valueHeight + gap, { width: textWidth, align: "center", lineBreak: false });
  }
  const legendX = x + width * 0.46;
  const itemHeight = 14;
  for (let i = 0; i < Math.min(values.length, block.chart.labels.length, 5); i++) {
    const itemY = y + 16 + i * itemHeight;
    ctx.doc.roundedRect(legendX, itemY + 2, 7, 7, 2).fill(chartColor(block, i));
    ctx.doc.font(ctx.regularFontName).fontSize(7).fillColor("#475569").text(block.chart.labels[i] ?? "", legendX + 11, itemY, { width: width * 0.28, lineBreak: false });
    ctx.doc.font(ctx.boldFontName).fontSize(7).fillColor("#0f172a").text(String(values[i]), x + width - 48, itemY, { width: 40, align: "right", lineBreak: false });
  }
}
function drawPieChart(ctx, block, x, y, width, height) {
  const theme = chartTheme(block);
  const values = block.chart.values.map((value) => Math.max(0, value));
  const total = Math.max(1, values.reduce((sum, value) => sum + value, 0));
  const radius = Math.min(height * 0.42, width * 0.2, 64);
  const cx = x + width * 0.27;
  const cy = y + height * 0.5;
  let angle = -90;
  ctx.doc.save();
  ctx.doc.circle(cx + 1.5, cy + 2, radius).fillOpacity(0.06).fill("#0f172a").fillOpacity(1);
  for (let i = 0; i < values.length; i++) {
    const sweep = values[i] / total * 360;
    if (sweep > 0) {
      const overlap = values.length > 1 ? 0.18 : 0;
      fillAnnularSegment(ctx, cx, cy, radius, 0, angle - overlap, angle + sweep + overlap, chartColor(block, i));
    }
    angle += sweep;
  }
  ctx.doc.circle(cx, cy, radius).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
  ctx.doc.circle(cx, cy, radius * 0.48).fillOpacity(0.1).fill("#ffffff").fillOpacity(1);
  const legendX = x + width * 0.55;
  const itemHeight = 15;
  const legendTop = y + Math.max(8, (height - itemHeight * Math.min(values.length, 6)) / 2);
  for (let i = 0; i < Math.min(values.length, block.chart.labels.length, 6); i++) {
    const itemY = legendTop + i * itemHeight;
    const percent = Math.round(values[i] / total * 100);
    fillBox(ctx, legendX - 3, itemY - 2, width * 0.38, 12, i % 2 === 0 ? "#f8fafc" : "#ffffff", 4);
    ctx.doc.roundedRect(legendX + 3, itemY + 1.5, 7, 7, 2).fill(chartColor(block, i));
    ctx.doc.font(ctx.regularFontName).fontSize(7).fillColor(theme.muted).text(block.chart.labels[i] ?? "", legendX + 14, itemY, { width: width * 0.2, lineBreak: false });
    ctx.doc.font(ctx.boldFontName).fontSize(7).fillColor(theme.text).text(`${percent}%`, x + width - 44, itemY, { width: 38, align: "right", lineBreak: false });
  }
  ctx.doc.restore();
}
function drawGaugeChart(ctx, block, x, y, width, height) {
  const value = Math.max(0, block.chart.values[0] ?? 0);
  const max = block.chart.max && block.chart.max > 0 ? block.chart.max : 100;
  const radius = Math.min(width * 0.27, height * 0.43, 72);
  const thickness = Math.max(10, Math.min(18, radius * 0.24));
  const innerRadius = radius - thickness;
  const cx = x + width * 0.5;
  const cy = y + height * 0.66;
  const start = 180;
  const sweep = 180;
  fillAnnularSegment(ctx, cx, cy, radius, innerRadius, start, start + sweep, "#e5e7eb", 0.95);
  fillAnnularSegment(ctx, cx, cy, radius, innerRadius, start, start + sweep * clamp(value / max, 0, 1), chartColor(block, 0), 0.98);
  drawCenteredChartValue(ctx, block.chart.center ?? String(Math.round(value)), block.chart.unit, cx, cy - radius * 0.07, radius * 1.2);
  ctx.doc.save();
  ctx.doc.font(ctx.regularFontName).fontSize(6.2).fillColor("#64748b");
  ctx.doc.text(`0${block.chart.unit ?? ""}`, cx - radius - 20, cy + 3, { width: 36, align: "center", lineBreak: false });
  ctx.doc.text(`${Math.round(max)}${block.chart.unit ?? ""}`, cx + radius - 16, cy + 3, { width: 42, align: "center", lineBreak: false });
  ctx.doc.restore();
}
function drawRadialChart(ctx, block, x, y, width, height) {
  const values = block.chart.values.map((value) => Math.max(0, value));
  const max = chartMax(block, values);
  const ringCount = clamp(values.length, 1, 6);
  const outerRadius = Math.min(width * 0.22, height * 0.35, 58);
  const cx = x + width * 0.38;
  const cy = y + height * 0.48;
  const gap = Math.max(2, outerRadius * 0.055);
  const thickness = Math.max(5, Math.min(11, (outerRadius * 0.68 - gap * (ringCount - 1)) / ringCount));
  const start = -205;
  const sweep = 310;
  ctx.doc.save();
  for (let i = 0; i < ringCount; i++) {
    const outer = outerRadius - i * (thickness + gap);
    const inner = Math.max(2, outer - thickness);
    fillAnnularSegment(ctx, cx, cy, outer, inner, start, start + sweep, "#e5e7eb", 0.9);
    fillAnnularSegment(ctx, cx, cy, outer, inner, start, start + sweep * clamp(values[i] / max, 0, 1), chartColor(block, i), 0.98);
  }
  const centerText = block.chart.center ?? (values.length === 1 ? String(Math.round(values[0])) : "");
  if (centerText) drawCenteredChartValue(ctx, centerText, block.chart.unit, cx, cy, outerRadius * 1.05);
  const legendX = x + width * 0.67;
  const legendTop = y + Math.max(14, height * 0.18);
  for (let i = 0; i < Math.min(values.length, block.chart.labels.length, 6); i++) {
    const itemY = legendTop + i * 13;
    ctx.doc.roundedRect(legendX, itemY + 2, 7, 7, 2).fill(chartColor(block, i));
    ctx.doc.font(ctx.regularFontName).fontSize(6.8).fillColor("#475569").text(block.chart.labels[i] ?? "", legendX + 11, itemY, { width: width * 0.22, lineBreak: false });
    ctx.doc.font(ctx.boldFontName).fontSize(6.8).fillColor("#0f172a").text(String(Math.round(values[i])), x + width - 44, itemY, { width: 36, align: "right", lineBreak: false });
  }
  ctx.doc.restore();
}
function drawRadialStackedChart(ctx, block, x, y, width, height) {
  const values = block.chart.values.map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0);
  const max = block.chart.max && block.chart.max > 0 ? block.chart.max : Math.max(1, total);
  const radius = Math.min(width * 0.28, height * 0.42, 72);
  const thickness = Math.max(10, Math.min(17, radius * 0.22));
  const innerRadius = radius - thickness;
  const cx = x + width * 0.48;
  const cy = y + height * 0.64;
  const start = 180;
  const sweep = 180;
  fillAnnularSegment(ctx, cx, cy, radius, innerRadius, start, start + sweep, "#e5e7eb", 0.9);
  let angle = start;
  for (let i = 0; i < values.length; i++) {
    const part = sweep * values[i] / max;
    fillAnnularSegment(ctx, cx, cy, radius, innerRadius, angle + 0.8, Math.min(start + sweep, angle + part - 0.8), chartColor(block, i), 0.98);
    angle += part;
  }
  drawCenteredChartValue(ctx, block.chart.center ?? String(Math.round(total)), block.chart.unit, cx, cy - radius * 0.06, radius * 1.25);
  drawChartLegend(ctx, block, x, y + height - 15, width, Math.min(values.length, 4));
}
function radarPoint(cx, cy, radius, index, total, ratio) {
  const angle = (-90 + 360 * index / Math.max(1, total)) * Math.PI / 180;
  return {
    x: cx + Math.cos(angle) * radius * ratio,
    y: cy + Math.sin(angle) * radius * ratio
  };
}
function drawRadarPolygon(ctx, points, fill, stroke, opacity) {
  if (points.length === 0) return;
  ctx.doc.save();
  ctx.doc.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.doc.lineTo(point.x, point.y);
  ctx.doc.closePath();
  if (fill) {
    ctx.doc.opacity(clamp(opacity, 0, 1));
    ctx.doc.fill(fill);
    ctx.doc.opacity(1);
  }
  ctx.doc.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.doc.lineTo(point.x, point.y);
  ctx.doc.closePath().strokeColor(stroke).lineWidth(1.2).stroke();
  ctx.doc.restore();
}
function drawRadarChart(ctx, block, x, y, width, height) {
  const series2 = (block.chart.series?.length ? block.chart.series : [block.chart.values]).map((items) => items.map((value) => Math.max(0, value)));
  const axisCount = Math.max(3, block.chart.labels.length, ...series2.map((items) => items.length));
  const allValues = series2.flat();
  const max = chartMax(block, allValues);
  const radius = Math.min(width * 0.24, height * 0.31, 62);
  const cx = x + width * 0.5;
  const cy = y + height * 0.45;
  ctx.doc.save();
  ctx.doc.strokeColor("#d8e0ea").lineWidth(0.55);
  for (let level = 1; level <= 4; level++) {
    const points = Array.from({ length: axisCount }, (_, index) => radarPoint(cx, cy, radius, index, axisCount, level / 4));
    ctx.doc.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.doc.lineTo(point.x, point.y);
    ctx.doc.closePath().stroke();
  }
  for (let index = 0; index < axisCount; index++) {
    const edge = radarPoint(cx, cy, radius, index, axisCount, 1);
    ctx.doc.moveTo(cx, cy).lineTo(edge.x, edge.y).stroke();
  }
  ctx.doc.font(ctx.regularFontName).fontSize(6.7).fillColor("#64748b");
  for (let index = 0; index < axisCount; index++) {
    const point = radarPoint(cx, cy, radius + 12, index, axisCount, 1);
    const label = block.chart.labels[index] ?? String(index + 1);
    ctx.doc.text(label, point.x - 22, point.y - 4, { width: 44, align: "center", lineBreak: false });
  }
  for (let i = 0; i < series2.length; i++) {
    const color = chartColor(block, i);
    const points = Array.from({ length: axisCount }, (_, index) => {
      const value = series2[i]?.[index] ?? 0;
      return radarPoint(cx, cy, radius, index, axisCount, clamp(value / max, 0, 1));
    });
    drawRadarPolygon(ctx, points, color, color, i === 0 ? 0.24 : 0.18);
  }
  drawChartLegend(ctx, block, x, y + height - 18, width, Math.min(series2.length, 4));
  ctx.doc.restore();
}
function chartBoxMetrics(ctx, block, availableWidth) {
  const margin = spacingPt(block.style, "margin", { top: 0, right: 0, bottom: 8, left: 0 });
  const padding = spacingPt(block.style, "padding", { top: 10, right: 12, bottom: 10, left: 12 });
  const border = borderPxToPt(parseBorderStyle(block.style, { width: 0.7 * 96 / 72, color: "#d8e0ea", style: "solid" }));
  const outerWidth = Math.min(availableWidth - margin.left - margin.right, cssLengthPt(block.style["width"], availableWidth) ?? availableWidth - margin.left - margin.right);
  const contentWidth = Math.max(40, outerWidth - padding.left - padding.right - border.width * 2);
  const chartHeight = cssLengthPt(block.style["height"]) ?? 145;
  const titleHeight = chartTitleHeight(ctx, block, contentWidth);
  const outerHeight = chartHeight + titleHeight + padding.top + padding.bottom + border.width * 2;
  return { margin, padding, border, outerWidth, outerHeight };
}
async function drawChartBlock(ctx, block) {
  const { margin, padding, border, outerWidth, outerHeight } = chartBoxMetrics(ctx, block, ctx.tableWidth);
  const contentWidth = Math.max(40, outerWidth - padding.left - padding.right - border.width * 2);
  ensureSpace(ctx, margin.top + outerHeight + margin.bottom);
  ctx.y += margin.top;
  const align = block.style["text-align"] === "center" ? "center" : block.style["text-align"] === "right" ? "right" : "left";
  const x = align === "center" ? ctx.margin + margin.left + (ctx.tableWidth - margin.left - margin.right - outerWidth) / 2 : align === "right" ? ctx.margin + ctx.tableWidth - margin.right - outerWidth : ctx.margin + margin.left;
  const y = ctx.y;
  const radius = borderRadiusPt(block.style, outerWidth, outerHeight);
  drawBoxShadow(ctx, block.style, x, y, outerWidth, outerHeight, radius);
  fillBox(ctx, x, y, outerWidth, outerHeight, parseCssColor(block.style["background-color"]) ?? "#ffffff", radius);
  await drawBackgroundImage(ctx, block.style, x, y, outerWidth, outerHeight, radius);
  strokeBox(ctx, x, y, outerWidth, outerHeight, border, radius);
  const contentX = x + border.width + padding.left;
  let cursor = drawChartHeader(ctx, block, contentX, y + border.width + padding.top, contentWidth);
  if (cursor === y + border.width + padding.top) cursor = y + border.width + padding.top;
  const plotY = cursor;
  const plotHeight = Math.max(50, y + outerHeight - padding.bottom - border.width - plotY);
  if (block.chart.chartType === "line" || block.chart.chartType === "area") drawLineChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "sparkline") drawSparklineChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "horizontal-bar") drawHorizontalBarChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "stacked-bar") drawStackedBarChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "pie") drawPieChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "donut") drawDonutChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "gauge") drawGaugeChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "radial") drawRadialChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "radial-stacked") drawRadialStackedChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else if (block.chart.chartType === "radar") drawRadarChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  else drawBarChart(ctx, block, contentX, plotY, contentWidth, plotHeight);
  ctx.y += outerHeight + margin.bottom;
}

// src/stream/table.ts
function computeColumnWidthsFromStyles(table, contentWidth) {
  const styles = table.columnStyles ?? [];
  if (styles.length === 0) return computeColumnWidths(table.columnCount, contentWidth);
  const widths = Array.from({ length: table.columnCount }, (_, index) => cssLengthPt(styles[index]?.["width"], contentWidth));
  const fixedTotal = widths.reduce((sum, value) => sum + (value ?? 0), 0);
  const missing = widths.filter((value) => value == null).length;
  const remaining = Math.max(0, contentWidth - fixedTotal);
  if (missing === 0 && fixedTotal > 0) {
    const scale = contentWidth / fixedTotal;
    return widths.map((value) => Math.max(1, (value ?? 0) * scale));
  }
  const fallback = missing > 0 ? remaining / missing : 0;
  return widths.map((value) => Math.max(1, value ?? fallback));
}
function plainInlineText(text, inlines, style) {
  const source = inlines.length > 0 ? inlines : [{ text, styles: style }];
  return source.map((segment) => applyTextTransform(segment.text, { ...style, ...segment.styles })).join("");
}
function inlineTextFromSegments(inlines) {
  return inlines.map((segment) => segment.text).join("");
}
function tablePresetDefaults(preset) {
  if (preset === "dense-comparison") {
    return {
      density: "dense",
      fit: "page-width",
      firstColumnWeight: 1.65,
      minFontSize: 6.2,
      maxFontSize: 9,
      verticalAlignMode: "optical",
      cellPagination: "text",
      cellTextAlign: "center",
      headerTextAlign: "center",
      firstColumnTextAlign: "left"
    };
  }
  if (preset === "compact-comparison") {
    return {
      density: "compact",
      fit: "page-width",
      firstColumnWeight: 1.55,
      minFontSize: 6.6,
      maxFontSize: 9.4,
      verticalAlignMode: "optical",
      cellPagination: "text",
      cellTextAlign: "center",
      headerTextAlign: "center",
      firstColumnTextAlign: "left"
    };
  }
  if (preset === "comparison") {
    return {
      density: "normal",
      fit: "page-width",
      firstColumnWeight: 1.45,
      verticalAlignMode: "optical",
      cellPagination: "text",
      cellTextAlign: "center",
      headerTextAlign: "center",
      firstColumnTextAlign: "left"
    };
  }
  return {};
}
function tableOption(ctx, key) {
  const explicit = ctx.options.table?.[key];
  if (explicit !== void 0) return explicit;
  return tablePresetDefaults(ctx.options.table?.preset)[key];
}
function tableDensity(ctx) {
  return tableOption(ctx, "density") ?? "normal";
}
function tableDensityScales(density) {
  if (density === "dense") return { font: 0.88, paddingX: 0.56, paddingY: 0.48, lineGap: 0.09 };
  if (density === "compact") return { font: 0.94, paddingX: 0.74, paddingY: 0.66, lineGap: 0.13 };
  return { font: 1, paddingX: 1, paddingY: 1, lineGap: 0.18 };
}
function clampTableFontSize(ctx, size) {
  const min = tableOption(ctx, "minFontSize");
  const max = tableOption(ctx, "maxFontSize");
  let out = size;
  if (min != null && Number.isFinite(min)) out = Math.max(min, out);
  if (max != null && Number.isFinite(max)) out = Math.min(max, out);
  return out;
}
function applyTableDensity(ctx) {
  const snapshot = {
    baseFontSize: ctx.baseFontSize,
    headerFontSize: ctx.headerFontSize,
    priceFontSize: ctx.priceFontSize,
    sectionFontSize: ctx.sectionFontSize,
    cellPaddingX: ctx.cellPaddingX,
    cellPaddingY: ctx.cellPaddingY
  };
  const scales = tableDensityScales(tableDensity(ctx));
  ctx.baseFontSize = clampTableFontSize(ctx, snapshot.baseFontSize * scales.font);
  ctx.headerFontSize = clampTableFontSize(ctx, snapshot.headerFontSize * scales.font);
  ctx.priceFontSize = clampTableFontSize(ctx, snapshot.priceFontSize * scales.font);
  ctx.sectionFontSize = clampTableFontSize(ctx, snapshot.sectionFontSize * scales.font);
  ctx.cellPaddingX = Math.max(1.2, snapshot.cellPaddingX * scales.paddingX);
  ctx.cellPaddingY = Math.max(1, snapshot.cellPaddingY * scales.paddingY);
  return snapshot;
}
function restoreTableContext(ctx, snapshot) {
  ctx.baseFontSize = snapshot.baseFontSize;
  ctx.headerFontSize = snapshot.headerFontSize;
  ctx.priceFontSize = snapshot.priceFontSize;
  ctx.sectionFontSize = snapshot.sectionFontSize;
  ctx.cellPaddingX = snapshot.cellPaddingX;
  ctx.cellPaddingY = snapshot.cellPaddingY;
}
function tableLineGapForStyle(ctx, style, size) {
  return lineGapForStyle(style, size, tableDensityScales(tableDensity(ctx)).lineGap);
}
function measureCellWidth(ctx, cell, row, contentWidth) {
  if (cell.isSpanPlaceholder) return { min: 0, preferred: 0 };
  const font = fontForCell(ctx, cell, row);
  const size = sizeForCell(ctx, cell, row);
  const padding = cellPadding(ctx, cell);
  const text = plainInlineText(cell.text, cell.inlines, { ...row.styles, ...cell.styles }).replace(/\s+/g, " ").trim();
  ctx.doc.font(font).fontSize(size);
  const lines = text ? text.split(/\n+/) : [""];
  const preferredText = Math.max(0, ...lines.map((line) => safeNumber(ctx.doc.widthOfString(line), 0)));
  const tokens = text.split(/\s+/).filter(Boolean);
  const longestToken = Math.max(0, ...tokens.map((token) => safeNumber(ctx.doc.widthOfString(token), 0)));
  const noWrap = isNoWrapStyle({ ...row.styles, ...cell.styles });
  const ellipsis = wantsEllipsis({ ...row.styles, ...cell.styles });
  const imageWidth = cell.imageSrc ? cssLengthPt(cell.imageStyles?.["width"], contentWidth) ?? Math.min(48, contentWidth) : 0;
  const preferred = Math.max(preferredText, imageWidth) + padding.left + padding.right;
  const min = Math.max(noWrap && !ellipsis ? preferredText : ellipsis ? Math.min(preferredText, 48) : longestToken, imageWidth * 0.65, 18) + padding.left + padding.right;
  return { min, preferred: Math.max(min, preferred) };
}
function normalizeAutoWidths(minWidths, preferredWidths, contentWidth) {
  const minTotal = minWidths.reduce((sum, value) => sum + value, 0);
  const preferredTotal = preferredWidths.reduce((sum, value) => sum + value, 0);
  if (preferredTotal <= 0) return computeColumnWidths(minWidths.length, contentWidth);
  if (preferredTotal <= contentWidth) {
    const extra = contentWidth - preferredTotal;
    return preferredWidths.map((value) => Math.max(1, value + extra * (value / preferredTotal)));
  }
  if (minTotal >= contentWidth) {
    const scale = contentWidth / Math.max(1, minTotal);
    return minWidths.map((value) => Math.max(1, value * scale));
  }
  const shrinkable = Math.max(1, preferredTotal - minTotal);
  const ratio = (contentWidth - minTotal) / shrinkable;
  return preferredWidths.map((preferred, index) => minWidths[index] + (preferred - minWidths[index]) * ratio);
}
function weightedFirstColumnWidths(columnCount, contentWidth, firstColumnWeight) {
  if (columnCount <= 1) return [contentWidth];
  const weight = Number.isFinite(firstColumnWeight) ? clamp(firstColumnWeight, 0.5, 4) : 1;
  const unit = contentWidth / (weight + columnCount - 1);
  return [unit * weight, ...Array.from({ length: columnCount - 1 }, () => unit)];
}
function weightedColumnWidths(columnCount, contentWidth, weights) {
  const normalized = Array.from({ length: columnCount }, (_, index) => {
    const value = weights[index] ?? 1;
    return Number.isFinite(value) ? clamp(value, 0.1, 10) : 1;
  });
  const total = normalized.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return computeColumnWidths(columnCount, contentWidth);
  return normalized.map((weight) => contentWidth * weight / total);
}
function generatedColumnWidths(ctx, columnCount, contentWidth, fallbackWidths) {
  const configuredWeights = tableOption(ctx, "columnWeights");
  if (configuredWeights?.length) return weightedColumnWidths(columnCount, contentWidth, configuredWeights);
  const firstColumnWeight = tableOption(ctx, "firstColumnWeight");
  if (firstColumnWeight != null && Number.isFinite(firstColumnWeight) && columnCount > 1) {
    return weightedFirstColumnWidths(columnCount, contentWidth, firstColumnWeight);
  }
  return fallbackWidths;
}
function computeAutoColumnWidths(ctx, table, contentWidth) {
  const minWidths = Array.from({ length: table.columnCount }, () => 18);
  const preferredWidths = Array.from({ length: table.columnCount }, () => 24);
  for (const row of [...table.headRows, ...table.bodyRows]) {
    let col = 0;
    for (const cell of row.cells) {
      const span = Math.max(1, cell.colspan);
      if (!cell.isSpanPlaceholder && row.kind !== "section") {
        const measured = measureCellWidth(ctx, cell, row, contentWidth);
        const shareMin = measured.min / span;
        const sharePreferred = measured.preferred / span;
        for (let i = col; i < Math.min(table.columnCount, col + span); i++) {
          minWidths[i] = Math.max(minWidths[i], shareMin);
          preferredWidths[i] = Math.max(preferredWidths[i], sharePreferred);
        }
      }
      col += span;
    }
  }
  return normalizeAutoWidths(minWidths, preferredWidths, contentWidth);
}
function computeTableColumnWidths(ctx, table, contentWidth, style) {
  if ((table.columnStyles?.length ?? 0) > 0) return computeColumnWidthsFromStyles(table, contentWidth);
  if (style.layout === "fixed") return generatedColumnWidths(ctx, table.columnCount, contentWidth, Array.from({ length: table.columnCount }, () => contentWidth / table.columnCount));
  const autoWidths = computeAutoColumnWidths(ctx, table, contentWidth);
  return tableOption(ctx, "fit") === "page-width" ? generatedColumnWidths(ctx, table.columnCount, contentWidth, autoWidths) : autoWidths;
}
function fontForCell(ctx, cell, row) {
  const defaultBold = row.kind === "header" || row.kind === "price" || row.kind === "section" || cell.isParam;
  const style = { ...row.styles, ...cell.styles };
  const text = plainInlineText(cell.text, cell.inlines, style);
  return fontForStyle(ctx, style, defaultBold ? ctx.boldFontName : ctx.regularFontName, text, defaultBold);
}
function sizeForCell(ctx, cell, row) {
  const cssSize = cssLengthPt(cell.styles["font-size"]) ?? cssLengthPt(row.styles["font-size"]);
  if (cssSize) return cssSize;
  if (row.kind === "section") return ctx.sectionFontSize;
  if (row.kind === "header") return ctx.headerFontSize;
  if (row.kind === "price") return ctx.priceFontSize;
  if (cell.isParam) return ctx.baseFontSize * 0.98;
  return ctx.baseFontSize;
}
function cellBlockFontSize(block, fallbackSize) {
  if (block.type === "heading") {
    const defaults = { 1: 18, 2: 16, 3: 14, 4: 12, 5: 10.5, 6: 10 };
    return cssLengthPt(block.style["font-size"]) ?? defaults[block.level] ?? fallbackSize;
  }
  return cssLengthPt(block.style["font-size"]) ?? fallbackSize;
}
function cellBlockMargin(block) {
  const fallback = block.type === "heading" ? { top: 0, right: 0, bottom: 6, left: 0 } : block.type === "text" ? { top: 0, right: 0, bottom: 4, left: 0 } : block.type === "image" ? { top: 0, right: 0, bottom: 6, left: 0 } : { top: 0, right: 0, bottom: 0, left: 0 };
  return spacingPt(block.style, "margin", fallback);
}
function cellBlockPadding(block) {
  return spacingPt(block.style, "padding", { top: 0, right: 0, bottom: 0, left: 0 });
}
function cellBlockBorder(block) {
  return borderPxToPt(parseBorderStyle(block.style, { width: 0, color: COLORS.border, style: "solid" }));
}
function isAbsoluteBlock(block) {
  return (block.style["position"] ?? "").trim().toLowerCase() === "absolute";
}
function cellBlockAlign(style) {
  const align = (style["text-align"] ?? "").trim().toLowerCase();
  return align === "center" || align === "right" ? align : "left";
}
function cellBlockVerticalAlign(style) {
  const align = (style["vertical-align"] ?? style["align-items"] ?? "").trim().toLowerCase();
  if (align === "middle" || align === "center") return "middle";
  if (align === "bottom" || align === "end" || align === "flex-end") return "bottom";
  return "top";
}
function richBlockTextWidth(ctx, block, fallbackFont, fallbackSize) {
  const size = cellBlockFontSize(block, fallbackSize);
  const font = fontForStyle(ctx, block.style, block.type === "heading" ? ctx.boldFontName : fallbackFont, block.text, block.type === "heading");
  const inlines = block.inlines.length > 0 ? block.inlines : [{ text: block.text, styles: block.style }];
  let width = 0;
  for (const segment of inlines) {
    ctx.doc.font(inlineFont(ctx, segment, font)).fontSize(inlineSize(segment, size));
    width += safeNumber(ctx.doc.widthOfString(applyTextTransform(segment.text, segment.styles)), 0);
  }
  return width;
}
function estimateRichImageHeight(ctx, block, width) {
  const margin = cellBlockMargin(block);
  const cssWidth = cssLengthPt(block.style["width"], width);
  const cssHeight = cssLengthPt(block.style["height"], ctx.contentBottom - ctx.contentTop);
  if (cssHeight != null) return margin.top + cssHeight + margin.bottom;
  if (cssWidth != null) return margin.top + Math.min(cssWidth * 0.58, ctx.contentBottom - ctx.contentTop) + margin.bottom;
  return margin.top + Math.min(90, width * 0.52) + margin.bottom;
}
function estimateRichBlockHeight(ctx, block, width, fallbackFont, fallbackSize) {
  if (isAbsoluteBlock(block)) return 0;
  const margin = cellBlockMargin(block);
  const padding = cellBlockPadding(block);
  const border = cellBlockBorder(block);
  const availableWidth = Math.max(8, width - margin.left - margin.right);
  const explicitWidth = cssLengthPt(block.style["width"], availableWidth);
  const boxWidth = Math.max(8, explicitWidth ?? availableWidth);
  const explicitHeight = styleBoxHeight(block.style, ctx.contentBottom - ctx.contentTop);
  if (block.type === "image") {
    return explicitHeight != null ? margin.top + explicitHeight + margin.bottom : estimateRichImageHeight(ctx, block, availableWidth);
  }
  if (block.type === "box") {
    if (explicitHeight != null) return margin.top + explicitHeight + margin.bottom;
    const innerWidth = Math.max(8, boxWidth - padding.left - padding.right - border.width * 2);
    const childHeight = block.blocks.reduce((sum, child) => sum + estimateRichBlockHeight(ctx, child, innerWidth, fallbackFont, fallbackSize), 0);
    return margin.top + childHeight + padding.top + padding.bottom + border.width * 2 + margin.bottom;
  }
  const size = cellBlockFontSize(block, fallbackSize);
  const font = fontForStyle(ctx, block.style, block.type === "heading" ? ctx.boldFontName : fallbackFont, block.text, block.type === "heading");
  const contentWidth = Math.max(8, boxWidth - padding.left - padding.right - border.width * 2);
  const lineGap = tableLineGapForStyle(ctx, block.style, size);
  const noWrap = isNoWrapStyle(block.style);
  const displayInlines = displayInlineSegments(ctx, block.text, block.inlines, font, size, contentWidth, block.style);
  const textHeightValue = inlineTextHeight(ctx, block.text, displayInlines, font, size, contentWidth, lineGap, noWrap);
  return margin.top + (explicitHeight ?? textHeightValue + padding.top + padding.bottom + border.width * 2) + margin.bottom;
}
function estimateRichCellHeight(ctx, cell, width, fallbackFont, fallbackSize) {
  if (!cell.richBlocks?.length) return 0;
  return cell.richBlocks.reduce((sum, block) => sum + estimateRichBlockHeight(ctx, block, width, fallbackFont, fallbackSize), 0);
}
function drawRichBlockBox(ctx, style, x, y, width, height, border, padding) {
  const radius = boxRadiusPt(style, width, height);
  drawBoxShadow(ctx, style, x, y, width, height, maxBoxRadius(radius));
  const bg = parseCssColor(style["background-color"]);
  if (bg) fillBox(ctx, x, y, width, height, bg, radius);
  strokeBox(ctx, x, y, width, height, border, radius);
  return {
    topLeft: Math.max(0, radius.topLeft - Math.max(padding.left, padding.top)),
    topRight: Math.max(0, radius.topRight - Math.max(padding.right, padding.top)),
    bottomRight: Math.max(0, radius.bottomRight - Math.max(padding.right, padding.bottom)),
    bottomLeft: Math.max(0, radius.bottomLeft - Math.max(padding.left, padding.bottom))
  };
}
function absoluteRichBlockRect(ctx, block, containerX, containerY, containerWidth, containerHeight, fallbackFont, fallbackSize) {
  const margin = cellBlockMargin(block);
  const padding = cellBlockPadding(block);
  const border = cellBlockBorder(block);
  const left = cssLengthPt(block.style["left"], containerWidth);
  const right = cssLengthPt(block.style["right"], containerWidth);
  const top = cssLengthPt(block.style["top"], containerHeight);
  const bottom = cssLengthPt(block.style["bottom"], containerHeight);
  let width = cssLengthPt(block.style["width"], containerWidth - margin.left - margin.right);
  let height = styleBoxHeight(block.style, containerHeight);
  if (block.type === "text" || block.type === "heading") {
    width ??= richBlockTextWidth(ctx, block, fallbackFont, fallbackSize) + padding.left + padding.right + border.width * 2;
  } else {
    width ??= Math.max(12, containerWidth - margin.left - margin.right);
  }
  height ??= estimateRichBlockHeight(ctx, { ...block, style: { ...block.style, position: "static" } }, Math.max(12, width), fallbackFont, fallbackSize);
  height = Math.max(1, height - margin.top - margin.bottom);
  const x = left != null ? containerX + left + margin.left : right != null ? containerX + containerWidth - right - width - margin.right : containerX + margin.left;
  const y = top != null ? containerY + top + margin.top : bottom != null ? containerY + containerHeight - bottom - height - margin.bottom : containerY + margin.top;
  return { x, y, width: Math.max(1, width), height: Math.max(1, height) };
}
async function drawRichBlock(ctx, block, x, y, width, containerHeight, fallbackFont, fallbackSize, fallbackColor) {
  const margin = cellBlockMargin(block);
  const padding = cellBlockPadding(block);
  const border = cellBlockBorder(block);
  const availableWidth = Math.max(8, width - margin.left - margin.right);
  const explicitWidth = cssLengthPt(block.style["width"], availableWidth);
  const boxWidth = Math.max(8, Math.min(availableWidth, explicitWidth ?? availableWidth));
  const drawX = cellBlockAlign(block.style) === "center" ? x + margin.left + (availableWidth - boxWidth) / 2 : cellBlockAlign(block.style) === "right" ? x + width - margin.right - boxWidth : x + margin.left;
  const drawY = y + margin.top;
  const estimatedHeight = Math.max(1, estimateRichBlockHeight(ctx, block, width, fallbackFont, fallbackSize) - margin.top - margin.bottom);
  const explicitHeight = styleBoxHeight(block.style, containerHeight);
  const boxHeight = Math.max(1, explicitHeight ?? estimatedHeight);
  if (block.type === "image") {
    const asset = await getAsset(ctx, block.src);
    if (asset) drawAssetInBox(ctx, asset, drawX, drawY, boxWidth, boxHeight, block.style, 1, "cell rich image");
    return margin.top + boxHeight + margin.bottom;
  }
  const outerRadius = boxRadiusPt(block.style, boxWidth, boxHeight);
  const contentRadius = drawRichBlockBox(ctx, block.style, drawX, drawY, boxWidth, boxHeight, border, padding);
  await drawBackgroundImage(ctx, block.style, drawX, drawY, boxWidth, boxHeight, borderRadiusPt(block.style, boxWidth, boxHeight));
  if (block.type === "box") {
    const innerX = drawX + border.width + padding.left;
    const innerY = drawY + border.width + padding.top;
    const innerWidth = Math.max(8, boxWidth - border.width * 2 - padding.left - padding.right);
    const innerHeight = Math.max(1, boxHeight - border.width * 2 - padding.top - padding.bottom);
    ctx.doc.save();
    if (isOverflowHidden(block.style) || maxBoxRadius(outerRadius) > 0) clipBox(ctx, drawX, drawY, boxWidth, boxHeight, outerRadius);
    await drawRichBlocks(ctx, block.blocks.filter((child) => !isAbsoluteBlock(child)), innerX, innerY, innerWidth, innerHeight, fallbackFont, fallbackSize, fallbackColor);
    for (const child of block.blocks.filter(isAbsoluteBlock)) {
      const rect = absoluteRichBlockRect(ctx, child, drawX, drawY, boxWidth, boxHeight, fallbackFont, fallbackSize);
      await drawRichBlock(ctx, { ...child, style: { ...child.style, position: "static" } }, rect.x, rect.y, rect.width, rect.height, fallbackFont, fallbackSize, fallbackColor);
    }
    ctx.doc.restore();
    return margin.top + boxHeight + margin.bottom;
  }
  const size = cellBlockFontSize(block, fallbackSize);
  const font = fontForStyle(ctx, block.style, block.type === "heading" ? ctx.boldFontName : fallbackFont, block.text, block.type === "heading");
  const textColor = parseCssColor(block.style["color"]) ?? fallbackColor;
  const contentX = drawX + border.width + padding.left;
  const contentY = drawY + border.width + padding.top;
  const contentWidth = Math.max(8, boxWidth - border.width * 2 - padding.left - padding.right);
  const contentHeight = Math.max(1, boxHeight - border.width * 2 - padding.top - padding.bottom);
  const lineGap = tableLineGapForStyle(ctx, block.style, size);
  const noWrap = isNoWrapStyle(block.style);
  const displayInlines = displayInlineSegments(ctx, block.text, block.inlines, font, size, contentWidth, block.style);
  const textHeightValue = inlineTextHeight(ctx, block.text, displayInlines, font, size, contentWidth, lineGap, noWrap);
  const textY = verticalContentY(contentY, contentHeight, textHeightValue, cellBlockVerticalAlign(block.style));
  ctx.doc.save();
  if (isOverflowHidden(block.style) || maxBoxRadius(contentRadius) > 0) clipBox(ctx, contentX, contentY, contentWidth, contentHeight, contentRadius);
  drawInlineText(ctx, block.text, displayInlines, contentX, textY, contentWidth, font, size, textColor, lineGap, cellBlockAlign(block.style), noWrap);
  ctx.doc.restore();
  return margin.top + boxHeight + margin.bottom;
}
async function drawRichBlocks(ctx, blocks, x, y, width, height, fallbackFont, fallbackSize, fallbackColor) {
  let cursorY = y;
  for (const block of blocks) {
    cursorY += await drawRichBlock(ctx, block, x, cursorY, width, Math.max(1, height - (cursorY - y)), fallbackFont, fallbackSize, fallbackColor);
  }
  return cursorY - y;
}
function styleBoxHeight(styles, base) {
  const height = cssLengthPt(styles["height"], base);
  const minHeight = cssLengthPt(styles["min-height"], base);
  const values = [height, minHeight].filter((value) => value != null && Number.isFinite(value));
  return values.length ? Math.max(...values) : void 0;
}
function cellVerticalAlign(cell, row) {
  const raw = (cell.styles["vertical-align"] ?? row.styles["vertical-align"] ?? "").trim().toLowerCase();
  if (raw === "middle" || raw === "center") return "middle";
  if (raw === "bottom") return "bottom";
  return "top";
}
function verticalContentY(y, contentHeight, itemHeight, align) {
  if (align === "bottom") return y + Math.max(0, contentHeight - itemHeight);
  if (align === "middle") return y + Math.max(0, (contentHeight - itemHeight) / 2);
  return y;
}
function opticalVerticalContentY(y, contentHeight, metrics, align) {
  if (align !== "middle" || metrics.lineCount === 0) return verticalContentY(y, contentHeight, safeNumber(metrics.layoutHeight, 0), align);
  const ws = Math.max(0, contentHeight - safeNumber(metrics.visualHeight, 0));
  const visualH = safeNumber(metrics.visualHeight, 0);
  const opticalBias = ws > visualH ? ws * 0.04 : 0;
  const opticalY = y + ws / 2 - opticalBias - safeNumber(metrics.baselineOffsetTop, 0);
  return safeNumber(Math.max(y, Math.min(y + Math.max(0, contentHeight - safeNumber(metrics.layoutHeight, 0)), opticalY)), y);
}
function tableTextBlockMetrics(ctx, inlines, font, size, width, lineGap, noWrap, color) {
  const items = inlineLayoutItems(ctx, inlines, font, size, color, noWrap);
  const lines = layoutInlineLines(ctx, items, width, noWrap);
  return { lines, metrics: measureInlineLines(ctx, lines, lineGap) };
}
function hasExplicitBlockHeight(block) {
  return block.style["height"] != null || block.style["min-height"] != null;
}
function hasAtomicRichContent(blocks) {
  return blocks.some((block) => {
    if (isAbsoluteBlock(block) || hasExplicitBlockHeight(block) || block.type === "image") return true;
    if (block.type === "box") return hasAtomicRichContent(block.blocks);
    return false;
  });
}
function hasSplittableRichTextBlock(blocks) {
  return blocks.some((block) => {
    if (isAbsoluteBlock(block) || block.type === "image") return false;
    if (block.type === "text" || block.type === "heading") return Boolean(block.text || block.inlines.length > 0);
    return hasSplittableRichTextBlock(block.blocks);
  });
}
function flattenRichBlocksForPagination(blocks, inherited = {}) {
  const output = [];
  const pushBreak = () => {
    if (output.length === 0) return;
    const previous = output[output.length - 1];
    if (!previous?.text.endsWith("\n")) output.push({ text: "\n", styles: inherited });
  };
  for (const block of blocks) {
    if (isAbsoluteBlock(block) || block.type === "image") continue;
    const style = { ...inherited, ...block.style };
    if (block.type === "box") {
      const nested = flattenRichBlocksForPagination(block.blocks, style);
      if (nested.length > 0) {
        pushBreak();
        output.push(...nested);
        pushBreak();
      }
      continue;
    }
    const source = block.inlines.length > 0 ? block.inlines : [{ text: block.text, styles: block.style }];
    pushBreak();
    for (const segment of source) output.push({ ...segment, styles: { ...style, ...segment.styles } });
    pushBreak();
  }
  while (output.length > 0 && output[0]?.text === "\n") output.shift();
  while (output.length > 0 && output[output.length - 1]?.text === "\n") output.pop();
  return output;
}
function minimumRowHeight(ctx, row) {
  const rowHeight = styleBoxHeight(row.styles, ctx.contentBottom - ctx.contentTop);
  if (row.kind === "section") return Math.max(rowHeight ?? 0, 24 * ctx.paddingScale + 10);
  const naturalLine = ctx.baseFontSize * 1.4 + ctx.cellPaddingY * 2;
  const legacyFloor = tableDensity(ctx) === "normal" ? 22 + 8 * ctx.paddingScale : 0;
  const base = row.kind === "header" ? Math.max(naturalLine * 2, calculateHeaderCellHeight(ctx.columns) * 0.62) : row.kind === "price" ? Math.max(naturalLine, 24 + 8 * ctx.paddingScale) : Math.max(naturalLine, legacyFloor);
  return Math.max(base, rowHeight ?? 0);
}
function takeLineFragment(lines, start, maxHeight, lineGap, forceOne) {
  let end = start;
  let height = 0;
  while (end < lines.length) {
    const next = lines[end];
    const nextHeight = height + (end > start ? lineGap : 0) + next.height;
    if (nextHeight > maxHeight && end > start) break;
    if (nextHeight > maxHeight && !forceOne) break;
    height = nextHeight;
    end += 1;
    if (nextHeight > maxHeight) break;
  }
  return { end, height };
}
function normalizedTextAlign(value) {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "center" || normalized === "right" || normalized === "left" ? normalized : void 0;
}
function cellTextAlign(ctx, cell, row, col = 0) {
  const explicit = normalizedTextAlign(cell.styles["text-align"]) ?? normalizedTextAlign(row.styles["text-align"]);
  if (explicit) return explicit;
  if (row.kind === "header" || cell.isHeader) return tableOption(ctx, "headerTextAlign") ?? "left";
  if (col === 0) return tableOption(ctx, "firstColumnTextAlign") ?? tableOption(ctx, "cellTextAlign") ?? "left";
  return tableOption(ctx, "cellTextAlign") ?? "left";
}
function estimatedCellImageHeight(ctx, cell, contentWidth) {
  if (!cell.imageSrc) return 0;
  const styles = cell.imageStyles ?? {};
  const explicitHeight = cssLengthPt(styles["height"], ctx.contentBottom - ctx.contentTop);
  if (explicitHeight != null) return explicitHeight;
  const explicitWidth = cssLengthPt(styles["width"], contentWidth);
  if (explicitWidth != null) return Math.min(explicitWidth, (ctx.contentBottom - ctx.contentTop) * 0.5);
  return Math.min(36, contentWidth);
}
function estimateRowHeight(ctx, row, capToPage = true) {
  let height = minimumRowHeight(ctx, row);
  if (row.kind === "section") return height;
  let col = 0;
  for (const cell of row.cells) {
    if (cell.isSpanPlaceholder) {
      col += Math.max(1, cell.colspan);
      continue;
    }
    const span = Math.max(1, cell.colspan);
    const width = ctx.columnWidths.slice(col, col + span).reduce((sum, value) => sum + value, 0);
    const font = fontForCell(ctx, cell, row);
    const size = sizeForCell(ctx, cell, row);
    const padding = cellPadding(ctx, cell);
    const lineGap = tableLineGapForStyle(ctx, { ...row.styles, ...cell.styles }, size);
    const contentWidth = Math.max(12, width - padding.left - padding.right);
    const cellTextStyle = { ...row.styles, ...cell.styles };
    const noWrap = isNoWrapStyle(cellTextStyle);
    const richContentHeight = cell.richBlocks?.length ? estimateRichCellHeight(ctx, cell, contentWidth, font, size) : 0;
    const textContentHeight = !cell.richBlocks?.length && (cell.text || cell.inlines.length > 0) ? inlineTextHeight(ctx, cell.text, cell.inlines, font, size, contentWidth, lineGap, noWrap) : 0;
    const imageContentHeight = !cell.richBlocks?.length ? estimatedCellImageHeight(ctx, cell, contentWidth) : 0;
    const cssCellHeight = styleBoxHeight(cell.styles, ctx.contentBottom - ctx.contentTop);
    height = safeNumber(Math.max(height, richContentHeight + padding.top + padding.bottom, textContentHeight + padding.top + padding.bottom, imageContentHeight + padding.top + padding.bottom, cssCellHeight ?? 0), height);
    col += span;
  }
  const safeHeight = safeNumber(height, minimumRowHeight(ctx, row));
  return capToPage ? Math.min(safeHeight, ctx.contentBottom - ctx.contentTop - 8) : safeHeight;
}
async function drawRow(ctx, row, index, fragment, groupHeight) {
  const height = fragment?.height ?? estimateRowHeight(ctx, row);
  const y = ctx.y;
  if (row.kind === "section") {
    const sectionCell = row.cells.find((cell) => cell.text) ?? row.cells[0];
    const text = sectionCell?.text ?? "";
    const sectionPadding = sectionCell ? cellPadding(ctx, sectionCell) : { top: ctx.cellPaddingY, right: ctx.cellPaddingX, bottom: ctx.cellPaddingY, left: ctx.cellPaddingX };
    const sectionStyle = { ...row.styles, ...sectionCell?.styles ?? {} };
    const fill = parseCssColor(sectionStyle["background-color"]) ?? COLORS.sectionBg;
    const textColor = parseCssColor(sectionStyle["color"]) ?? COLORS.sectionText;
    const radius = sectionCell ? borderRadiusPt(sectionCell.styles, ctx.tableWidth, height) : 0;
    if (fill) fillBox(ctx, ctx.margin, y, ctx.tableWidth, height, fill, radius);
    const sectionAlign = sectionCell ? cellVerticalAlign(sectionCell, row) : "middle";
    const sectionWidth = Math.max(12, ctx.tableWidth - sectionPadding.left - sectionPadding.right);
    const sectionSize = sizeForCell(ctx, sectionCell ?? row.cells[0], row);
    const sectionFont = sectionCell ? fontForCell(ctx, sectionCell, row) : fontForStyle(ctx, sectionStyle, ctx.boldFontName, text, true);
    const sectionLineGap = tableLineGapForStyle(ctx, sectionStyle, sectionSize);
    const sectionInlines = sectionCell?.inlines ?? [{ text, styles: sectionStyle }];
    const sectionTextHeight = inlineTextHeight(ctx, text, sectionInlines, sectionFont, sectionSize, sectionWidth, sectionLineGap);
    const textAlign = sectionStyle["text-align"] === "center" || sectionStyle["text-align"] === "right" ? sectionStyle["text-align"] : "left";
    drawInlineText(
      ctx,
      text,
      sectionInlines,
      ctx.margin + sectionPadding.left,
      verticalContentY(y + sectionPadding.top, Math.max(1, height - sectionPadding.top - sectionPadding.bottom), sectionTextHeight, sectionAlign),
      sectionWidth,
      sectionFont,
      sectionSize,
      textColor,
      sectionLineGap,
      textAlign
    );
    ctx.y = y + height;
    return;
  }
  let x = ctx.margin;
  let col = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    const width = ctx.columnWidths.slice(col, col + span).reduce((sum, value) => sum + value, 0);
    if (cell.isSpanPlaceholder) {
      x += width;
      col += span;
      continue;
    }
    const padding = cellPadding(ctx, cell);
    const border = cellBorders(ctx, cell);
    const cellH = cell.rowspan > 1 && groupHeight != null && !fragment ? Math.min(groupHeight, Math.max(height, ctx.contentBottom - y)) : height;
    const radius = borderRadiusPt(cell.styles, width, cellH);
    const cellFragment = fragment?.cells.get(col);
    const fill = cell.isDiff ? parseCssColor(cell.styles["background-color"]) ?? COLORS.diffBg : row.kind === "header" || row.kind === "price" ? parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? COLORS.headerBg : cell.isParam ? parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? COLORS.paramBg : row.kind === "body" && index % 2 === 1 ? parseCssColor(row.styles["background-color"]) ?? COLORS.evenBg : parseCssColor(cell.styles["background-color"]) ?? parseCssColor(row.styles["background-color"]) ?? null;
    drawBoxShadow(ctx, cell.styles, x, y, width, cellH, radius);
    if (fill) fillBox(ctx, x, y, width, cellH, fill, radius);
    await drawBackgroundImage(ctx, cell.styles, x, y, width, cellH, radius);
    const borderCell = fragment && cell.rowspan > 1 ? { ...cell, rowspan: 1 } : cell;
    strokeCellBorder(ctx, borderCell, x, y, width, cellH, border);
    const font = fontForCell(ctx, cell, row);
    const size = sizeForCell(ctx, cell, row);
    const align = cellTextAlign(ctx, cell, row, col);
    const verticalAlign = cellFragment?.forceTopAlign ? "top" : cellVerticalAlign(cell, row);
    const contentX = x + padding.left;
    const contentY = y + padding.top;
    const contentWidth = Math.max(12, width - padding.left - padding.right);
    const contentHeight = Math.max(8, cellH - padding.top - padding.bottom);
    const textColor = parseCssColor(cell.styles["color"]) ?? parseCssColor(row.styles["color"]) ?? COLORS.text;
    if (cell.richBlocks?.length) {
      if (cellFragment && cellFragment.lineEnd > cellFragment.lineStart) {
        const textY2 = verticalContentY(contentY, contentHeight, cellFragment.textHeight, "top");
        ctx.doc.save();
        const contentRadius3 = isOverflowHidden(cell.styles) || radius > 0 ? Math.max(0, radius - Math.max(padding.left, padding.top)) : 0;
        clipBox(ctx, contentX, contentY, contentWidth, contentHeight, contentRadius3);
        drawInlineLayoutLines(ctx, cellFragment.lines.slice(cellFragment.lineStart, cellFragment.lineEnd), contentX, textY2, contentWidth, cellFragment.align, cellFragment.lineGap);
        ctx.doc.restore();
        x += width;
        col += span;
        continue;
      }
      if (fragment && !cellFragment?.drawFirstOnlyContent) {
        x += width;
        col += span;
        continue;
      }
      const richHeight = estimateRichCellHeight(ctx, cell, contentWidth, font, size);
      const richY = verticalContentY(contentY, contentHeight, richHeight, verticalAlign);
      ctx.doc.save();
      const contentRadius2 = isOverflowHidden(cell.styles) || radius > 0 ? Math.max(0, radius - Math.max(padding.left, padding.top)) : 0;
      clipBox(ctx, contentX, contentY, contentWidth, contentHeight, contentRadius2);
      await drawRichBlocks(ctx, cell.richBlocks, contentX, richY, contentWidth, contentHeight, font, size, textColor);
      ctx.doc.restore();
      x += width;
      col += span;
      continue;
    }
    if (cell.imageSrc) {
      const asset = !fragment || cellFragment?.drawFirstOnlyContent ? await getAsset(ctx, cell.imageSrc) : null;
      if (asset) {
        const imageStyles = { ...cell.imageStyles ?? {} };
        if (!imageStyles["object-position"]) {
          const objectX = align === "right" ? "right" : align === "center" ? "center" : "left";
          const objectY = verticalAlign === "bottom" ? "bottom" : verticalAlign === "middle" ? "center" : "top";
          imageStyles["object-position"] = `${objectX} ${objectY}`;
        }
        drawAssetInBox(ctx, asset, contentX, contentY, contentWidth, contentHeight, imageStyles, 1, "cell image");
      }
    }
    if (fragment && !cellFragment) {
      x += width;
      col += span;
      continue;
    }
    const cellTextStyle = { ...row.styles, ...cell.styles };
    const noWrap = isNoWrapStyle(cellTextStyle);
    const lineGap = tableLineGapForStyle(ctx, cellTextStyle, size);
    const displayInlines = displayInlineSegments(ctx, cell.text, cell.inlines, font, size, contentWidth, cellTextStyle);
    const opticalText = !cellFragment && tableOption(ctx, "verticalAlignMode") === "optical";
    const textLayout = opticalText ? tableTextBlockMetrics(ctx, displayInlines, font, size, contentWidth, lineGap, noWrap, textColor) : void 0;
    const textBlockHeight = cellFragment ? cellFragment.textHeight : (textLayout && Number.isFinite(textLayout.metrics.layoutHeight) ? textLayout.metrics.layoutHeight : null) ?? inlineTextHeight(ctx, cell.text, displayInlines, font, size, contentWidth, lineGap, noWrap);
    const textY = textLayout ? opticalVerticalContentY(contentY, contentHeight, textLayout.metrics, verticalAlign) : verticalContentY(contentY, contentHeight, textBlockHeight, verticalAlign);
    ctx.doc.save();
    const contentRadius = isOverflowHidden(cell.styles) || radius > 0 ? Math.max(0, radius - Math.max(padding.left, padding.top)) : 0;
    clipBox(ctx, contentX, contentY, contentWidth, contentHeight, contentRadius);
    if (cellFragment) {
      drawInlineLayoutLines(ctx, cellFragment.lines.slice(cellFragment.lineStart, cellFragment.lineEnd), contentX, textY, contentWidth, cellFragment.align, cellFragment.lineGap);
    } else if (textLayout) {
      drawInlineLayoutLines(ctx, textLayout.lines, contentX, textY, contentWidth, align, lineGap);
    } else {
      drawInlineText(ctx, cell.text, displayInlines, contentX, textY, contentWidth, font, size, textColor, lineGap, align, noWrap);
    }
    ctx.doc.restore();
    x += width;
    col += span;
  }
  ctx.y = safeNumber(y + height, y + minimumRowHeight(ctx, row));
  if (ctx.options.watermarkAvoidHeader && (row.kind === "header" || row.kind === "price")) {
    ctx.watermarkClipTop = ctx.y;
  }
}
function rowHasBreakInsideAvoid(row) {
  const value = (row.styles["break-inside"] ?? row.styles["page-break-inside"] ?? "").trim().toLowerCase();
  return value === "avoid" || value === "avoid-page";
}
function groupRowsByRowspan(ctx, rows) {
  const groups = [];
  for (let i = 0; i < rows.length; ) {
    let end = rows[i]?.kind === "section" && i + 1 < rows.length ? i + 1 : i;
    let hasRowspan = false;
    for (let scan = i; scan <= end && scan < rows.length; scan++) {
      const row = rows[scan];
      for (const cell of row.cells) {
        if (!cell.isSpanPlaceholder && cell.rowspan > 1) {
          hasRowspan = true;
          end = Math.max(end, scan + cell.rowspan - 1);
        }
      }
    }
    const groupRows = rows.slice(i, Math.min(rows.length, end + 1));
    const height = groupRows.reduce((sum, row) => sum + safeNumber(estimateRowHeight(ctx, row, false), minimumRowHeight(ctx, row)), 0);
    groups.push({ rows: groupRows, startIndex: i, height, hasRowspan });
    i = end + 1;
  }
  return groups;
}
function rowsHeight(ctx, rows, capToPage = true) {
  return rows.reduce((sum, row) => sum + estimateRowHeight(ctx, row, capToPage), 0);
}
async function drawRepeatedHeaders(ctx, headers, repeat) {
  if (!repeat) return;
  for (const header of headers) await drawRow(ctx, header, -1);
}
function freshPageBodyHeight(ctx, headers, repeat) {
  return Math.max(0, ctx.contentBottom - ctx.contentTop - (repeat ? rowsHeight(ctx, headers) : 0));
}
function rowHasUnsupportedCellPaginationSpan(ctx, row) {
  const allowRowspanContinuation = tableOption(ctx, "cellPagination") !== "off" && ctx.options.table?.rowspanPagination === "split";
  return row.cells.some((cell) => (cell.rowspan > 1 || cell.isSpanPlaceholder) && !allowRowspanContinuation);
}
function isSplittableTextCell(ctx, cell) {
  if (cell.isSpanPlaceholder || cell.imageSrc) return false;
  if (!cell.richBlocks?.length) return Boolean(cell.text || cell.inlines.length > 0);
  return tableOption(ctx, "cellPagination") === "rich-text" && hasSplittableRichTextBlock(cell.richBlocks);
}
function canPaginateRowCells(ctx, row, rawHeight, freshBodyHeightValue, index) {
  const mode = tableOption(ctx, "cellPagination") ?? "off";
  if (mode === "off") return false;
  if (row.kind === "section" || rowHasBreakInsideAvoid(row)) return false;
  if (rawHeight <= freshBodyHeightValue) return false;
  if (rowHasUnsupportedCellPaginationSpan(ctx, row)) {
    ctx.warnings.add("table_cell_pagination_rowspan_unsupported", `Table row ${index + 1} is taller than a page and belongs to a rowspan group; set table.rowspanPagination to "split" to allow cell text fragments inside the group, otherwise the existing grouped rowspan behavior is preserved.`);
    return false;
  }
  if (mode === "rich-text" && row.cells.some((cell) => cell.imageSrc || cell.richBlocks?.length && hasAtomicRichContent(cell.richBlocks))) {
    ctx.warnings.add("table_cell_pagination_rich_content_unsupported", `Table row ${index + 1} contains image, fixed-height, or positioned rich content; rich-text pagination splits structural text and keeps atomic rich blocks whole.`);
  }
  return row.cells.some((cell) => isSplittableTextCell(ctx, cell));
}
function cellTextLayout(ctx, row, cell, col) {
  const span = Math.max(1, cell.colspan);
  const width = ctx.columnWidths.slice(col, col + span).reduce((sum, value) => sum + value, 0);
  const padding = cellPadding(ctx, cell);
  const contentWidth = Math.max(12, width - padding.left - padding.right);
  const font = fontForCell(ctx, cell, row);
  const size = sizeForCell(ctx, cell, row);
  const style = { ...row.styles, ...cell.styles };
  const noWrap = isNoWrapStyle(style);
  const lineGap = tableLineGapForStyle(ctx, style, size);
  const textColor = parseCssColor(cell.styles["color"]) ?? parseCssColor(row.styles["color"]) ?? COLORS.text;
  const sourceInlines = cell.richBlocks?.length && tableOption(ctx, "cellPagination") === "rich-text" ? flattenRichBlocksForPagination(cell.richBlocks, style) : cell.inlines;
  const sourceText = sourceInlines.length > 0 ? inlineTextFromSegments(sourceInlines) : cell.text;
  const displayInlines = displayInlineSegments(ctx, sourceText, sourceInlines, font, size, contentWidth, style);
  const items = inlineLayoutItems(ctx, displayInlines, font, size, textColor, noWrap);
  const lines = layoutInlineLines(ctx, items, contentWidth, noWrap);
  return {
    lines,
    lineGap,
    cursor: 0,
    align: cellTextAlign(ctx, cell, row, col),
    padding
  };
}
function preparePaginatedTextLayouts(ctx, row) {
  const layouts = /* @__PURE__ */ new Map();
  let col = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    if (isSplittableTextCell(ctx, cell)) {
      layouts.set(col, cellTextLayout(ctx, row, cell, col));
    }
    col += span;
  }
  return layouts;
}
function firstOnlyCellContentHeight(ctx, row, cell, col) {
  if (!cell.richBlocks?.length && !cell.imageSrc) return 0;
  const span = Math.max(1, cell.colspan);
  const width = ctx.columnWidths.slice(col, col + span).reduce((sum, value) => sum + value, 0);
  const padding = cellPadding(ctx, cell);
  const contentWidth = Math.max(12, width - padding.left - padding.right);
  const font = fontForCell(ctx, cell, row);
  const size = sizeForCell(ctx, cell, row);
  const contentHeight = cell.richBlocks?.length ? estimateRichCellHeight(ctx, cell, contentWidth, font, size) : estimatedCellImageHeight(ctx, cell, contentWidth);
  return contentHeight + padding.top + padding.bottom;
}
function firstFragmentWholeBlockHeight(ctx, row, layouts) {
  let col = 0;
  let height = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    const hasWholeBlock = !layouts.has(col) && (cell.imageSrc || cell.richBlocks?.length && !isSplittableTextCell(ctx, cell));
    if (hasWholeBlock) height = Math.max(height, firstOnlyCellContentHeight(ctx, row, cell, col));
    col += span;
  }
  return height;
}
function rowPaginationDone(layouts) {
  for (const layout of layouts.values()) {
    if (layout.cursor < layout.lines.length) return false;
  }
  return true;
}
function rowPaginationCursorTotal(layouts) {
  let total = 0;
  for (const layout of layouts.values()) total += layout.cursor;
  return total;
}
function buildRowFragment(ctx, row, layouts, firstFragment, capacity, index) {
  const cells = /* @__PURE__ */ new Map();
  let height = Math.min(capacity, minimumRowHeight(ctx, row));
  let col = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    const layout = layouts.get(col);
    const padding = cellPadding(ctx, cell);
    if (layout && layout.cursor < layout.lines.length) {
      const contentCapacity = Math.max(1, capacity - layout.padding.top - layout.padding.bottom);
      const forceOne = false;
      const slice = takeLineFragment(layout.lines, layout.cursor, contentCapacity, layout.lineGap, forceOne);
      if (slice.end === layout.cursor) {
        ctx.warnings.add("table_cell_pagination_fragment_too_small", `Table row ${index + 1} had no room for the next text line; forcing a clipped continuation fragment.`);
        ctx.warnings.add("table_cell_pagination_forced_line", `Table row ${index + 1} contains a wrapped line taller than the available fragment; rendering one line in a clipped fragment to guarantee progress.`);
        const forced = takeLineFragment(layout.lines, layout.cursor, contentCapacity, layout.lineGap, true);
        cells.set(col, {
          lineStart: layout.cursor,
          lineEnd: forced.end,
          lines: layout.lines,
          lineGap: layout.lineGap,
          textHeight: forced.height,
          align: layout.align,
          forceTopAlign: true,
          drawFirstOnlyContent: false
        });
        layout.cursor = forced.end;
        height = Math.max(height, Math.min(capacity, forced.height + layout.padding.top + layout.padding.bottom));
      } else {
        const continues = slice.end < layout.lines.length || layout.cursor > 0;
        cells.set(col, {
          lineStart: layout.cursor,
          lineEnd: slice.end,
          lines: layout.lines,
          lineGap: layout.lineGap,
          textHeight: slice.height,
          align: layout.align,
          forceTopAlign: continues,
          drawFirstOnlyContent: false
        });
        layout.cursor = slice.end;
        height = Math.max(height, Math.min(capacity, slice.height + layout.padding.top + layout.padding.bottom));
      }
    } else if (firstFragment && (cell.richBlocks?.length || cell.imageSrc)) {
      const contentHeight = firstOnlyCellContentHeight(ctx, row, cell, col);
      if (contentHeight > capacity) {
        ctx.warnings.add("table_cell_pagination_rich_content_unsupported", `Table row ${index + 1} contains rich/image cell content taller than the current fragment; cell pagination keeps that block whole and clips it as before.`);
        ctx.warnings.add("table_cell_pagination_clipped_block", `Table row ${index + 1} contains an atomic rich/image block taller than the available fragment; the block is clipped because atomic blocks are not sliced.`);
      }
      cells.set(col, {
        lineStart: 0,
        lineEnd: 0,
        lines: [],
        lineGap: 0,
        textHeight: 0,
        align: cellTextAlign(ctx, cell, row, col),
        forceTopAlign: false,
        drawFirstOnlyContent: true
      });
      height = Math.max(height, Math.min(capacity, contentHeight));
    }
    const cssCellHeight = styleBoxHeight(cell.styles, ctx.contentBottom - ctx.contentTop);
    if (cssCellHeight != null) height = Math.max(height, Math.min(capacity, cssCellHeight + padding.top + padding.bottom));
    col += span;
  }
  return { height: Math.max(1, Math.min(capacity, height)), cells };
}
async function drawPaginatedTextRow(ctx, row, index, headers, repeat) {
  const layouts = preparePaginatedTextLayouts(ctx, row);
  if (layouts.size === 0) {
    ctx.warnings.add("table_cell_pagination_no_text", `Table row ${index + 1} is taller than a page, but no plain text cells were available for cellPagination=text.`);
    await drawRowSequentiallyFallback(ctx, row, index, headers, repeat);
    return;
  }
  let firstFragment = true;
  let guard = 0;
  while (!rowPaginationDone(layouts) && guard < 1e3) {
    guard += 1;
    let capacity = ctx.contentBottom - ctx.y;
    if (capacity < Math.max(10, minimumRowHeight(ctx, row) * 0.5)) {
      addPage(ctx);
      await drawRepeatedHeaders(ctx, headers, repeat);
      capacity = ctx.contentBottom - ctx.y;
    }
    if (firstFragment) {
      const wholeBlockHeight = firstFragmentWholeBlockHeight(ctx, row, layouts);
      const freshCapacity = freshPageBodyHeight(ctx, headers, repeat);
      if (wholeBlockHeight > capacity && wholeBlockHeight <= freshCapacity && ctx.y > ctx.contentTop + 0.5) {
        addPage(ctx);
        await drawRepeatedHeaders(ctx, headers, repeat);
        capacity = ctx.contentBottom - ctx.y;
      }
    }
    const beforeCursor = rowPaginationCursorTotal(layouts);
    const fragment = buildRowFragment(ctx, row, layouts, firstFragment, Math.max(1, capacity), index);
    await drawRow(ctx, row, index, fragment);
    const afterCursor = rowPaginationCursorTotal(layouts);
    firstFragment = false;
    if (afterCursor <= beforeCursor && !rowPaginationDone(layouts)) {
      ctx.warnings.add("table_cell_pagination_no_progress", `Table row ${index + 1} cell pagination made no progress; stopping pagination for this row to avoid an infinite loop.`);
      break;
    }
    if (!rowPaginationDone(layouts)) {
      addPage(ctx);
      await drawRepeatedHeaders(ctx, headers, repeat);
    }
  }
  if (guard >= 1e3) {
    ctx.warnings.add("table_cell_pagination_no_progress", `Table row ${index + 1} cell pagination stopped after too many fragments.`);
  }
}
async function drawRowSequentiallyFallback(ctx, row, index, headers, repeat, groupHeight) {
  const rawHeight = estimateRowHeight(ctx, row, false);
  const pageHeight = Math.max(1, ctx.contentBottom - ctx.contentTop);
  if (rawHeight > pageHeight) {
    ctx.warnings.add("table_row_too_tall", `Table row ${index + 1} is taller than a page and may be clipped. Reduce content, font size, or padding.`);
  }
  const height = estimateRowHeight(ctx, row);
  if (ctx.y + height > ctx.contentBottom) {
    addPage(ctx);
    await drawRepeatedHeaders(ctx, headers, repeat);
  }
  await drawRow(ctx, row, index, void 0, groupHeight);
}
async function drawRowSequentially(ctx, row, index, headers, repeat, groupHeight) {
  const rawHeight = estimateRowHeight(ctx, row, false);
  const freshBody = freshPageBodyHeight(ctx, headers, repeat);
  if (canPaginateRowCells(ctx, row, rawHeight, freshBody, index)) {
    await drawPaginatedTextRow(ctx, row, index, headers, repeat);
    return;
  }
  await drawRowSequentiallyFallback(ctx, row, index, headers, repeat, groupHeight);
}
async function drawRowGroups(ctx, rows, headers, repeat) {
  const groups = groupRowsByRowspan(ctx, rows);
  const keepRowspans = ctx.options.table?.rowspanPagination !== "split";
  for (const group of groups) {
    const avoidGroupBreak = keepRowspans && group.hasRowspan || group.rows.some(rowHasBreakInsideAvoid);
    const freshBody = freshPageBodyHeight(ctx, headers, repeat);
    if (avoidGroupBreak && group.height <= freshBody && ctx.y + group.height > ctx.contentBottom) {
      addPage(ctx);
      await drawRepeatedHeaders(ctx, headers, repeat);
    } else if (avoidGroupBreak && group.height > freshBody) {
      ctx.warnings.add("table_rowspan_group_too_tall", `Rows ${group.startIndex + 1}-${group.startIndex + group.rows.length} are connected by rowspan/break-inside and do not fit on a fresh page; rendering sequentially.`);
    }
    for (let offset = 0; offset < group.rows.length; offset++) {
      const gh = group.hasRowspan && offset === 0 && Number.isFinite(group.height) ? group.height : void 0;
      await drawRowSequentially(ctx, group.rows[offset], group.startIndex + offset, headers, repeat, gh);
    }
  }
}
function shouldRepeatTableHeaders(ctx, table) {
  if (ctx.options.tableHeaderRepeat === "auto") return table.headRows.length > 0;
  if (typeof ctx.options.tableHeaderRepeat === "boolean") return ctx.options.tableHeaderRepeat;
  if (ctx.options.repeatHeaders != null) return ctx.options.repeatHeaders;
  return table.repeatHeader ?? false;
}
function normalizedHorizontalPageColumns(ctx) {
  const configured = ctx.options.table?.horizontalPageColumns;
  if (configured != null && Number.isFinite(configured)) return Math.max(1, Math.floor(configured));
  return ctx.orientation === "landscape" ? 8 : 6;
}
function normalizedRepeatColumns(ctx, table) {
  const configured = ctx.options.table?.repeatColumns ?? 0;
  if (!Number.isFinite(configured) || table.columnCount <= 1) return 0;
  return clamp(Math.floor(configured), 0, table.columnCount - 1);
}
function protectedColspanRanges(table) {
  const ranges = [];
  for (const row of table.bodyRows) {
    if (row.kind === "section") continue;
    for (const item of logicalCellsForRow(row)) {
      const span = item.end - item.start;
      if (span <= 1 || span >= table.columnCount || item.cell.isSpanPlaceholder) continue;
      ranges.push({ start: item.start, end: item.end });
    }
  }
  return ranges;
}
function adjustedSliceEnd(start, initialEnd, table, protectedRanges) {
  let end = initialEnd;
  let changed = true;
  while (changed) {
    changed = false;
    for (const range of protectedRanges) {
      if (range.start < end && range.end > end && range.end > start) {
        end = Math.min(table.columnCount, range.end);
        changed = true;
      }
    }
  }
  return Math.max(start + 1, Math.min(table.columnCount, end));
}
function horizontalColumnSlices(ctx, table) {
  const mode = ctx.options.table?.horizontalPagination ?? "none";
  if (mode === "none" || table.columnCount <= 1) {
    return [{ columns: Array.from({ length: table.columnCount }, (_, i) => i), start: 0, end: table.columnCount, index: 0, total: 1 }];
  }
  const repeatColumns = normalizedRepeatColumns(ctx, table);
  const pageColumns = normalizedHorizontalPageColumns(ctx);
  const variableColumns = Math.max(1, table.columnCount - repeatColumns);
  if (variableColumns <= pageColumns) {
    return [{ columns: Array.from({ length: table.columnCount }, (_, i) => i), start: 0, end: table.columnCount, index: 0, total: 1 }];
  }
  const repeated = Array.from({ length: repeatColumns }, (_, i) => i);
  const protectedRanges = protectedColspanRanges(table);
  const slices = [];
  for (let start = repeatColumns; start < table.columnCount; ) {
    const end = adjustedSliceEnd(start, Math.min(table.columnCount, start + pageColumns), table, protectedRanges);
    slices.push({
      columns: [...repeated, ...Array.from({ length: end - start }, (_, i) => start + i)],
      start,
      end,
      index: slices.length,
      total: 0
    });
    start = end;
  }
  return slices.map((slice) => ({ ...slice, total: slices.length }));
}
function logicalCellsForRow(row) {
  const cells = [];
  let col = 0;
  for (const cell of row.cells) {
    const span = Math.max(1, cell.colspan);
    cells.push({ cell, start: col, end: col + span });
    col += span;
  }
  return cells;
}
function logicalCellAt(cells, column) {
  return cells.find((item) => column >= item.start && column < item.end);
}
function emptySliceCell(isParam, colspan) {
  return {
    text: "",
    inlines: [],
    className: "",
    style: "",
    styles: {},
    colspan,
    rowspan: 1,
    isHeader: false,
    isParam,
    isPrice: false,
    isDiff: false,
    isSection: false
  };
}
function cloneCellForSlice(cell, colspan) {
  return {
    ...cell,
    colspan,
    rowspan: cell.rowspan,
    inlines: cell.inlines.map((segment) => ({ ...segment, styles: { ...segment.styles } })),
    styles: { ...cell.styles }
  };
}
function sliceRowByColumns(row, columns) {
  const logical = logicalCellsForRow(row);
  const cells = [];
  let splitBodyColspan = false;
  let current;
  let currentSpan = 0;
  let currentIsSynthetic = false;
  const flush = () => {
    if (currentSpan <= 0) return;
    if (!current) {
      cells.push(emptySliceCell(cells.length === 0, currentSpan));
    } else {
      if (currentSpan < Math.max(1, current.cell.colspan) && !current.cell.isSpanPlaceholder && !current.cell.isHeader && !current.cell.isSection && row.kind !== "section") {
        splitBodyColspan = true;
      }
      cells.push(cloneCellForSlice(current.cell, currentSpan));
    }
    current = void 0;
    currentSpan = 0;
    currentIsSynthetic = false;
  };
  for (const column of columns) {
    const hit = logicalCellAt(logical, column);
    const isSynthetic = !hit;
    if (currentSpan > 0 && hit?.cell === current?.cell && isSynthetic === currentIsSynthetic) {
      currentSpan += 1;
      continue;
    }
    flush();
    current = hit;
    currentSpan = 1;
    currentIsSynthetic = isSynthetic;
  }
  flush();
  return { row: { ...row, cells }, splitBodyColspan };
}
function sliceTableByColumns(table, columns) {
  let splitBodyColspan = false;
  const headRows = table.headRows.map((row) => sliceRowByColumns(row, columns).row);
  const bodyRows = table.bodyRows.map((row) => {
    const sliced = sliceRowByColumns(row, columns);
    if (sliced.splitBodyColspan) splitBodyColspan = true;
    return sliced.row;
  });
  const slicedTable = { ...table, headRows, bodyRows, columnCount: columns.length };
  if ((table.columnStyles?.length ?? 0) > 0) slicedTable.columnStyles = columns.map((column) => table.columnStyles?.[column] ?? {});
  return { table: slicedTable, splitBodyColspan };
}
function drawTableCornerMask(ctx, x, y, width, radius, edge, color = "#ffffff") {
  const r = Math.max(0, Math.min(radius, width / 2));
  if (r <= 0) return;
  ctx.doc.save();
  ctx.doc.fillColor(color);
  if (edge === "top") {
    ctx.doc.moveTo(x, y).lineTo(x + r, y).quadraticCurveTo(x, y, x, y + r).closePath().fill();
    ctx.doc.moveTo(x + width - r, y).lineTo(x + width, y).lineTo(x + width, y + r).quadraticCurveTo(x + width, y, x + width - r, y).closePath().fill();
  } else {
    ctx.doc.moveTo(x, y - r).lineTo(x, y).lineTo(x + r, y).quadraticCurveTo(x, y, x, y - r).closePath().fill();
    ctx.doc.moveTo(x + width, y - r).lineTo(x + width, y).lineTo(x + width - r, y).quadraticCurveTo(x + width, y, x + width, y - r).closePath().fill();
  }
  ctx.doc.restore();
}
function strokeTableRoundedEdge(ctx, x, y, width, radius, edge, border) {
  const r = Math.max(0, Math.min(radius, width / 2));
  if (r <= 0 || border.width <= 0 || border.style === "none") return;
  ctx.doc.save();
  ctx.doc.strokeColor(border.color ?? COLORS.border).lineWidth(border.width);
  if (edge === "top") {
    ctx.doc.moveTo(x, y + r).quadraticCurveTo(x, y, x + r, y).lineTo(x + width - r, y).quadraticCurveTo(x + width, y, x + width, y + r).stroke();
  } else {
    ctx.doc.moveTo(x, y - r).quadraticCurveTo(x, y, x + r, y).lineTo(x + width - r, y).quadraticCurveTo(x + width, y, x + width, y - r).stroke();
  }
  ctx.doc.restore();
}
async function drawSingleTableBlock(ctx, table, style, addTrailingGap = true) {
  const previousWidths = ctx.columnWidths;
  const previousColumns = ctx.columns;
  const previousTableWidth = ctx.tableWidth;
  const previousTableStyle = ctx.currentTableStyle;
  const previousTableContext = applyTableDensity(ctx);
  try {
    const cssWidth = cssLengthPt(style["width"], previousTableWidth);
    const width = tableOption(ctx, "fit") === "page-width" ? previousTableWidth : cssWidth ?? previousTableWidth;
    ctx.columns = table.columnCount;
    ctx.tableWidth = clamp(width, Math.min(previousTableWidth, 120), previousTableWidth);
    ctx.currentTableStyle = tableStyle(style);
    ctx.columnWidths = computeTableColumnWidths(ctx, table, ctx.tableWidth, ctx.currentTableStyle);
    const tableRadius = borderRadiusPt(style, ctx.tableWidth, ctx.contentBottom - ctx.contentTop);
    const tableBorder = borderPxToPt(parseBorderStyle(style, { width: tableRadius > 0 ? 1 : 0, color: COLORS.border, style: "solid" }));
    const repeat = shouldRepeatTableHeaders(ctx, table);
    const groups = groupRowsByRowspan(ctx, table.bodyRows);
    const firstGroup = groups[0];
    const headerHeight = rowsHeight(ctx, table.headRows);
    if (firstGroup && firstGroup.height <= freshPageBodyHeight(ctx, table.headRows, repeat) && ctx.y + headerHeight + firstGroup.height > ctx.contentBottom) {
      addPage(ctx);
    }
    let tableTopY = ctx.y;
    for (const row of table.headRows) {
      const height = estimateRowHeight(ctx, row);
      if (ctx.y + height > ctx.contentBottom) {
        addPage(ctx);
        tableTopY = ctx.y;
      }
      await drawRow(ctx, row, -1);
    }
    if (tableRadius > 0) {
      drawTableCornerMask(ctx, ctx.margin, tableTopY, ctx.tableWidth, tableRadius, "top");
      strokeTableRoundedEdge(ctx, ctx.margin, tableTopY, ctx.tableWidth, tableRadius, "top", tableBorder);
    }
    await drawRowGroups(ctx, table.bodyRows, table.headRows, repeat);
    if (tableRadius > 0) {
      drawTableCornerMask(ctx, ctx.margin, ctx.y, ctx.tableWidth, tableRadius, "bottom");
      strokeTableRoundedEdge(ctx, ctx.margin, ctx.y, ctx.tableWidth, tableRadius, "bottom", tableBorder);
    }
    if (addTrailingGap) ctx.y += 8;
  } finally {
    ctx.columns = previousColumns;
    ctx.columnWidths = previousWidths;
    ctx.tableWidth = previousTableWidth;
    ctx.currentTableStyle = previousTableStyle;
    restoreTableContext(ctx, previousTableContext);
  }
}
async function drawTableBlock(ctx, block) {
  const slices = horizontalColumnSlices(ctx, block.table);
  let splitBodyColspan = false;
  for (const slice of slices) {
    if (slice.index > 0) addPage(ctx);
    const sliced = sliceTableByColumns(block.table, slice.columns);
    if (sliced.splitBodyColspan) splitBodyColspan = true;
    await drawSingleTableBlock(ctx, sliced.table, block.style, slice.index === slices.length - 1);
  }
  if (splitBodyColspan) {
    ctx.warnings.add("table_colspan_horizontal_split", "A body cell with colspan crossed a horizontal table slice boundary; its visible portion was repeated/clipped per slice.");
  }
}

// src/stream/flow.ts
function blockFontSize(block) {
  if (block.type === "heading") {
    const defaults = { 1: 24, 2: 20, 3: 17, 4: 14, 5: 12, 6: 11 };
    return cssLengthPt(block.style["font-size"]) ?? defaults[block.level] ?? 12;
  }
  if (block.type === "preformatted") return cssLengthPt(block.style["font-size"]) ?? 9;
  if (block.type === "blockquote") return cssLengthPt(block.style["font-size"]) ?? 10.5;
  return cssLengthPt(block.style["font-size"]) ?? 10.5;
}
function blockColor(block) {
  return parseCssColor(block.style["color"]) ?? COLORS.text;
}
async function drawTextBlock(ctx, block) {
  const size = blockFontSize(block);
  const defaultBold = block.type === "heading" || block.style["font-weight"] === "bold" || Number(block.style["font-weight"]) >= 600;
  const font = fontForStyle(ctx, block.style, defaultBold ? ctx.boldFontName : ctx.regularFontName, block.text, defaultBold);
  const prefix = block.type === "list-item" ? block.ordered ? `${block.index}. ` : "- " : "";
  const box = textBoxStyle(block);
  const indent = block.type === "list-item" ? 14 : 0;
  const boxX = ctx.margin + box.margin.left;
  const boxWidth = Math.max(20, ctx.tableWidth - box.margin.left - box.margin.right);
  const contentX = boxX + box.border.width + box.padding.left + indent;
  const contentWidth = Math.max(20, boxWidth - box.border.width * 2 - box.padding.left - box.padding.right - indent);
  const lineGap = lineGapForStyle(block.style, size, block.type === "preformatted" ? 0.1 : 0.22);
  ctx.doc.font(font).fontSize(size);
  const displayText = prefix + block.text;
  const displayInlines = prefix ? [{ text: prefix, styles: { "font-weight": block.type === "list-item" && block.ordered ? "400" : "700" } }, ...block.inlines] : block.inlines;
  const textHeightValue = inlineTextHeight(ctx, displayText, displayInlines, font, size, contentWidth, lineGap);
  const boxHeight = textHeightValue + box.padding.top + box.padding.bottom + box.border.width * 2;
  ensureSpace(ctx, box.margin.top + boxHeight + box.margin.bottom);
  ctx.y += box.margin.top;
  const bg = parseCssColor(block.style["background-color"]) ?? (block.type === "preformatted" ? "#f6f8fa" : void 0);
  const radius = borderRadiusPt(block.style, boxWidth, boxHeight);
  drawBoxShadow(ctx, block.style, boxX, ctx.y, boxWidth, boxHeight, radius);
  if (bg) fillBox(ctx, boxX, ctx.y, boxWidth, boxHeight, bg, radius);
  await drawBackgroundImage(ctx, block.style, boxX, ctx.y, boxWidth, boxHeight, radius);
  strokeBox(ctx, boxX, ctx.y, boxWidth, boxHeight, box.border, radius);
  if (block.type === "blockquote") {
    const border = parseBorderStyle(block.style, { width: 3 * 96 / 72, color: parseCssColor(block.style["border-color"]) ?? COLORS.border });
    ctx.doc.rect(boxX, ctx.y, Math.max(2, pxToPt(border.width)), boxHeight).fill(border.color ?? COLORS.border);
  }
  ctx.doc.save();
  if (isOverflowHidden(block.style) || radius > 0) {
    clipBox(ctx, contentX, ctx.y + box.border.width + box.padding.top, contentWidth, Math.max(1, boxHeight - box.border.width * 2 - box.padding.top - box.padding.bottom), Math.max(0, radius - Math.max(box.padding.left, box.padding.top)));
  }
  drawInlineText(ctx, displayText, displayInlines, contentX, ctx.y + box.border.width + box.padding.top, contentWidth, font, size, blockColor(block), lineGap, block.style["text-align"] === "center" || block.style["text-align"] === "right" ? block.style["text-align"] : "left");
  ctx.doc.restore();
  ctx.y += boxHeight + box.margin.bottom;
}
async function drawImageBlock(ctx, block) {
  const asset = await getAsset(ctx, block.src);
  if (!asset) return;
  const dims = imageDimensions(asset);
  const cssWidth = cssLengthPt(block.style["width"], ctx.tableWidth);
  const cssHeight = cssLengthPt(block.style["height"]);
  let width = cssWidth ?? (dims ? pxToPt(dims.width) : ctx.tableWidth);
  let height = cssHeight ?? (dims ? pxToPt(dims.height) : 180);
  if (dims && cssWidth != null && cssHeight == null) height = width * dims.height / dims.width;
  if (dims && cssHeight != null && cssWidth == null) width = height * dims.width / dims.height;
  if (width > ctx.tableWidth) {
    const scale = ctx.tableWidth / width;
    width = ctx.tableWidth;
    height *= scale;
  }
  if (height > 360) {
    const scale = 360 / height;
    height = 360;
    width *= scale;
  }
  ensureSpace(ctx, height + blockMarginTop(block) + blockMarginBottom(block));
  ctx.y += blockMarginTop(block);
  const align = block.style["text-align"] === "center" ? "center" : block.style["text-align"] === "right" ? "right" : "left";
  const x = align === "center" ? ctx.margin + (ctx.tableWidth - width) / 2 : align === "right" ? ctx.margin + ctx.tableWidth - width : ctx.margin;
  drawAssetInBox(ctx, asset, x, ctx.y, width, height, block.style, 1, "image block");
  ctx.y += height + blockMarginBottom(block);
}
function drawHrBlock(ctx, block) {
  const top = blockMarginTop(block) || 6;
  const bottom = blockMarginBottom(block) || 6;
  ensureSpace(ctx, top + bottom + 2);
  ctx.y += top;
  ctx.doc.moveTo(ctx.margin, ctx.y).lineTo(ctx.margin + ctx.tableWidth, ctx.y).strokeColor(parseCssColor(block.style["border-color"]) ?? COLORS.border).lineWidth(cssLengthPt(block.style["border-width"]) ?? 0.7).stroke();
  ctx.y += bottom;
}
function gridTemplateColumns(style) {
  const raw = (style["grid-template-columns"] ?? "").trim();
  if (!raw) return ["1fr"];
  const expanded = raw.replace(
    /repeat\(\s*(\d+)\s*,\s*([^)]+)\)/gi,
    (_match, count, value) => Array.from({ length: Math.max(1, Number.parseInt(count, 10) || 1) }, () => value.trim()).join(" ")
  );
  return expanded.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}
function gridGap(style, axis) {
  const specific = axis === "row" ? style["row-gap"] : style["column-gap"];
  const gap = style["gap"];
  if (specific) return cssLengthPt(specific) ?? 0;
  if (!gap) return 0;
  const parts = gap.trim().split(/\s+/);
  const raw = axis === "row" ? parts[0] : parts[1] ?? parts[0];
  return cssLengthPt(raw) ?? 0;
}
function gridColumnWidths(style, availableWidth) {
  const tracks = gridTemplateColumns(style);
  const columnGap = gridGap(style, "column");
  const gapTotal = columnGap * Math.max(0, tracks.length - 1);
  const widthForTracks = Math.max(1, availableWidth - gapTotal);
  const fixed = tracks.map((track) => track.endsWith("fr") ? void 0 : cssLengthPt(track, widthForTracks));
  const fixedTotal = fixed.reduce((sum, value) => sum + (value ?? 0), 0);
  const frTotal = tracks.reduce((sum, track, index) => fixed[index] == null ? sum + (Number.parseFloat(track) || 1) : sum, 0);
  const remaining = Math.max(1, widthForTracks - fixedTotal);
  return tracks.map((track, index) => fixed[index] ?? remaining * ((Number.parseFloat(track) || 1) / Math.max(1, frTotal)));
}
async function estimateBlockHeight(ctx, block, width) {
  if (block.type === "heading" || block.type === "paragraph" || block.type === "list-item" || block.type === "blockquote" || block.type === "preformatted") {
    const size = blockFontSize(block);
    const defaultBold = block.type === "heading" || block.style["font-weight"] === "bold" || Number(block.style["font-weight"]) >= 600;
    const font = fontForStyle(ctx, block.style, defaultBold ? ctx.boldFontName : ctx.regularFontName, block.text, defaultBold);
    const box = textBoxStyle(block);
    const indent = block.type === "list-item" ? 14 : 0;
    const boxWidth = Math.max(20, width - box.margin.left - box.margin.right);
    const contentWidth = Math.max(20, boxWidth - box.border.width * 2 - box.padding.left - box.padding.right - indent);
    const lineGap = lineGapForStyle(block.style, size, block.type === "preformatted" ? 0.1 : 0.22);
    const prefix = block.type === "list-item" ? block.ordered ? `${block.index}. ` : "- " : "";
    const displayText = prefix + block.text;
    const displayInlines = prefix ? [{ text: prefix, styles: { "font-weight": block.type === "list-item" && block.ordered ? "400" : "700" } }, ...block.inlines] : block.inlines;
    ctx.doc.font(font).fontSize(size);
    const textHeightValue = inlineTextHeight(ctx, displayText, displayInlines, font, size, contentWidth, lineGap);
    return box.margin.top + textHeightValue + box.padding.top + box.padding.bottom + box.border.width * 2 + box.margin.bottom;
  }
  if (block.type === "chart") {
    const metrics = chartBoxMetrics(ctx, block, width);
    return metrics.margin.top + metrics.outerHeight + metrics.margin.bottom;
  }
  if (block.type === "hr") return (blockMarginTop(block) || 6) + (blockMarginBottom(block) || 6) + 2;
  if (block.type === "image") {
    const cssHeight = cssLengthPt(block.style["height"]);
    return (cssHeight ?? 120) + blockMarginTop(block) + blockMarginBottom(block);
  }
  if (block.type === "table") {
    const previousTableWidth = ctx.tableWidth;
    const previousColumns = ctx.columns;
    const previousWidths = ctx.columnWidths;
    const previousStyle = ctx.currentTableStyle;
    ctx.tableWidth = width;
    ctx.columns = block.table.columnCount;
    ctx.currentTableStyle = tableStyle(block.style);
    ctx.columnWidths = computeTableColumnWidths(ctx, block.table, width, ctx.currentTableStyle);
    const height = rowsHeight(ctx, block.table.headRows, false) + rowsHeight(ctx, block.table.bodyRows, false) + blockMarginBottom(block);
    ctx.tableWidth = previousTableWidth;
    ctx.columns = previousColumns;
    ctx.columnWidths = previousWidths;
    ctx.currentTableStyle = previousStyle;
    return height;
  }
  if (block.type === "grid") {
    return estimateGridHeight(ctx, block, width);
  }
  return 0;
}
async function estimateGridHeight(ctx, block, width) {
  const margin = spacingPt(block.style, "margin", { top: 0, right: 0, bottom: 8, left: 0 });
  const padding = spacingPt(block.style, "padding", { top: 0, right: 0, bottom: 0, left: 0 });
  const border = borderPxToPt(parseBorderStyle(block.style, { width: 0, color: COLORS.border, style: "solid" }));
  const innerWidth = Math.max(1, width - margin.left - margin.right - padding.left - padding.right - border.width * 2);
  const columns = gridColumnWidths(block.style, innerWidth);
  const rowGap = gridGap(block.style, "row");
  let contentHeight = 0;
  for (let index = 0; index < block.blocks.length; index += columns.length) {
    const rowBlocks = block.blocks.slice(index, index + columns.length);
    const heights = await Promise.all(rowBlocks.map((child, childIndex) => estimateBlockHeight(ctx, child, columns[childIndex] ?? columns[0] ?? innerWidth)));
    if (index > 0) contentHeight += rowGap;
    contentHeight += Math.max(0, ...heights);
  }
  return margin.top + padding.top + padding.bottom + border.width * 2 + contentHeight + margin.bottom;
}
async function drawGridBlock(ctx, block) {
  const margin = spacingPt(block.style, "margin", { top: 0, right: 0, bottom: 8, left: 0 });
  const padding = spacingPt(block.style, "padding", { top: 0, right: 0, bottom: 0, left: 0 });
  const border = borderPxToPt(parseBorderStyle(block.style, { width: 0, color: COLORS.border, style: "solid" }));
  const outerWidth = Math.max(1, ctx.tableWidth - margin.left - margin.right);
  const innerWidth = Math.max(1, outerWidth - padding.left - padding.right - border.width * 2);
  const columns = gridColumnWidths(block.style, innerWidth);
  const columnGap = gridGap(block.style, "column");
  const rowGap = gridGap(block.style, "row");
  const totalHeight = await estimateGridHeight(ctx, block, ctx.tableWidth);
  ensureSpace(ctx, totalHeight);
  ctx.y += margin.top;
  const gridX = ctx.margin + margin.left;
  const gridY = ctx.y;
  const radius = borderRadiusPt(block.style, outerWidth, totalHeight - margin.top - margin.bottom);
  drawBoxShadow(ctx, block.style, gridX, gridY, outerWidth, totalHeight - margin.top - margin.bottom, radius);
  const bg = parseCssColor(block.style["background-color"]);
  if (bg) fillBox(ctx, gridX, gridY, outerWidth, totalHeight - margin.top - margin.bottom, bg, radius);
  strokeBox(ctx, gridX, gridY, outerWidth, totalHeight - margin.top - margin.bottom, border, radius);
  let cursorY = gridY + border.width + padding.top;
  for (let index = 0; index < block.blocks.length; index += columns.length) {
    const rowBlocks = block.blocks.slice(index, index + columns.length);
    const heights = await Promise.all(rowBlocks.map((child, childIndex) => estimateBlockHeight(ctx, child, columns[childIndex] ?? columns[0] ?? innerWidth)));
    const rowHeight = Math.max(0, ...heights);
    let cursorX = gridX + border.width + padding.left;
    for (let childIndex = 0; childIndex < rowBlocks.length; childIndex++) {
      const child = rowBlocks[childIndex];
      const cellWidth = columns[childIndex] ?? columns[0] ?? innerWidth;
      const previousMargin = ctx.margin;
      const previousWidth = ctx.tableWidth;
      const previousY = ctx.y;
      ctx.margin = cursorX;
      ctx.tableWidth = cellWidth;
      ctx.y = cursorY;
      await drawBlock(ctx, child);
      ctx.margin = previousMargin;
      ctx.tableWidth = previousWidth;
      ctx.y = previousY;
      cursorX += cellWidth + columnGap;
    }
    cursorY += rowHeight + rowGap;
  }
  ctx.y = gridY + totalHeight - margin.top;
}
async function drawBlock(ctx, block) {
  if (block.type === "heading" || block.type === "paragraph" || block.type === "list-item" || block.type === "blockquote" || block.type === "preformatted") {
    await drawTextBlock(ctx, block);
  } else if (block.type === "image") {
    await drawImageBlock(ctx, block);
  } else if (block.type === "chart") {
    await drawChartBlock(ctx, block);
  } else if (block.type === "grid") {
    await drawGridBlock(ctx, block);
  } else if (block.type === "hr") {
    drawHrBlock(ctx, block);
  } else if (block.type === "page-break") {
    if (ctx.y > ctx.contentTop + 1) addPage(ctx);
  } else if (block.type === "table") {
    await drawTableBlock(ctx, block);
  }
}

// src/stream/pdfkit-safety.ts
var METHODS_WITH_NUMBERS = [
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
  "translate"
];
var POSITIVE_KEYS = /* @__PURE__ */ new Set([
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
  "columnGap"
]);
var ZERO_KEYS = /* @__PURE__ */ new Set([
  "lineGap",
  "characterSpacing",
  "wordSpacing"
]);
function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function fallbackNumber(method, path) {
  const key = path.split(".").pop() ?? "";
  if (method === "scale") return 1;
  if (method === "opacity" || method === "fillOpacity" || method === "strokeOpacity" || key.toLowerCase().includes("opacity")) return 1;
  if (method === "fontSize" || method === "lineWidth" || POSITIVE_KEYS.has(key)) return 1;
  if (ZERO_KEYS.has(key)) return 0;
  return 0;
}
function clampOpacity(method, path, value) {
  const key = path.split(".").pop() ?? "";
  if (method !== "opacity" && method !== "fillOpacity" && method !== "strokeOpacity" && !key.toLowerCase().includes("opacity")) return value;
  return Math.max(0, Math.min(1, value));
}
function sanitizePdfKitValue(method, value, path) {
  if (typeof value === "number") {
    if (Number.isFinite(value)) return { value: clampOpacity(method, path, value), changed: false, samples: [] };
    return {
      value: fallbackNumber(method, path),
      changed: true,
      samples: [`${path}=${String(value)}`]
    };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const samples = [];
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
    const samples = [];
    const sanitized = {};
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
function patchPdfKitNumberSafety(doc, warnings) {
  const mutableDoc = doc;
  const methodBag = mutableDoc;
  const warned = /* @__PURE__ */ new Set();
  for (const method of METHODS_WITH_NUMBERS) {
    const original = methodBag[method];
    if (typeof original !== "function") continue;
    methodBag[method] = function patchedPdfKitMethod(...args) {
      let changed = false;
      const samples = [];
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
          `Sanitized non-finite number before PDFKit ${method}(${samples.slice(0, 3).join(", ")}).`
        );
      }
      return original.apply(this, sanitized);
    };
  }
}

// src/stream-render.ts
async function createStreamContext(options, parsed, warnings) {
  const columns = maxDocumentColumns(parsed);
  const pageOptions = effectivePageOptions(options, parsed.page);
  const orientation = pageOptions.orientation !== "auto" ? pageOptions.orientation : determineOrientation(columns);
  const margin = mm(pageOptions.marginMm);
  const doc = new PDFDocument({
    size: pageOptions.size,
    layout: pageLayout(orientation),
    margin: 0,
    autoFirstPage: true,
    bufferPages: false,
    info: {
      Producer: "Html2PdfSmith",
      Title: options.title ?? (options.recordId ? `HTML PDF ${options.recordId}` : "HTML PDF")
    }
  });
  const done = chunksToBuffer(doc);
  patchPdfKitNumberSafety(doc, warnings);
  doc.on("pageAdded", () => {
    ctxRef.pages += 1;
  });
  const fonts = await registerFonts(doc, parsed, options, warnings);
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const contentWidth = pageWidth - margin * 2;
  const headerReserve = reservedHeaderHeight(options);
  const footerReserve = reservedFooterHeight(options);
  const pageNumbers = pageNumberSettings(options);
  if (pageNumbers.enabled && pageNumbers.format.includes("{total}")) {
    warnings.add("page_total_unsupported_streaming", "Page number format contains {total}; streaming mode prints ? for total pages to keep memory usage low.");
  }
  const fontScale = calculateFontScale(columns) / 100;
  const paddingScale = calculatePaddingScale(columns);
  const ctxRef = {
    doc,
    warnings,
    options,
    parsed,
    columns,
    orientation,
    pageSize: pageOptions.size,
    margin,
    contentTop: margin + headerReserve,
    contentBottom: pageHeight - margin - footerReserve,
    pageWidth,
    pageHeight,
    y: margin + headerReserve,
    pages: 1,
    columnWidths: computeColumnWidths(columns, contentWidth),
    tableWidth: contentWidth,
    fontScale,
    paddingScale,
    baseFontSize: 9.7 * fontScale,
    headerFontSize: Math.max(5.4, 14.2 * fontScale),
    priceFontSize: Math.max(5.4, 12.5 * fontScale),
    sectionFontSize: Math.max(6.2, 10.5 * fontScale),
    cellPaddingX: Math.max(2.2, 7 * paddingScale),
    cellPaddingY: Math.max(1.8, 4 * paddingScale),
    regularFontName: fonts.regular,
    boldFontName: fonts.bold,
    italicFontName: fonts.italic,
    boldItalicFontName: fonts.boldItalic,
    fontFamilies: fonts.families,
    fontResolver: new FontResolver(doc, {
      regular: fonts.regular,
      bold: fonts.bold,
      italic: fonts.italic,
      boldItalic: fonts.boldItalic
    }, fonts.families, fonts.fallbackFamilies),
    watermarkAsset: await loadPdfKitAsset(options.watermarkUrl, warnings, options),
    logoAsset: await loadPdfKitAsset(options.userLogoUrl, warnings, options),
    qrAsset: await loadPdfKitAsset(options.headerContacts?.qr?.src ?? parsed.contactQrSrc, warnings, options),
    assetCache: /* @__PURE__ */ new Map(),
    currentTableStyle: tableStyle({})
  };
  return { ctx: ctxRef, done };
}
async function renderHtmlToPdfDetailed(options) {
  const warnings = new WarningSink(options.onWarning);
  const html = await prepareHtmlForRender(options, warnings);
  const parsed = parsePrintableHtml(html);
  const { ctx, done } = await createStreamContext(options, parsed, warnings);
  drawWatermark(ctx, "background");
  drawPageChrome(ctx);
  drawHeader(ctx);
  for (const block of parsed.blocks) await drawBlock(ctx, block);
  finishPage(ctx);
  ctx.doc.end();
  let pdf = new Uint8Array(await done);
  if (options.protectPdf) {
    try {
      pdf = await protectPdfWithQpdf(pdf, options.qpdfPath);
    } catch (error) {
      warnings.add("qpdf_failed", `qpdf protection failed; returning unprotected PDF: ${String(error)}`);
    }
  }
  return {
    pdf,
    warnings: warnings.warnings,
    pages: ctx.pages,
    columns: ctx.columns,
    orientation: ctx.orientation
  };
}
async function renderHtmlToPdf(options) {
  return (await renderHtmlToPdfDetailed(options)).pdf;
}

// src/compat.ts
async function convertHtmlToPdfDetailed(options) {
  const renderOptions = {
    html: options.htmlContent
  };
  if (options.baseUrl !== void 0) renderOptions.baseUrl = options.baseUrl;
  if (options.stylesheets !== void 0) renderOptions.stylesheets = options.stylesheets;
  if (options.resourcePolicy !== void 0) renderOptions.resourcePolicy = options.resourcePolicy;
  if (options.recordId !== void 0) renderOptions.recordId = options.recordId;
  if (options.repeatHeaders !== void 0) renderOptions.repeatHeaders = options.repeatHeaders;
  if (options.hideHeader !== void 0) renderOptions.hideHeader = options.hideHeader;
  if (options.watermarkText !== void 0) renderOptions.watermarkText = options.watermarkText;
  if (options.watermarkUrl !== void 0) renderOptions.watermarkUrl = options.watermarkUrl;
  if (options.userLogoUrl !== void 0) renderOptions.userLogoUrl = options.userLogoUrl;
  if (options.logoScale !== void 0) renderOptions.logoScale = options.logoScale;
  if (options.logoOffsetXMm !== void 0) renderOptions.logoOffsetXMm = options.logoOffsetXMm;
  if (options.logoOffsetYMm !== void 0) renderOptions.logoOffsetYMm = options.logoOffsetYMm;
  if (options.headerContacts !== void 0) renderOptions.headerContacts = options.headerContacts;
  if (options.watermarkScale !== void 0) renderOptions.watermarkScale = options.watermarkScale;
  if (options.watermarkOpacity !== void 0) renderOptions.watermarkOpacity = options.watermarkOpacity;
  if (options.patternType !== void 0) renderOptions.patternType = options.patternType;
  if (options.protectPdf !== void 0) renderOptions.protectPdf = options.protectPdf;
  if (options.qpdfPath !== void 0) renderOptions.qpdfPath = options.qpdfPath;
  if (options.font !== void 0) renderOptions.font = options.font;
  if (options.page !== void 0) renderOptions.page = options.page;
  return renderHtmlToPdfDetailed(renderOptions);
}
async function convertHtmlToPdf(options) {
  const result = await convertHtmlToPdfDetailed(options);
  return Buffer5.from(result.pdf);
}

// src/font-manifest.ts
import { readFile as readFile4 } from "fs/promises";
import { dirname as dirname2, isAbsolute as isAbsolute2, resolve as resolve2 } from "path";
function resolveManifestFile(baseDir, filePath) {
  if (!filePath) return void 0;
  return isAbsolute2(filePath) ? filePath : resolve2(baseDir, filePath);
}
function fontFaceFromManifest(baseDir, face) {
  const out = {
    family: face.family,
    regularPath: resolve2(baseDir, face.regularPath)
  };
  const boldPath = resolveManifestFile(baseDir, face.boldPath);
  const italicPath = resolveManifestFile(baseDir, face.italicPath);
  const boldItalicPath = resolveManifestFile(baseDir, face.boldItalicPath);
  if (boldPath) out.boldPath = boldPath;
  if (italicPath) out.italicPath = italicPath;
  if (boldItalicPath) out.boldItalicPath = boldItalicPath;
  if (face.license) out.license = face.license;
  if (face.source) out.source = face.source;
  return out;
}
function fallbackFaceFromBundled(face) {
  const out = {
    family: face.family,
    regularPath: face.regularPath
  };
  if (face.boldPath) out.boldPath = face.boldPath;
  if (face.italicPath) out.italicPath = face.italicPath;
  if (face.boldItalicPath) out.boldItalicPath = face.boldItalicPath;
  return out;
}
function normalizeFamily(value) {
  const normalized = value?.trim().toLowerCase();
  return normalized || void 0;
}
function fontOptionsFromManifest(manifest, manifestDir = process.cwd(), options = {}) {
  const faces = manifest.fonts.filter((face) => face.family?.trim() && face.regularPath?.trim()).map((face) => fontFaceFromManifest(manifestDir, face));
  if (faces.length === 0) {
    throw new Error("html2pdfsmith font manifest does not contain any usable fonts.");
  }
  const defaultFamily = normalizeFamily(options.defaultFamily ?? manifest.defaultFamily);
  const bundled = defaultFamily ? faces.find((face) => normalizeFamily(face.family) === defaultFamily) ?? faces[0] : faces[0];
  const fallbackFamilies = (options.fallbackFonts ?? manifest.fallbackFamilies ?? []).map((family) => normalizeFamily(family)).filter((family) => Boolean(family));
  const fallbackFontPaths = faces.filter((face) => fallbackFamilies.includes(normalizeFamily(face.family) ?? "")).map(fallbackFaceFromBundled);
  const result = {
    bundled,
    bundledFonts: faces
  };
  if (fallbackFontPaths.length > 0) result.fallbackFontPaths = fallbackFontPaths;
  return result;
}
async function loadFontManifest(manifestPath, options = {}) {
  const absoluteManifestPath = resolve2(manifestPath);
  const raw = await readFile4(absoluteManifestPath, "utf8");
  const manifest = JSON.parse(raw);
  return fontOptionsFromManifest(manifest, dirname2(absoluteManifestPath), options);
}
export {
  FontLoadError,
  HEADER_LOGO_MAX_OFFSET_MM,
  Html2PdfError,
  PdfProtectionError,
  ResourceLoadError,
  ResourcePolicyError,
  calculateFontScale,
  calculateHeaderCellHeight,
  calculatePaddingScale,
  convertHtmlToPdf,
  convertHtmlToPdfDetailed,
  createChartDashboardHtml,
  determineOrientation,
  fontOptionsFromManifest,
  getGoogleFontCacheDir,
  headerLogoBox,
  isGoogleFontCached,
  loadFontManifest,
  parsePrintableHtml,
  protectPdfWithQpdf,
  renderHtmlToPdf,
  renderHtmlToPdfDetailed,
  resolveFontPaths,
  resolveGoogleFont
};
