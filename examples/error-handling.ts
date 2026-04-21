import { Html2PdfError, renderHtmlToPdfDetailed, type RenderWarning } from "../src/index";
import { writeExamplePdf } from "./output";

const html = `<!doctype html>
<html>
  <body>
    <h1>Error Handling Example</h1>
    <p>This render intentionally references an HTTP image while HTTP resources are blocked.</p>
    <img src="https://example.invalid/logo.png" style="width: 96px; height: 48px">
    <table>
      <thead><tr><th>Mode</th><th>Behavior</th></tr></thead>
      <tbody>
        <tr><td>Recoverable</td><td>Render PDF and collect warnings.</td></tr>
        <tr><td>Fail closed</td><td>Throw from onWarning for production policy violations.</td></tr>
      </tbody>
    </table>
  </body>
</html>`;

function isFatalWarning(warning: RenderWarning): boolean {
  return warning.code.endsWith("_load_failed")
    || warning.code === "qpdf_failed"
    || warning.code === "font_fallback";
}

const recoverable = await renderHtmlToPdfDetailed({
  html,
  resourcePolicy: {
    allowHttp: false,
    allowFile: true,
    allowData: true,
  },
  onWarning(warning) {
    console.warn(`[recoverable:${warning.code}] ${warning.message}`);
  },
});

const output = await writeExamplePdf("error-handling.pdf", recoverable.pdf);
console.log({
  mode: "recoverable",
  output,
  pages: recoverable.pages,
  warnings: recoverable.warnings.map((warning) => warning.code),
});

try {
  await renderHtmlToPdfDetailed({
    html,
    resourcePolicy: {
      allowHttp: false,
      allowFile: true,
      allowData: true,
    },
    onWarning(warning) {
      if (isFatalWarning(warning)) {
        throw new Error(`PDF render rejected: ${warning.code}: ${warning.message}`);
      }
    },
  });
} catch (error) {
  if (error instanceof Html2PdfError) {
    console.error({ mode: "fail-closed", source: "html2pdfsmith", name: error.name, message: error.message });
  } else if (error instanceof Error) {
    console.error({ mode: "fail-closed", source: "application-policy", name: error.name, message: error.message });
  } else {
    throw error;
  }
}
