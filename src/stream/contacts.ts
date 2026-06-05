import SVGtoPDF from "svg-to-pdfkit";
import type { HeaderContactIcon } from "../types";
import { safeNumber } from "../units";
import { COLORS, type StreamContext } from "./layout";
import { drawAssetSafely } from "./assets";

/**
 * Built-in contact / social glyphs. Each is a self-contained 24×24 SVG with
 * explicit colours (no `currentColor`) so svg-to-pdfkit renders it faithfully.
 * Contact icons are ink-coloured; social badges use brand colours so the QR
 * badge reads at a glance.
 */
const ICONS: Record<HeaderContactIcon, string> = {
  phone:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${COLORS.text}" d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.05-.24 12.36 12.36 0 0 0 3.54.57 1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1C10.07 20.01 3.99 13.93 3.99 5a1 1 0 0 1 1-1H8.5a1 1 0 0 1 1 1c0 1.21.2 2.42.57 3.54a1 1 0 0 1-.24 1.05l-2.2 2.2z"/></svg>`,
  email:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.4" fill="none" stroke="${COLORS.text}" stroke-width="1.7"/><path d="M3.2 6.6 12 13l8.8-6.4" fill="none" stroke="${COLORS.text}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  globe:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="${COLORS.text}" stroke-width="1.7"/><path d="M3 12h18M12 3c3.2 2.6 3.2 15.4 0 18M12 3c-3.2 2.6-3.2 15.4 0 18" fill="none" stroke="${COLORS.text}" stroke-width="1.7"/></svg>`,
  telegram:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#229ED9"/><path fill="#fff" d="M5.5 11.8 17 7.3c.6-.23 1.12.14.92.99l-1.96 9.23c-.14.66-.54.82-1.1.51l-3.04-2.24-1.46 1.41c-.16.16-.3.3-.6.3l.21-3.06 5.56-5.02c.24-.21-.05-.33-.37-.12l-6.87 4.33-2.96-.92c-.64-.2-.66-.64.14-.95z"/></svg>`,
  wechat:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#07C160"/><path fill="#fff" d="M9.3 6.2c-2.9 0-5.3 1.94-5.3 4.36 0 1.4.79 2.65 2.03 3.46l-.5 1.5 1.78-.9c.63.16 1.3.25 1.99.25.18 0 .35-.01.52-.03a3.9 3.9 0 0 1-.16-1.1c0-2.3 2.2-4.06 4.86-4.06l.34.01C14.4 7.74 12.06 6.2 9.3 6.2zm-1.74 2.4a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4zm3.5 0a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4z"/><path fill="#fff" d="M20 13.9c0-2-2-3.62-4.45-3.62-2.52 0-4.45 1.62-4.45 3.62s1.93 3.62 4.45 3.62c.55 0 1.08-.08 1.57-.22l1.45.78-.4-1.27c.93-.66 1.83-1.6 1.83-2.91zm-5.9-.98a.58.58 0 1 1 0 1.16.58.58 0 0 1 0-1.16zm2.9 0a.58.58 0 1 1 0 1.16.58.58 0 0 1 0-1.16z"/></svg>`,
  whatsapp:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#25D366"/><path fill="#fff" d="M12 5.4a6.5 6.5 0 0 0-5.56 9.86L5.6 18.6l3.43-.9A6.5 6.5 0 1 0 12 5.4zm0 1.5a5 5 0 0 1 4.2 7.7l-.18.28.5 1.83-1.88-.49-.27.16a5 5 0 1 1-2.37-9.49zm-2.5 2.5c-.13 0-.34.05-.52.24-.18.2-.68.67-.68 1.62 0 .96.7 1.88.8 2.01.1.13 1.37 2.18 3.4 2.98 1.68.66 2.02.53 2.39.5.37-.04 1.18-.49 1.35-.96.17-.47.17-.87.12-.96-.05-.08-.18-.13-.38-.23-.2-.1-1.18-.58-1.36-.65-.18-.07-.31-.1-.45.1-.13.2-.51.65-.63.78-.12.13-.23.15-.43.05-.2-.1-.85-.31-1.62-1-.6-.53-1-1.19-1.12-1.39-.12-.2-.01-.3.09-.4.09-.09.2-.23.3-.35.1-.12.13-.2.2-.34.06-.13.03-.25-.02-.35-.05-.1-.44-1.1-.62-1.5-.16-.39-.32-.34-.44-.34z"/></svg>`,
  instagram:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="0" y="0" width="24" height="24" rx="6" fill="#E4405F"/><rect x="5" y="5" width="14" height="14" rx="4.4" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="12" cy="12" r="3.4" fill="none" stroke="#fff" stroke-width="1.7"/><circle cx="16.4" cy="7.6" r="1.1" fill="#fff"/></svg>`,
  facebook:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path fill="#fff" d="M13.3 19v-6h2l.4-2.4h-2.4V9.1c0-.7.2-1.18 1.2-1.18h1.27V5.8c-.22-.03-.98-.1-1.86-.1-1.84 0-3.1 1.12-3.1 3.18v1.72H8.6V13h2.21v6z"/></svg>`,
  youtube:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1.5" y="5" width="21" height="14" rx="4.5" fill="#FF0000"/><path fill="#fff" d="M10 9.2v5.6l4.8-2.8z"/></svg>`,
  viber:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#7360F2"/><path fill="#fff" d="M12 5.6c-3.3 0-6 2.4-6 5.7 0 1.5.6 2.9 1.6 3.9l-.5 2.2 2.3-1.1c.8.3 1.7.5 2.6.5 3.3 0 6-2.4 6-5.5s-2.7-5.7-6-5.7zm-2.6 3.1c.13 0 .35.04.52.43.13.3.45 1.1.49 1.18.04.08.07.18.01.3-.06.12-.1.18-.19.28-.09.1-.19.22-.27.3-.09.08-.18.17-.08.34.1.17.46.74 1 1.2.69.6 1.27.78 1.45.86.18.08.28.07.39-.04.1-.12.45-.52.57-.7.12-.18.24-.15.4-.09.17.06 1.06.5 1.24.59.18.09.3.13.34.2.04.08.04.43-.12.84-.16.41-.94.79-1.28.82-.34.03-.66.16-2.22-.46-1.88-.74-3.05-2.65-3.14-2.77-.09-.12-.74-.98-.74-1.87 0-.89.47-1.33.63-1.51.16-.18.35-.23.47-.23z"/></svg>`,
  linkedin:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#0A66C2"/><path fill="#fff" d="M7.2 9.6H4.9V19h2.3V9.6zM6.05 8.5a1.34 1.34 0 1 0 0-2.68 1.34 1.34 0 0 0 0 2.68zM19.1 19v-5.16c0-2.76-1.47-4.04-3.44-4.04-1.59 0-2.3.87-2.69 1.49V9.6H10.7c.03.65 0 9.4 0 9.4h2.27v-5.25c0-.2.01-.41.07-.55.17-.4.54-.83 1.18-.83.83 0 1.16.63 1.16 1.56V19z"/></svg>`,
  x:
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#000"/><path fill="#fff" d="M13.94 10.78 18.5 5.5h-1.3l-3.84 4.46L10.2 5.5H6.2l4.78 6.96L6.2 18.5h1.3l4.06-4.72 3.34 4.72h4l-4.96-7.72zm-1.44 1.67-.47-.67-3.85-5.5h1.86l3.02 4.32.47.67 3.93 5.62h-1.86l-3.1-4.46z"/></svg>`,
};

