import { renderHtmlToPdfDetailed } from "../src/index";
import { writeFileSync } from "node:fs";

const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    /*
      Ультра-минималистичный "швейцарский" дизайн инвойса.
      Никаких лишних рамок и фонов — только идеальная типографика,
      чистое пространство и элегантные линии.
    */
    body {
      font-family: 'Inter', sans-serif;
      margin: 0;
      padding: 0;
      color: #111827;
    }

    .container {
      padding-top: 10px;
    }

    /* ЗАГОЛОВОК */
    .header {
      width: 100%;
      border-bottom: 2px solid #111827;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .header td { vertical-align: bottom; }
    
    .brand {
      font-size: 28px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #111827;
    }
    .brand span { 
      color: #9ca3af; 
      font-weight: 400; 
    }
    
    .invoice-title {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #6b7280;
      font-weight: 600;
      text-align: right;
    }
    .invoice-no {
      font-size: 18px;
      font-weight: 600;
      color: #111827;
      text-align: right;
      margin-top: 4px;
    }

    /* ИНФОРМАЦИЯ О КЛИЕНТЕ И ДАТАХ */
    .meta-table {
      width: 100%;
      margin-bottom: 32px;
      font-size: 11px;
      line-height: 1.5;
    }
    .meta-table td { vertical-align: top; }
    .meta-label {
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-size: 9px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    /* ТАБЛИЦА ПОЗИЦИЙ */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    .items-table th {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #6b7280;
      font-weight: 600;
      text-align: left;
      padding-bottom: 12px;
      border-bottom: 1px solid #d1d5db;
    }
    .items-table td {
      padding: 16px 0;
      border-bottom: 1px solid #f3f4f6;
      font-size: 12px;
      vertical-align: top;
    }
    
    .right { text-align: right !important; }
    
    .item-name {
      font-weight: 600;
      color: #111827;
      margin-bottom: 4px;
      font-size: 13px;
    }
    .item-desc {
      color: #6b7280;
      font-size: 11px;
    }

    /* ИТОГИ */
    .total-table {
      width: 40%;
      margin-left: auto;
      margin-top: 24px;
      border-collapse: collapse;
    }
    .total-table td {
      padding: 10px 0;
      font-size: 12px;
      color: #4b5563;
    }
    .total-row td {
      border-top: 2px solid #111827;
      padding-top: 14px;
      font-weight: 700;
      font-size: 16px;
      color: #111827;
    }
  </style>
</head>
<body>
  <div class="container">
    <table class="header">
      <tr>
        <td>
          <div class="brand">AUTO<span>CORE</span></div>
        </td>
        <td>
          <div class="invoice-title">Invoice</div>
          <div class="invoice-no">INV-2026-001</div>
        </td>
      </tr>
    </table>

    <table class="meta-table">
      <tr>
        <td style="width: 50%;">
          <div class="meta-label">Billed To</div>
          <div style="font-weight: 600; color: #111827; font-size: 13px;">Nexus Industries</div>
          <div style="color: #4b5563; margin-top: 4px;">4200 Industrial Pkwy<br>Sector 4, Neo City</div>
        </td>
        <td style="width: 25%;">
          <div class="meta-label">Date</div>
          <div style="font-weight: 500; color: #111827; margin-bottom: 16px;">Apr 19, 2026</div>
          <div class="meta-label">Due Date</div>
          <div style="font-weight: 500; color: #111827;">May 03, 2026</div>
        </td>
        <td style="width: 25%; text-align: right;">
          <div class="meta-label">Amount Due</div>
          <div style="font-size: 24px; font-weight: 700; color: #111827; letter-spacing: -0.5px;">$2,850.00</div>
        </td>
      </tr>
    </table>

    <table class="items-table">
      <colgroup>
        <col style="width: 50%;">
        <col style="width: 15%;">
        <col style="width: 15%;">
        <col style="width: 20%;">
      </colgroup>
      <thead>
        <tr>
          <th>Description</th>
          <th class="right">Qty</th>
          <th class="right">Rate</th>
          <th class="right">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div class="item-name">V8 Engine Rebuild</div>
            <div class="item-desc">Full cylinder bore and piston replacement</div>
          </td>
          <td class="right" style="color: #4b5563;">1</td>
          <td class="right" style="color: #4b5563;">$2,400.00</td>
          <td class="right" style="font-weight: 500;">$2,400.00</td>
        </tr>
        <tr>
          <td>
            <div class="item-name">Labor</div>
            <div class="item-desc">Master Technician (Hours)</div>
          </td>
          <td class="right" style="color: #4b5563;">3</td>
          <td class="right" style="color: #4b5563;">$150.00</td>
          <td class="right" style="font-weight: 500;">$450.00</td>
        </tr>
      </tbody>
    </table>

    <table class="total-table">
      <tr>
        <td>Subtotal</td>
        <td class="right">$2,850.00</td>
      </tr>
      <tr>
        <td>Tax (0%)</td>
        <td class="right">$0.00</td>
      </tr>
      <tr class="total-row">
        <td>Total</td>
        <td class="right">$2,850.00</td>
      </tr>
    </table>
  </div>
</body>
</html>
`;

async function main() {
  console.log("Rendering minimalist professional AUTOCORE invoice...");
  
  const result = await renderHtmlToPdfDetailed({
    html,
    // Самый топовый корпоративный шрифт Inter
    font: {
      googleFont: "Inter",
      googleFonts: ["Inter"],
    },
    page: {
      size: "A4",
      // Большие отступы, чтобы документ "дышал" и смотрелся дорого
      marginMm: 24, 
    }
  });

  const outputPath = "examples/autocore-invoice.pdf";
  writeFileSync(outputPath, result.pdf);
  
  console.log(`\n✅ Invoice successfully generated: ${outputPath}`);
}

main().catch(console.error);
