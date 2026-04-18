import { PDFDocument } from "pdf-lib";
import { fileURLToPath } from "node:url";
import { renderHtmlToPdfDetailed } from "../src/index";

process.env.HTML2PDFSMITH_CACHE_DIR ??= fileURLToPath(new URL("../tmp/cache", import.meta.url));

async function writeExamplePdf(filename: string, pdf: Uint8Array): Promise<string> {
  const target = new URL(filename, import.meta.url);
  try {
    await Bun.write(target, pdf);
    return target.pathname;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("EBUSY")) throw error;
    const fallback = new URL(filename.replace(/\.pdf$/i, `-${Date.now()}.pdf`), import.meta.url);
    await Bun.write(fallback, pdf);
    return fallback.pathname;
  }
}

const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    h1 {
      font-family: "Inter";
      font-size: 22px;
      margin-bottom: 10px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #9aa4b2;
    }
    th, td {
      border: 1px solid #d0d7e2;
      padding: 7px 10px;
      font-size: 9.5pt;
    }
    thead th {
      font-family: "Inter";
      font-size: 12pt;
      font-weight: 700;
      text-align: center;
      background-color: #edf2f7;
    }
    .left {
      font-family: "Roboto";
      text-align: left;
      padding-left: 14px;
    }
    .center {
      font-family: "Lato";
      text-align: center;
      font-size: 11pt;
      font-weight: 400;
    }
    .right {
      font-family: "Merriweather";
      text-align: right;
      font-size: 10pt;
      font-weight: 700;
      padding-right: 16px;
    }
    .normal-head {
      font-weight: 400;
      background-color: #f8fafc;
    }
    .big {
      font-size: 14pt;
      font-weight: 700;
      color: #1d4ed8;
    }
    .small {
      font-size: 8pt;
      color: #64748b;
    }
    .italic {
      font-family: "Inter";
      font-style: italic;
      font-weight: 400;
    }
    .bold-italic {
      font-family: "Inter";
      font-style: italic;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <h1>Google Fonts Table Test</h1>
  <table>
    <thead>
      <tr>
        <th>Inter Bold Center</th>
        <th class="normal-head">Inter Normal Header</th>
        <th>Alignment</th>
        <th>Weight / Size</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="left">Roboto left padded</td>
        <td class="center">Lato centered</td>
        <td class="right">$12,450</td>
        <td><span class="big">Big blue</span> and <span class="small">small gray</span></td>
      </tr>
      <tr>
        <td class="left" style="font-weight: 700">Roboto bold left</td>
        <td class="center" style="font-weight: 400">Lato normal center</td>
        <td class="right" style="font-weight: 400">Merriweather normal right</td>
        <td><strong>Strong</strong> / <em>italic</em> / <u>underline</u></td>
      </tr>
      <tr>
        <td class="left" style="padding: 12px 18px">Large custom padding</td>
        <td class="center" style="font-size: 13pt">Centered 13pt</td>
        <td class="right" style="font-size: 8pt">Right 8pt</td>
        <td style="text-align: center; font-family: 'Roboto'">Cell-level center</td>
      </tr>
      <tr>
        <td class="italic">Inter italic 400</td>
        <td class="bold-italic">Inter bold italic 700</td>
        <td class="right"><em>Merriweather italic via em</em></td>
        <td style="font-family: 'Lato'; font-style: italic; text-align: center">Lato CSS italic</td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;

const result = await renderHtmlToPdfDetailed({
  html,
  repeatHeaders: true,
  pageHeader: { text: "Html2PdfSmith font table", align: "right" },
  pageFooter: { text: "Google Fonts + table CSS", align: "left" },
  pageNumbers: true,
  font: {
    googleFont: "Inter",
    googleFonts: ["Roboto", "Lato", "Merriweather"],
  },
});

const loaded = await PDFDocument.load(result.pdf);
const output = await writeExamplePdf("./font-table.pdf", result.pdf);
console.log({
  output,
  pages: result.pages,
  actualPages: loaded.getPageCount(),
  bytes: result.pdf.byteLength,
  warnings: result.warnings,
});
