import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { basename, delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

interface Fixture {
  name: string;
  script: string;
  pdf: string;
}

interface PngImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

interface DiffResult {
  totalPixels: number;
  changedPixels: number;
  changedRatio: number;
  maxDelta: number;
  avgDelta: number;
}

const fixtures: Fixture[] = [
  { name: "simple-document", script: "examples/simple-document.ts", pdf: "tmp/pdfs/simple-document.pdf" },
  { name: "css-table", script: "examples/css-table.ts", pdf: "tmp/pdfs/css-table.pdf" },
  { name: "visual-css-controls", script: "examples/visual-css-controls.ts", pdf: "tmp/pdfs/visual-css-controls.pdf" },
  { name: "wide-table-pagination", script: "examples/wide-table-pagination.ts", pdf: "tmp/pdfs/wide-table-pagination.pdf" },
  { name: "inline-badges", script: "examples/inline-badges.ts", pdf: "tmp/pdfs/inline-badges.pdf" },
];

const args = new Set(process.argv.slice(2));
const update = args.has("--update");
const dpi = numberArg("--dpi", 110);
const pixelTolerance = numberArg("--pixel-tolerance", 8);
const maxDiffRatio = numberArg("--max-diff-ratio", 0.001);
const selected = stringArg("--fixtures")?.split(",").map((item) => item.trim()).filter(Boolean);

const root = fileURLToPath(new URL("..", import.meta.url));
const baselineDir = join(root, "examples", "visual-baselines");
const currentDir = join(root, "tmp", "visual", "current");
const diffDir = join(root, "tmp", "visual", "diff");
let pdftoppmCommand = "pdftoppm";

function stringArg(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function numberArg(name: string, fallback: number): number {
  const raw = stringArg(name);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function ensureCommand(command: string): Promise<void> {
  try {
    const proc = Bun.spawn([command, "-v"], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
  } catch {
    throw new Error(
      `${command} was not found. Install Poppler and make sure ${command} is in PATH. ` +
      "Windows: install poppler-utils and add its bin directory to PATH. macOS: brew install poppler. Ubuntu/Debian: apt-get install poppler-utils.",
    );
  }
}

async function addLocalPopplerToPath(): Promise<void> {
  if (process.platform !== "win32") return;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return;
  const popplerRoot = join(localAppData, "Programs", "poppler");
  if (!existsSync(popplerRoot)) return;
  const entries = await readdir(popplerRoot, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("poppler-"))
    .map((entry) => join(popplerRoot, entry.name, "Library", "bin"))
    .filter((bin) => existsSync(join(bin, "pdftoppm.exe")))
    .sort()
    .reverse();
  const bin = candidates[0];
  if (!bin) return;
  pdftoppmCommand = join(bin, "pdftoppm.exe");
  const currentPath = process.env.PATH ?? process.env.Path ?? "";
  const pathParts = currentPath.split(delimiter).filter(Boolean);
  if (!pathParts.some((part) => part.toLowerCase() === bin.toLowerCase())) {
    process.env.PATH = `${bin}${delimiter}${currentPath}`;
    process.env.Path = process.env.PATH;
  }
}

async function run(command: string[], label: string): Promise<void> {
  const proc = Bun.spawn(command, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) {
    throw new Error(`${label} failed with exit ${code}\n${stdout}\n${stderr}`.trim());
  }
}

async function renderPdfToPngs(pdfPath: string, outPrefix: string): Promise<string[]> {
  await run([pdftoppmCommand, "-png", "-r", String(dpi), pdfPath, outPrefix], `pdftoppm ${basename(pdfPath)}`);
  const dir = resolve(outPrefix, "..");
  const prefixBase = basename(outPrefix);
  const files = (await readdir(dir))
    .filter((file) => file.startsWith(`${prefixBase}-`) && file.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((file) => join(dir, file));
  if (files.length === 0) throw new Error(`pdftoppm produced no PNG pages for ${pdfPath}`);
  return files;
}

function readUInt32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  ) >>> 0;
}

function bytesPerPixel(colorType: number): number {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 3) return 1;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type ${colorType}`);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(bytes: Uint8Array): PngImage {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error("Invalid PNG signature");

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];

  while (offset < bytes.length) {
    const length = readUInt32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = readUInt32(data, 0);
      height = readUInt32(data, 4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "PLTE") {
      palette = new Uint8Array(data);
    } else if (type === "tRNS") {
      transparency = new Uint8Array(data);
    } else if (type === "IDAT") {
      idat.push(new Uint8Array(data));
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported");
  if (!width || !height) throw new Error("PNG is missing IHDR dimensions");

  const compressed = Buffer.concat(idat.map((chunk) => Buffer.from(chunk)));
  const inflated = new Uint8Array(inflateSync(compressed));
  const bpp = bytesPerPixel(colorType);
  const stride = width * bpp;
  const raw = new Uint8Array(height * stride);
  let src = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[src++]!;
    const row = y * stride;
    const prev = y > 0 ? row - stride : -1;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? raw[row + x - bpp]! : 0;
      const up = prev >= 0 ? raw[prev + x]! : 0;
      const upLeft = prev >= 0 && x >= bpp ? raw[prev + x - bpp]! : 0;
      const value = inflated[src++]!;
      if (filter === 0) raw[row + x] = value;
      else if (filter === 1) raw[row + x] = (value + left) & 255;
      else if (filter === 2) raw[row + x] = (value + up) & 255;
      else if (filter === 3) raw[row + x] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) raw[row + x] = (value + paeth(left, up, upLeft)) & 255;
      else throw new Error(`Unsupported PNG filter ${filter}`);
    }
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const source = pixel * bpp;
    const target = pixel * 4;
    if (colorType === 0) {
      const gray = raw[source]!;
      rgba[target] = gray;
      rgba[target + 1] = gray;
      rgba[target + 2] = gray;
      rgba[target + 3] = 255;
    } else if (colorType === 2) {
      rgba[target] = raw[source]!;
      rgba[target + 1] = raw[source + 1]!;
      rgba[target + 2] = raw[source + 2]!;
      rgba[target + 3] = 255;
    } else if (colorType === 3) {
      if (!palette) throw new Error("Indexed PNG is missing PLTE");
      const index = raw[source]!;
      rgba[target] = palette[index * 3] ?? 0;
      rgba[target + 1] = palette[index * 3 + 1] ?? 0;
      rgba[target + 2] = palette[index * 3 + 2] ?? 0;
      rgba[target + 3] = transparency?.[index] ?? 255;
    } else if (colorType === 4) {
      const gray = raw[source]!;
      rgba[target] = gray;
      rgba[target + 1] = gray;
      rgba[target + 2] = gray;
      rgba[target + 3] = raw[source + 1]!;
    } else if (colorType === 6) {
      rgba[target] = raw[source]!;
      rgba[target + 1] = raw[source + 1]!;
      rgba[target + 2] = raw[source + 2]!;
      rgba[target + 3] = raw[source + 3]!;
    }
  }

  return { width, height, rgba };
}

function comparePngs(expected: PngImage, actual: PngImage): DiffResult {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    throw new Error(`PNG dimensions differ: expected ${expected.width}x${expected.height}, got ${actual.width}x${actual.height}`);
  }
  let changedPixels = 0;
  let totalDelta = 0;
  let maxDelta = 0;
  const totalPixels = expected.width * expected.height;

  for (let pixel = 0; pixel < totalPixels; pixel++) {
    const index = pixel * 4;
    const delta = Math.max(
      Math.abs(expected.rgba[index]! - actual.rgba[index]!),
      Math.abs(expected.rgba[index + 1]! - actual.rgba[index + 1]!),
      Math.abs(expected.rgba[index + 2]! - actual.rgba[index + 2]!),
      Math.abs(expected.rgba[index + 3]! - actual.rgba[index + 3]!),
    );
    totalDelta += delta;
    maxDelta = Math.max(maxDelta, delta);
    if (delta > pixelTolerance) changedPixels += 1;
  }

  return {
    totalPixels,
    changedPixels,
    changedRatio: changedPixels / totalPixels,
    maxDelta,
    avgDelta: totalDelta / totalPixels,
  };
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBytes.copy(out, 4);
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.length);
  return out;
}

function encodeDiffPng(expected: PngImage, actual: PngImage): Buffer {
  const width = expected.width;
  const height = expected.height;
  const raw = Buffer.alloc(height * (1 + width * 4));
  let out = 0;
  for (let y = 0; y < height; y++) {
    raw[out++] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = y * width + x;
      const index = pixel * 4;
      const delta = Math.max(
        Math.abs(expected.rgba[index]! - actual.rgba[index]!),
        Math.abs(expected.rgba[index + 1]! - actual.rgba[index + 1]!),
        Math.abs(expected.rgba[index + 2]! - actual.rgba[index + 2]!),
        Math.abs(expected.rgba[index + 3]! - actual.rgba[index + 3]!),
      );
      if (delta > pixelTolerance) {
        raw[out++] = 255;
        raw[out++] = 0;
        raw[out++] = 0;
        raw[out++] = 255;
      } else {
        raw[out++] = 255;
        raw[out++] = 255;
        raw[out++] = 255;
        raw[out++] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function cleanFixtureFiles(dir: string, fixtureName: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const file of await readdir(dir)) {
    if (file.startsWith(`${fixtureName}-`) && file.endsWith(".png")) {
      await rm(join(dir, file), { force: true });
    }
  }
}

async function expectedPages(name: string): Promise<string[]> {
  if (!existsSync(baselineDir)) return [];
  return (await readdir(baselineDir))
    .filter((file) => file.startsWith(`${name}-`) && file.endsWith(".png"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((file) => join(baselineDir, file));
}

async function compareFixture(fixture: Fixture): Promise<void> {
  await run([process.execPath, "run", fixture.script], `generate ${fixture.name}`);
  await cleanFixtureFiles(currentDir, fixture.name);
  await cleanFixtureFiles(diffDir, fixture.name);

  const actualPages = await renderPdfToPngs(join(root, fixture.pdf), join(currentDir, fixture.name));
  const baselines = await expectedPages(fixture.name);

  if (update) {
    await cleanFixtureFiles(baselineDir, fixture.name);
    for (let i = 0; i < actualPages.length; i++) {
      await copyFile(actualPages[i]!, join(baselineDir, `${fixture.name}-${i + 1}.png`));
    }
    console.log({ fixture: fixture.name, updatedPages: actualPages.length });
    return;
  }

  if (baselines.length === 0) {
    throw new Error(`Missing visual baselines for ${fixture.name}. Run: bun run visual:update -- --fixtures=${fixture.name}`);
  }
  if (baselines.length !== actualPages.length) {
    throw new Error(`${fixture.name}: page count changed from ${baselines.length} baseline pages to ${actualPages.length} current pages`);
  }

  for (let i = 0; i < baselines.length; i++) {
    const expectedBytes = await readFile(baselines[i]!);
    const actualBytes = await readFile(actualPages[i]!);
    if (sha256(expectedBytes) === sha256(actualBytes)) continue;

    const expected = decodePng(expectedBytes);
    const actual = decodePng(actualBytes);
    const diff = comparePngs(expected, actual);
    if (diff.changedRatio > maxDiffRatio) {
      const diffPath = join(diffDir, `${fixture.name}-${i + 1}.diff.png`);
      await writeFile(diffPath, encodeDiffPng(expected, actual));
      throw new Error(
        `${fixture.name} page ${i + 1}: visual diff ${(diff.changedRatio * 100).toFixed(4)}% exceeds ${(maxDiffRatio * 100).toFixed(4)}%. ` +
        `changed=${diff.changedPixels}/${diff.totalPixels}, maxDelta=${diff.maxDelta}, avgDelta=${diff.avgDelta.toFixed(3)}, diff=${diffPath}`,
      );
    }
  }

  console.log({ fixture: fixture.name, pages: actualPages.length, status: "ok" });
}

await addLocalPopplerToPath();
await ensureCommand(pdftoppmCommand);
await mkdir(currentDir, { recursive: true });
await mkdir(diffDir, { recursive: true });
if (update) await mkdir(baselineDir, { recursive: true });

const selectedFixtures = selected
  ? fixtures.filter((fixture) => selected.includes(fixture.name))
  : fixtures;
const missing = selected?.filter((name) => !fixtures.some((fixture) => fixture.name === name)) ?? [];
if (missing.length > 0) throw new Error(`Unknown visual fixtures: ${missing.join(", ")}`);

for (const fixture of selectedFixtures) {
  await compareFixture(fixture);
}