/** Draw a built-in glyph at (x, y) sized to `size` (pt). Silent on failure. */
export function drawContactIcon(ctx: StreamContext, icon: HeaderContactIcon | undefined | null, x: number, y: number, size: number): void {
  if (!icon) return;
  const svg = ICONS[icon];
  if (!svg) return;
  try {
    ctx.doc.save();
    SVGtoPDF(ctx.doc, svg, x, y, { width: size, height: size, assumePt: true, preserveAspectRatio: "xMidYMid meet" });
    ctx.doc.restore();
  } catch (error) {
    ctx.warnings.add("contact_icon_failed", `Failed to draw contact icon "${icon}": ${String(error)}`);
  }
}

const ROW_GAP = 7;
const ICON_TEXT_GAP = 6;
const ICON_SIZE = 11;
const TEXT_SIZE = 9;

/**
 * Render the structured header contact block on the right side of the header.
 * Returns the x of the block's left edge (so callers can avoid overlap), or the
 * incoming `right` when nothing was drawn.
 *
 * Layout mirrors the editor preview: an optional QR (with a centered social
 * badge) is the right-most element, and the icon+text rows sit to its left,
 * the whole block vertically centred in the header band.
 */
export function drawHeaderContacts(ctx: StreamContext, top: number, headerHeight: number): number {
  const contacts = ctx.options.headerContacts;
  if (!contacts) return ctx.pageWidth - ctx.margin;

  let right = ctx.pageWidth - ctx.margin;

  // ── QR (right-most) ───────────────────────────────────────────────
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

  // ── Icon + text rows (to the left of the QR) ─────────────────────
  const items = (contacts.items ?? []).filter((item) => safeNumber(item.text?.length, 0) > 0).slice(0, 5);
  if (items.length === 0) return right;

  const font = ctx.regularFontName;
  ctx.doc.font(font).fontSize(TEXT_SIZE);

  const leftRoom = right - ctx.margin - 150; // keep clear of the logo
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
      ellipsis: true,
    });
    if (item.href) {
      try {
        ctx.doc.link(textX, textY - 1, textWidth, TEXT_SIZE + 2, item.href);
      } catch {
        /* link annotations are best-effort */
      }
    }
    y += rowHeight;
  }

  return blockX;
}
