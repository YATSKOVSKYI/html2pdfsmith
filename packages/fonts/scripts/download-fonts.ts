import { existsSync, mkdirSync } from "node:fs";
import { copyFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type VariantName = "Regular" | "Bold" | "Italic" | "BoldItalic";

interface BaseFontDownload {
  family: string;
  folder: string;
  prefix: string;
  licenseFile: string;
  licenseUrl: string;
}

interface StaticFontDownload extends BaseFontDownload {
  kind: "static";
  regularUrl: string;
  boldUrl?: string;
  italicUrl?: string;
  boldItalicUrl?: string;
}

interface VariableFontDownload extends BaseFontDownload {
  kind: "variable";
  regularUrl: string;
  italicUrl?: string;
}

type FontDownload = StaticFontDownload | VariableFontDownload;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const githubRaw = "https://raw.githubusercontent.com/google/fonts/main";

const fonts: FontDownload[] = [
  {
    kind: "variable",
    family: "Open Sans",
    folder: "open-sans",
    prefix: "OpenSans",
    regularUrl: `${githubRaw}/ofl/opensans/OpenSans%5Bwdth,wght%5D.ttf`,
    italicUrl: `${githubRaw}/ofl/opensans/OpenSans-Italic%5Bwdth,wght%5D.ttf`,
    licenseFile: "OpenSans-OFL.txt",
    licenseUrl: `${githubRaw}/ofl/opensans/OFL.txt`,
  },
  {
    kind: "static",
    family: "Ubuntu",
    folder: "ubuntu",
    prefix: "Ubuntu",
    regularUrl: `${githubRaw}/ufl/ubuntu/Ubuntu-Regular.ttf`,
    boldUrl: `${githubRaw}/ufl/ubuntu/Ubuntu-Bold.ttf`,
    italicUrl: `${githubRaw}/ufl/ubuntu/Ubuntu-Italic.ttf`,
    boldItalicUrl: `${githubRaw}/ufl/ubuntu/Ubuntu-BoldItalic.ttf`,
    licenseFile: "Ubuntu-UFL.txt",
    licenseUrl: `${githubRaw}/ufl/ubuntu/LICENCE.txt`,
  },
  {
    kind: "static",
    family: "Anton",
    folder: "anton",
    prefix: "Anton",
    regularUrl: `${githubRaw}/ofl/anton/Anton-Regular.ttf`,
    licenseFile: "Anton-OFL.txt",
    licenseUrl: `${githubRaw}/ofl/anton/OFL.txt`,
  },
  {
    kind: "variable",
    family: "Roboto Condensed",
    folder: "roboto-condensed",
    prefix: "RobotoCondensed",
    regularUrl: `${githubRaw}/ofl/robotocondensed/RobotoCondensed%5Bwght%5D.ttf`,
    italicUrl: `${githubRaw}/ofl/robotocondensed/RobotoCondensed-Italic%5Bwght%5D.ttf`,
    licenseFile: "RobotoCondensed-OFL.txt",
    licenseUrl: `${githubRaw}/ofl/robotocondensed/OFL.txt`,
  },
  {
    kind: "variable",
    family: "Merriweather",
    folder: "merriweather",
    prefix: "Merriweather",
    regularUrl: `${githubRaw}/ofl/merriweather/Merriweather%5Bopsz,wdth,wght%5D.ttf`,
    italicUrl: `${githubRaw}/ofl/merriweather/Merriweather-Italic%5Bopsz,wdth,wght%5D.ttf`,
    licenseFile: "Merriweather-OFL.txt",
    licenseUrl: `${githubRaw}/ofl/merriweather/OFL.txt`,
  },
  {
    kind: "variable",
    family: "Noto Sans",
    folder: "noto-sans",
    prefix: "NotoSans",
    regularUrl: `${githubRaw}/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf`,
    italicUrl: `${githubRaw}/ofl/notosans/NotoSans-Italic%5Bwdth,wght%5D.ttf`,
    licenseFile: "NotoSans-OFL.txt",
    licenseUrl: `${githubRaw}/ofl/notosans/OFL.txt`,
  },
];

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function isSupportedFontBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const [b0, b1, b2, b3] = bytes;
  return (
    b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00 ||
    b0 === 0x4f && b1 === 0x54 && b2 === 0x54 && b3 === 0x4f ||
    b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65 ||
    b0 === 0x74 && b1 === 0x74 && b2 === 0x63 && b3 === 0x66
  );
}

function fileName(item: BaseFontDownload, variant: VariantName): string {
  return `${item.prefix}-${variant}.ttf`;
}

