import { parseDocument } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import { DomUtils } from "htmlparser2";
import { parseCssRules, resolveElementStyle, type CssRule } from "./css";
import type { ParsedBlock, ParsedCell, ParsedDocument, ParsedRow, ParsedTable } from "./types";

function isElement(node: AnyNode | null | undefined): node is Element {
  return !!node && node.type === "tag";
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
  return DomUtils.findAll((node) => isElement(node) && predicate(node), nodes) as Element[];
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
  const text = normalizeWhitespace(textWithBreaks(el));
  const lower = `${cls} ${style} ${Object.entries(styles).map(([k, v]) => `${k}:${v}`).join(";")}`.toLowerCase();
  const isHeader = el.name.toLowerCase() === "th";
  const isPrice = /\bprice\b/.test(cls) || lower.includes("data-price");
  const isParam = /\bparam-name\b/.test(cls) || lower.includes("background-color: #f4f6f8");
  const isDiff = /\bdiff\b/.test(cls) || lower.includes("#fff3cd") || lower.includes("#fff1bf") || lower.includes("255, 165, 0");
  const isSection = /\bsection-header\b|\bsection-title\b/.test(cls) || lower.includes("background-color: #22252a") || lower.includes("background-color: #1f2329");

  const cell: ParsedCell = {
    text,
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

  return { cells, kind };
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

  const columnCount = Math.max(1, maxColumns([...headRows, ...bodyRows]));

  return {
    headRows: normalizeRowspans(headRows, columnCount),
    bodyRows: normalizeRowspans(bodyRows, columnCount),
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

  const visit = (node: AnyNode): void => {
    if (!isElement(node)) return;
    const name = node.name.toLowerCase();
    if (name === "script" || name === "style" || name === "meta" || name === "title") return;
    if (hasClass(node, "contact-card") || hasClass(node, "brand-name") || name === "header") return;

    const style = resolveElementStyle(node, rules);
    if (name === "table") {
      blocks.push({ type: "table", table: parseTable(node, rules), style });
      return;
    }
    if (/^h[1-6]$/.test(name)) {
      const text = normalizeWhitespace(textWithBreaks(node));
      if (text) blocks.push({ type: "heading", level: Number(name.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6, text, style });
      return;
    }
    if (name === "p") {
      const text = normalizeWhitespace(textWithBreaks(node));
      if (text) blocks.push({ type: "paragraph", text, style });
      return;
    }
    if (name === "img") {
      const src = attr(node, "src").trim();
      if (src) blocks.push({ type: "image", src, alt: attr(node, "alt"), style });
      return;
    }
    if (name === "hr") {
      blocks.push({ type: "hr", style });
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
      if (text) blocks.push({ type: "list-item", text, ordered: current.ordered, index: current.index, style });
      return;
    }

    for (const child of node.children ?? []) visit(child);
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
    if (text) blocks.push({ type: "paragraph", text, style: {} });
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
