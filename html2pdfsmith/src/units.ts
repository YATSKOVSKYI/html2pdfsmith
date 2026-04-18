export const MM_TO_PT = 72 / 25.4;

export function mm(value: number): number {
  return value * MM_TO_PT;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function safeNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function a4Size(orientation: "portrait" | "landscape"): { width: number; height: number } {
  const portrait = { width: mm(210), height: mm(297) };
  return orientation === "portrait" ? portrait : { width: portrait.height, height: portrait.width };
}

export function letterSize(orientation: "portrait" | "landscape"): { width: number; height: number } {
  const portrait = { width: 612, height: 792 };
  return orientation === "portrait" ? portrait : { width: portrait.height, height: portrait.width };
}

export function calculateFontScale(columns: number): number {
  if (columns <= 1) return 85;
  if (columns <= 3) return 80;
  if (columns <= 5) return 75;
  if (columns <= 6) return 72;
  if (columns <= 8) return 68;
  if (columns <= 9) return 65;
  if (columns <= 11) return 62;
  if (columns <= 12) return 60;
  if (columns <= 14) return 58;
  if (columns <= 16) return 55;
  return 52;
}

export function calculatePaddingScale(columns: number): number {
  if (columns <= 1) return 1;
  if (columns <= 3) return 0.9;
  if (columns <= 5) return 0.75;
  if (columns <= 6) return 0.7;
  if (columns <= 8) return 0.65;
  if (columns <= 9) return 0.6;
  if (columns <= 11) return 0.55;
  if (columns <= 12) return 0.5;
  if (columns <= 14) return 0.45;
  if (columns <= 16) return 0.4;
  return 0.35;
}

export function calculateHeaderCellHeight(columns: number): number {
  if (columns <= 1) return 100;
  if (columns <= 3) return 90;
  if (columns <= 5) return 80;
  if (columns <= 6) return 70;
  if (columns <= 8) return 65;
  if (columns <= 9) return 60;
  if (columns <= 10) return 55;
  if (columns <= 11) return 50;
  if (columns <= 12) return 45;
  if (columns <= 14) return 42;
  return 38;
}

export function determineOrientation(columns: number): "portrait" | "landscape" {
  return columns <= 3 ? "portrait" : "landscape";
}
