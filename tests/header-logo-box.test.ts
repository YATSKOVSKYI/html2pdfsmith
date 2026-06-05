import { describe, expect, test } from "bun:test";
import { HEADER_LOGO_MAX_OFFSET_MM, headerLogoBox } from "../src/stream/page";
import { mm } from "../src/units";

const A4_PORTRAIT_CONTENT_PT = (210 - 2 * 2.5) / 25.4 * 72; // margin 2.5mm each side
const HEADER_PT = mm(18);
const MARGIN_PT = mm(2.5);

const base = (over: Partial<Parameters<typeof headerLogoBox>[0]> = {}) =>
  headerLogoBox({
    logoScale: 100,
    contentWidthPt: A4_PORTRAIT_CONTENT_PT,
    headerHeightPt: HEADER_PT,
    marginPt: MARGIN_PT,
    ...over,
  });

describe("headerLogoBox", () => {
  test("height scales linearly with logoScale (100% ≈ 40pt)", () => {
    expect(base({ logoScale: 100 }).heightPt).toBeCloseTo(40, 6);
    expect(base({ logoScale: 50 }).heightPt).toBeCloseTo(20, 6);
    expect(base({ logoScale: 25 }).heightPt).toBeCloseTo(12, 6); // clamped to 12 min (10→4 would clamp)
  });

  test("clamps height to the 12..84pt range", () => {
    expect(base({ logoScale: 1 }).heightPt).toBeCloseTo(12, 6);
    expect(base({ logoScale: 200 }).heightPt).toBeCloseTo(80, 6);
    expect(base({ logoScale: 999 }).heightPt).toBeCloseTo(80, 6); // logoScale clamped to 200 first
  });

  test("a bigger logoScale yields a taller box", () => {
    expect(base({ logoScale: 80 }).heightPt).toBeGreaterThan(base({ logoScale: 40 }).heightPt);
  });

  test("no offset means no nudge", () => {
    const box = base();
    expect(box.xOffsetPt).toBe(0);
    expect(box.yOffsetPt).toBe(0);
  });

  test("translates positive offsets by the mm equivalent in pt", () => {
    const box = base({ offsetXMm: 10, offsetYMm: 5 });
    expect(box.xOffsetPt).toBeCloseTo(mm(10), 6);
    expect(box.yOffsetPt).toBeCloseTo(mm(5), 6);
  });

  test("clamps offsets beyond ±20mm", () => {
    const box = base({ offsetXMm: 999, offsetYMm: -999 });
    expect(box.xOffsetPt).toBeCloseTo(mm(HEADER_LOGO_MAX_OFFSET_MM), 6);
    expect(box.yOffsetPt).toBeCloseTo(-MARGIN_PT, 6); // capped at page top
  });

  test("keeps the box on the page when nudged left past the page edge", () => {
    expect(base({ offsetXMm: -20 }).xOffsetPt).toBeCloseTo(-MARGIN_PT, 6);
  });
});
