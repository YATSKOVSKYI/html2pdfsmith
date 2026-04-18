import { parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import { DomUtils } from "htmlparser2";
import { parseCssRules, resolveElementStyle, type CssRule } from "./css";
import type { ParsedBlock, ParsedCell, ParsedDocument, ParsedInlineSegment, ParsedRow, ParsedTable } from "./types";

function isElement(node: AnyNode | null | undefined): node is Element {
  return !!node && (node.type === "tag" || node.type === "style" || node.type === "script");
}

function attr(el: Element, name: string): string {
  return el.attribs?.[name] ?? "";
}

function className(el: Element): string {
  return attr(el, "class");
}

function hasClass(el: Element, name: string): boolean {
  return className(el).split(/\s+/).includes(name);
}

function findFirst(root: AnyNode | AnyNode[], predicate: (el: Element) => boolean): Element | undefined {
  const nodes = Array.isArray(root) ? root : [root];
  return DomUtils.findOne((node) => isElement(node) && predicate(node), nodes, true) as Element | undefined;
}

function findAll(root: AnyNode | AnyNode[], predicate: (el: Element) => boolean): Element[] {
  const nodes = Array.isArray(root) ? root : [root];
  const found: Element[] = [];
  const visit = (node: AnyNode): void => {
    if (isElement(node) && predicate(node)) found.push(node);
    if ("children" in node && node.children) {
      for (const child of node.children) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return found;
}

function directElementChildren(el: Element, tagName?: string): Element[] {
  return (el.children ?? []).filter((child): child is Element => {
    if (!isElement(child)) return false;
    return tagName ? child.name.toLowerCase() === tagName : true;
  });
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizePreText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\n+|\n+$/g, "");
}

function textWithBreaks(node: AnyNode): string {
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

function preText(node: AnyNode): string {
  if (node.type === "text") return node.data ?? "";
  if (!("children" in node) || !node.children) return "";
  if (isElement(node) && node.name.toLowerCase() === "br") return "\n";
  return node.children.map((child) => preText(child)).join("");
}

function mergeStyle(base: Record<string, string>, next: Record<string, string>): Record<string, string> {
  return { ...base, ...next };
}

function sameInlineStyle(a: ParsedInlineSegment, b: ParsedInlineSegment): boolean {
  if (a.href !== b.href) return false;
  const aEntries = Object.entries(a.styles);
  const bEntries = Object.entries(b.styles);
  if (aEntries.length !== bEntries.length) return false;
  return aEntries.every(([key, value]) => b.styles[key] === value);
}

function normalizeInlineSegments(segments: ParsedInlineSegment[]): ParsedInlineSegment[] {
  const normalized: ParsedInlineSegment[] = [];
  for (const segment of segments) {
    const text = segment.text.replace(/\u00a0/g, " ").replace(/[ \t\r\f\v\n]+/g, " ");
    if (!text) continue;
    const previous = normalized[normalized.length - 1];
    if (previous && sameInlineStyle(previous, segment)) {
      previous.text += text;
    } else {
      const next: ParsedInlineSegment = { text, styles: segment.styles };
      if (segment.href) next.href = segment.href;
      normalized.push(next);
    }
  }

  if (normalized[0]) normalized[0].text = normalized[0].text.trimStart();
  const last = normalized[normalized.length - 1];
  if (last) last.text = last.text.trimEnd();
  return normalized.filter((segment) => segment.text);
}

function parseInlineSegments(node: AnyNode, rules: CssRule[], inherited: Record<string, string> = {}): ParsedInlineSegment[] {
  if (node.type === "text") {
    const text = node.data ?? "";
    return text ? [{ text, styles: inherited }] : [];
  }
  if (!("children" in node) || !node.children) return [];
  if (isElement(node) && node.name.toLowerCase() === "br") return [{ text: "\n", styles: inherited }];

  let style = inherited;
  let href: string | undefined;
  if (isElement(node)) {
    const name = node.name.toLowerCase();
    style = mergeStyle(inherited, resolveElementStyle(node, rules));
    if (name === "strong" || name === "b") style = mergeStyle(style, { "font-weight": "700" });
    if (name === "em" || name === "i") style = mergeStyle(style, { "font-style": "italic" });
    if (name === "u") style = mergeStyle(style, { "text-decoration": "underline" });
    if (name === "s" || name === "del") style = mergeStyle(style, { "text-decoration": "line-through" });
    if (name === "code") style = mergeStyle(style, { "font-family": "monospace", "background-color": style["background-color"] ?? "#f6f8fa" });
    if (style["display"]?.trim().toLowerCase() === "none" || style["visibility"]?.trim().toLowerCase() === "hidden") return [];
    if (name === "a") href = attr(node, "href").trim() || undefined;
  }

  const segments = node.children.flatMap((child) => parseInlineSegments(child, rules, style));
  if (!href) return segments;
  return segments.map((segment) => ({ ...segment, href: segment.href ?? href }));
}

function inlineText(segments: ParsedInlineSegment[]): string {
  return normalizeWhitespace(segments.map((segment) => segment.text).join(""));
}

function firstImageSrc(el: Element): string | undefined {
  const img = findFirst(el, (node) => node.name.toLowerCase() === "img");
  const src = img ? attr(img, "src").trim() : "";
  return src || undefined;
}

function parseIntAttr(el: Element, name: string, fallback: number): number {
  const value = Number.parseInt(attr(el, name), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseCell(el: Element, rules: CssRule[]): ParsedCell {
  const cls = className(el);
  const style = attr(el, "style");
  const styles = resolveElementStyle(el, rules);
  const inlines = normalizeInlineSegments(parseInlineSegments(el, rules, styles));
  const text = inlineText(inlines) || normalizeWhitespace(textWithBreaks(el));
  const lower = `${cls} ${style} ${Object.entries(styles).map(([k, v]) => `${k}:${v}`).join(";")}`.toLowerCase();
  const isHeader = el.name.toLowerCase() === "th";
  const isPrice = /\bprice\b/.test(cls) || lower.includes("data-price");
  const isParam = /\bparam-name\b/.test(cls) || lower.includes("background-color: #f4f6f8");
  const isDiff = /\bdiff\b/.test(cls) || lower.includes("#fff3cd") || lower.includes("#fff1bf") || lower.includes("255, 165, 0");
  const isSection = /\bsection-header\b|\bsection-title\b/.test(cls) || lower.includes("background-color: #22252a") || lower.includes("background-color: #1f2329");

  const cell: ParsedCell = {
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
    isSection,
  };

  const imageSrc = firstImageSrc(el);
  if (imageSrc) cell.imageSrc = imageSrc;
  return cell;
}

function parseRow(el: Element, fallbackKind: ParsedRow["kind"], rules: CssRule[]): ParsedRow {
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

function maxColumns(rows: ParsedRow[]): number {
  return Math.max(
    0,
    ...rows.map((row) => row.cells.reduce((sum, cell) => sum + Math.max(1, cell.colspan), 0)),
  );
}

function normalizeRowspans(rows: ParsedRow[], columnCount: number): ParsedRow[] {
  const active: Array<{ remaining: number; cell: ParsedCell } | undefined> = [];
  const normalized: ParsedRow[] = [];

  for (const row of rows) {
    const cells: ParsedCell[] = [];
    let sourceIndex = 0;

    for (let col = 0; col < columnCount;) {
      const activeCell = active[col];
      if (activeCell && activeCell.remaining > 0) {
        const { imageSrc: _imageSrc, ...cellWithoutImage } = activeCell.cell;
        const placeholder: ParsedCell = {
          ...cellWithoutImage,
          text: "",
          inlines: [],
          colspan: 1,
          rowspan: 1,
          isSpanPlaceholder: true,
          isSpanPlaceholderEnd: activeCell.remaining === 1,
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
          isSection: false,
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

function parseTable(tableEl: Element, rules: CssRule[]): ParsedTable {
  const thead = findFirst(tableEl, (el) => el.name.toLowerCase() === "thead");
  const tbody = findFirst(tableEl, (el) => el.name.toLowerCase() === "tbody");

  const headRows = thead
    ? directElementChildren(thead, "tr").map((row) => parseRow(row, "header", rules))
    : [];

  const bodyRows = tbody
    ? directElementChildren(tbody, "tr").map((row) => parseRow(row, "body", rules))
    : directElementChildren(tableEl, "tr").map((row) => parseRow(row, "body", rules));
  const tfoot = findFirst(tableEl, (el) => el.name.toLowerCase() === "tfoot");
  const footRows = tfoot
    ? directElementChildren(tfoot, "tr").map((row) => parseRow(row, "body", rules))
    : [];

  const columnCount = Math.max(1, maxColumns([...headRows, ...bodyRows, ...footRows]));

  return {
    headRows: normalizeRowspans(headRows, columnCount),
    bodyRows: normalizeRowspans([...bodyRows, ...footRows], columnCount),
    columnCount,
  };
}

function styleText(root: AnyNode[]): string {
  return findAll(root, (el) => el.name.toLowerCase() === "style")
    .map((el) => textWithBreaks(el))
    .join("\n");
}

function bodyChildren(roots: AnyNode[]): AnyNode[] {
  const body = findFirst(roots, (el) => el.name.toLowerCase() === "body");
  return body?.children ?? roots;
}

function parseFlowBlocks(nodes: AnyNode[], rules: CssRule[], blocks: ParsedBlock[] = []): ParsedBlock[] {
  let listStack: Array<{ ordered: boolean; index: number }> = [];

  const isHidden = (style: Record<string, string>) =>
    style["display"]?.trim().toLowerCase() === "none" || style["visibility"]?.trim().toLowerCase() === "hidden";
  const isPageBreak = (value: string | undefined) => {
    const v = value?.trim().toLowerCase();
    return v === "always" || v === "page" || v === "left" || v === "right";
  };

  const visit = (node: AnyNode): void => {
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
    if (/^h[1-6]$/.test(name)) {
      const inlines = normalizeInlineSegments(parseInlineSegments(node, rules, style));
      const text = inlineText(inlines) || normalizeWhitespace(textWithBreaks(node));
      if (text) blocks.push({ type: "heading", level: Number(name.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6, text, inlines, style });
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

function parseContactItems(root: AnyNode[]): { items: string[]; qrSrc?: string } {
  const card = findFirst(root, (el) => hasClass(el, "contact-card"));
  if (!card) return { items: [] };

  const itemEls = findAll(card, (el) => hasClass(el, "contact-item"));
  const items = itemEls.map((el) => normalizeWhitespace(textWithBreaks(el))).filter(Boolean);
  const qr = findFirst(card, (el) => hasClass(el, "contact-qr"));
  const img = qr ? findFirst(qr, (el) => el.name.toLowerCase() === "img") : undefined;
  const qrSrc = img ? attr(img, "src").trim() : "";

  return qrSrc ? { items, qrSrc } : { items };
}

export function parsePrintableHtml(html: string): ParsedDocument {
  const doc = parseDocument(html, { decodeEntities: true });
  const roots = doc.children ?? [];
  const rules = parseCssRules(styleText(roots));

  const brandEl = findFirst(roots, (el) => hasClass(el, "brand-name"));
  const titleEl = findFirst(roots, (el) => el.name.toLowerCase() === "title");
  const brandText = brandEl
    ? normalizeWhitespace(textWithBreaks(brandEl))
    : titleEl
      ? normalizeWhitespace(textWithBreaks(titleEl))
      : "DOCUMENT";
  const contacts = parseContactItems(roots);
  const blocks = parseFlowBlocks(bodyChildren(roots), rules);
  if (blocks.length === 0) {
    const text = normalizeWhitespace(textWithBreaks(doc));
    if (text) blocks.push({ type: "paragraph", text, inlines: [{ text, styles: {} }], style: {} });
  }
  const primaryTable = blocks.find((block): block is Extract<ParsedBlock, { type: "table" }> => block.type === "table")?.table;

  const parsed: ParsedDocument = {
    brandText: brandText || "DOCUMENT",
    contactItems: contacts.items,
    blocks,
  };
  if (primaryTable) parsed.primaryTable = primaryTable;
  if (contacts.qrSrc) parsed.contactQrSrc = contacts.qrSrc;
  return parsed;
}
