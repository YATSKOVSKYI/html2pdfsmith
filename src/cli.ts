#!/usr/bin/env node
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { getGoogleFontCacheDir, resolveGoogleFont, type GoogleFontPaths } from "./google-fonts";
import type { PdfFontManifest, PdfFontManifestFace } from "./font-manifest";
import { WarningSink } from "./warnings";

interface ParsedInstallArgs {
  families: string[];
  outDir: string;
  defaultFamily?: string;
  fallbackFamilies: string[];
  css: boolean;
}

interface InstalledFace {
  family: string;
  regularPath: string;
  boldPath?: string;
  italicPath?: string;
  boldItalicPath?: string;
}

const HELP = `html2pdfsmith

Usage:
  html2pdfsmith fonts install "Open Sans" "Anton" "Noto Sans SC" --out ./assets/pdf-fonts
  html2pdfsmith fonts cache-dir

Commands:
  fonts install <families...>  Download Google Font families into a local project directory.
  fonts cache-dir              Print the shared html2pdfsmith Google Fonts cache directory.

Install options:
  --out <dir>                  Output directory. Default: ./html2pdfsmith-fonts
  --default <family>           Default family in the generated manifest. Default: first family.
  --fallback <families>        Comma-separated fallback families for CJK/missing glyphs.
  --no-css                     Do not generate fonts.css.
  -h, --help                   Show help.
`;

function slugifyFamily(family: string): string {
  return family.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function fileNameFor(slug: string, slot: string, sourcePath: string): string {
  const ext = extname(sourcePath).toLowerCase() || ".ttf";
  return `${slug}-${slot}${ext}`;
}

function toManifestPath(fromDir: string, filePath: string): string {
  return relative(fromDir, filePath).split(sep).join("/");
}

function cssUrl(path: string): string {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function fontFormat(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".otf") return "opentype";
  if (ext === ".ttc") return "truetype-collection";
  return "truetype";
}

function parseCsv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function readOption(args: string[], index: number, name: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parseInstallArgs(args: string[]): ParsedInstallArgs {
  const families: string[] = [];
  const fallbackFamilies: string[] = [];
  let outDir = "./html2pdfsmith-fonts";
  let defaultFamily: string | undefined;
  let css = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--out" || arg === "-o") {
      outDir = readOption(args, i, arg);
      i += 1;
    } else if (arg === "--default") {
      defaultFamily = readOption(args, i, arg).trim();
      i += 1;
    } else if (arg === "--fallback") {
      fallbackFamilies.push(...parseCsv(readOption(args, i, arg)));
      i += 1;
    } else if (arg === "--no-css") {
      css = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      families.push(arg);
    }
  }

  const requestedFamilies = [
    ...families,
    ...(defaultFamily ? [defaultFamily] : []),
    ...fallbackFamilies,
  ];
  const dedupedFamilies = [...new Map(requestedFamilies.map((family) => [family.trim().toLowerCase(), family.trim()])).values()]
    .filter(Boolean);
  if (dedupedFamilies.length === 0) {
    throw new Error("Pass at least one Google Fonts family name.");
  }
  const dedupedFallbacks = [...new Map(fallbackFamilies.map((family) => [family.toLowerCase(), family])).values()];

  const parsed: ParsedInstallArgs = {
    families: dedupedFamilies,
    outDir,
    fallbackFamilies: dedupedFallbacks,
    css,
  };
  if (defaultFamily) parsed.defaultFamily = defaultFamily;
  return parsed;
}

async function copyVariant(outDir: string, familySlug: string, slot: string, sourcePath: string): Promise<string> {
  const destDir = join(outDir, familySlug);
  await mkdir(destDir, { recursive: true });
  const dest = join(destDir, fileNameFor(familySlug, slot, sourcePath));
  await copyFile(sourcePath, dest);
  return dest;
}

async function installFace(outDir: string, family: string, paths: GoogleFontPaths): Promise<InstalledFace> {
  const slug = slugifyFamily(family);
  const regularPath = await copyVariant(outDir, slug, "regular", paths.regularPath);
  const result: InstalledFace = { family, regularPath };

  const boldSource = paths.boldPath || paths.regularPath;
  const italicSource = paths.italicPath || paths.regularPath;
  const boldItalicSource = paths.boldItalicPath || paths.boldPath || paths.italicPath || paths.regularPath;
  if (boldSource) result.boldPath = await copyVariant(outDir, slug, "bold", boldSource);
  if (italicSource) result.italicPath = await copyVariant(outDir, slug, "italic", italicSource);
  if (boldItalicSource) result.boldItalicPath = await copyVariant(outDir, slug, "bold-italic", boldItalicSource);
  return result;
}

