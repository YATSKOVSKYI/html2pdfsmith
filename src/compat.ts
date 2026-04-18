import { Buffer } from "node:buffer";
import { renderHtmlToPdfDetailed } from "./stream-render";
import type { RenderHtmlToPdfOptions, RenderHtmlToPdfResult } from "./types";

export interface ConvertHtmlToPdfLiteOptions {
  htmlContent: string;
  baseUrl?: string;
  stylesheets?: RenderHtmlToPdfOptions["stylesheets"];
  resourcePolicy?: RenderHtmlToPdfOptions["resourcePolicy"];
  recordId?: string;
  repeatHeaders?: boolean;
  hideHeader?: boolean;
  watermarkText?: string | null;
  watermarkUrl?: string | null;
  userLogoUrl?: string | null;
  logoScale?: number;
  watermarkScale?: number;
  watermarkOpacity?: number;
  patternType?: string;
  protectPdf?: boolean;
  qpdfPath?: string;
  font?: RenderHtmlToPdfOptions["font"];
  page?: RenderHtmlToPdfOptions["page"];
}

export async function convertHtmlToPdfDetailed(
  options: ConvertHtmlToPdfLiteOptions,
): Promise<RenderHtmlToPdfResult> {
  const renderOptions: RenderHtmlToPdfOptions = {
    html: options.htmlContent,
  };

  if (options.baseUrl !== undefined) renderOptions.baseUrl = options.baseUrl;
  if (options.stylesheets !== undefined) renderOptions.stylesheets = options.stylesheets;
  if (options.resourcePolicy !== undefined) renderOptions.resourcePolicy = options.resourcePolicy;
  if (options.recordId !== undefined) renderOptions.recordId = options.recordId;
  if (options.repeatHeaders !== undefined) renderOptions.repeatHeaders = options.repeatHeaders;
  if (options.hideHeader !== undefined) renderOptions.hideHeader = options.hideHeader;
  if (options.watermarkText !== undefined) renderOptions.watermarkText = options.watermarkText;
  if (options.watermarkUrl !== undefined) renderOptions.watermarkUrl = options.watermarkUrl;
  if (options.userLogoUrl !== undefined) renderOptions.userLogoUrl = options.userLogoUrl;
  if (options.logoScale !== undefined) renderOptions.logoScale = options.logoScale;
  if (options.watermarkScale !== undefined) renderOptions.watermarkScale = options.watermarkScale;
  if (options.watermarkOpacity !== undefined) renderOptions.watermarkOpacity = options.watermarkOpacity;
  if (options.patternType !== undefined) renderOptions.patternType = options.patternType;
  if (options.protectPdf !== undefined) renderOptions.protectPdf = options.protectPdf;
  if (options.qpdfPath !== undefined) renderOptions.qpdfPath = options.qpdfPath;
  if (options.font !== undefined) renderOptions.font = options.font;
  if (options.page !== undefined) renderOptions.page = options.page;

  return renderHtmlToPdfDetailed(renderOptions);
}

export async function convertHtmlToPdf(options: ConvertHtmlToPdfLiteOptions): Promise<Buffer> {
  const result = await convertHtmlToPdfDetailed(options);
  return Buffer.from(result.pdf);
}
