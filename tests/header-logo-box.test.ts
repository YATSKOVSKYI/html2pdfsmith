import { describe, expect, test } from "bun:test";
import { HEADER_LOGO_MAX_OFFSET_MM, headerLogoBox } from "../src/stream/page";
import { mm } from "../src/units";

const A4_PORTRAIT_CONTENT_PT = (210 - 2 * 2.5) / 25.4 * 72; // margin 2.5mm each side
const HEADER_PT = mm(18);
const MARGIN_PT = mm(2.5);

describe("headerLogoBox", () => {
  test("matches the historical box at offset 0", () => {
    const box = headerLogoBox({
      logoScale: 100,
      contentWidthPt: A4_PORTRAIT_CONTENT_PT,
      headerHeightPt: HEADER_PT,
      marginPt: MARGIN_PT,
    });
    expect(box.widthPt).toBeCloseTo(60 + 100 * 1.8, 6);
    expect(box.heightPt).toBeCloseTo(Math.min(42, HEADER_PT - 4), 6);
    expect(box.xOffsetPt).toBe(0);
    expect(box.yOffsetPt).toBe(0);
  });

  test("translates positive offsets by the mm equivalent in pt", () => {
    const box = headerLogoBox({
      logoScale: 100,
      contentWidthPt: A4_PORTRAIT_CONTENT_PT,
      headerHeightPt: HEADER_PT,
      marginPt: MARGIN_PT,
      offsetXMm: 10,
      offsetYMm: 5,
    });
    expect(box.xOffsetPt).toBeCloseTo(mm(10), 6);
    expect(box.yOffsetPt).toBeCloseTo(mm(5), 6);
  });

  test("clamps offsets beyond ±20mm", () => {
    const box = headerLogoBox({
      logoScale: 100,
      contentWidthPt: A4_PORTRAIT_CONTENT_PT,
      headerHeightPt: HEADER_PT,
      marginPt: MARGIN_PT,
      offsetXMm: 999,
      offsetYMm: -999,
    });
    // X capped at +20mm (well within the content band for a 240pt box on A4).
    expect(box.xOffsetPt).toBeCloseTo(mm(HEADER_LOGO_MAX_OFFSET_MM), 6);
    // Y cannot go above the page top: limited to -marginPt (negative offset clamped).
    expect(box.yOffsetPt).toBeCloseTo(-MARGIN_PT, 6);
  });

  test("keeps the box on the page when nudged left past the page edge", () => {
    const box = headerLogoBox({
      logoScale: 100,
      contentWidthPt: A4_PORTRAIT_CONTENT_PT,
      headerHeightPt: HEADER_PT,
      marginPt: MARGIN_PT,
      offsetXMm: -20,
    });
    // Leftward room is only the margin, so the box stops at the physical page edge.
    expect(box.xOffsetPt).toBeCloseTo(-MARGIN_PT, 6);
  });

  test("scales the box width with logoScale", () => {
    const small = headerLogoBox({ logoScale: 50, contentWidthPt: A4_PORTRAIT_CONTENT_PT, headerHeightPt: HEADER_PT, marginPt: MARGIN_PT });
    const large = headerLogoBox({ logoScale: 150, contentWidthPt: A4_PORTRAIT_CONTENT_PT, headerHeightPt: HEADER_PT, marginPt: MARGIN_PT });
    expect(large.widthPt).toBeGreaterThan(small.widthPt);
    expect(small.widthPt).toBeCloseTo(60 + 50 * 1.8, 6);
  });
});