function manifestFace(outDir: string, face: InstalledFace): PdfFontManifestFace {
  const out: PdfFontManifestFace = {
    family: face.family,
    regularPath: toManifestPath(outDir, face.regularPath),
    source: "google-fonts",
    license: `Review the Google Fonts license for ${face.family}.`,
  };
  if (face.boldPath) out.boldPath = toManifestPath(outDir, face.boldPath);
  if (face.italicPath) out.italicPath = toManifestPath(outDir, face.italicPath);
  if (face.boldItalicPath) out.boldItalicPath = toManifestPath(outDir, face.boldItalicPath);
  return out;
}

function cssForFace(outDir: string, face: InstalledFace): string {
  const entries = [
    { path: face.regularPath, weight: 400, style: "normal" },
    { path: face.boldPath, weight: 700, style: "normal" },
    { path: face.italicPath, weight: 400, style: "italic" },
    { path: face.boldItalicPath, weight: 700, style: "italic" },
  ].filter((entry): entry is { path: string; weight: number; style: string } => Boolean(entry.path));

  return entries.map((entry) => {
    const relativePath = toManifestPath(outDir, entry.path);
    return [
      "@font-face {",
      `  font-family: "${face.family.replace(/"/g, "\\\"")}";`,
      `  src: url("./${cssUrl(relativePath)}") format("${fontFormat(relativePath)}");`,
      `  font-weight: ${entry.weight};`,
      `  font-style: ${entry.style};`,
      "}",
    ].join("\n");
  }).join("\n\n");
}

async function writeInstallReadme(outDir: string, manifestPath: string, cssPath: string | undefined): Promise<void> {
  const lines = [
    "# Html2PdfSmith Local Fonts",
    "",
    "This directory was generated by `html2pdfsmith fonts install`.",
    "",
    "Use the generated manifest with:",
    "",
    "```ts",
    "import { loadFontManifest, renderHtmlToPdfDetailed } from \"html2pdfsmith\";",
    "",
    `const font = await loadFontManifest(\"${toManifestPath(process.cwd(), manifestPath)}\");`,
    "const result = await renderHtmlToPdfDetailed({ html, font });",
    "```",
    "",
    "Font files are copied locally so production renders can run with `resourcePolicy: { allowHttp: false }`.",
    "Review each font family's license before committing these files to a repository or distributing them.",
  ];
  if (cssPath) {
    lines.push("", `Optional CSS font-face file: \`${toManifestPath(outDir, cssPath)}\`.`);
  }
  await writeFile(join(outDir, "README.md"), `${lines.join("\n")}\n`);
}

async function installFonts(args: string[]): Promise<void> {
  const parsed = parseInstallArgs(args);
  const outDir = resolve(parsed.outDir);
  await mkdir(outDir, { recursive: true });

  const warnings = new WarningSink((warning) => {
    process.stderr.write(`[${warning.code}] ${warning.message}\n`);
  });
  const installed: InstalledFace[] = [];

  for (const family of parsed.families) {
    process.stdout.write(`Installing ${family}...\n`);
    const paths = await resolveGoogleFont(family, warnings);
    if (!paths) {
      throw new Error(`Could not resolve Google Font "${family}".`);
    }
    installed.push(await installFace(outDir, family, paths));
  }

  const manifest: PdfFontManifest = {
    version: 1,
    generatedBy: "html2pdfsmith",
    generatedAt: new Date().toISOString(),
    defaultFamily: parsed.defaultFamily ?? parsed.families[0]!,
    fallbackFamilies: parsed.fallbackFamilies,
    fonts: installed.map((face) => manifestFace(outDir, face)),
  };
  let cssPath: string | undefined;
  if (parsed.css) {
    cssPath = join(outDir, "fonts.css");
    manifest.cssPath = toManifestPath(outDir, cssPath);
    await writeFile(cssPath, `${installed.map((face) => cssForFace(outDir, face)).join("\n\n")}\n`);
  }

  const manifestPath = join(outDir, "html2pdfsmith-fonts.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeInstallReadme(outDir, manifestPath, cssPath);

  process.stdout.write(`\nInstalled ${installed.length} font famil${installed.length === 1 ? "y" : "ies"}.\n`);
  process.stdout.write(`Manifest: ${manifestPath}\n`);
  if (cssPath) process.stdout.write(`CSS: ${cssPath}\n`);
}

function printHelp(): void {
  process.stdout.write(HELP);
}

async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command, subcommand, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "fonts" && subcommand === "install") {
    await installFonts(rest);
    return;
  }
  if (command === "fonts" && subcommand === "cache-dir") {
    process.stdout.write(`${getGoogleFontCacheDir()}\n`);
    return;
  }
  throw new Error(`Unknown command. Run "html2pdfsmith --help".`);
}

function isCliEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isCliEntry()) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export { main };
