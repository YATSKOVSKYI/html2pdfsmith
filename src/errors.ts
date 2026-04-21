/**
 * Base class for all html2pdfsmith errors.
 */
export class Html2PdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Html2PdfError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a resource (image, css, font) is blocked by the configured resourcePolicy,
 * or exceeds size limits.
 */
export class ResourcePolicyError extends Html2PdfError {
  constructor(message: string) {
    super(message);
    this.name = "ResourcePolicyError";
  }
}

/**
 * Thrown when a network request for a resource or font fails (e.g. HTTP 404 or timeout).
 */
export class ResourceLoadError extends Html2PdfError {
  constructor(message: string) {
    super(message);
    this.name = "ResourceLoadError";
  }
}

/**
 * Thrown when there is an issue resolving or fetching Google Fonts.
 */
export class FontLoadError extends Html2PdfError {
  constructor(message: string) {
    super(message);
    this.name = "FontLoadError";
  }
}

/**
 * Thrown when qpdf fails to protect the document.
 */
export class PdfProtectionError extends Html2PdfError {
  constructor(message: string) {
    super(message);
    this.name = "PdfProtectionError";
  }
}
