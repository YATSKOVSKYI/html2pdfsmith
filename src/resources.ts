import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseDocument } from "htmlparser2";
import { DomUtils } from "htmlparser2";
import type { AnyNode, Element } from "domhandler";
import type { PdfResourcePolicy, PdfStylesheet, RenderHtmlToPdfOptions } from "./types";
import type { WarningSink } from "./warnings";

type ResourceKind = "data" | "http" | "file";
type ResourceType = "image" | "stylesheet";

interface ResolvedResource {
  kind: ResourceKind;
  value: string;
  display: string;
}

export interface LoadedResource {
  bytes: Uint8Array;
  mime: string;
  display: string;
}

function isElement(node: AnyNode | null | undefined): node is Element {
  return !!node && (node.type === "tag" || node.type === "style" || node.type === "script");
}

function policyValue(policy: PdfResourcePolicy | undefined, key: keyof PdfResourcePolicy, fallback: boolean): boolean {
  const value = policy?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function timeoutMs(policy: PdfResourcePolicy | undefined): number {
  return policy?.timeoutMs ?? 10_000;
}

function maxBytes(policy: PdfResourcePolicy | undefined, type: ResourceType): number {
  return type === "image"
    ? policy?.maxImageBytes ?? Number.POSITIVE_INFINITY
    : policy?.maxStylesheetBytes ?? 1_000_000;
}

function isDataUrl(value: string): boolean {
  return /^data:/i.test(value);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isFileUrl(value: string): boolean {
  return /^file:\/\//i.test(value);
}

function baseToUrl(baseUrl: string | undefined): URL | undefined {
  if (!baseUrl) return undefined;
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
    // Keep the resolved path as-is when stat fails.
  }
  return pathToFileURL(basePath.endsWith("/") || basePath.endsWith("\\") ? basePath : `${basePath}/`);
}

export function resolveResource(src: string, baseUrl: string | undefined): ResolvedResource {
  const trimmed = src.trim();
  if (isDataUrl(trimmed)) return { kind: "data", value: trimmed, display: "data URL" };
  if (isHttpUrl(trimmed)) return { kind: "http", value: trimmed, display: trimmed };
  if (isFileUrl(trimmed)) {
    const filePath = fileURLToPath(trimmed);
    return { kind: "file", value: filePath, display: filePath };
  }
  if (isAbsolute(trimmed)) return { kind: "file", value: trimmed, display: trimmed };

  const base = baseToUrl(baseUrl);
  if (base) {
    const resolvedUrl = new URL(trimmed, base);
    if (resolvedUrl.protocol === "http:" || resolvedUrl.protocol === "https:") {
      return { kind: "http", value: resolvedUrl.toString(), display: resolvedUrl.toString() };
    }
    if (resolvedUrl.protocol === "file:") {
      const filePath = fileURLToPath(resolvedUrl);
      return { kind: "file", value: filePath, display: filePath };
    }
  }

  const filePath = resolve(trimmed);
  return { kind: "file", value: filePath, display: filePath };
}

function parseDataUrl(src: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/is.exec(src);
  if (!match) throw new Error("Invalid data URL");
  const mime = (match[1] || "application/octet-stream").toLowerCase();
  const payload = match[2] ?? "";
  const isBase64 = /^data:[^,]*;base64,/i.test(src);
  const bytes = isBase64
    ? Buffer.from(payload, "base64")
    : Buffer.from(decodeURIComponent(payload), "utf8");
  return { bytes, mime };
}

function enforceAllowed(resource: ResolvedResource, type: ResourceType, policy: PdfResourcePolicy | undefined): void {
  if (resource.kind === "data" && !policyValue(policy, "allowData", true)) {
    throw new Error(`${type} data URLs are blocked by resourcePolicy.allowData=false`);
  }
  if (resource.kind === "http" && !policyValue(policy, "allowHttp", true)) {
    throw new Error(`${type} HTTP resources are blocked by resourcePolicy.allowHttp=false`);
  }
  if (resource.kind === "file" && !policyValue(policy, "allowFile", true)) {
    throw new Error(`${type} file resources are blocked by resourcePolicy.allowFile=false`);
  }
}

function enforceSize(size: number, limit: number, type: ResourceType, display: string): void {
  if (size > limit) {
    throw new Error(`${type} resource is too large (${size} bytes > ${limit} bytes): ${display}`);
  }
}

export async function loadResource(
  src: string,
  type: ResourceType,
  warnings: WarningSink,
  options: Pick<RenderHtmlToPdfOptions, "baseUrl" | "resourcePolicy"> = {},
): Promise<LoadedResource | null> {
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
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength)) enforceSize(contentLength, limit, type, resource.display);
      const bytes = new Uint8Array(await response.arrayBuffer());
      enforceSize(bytes.byteLength, limit, type, resource.display);
      return { bytes, mime: response.headers.get("content-type") ?? "application/octet-stream", display: resource.display };
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

function extractLinkedStylesheets(html: string): string[] {
  const doc = parseDocument(html, { decodeEntities: true });
  const roots = doc.children ?? [];
  const links = DomUtils.findAll((node) => {
    if (!isElement(node) || node.name.toLowerCase() !== "link") return false;
    const rel = node.attribs?.["rel"]?.toLowerCase().split(/\s+/) ?? [];
    return rel.includes("stylesheet") && Boolean(node.attribs?.["href"]);
  }, roots) as Element[];
  return links.map((link) => link.attribs?.["href"]?.trim()).filter((href): href is string => Boolean(href));
}

async function loadStylesheetSource(
  source: PdfStylesheet,
  warnings: WarningSink,
  options: Pick<RenderHtmlToPdfOptions, "baseUrl" | "resourcePolicy">,
): Promise<string> {
  if (typeof source !== "string") {
    if (source.content != null) return source.content;
    if (!source.href) return "";
    source = source.href;
  }

  const loaded = await loadResource(source, "stylesheet", warnings, options);
  if (!loaded) return "";
  return Buffer.from(loaded.bytes).toString("utf8");
}

function injectStyles(html: string, css: string): string {
  if (!css.trim()) return html;
  const style = `<style data-html2pdfsmith="external">\n${css}\n</style>`;
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${style}`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${style}</head>`);
  return `${style}\n${html}`;
}

export async function prepareHtmlForRender(
  options: RenderHtmlToPdfOptions,
  warnings: WarningSink,
): Promise<string> {
  const configured = options.stylesheets ?? [];
  const linked = extractLinkedStylesheets(options.html);
  if (configured.length === 0 && linked.length === 0) return options.html;

  const cssParts: string[] = [];
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