async function downloadBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function downloadFont(url: string, dest: string): Promise<void> {
  const bytes = await downloadBytes(url);
  if (!isSupportedFontBytes(bytes)) throw new Error(`Downloaded font is not TTF/OTF/TTC: ${url}`);
  await writeFile(dest, bytes);
}

async function downloadText(url: string, dest: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} downloading ${url}`);
  await writeFile(dest, await response.text());
}

async function runPython(args: string[]): Promise<void> {
  const attempts = ["python", "python3"];
  const errors: string[] = [];
  for (const executable of attempts) {
    try {
      const proc = Bun.spawn([executable, ...args], { stdout: "pipe", stderr: "pipe" });
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      if (code === 0) return;
      errors.push(`${executable}: ${stdout}${stderr}`);
    } catch (error) {
      errors.push(`${executable}: ${String(error)}`);
    }
  }
  throw new Error(`Python fontTools failed. Install fonttools with "python -m pip install fonttools".\n${errors.join("\n")}`);
}

async function instantiateVariableFont(helper: string, source: string, dest: string, weight: 400 | 700): Promise<void> {
  await runPython([helper, source, dest, String(weight)]);
}

async function downloadStaticFamily(item: StaticFontDownload): Promise<void> {
  const familyDir = join(root, "fonts", item.folder);
  ensureDir(familyDir);

  const regularPath = join(familyDir, fileName(item, "Regular"));
  await downloadFont(item.regularUrl, regularPath);

  const targets: Array<[VariantName, string | undefined, VariantName]> = [
    ["Bold", item.boldUrl, "Regular"],
    ["Italic", item.italicUrl, "Regular"],
    ["BoldItalic", item.boldItalicUrl, item.boldUrl ? "Bold" : "Regular"],
  ];

  for (const [variant, url, fallback] of targets) {
    const dest = join(familyDir, fileName(item, variant));
    if (url) await downloadFont(url, dest);
    else await copyFile(join(familyDir, fileName(item, fallback)), dest);
  }
}

async function downloadVariableFamily(item: VariableFontDownload, helper: string): Promise<void> {
  const familyDir = join(root, "fonts", item.folder);
  const tempDir = join(root, "tmp", item.folder);
  ensureDir(familyDir);
  ensureDir(tempDir);

  const regularSource = join(tempDir, `${item.prefix}-variable.ttf`);
  const italicSource = join(tempDir, `${item.prefix}-italic-variable.ttf`);
  await downloadFont(item.regularUrl, regularSource);
  if (item.italicUrl) await downloadFont(item.italicUrl, italicSource);

  await instantiateVariableFont(helper, regularSource, join(familyDir, fileName(item, "Regular")), 400);
  await instantiateVariableFont(helper, regularSource, join(familyDir, fileName(item, "Bold")), 700);

  if (item.italicUrl) {
    await instantiateVariableFont(helper, italicSource, join(familyDir, fileName(item, "Italic")), 400);
    await instantiateVariableFont(helper, italicSource, join(familyDir, fileName(item, "BoldItalic")), 700);
  } else {
    await copyFile(join(familyDir, fileName(item, "Regular")), join(familyDir, fileName(item, "Italic")));
    await copyFile(join(familyDir, fileName(item, "Bold")), join(familyDir, fileName(item, "BoldItalic")));
  }
}

async function writePythonHelper(): Promise<string> {
  const tempDir = join(root, "tmp");
  ensureDir(tempDir);
  const helper = join(tempDir, "instantiate-variable-font.py");
  await writeFile(helper, `
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source, dest, weight_raw = sys.argv[1], sys.argv[2], float(sys.argv[3])
font = TTFont(source)
if "fvar" in font:
    axes = {}
    for axis in font["fvar"].axes:
        axes[axis.axisTag] = weight_raw if axis.axisTag == "wght" else axis.defaultValue
    font = instantiateVariableFont(font, axes, inplace=False)
font.save(dest)
`);
  return helper;
}

async function downloadFamily(item: FontDownload, helper: string): Promise<void> {
  if (item.kind === "static") await downloadStaticFamily(item);
  else await downloadVariableFamily(item, helper);
  console.log(`downloaded ${item.family}`);
}

async function main(): Promise<void> {
  ensureDir(join(root, "fonts"));
  ensureDir(join(root, "licenses"));

  const helper = await writePythonHelper();
  for (const item of fonts) await downloadFamily(item, helper);

  await Promise.all(fonts.map((item) => downloadText(item.licenseUrl, join(root, "licenses", item.licenseFile))));
  await rm(join(root, "tmp"), { recursive: true, force: true });
  console.log("downloaded font licenses");
}

await main();
