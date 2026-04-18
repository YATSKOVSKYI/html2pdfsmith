import { fileURLToPath } from "node:url";

export interface BundledFontFace {
  family: string;
  regularPath: string;
  boldPath?: string;
  italicPath?: string;
  boldItalicPath?: string;
  license?: string;
  source?: string;
}

function fontPath(folder: string, file: string): string {
  return fileURLToPath(new URL(`../fonts/${folder}/${file}`, import.meta.url));
}

export const bundledFonts = {
  openSans: {
    family: "Open Sans",
    regularPath: fontPath("open-sans", "OpenSans-Regular.ttf"),
    boldPath: fontPath("open-sans", "OpenSans-Bold.ttf"),
    italicPath: fontPath("open-sans", "OpenSans-Italic.ttf"),
    boldItalicPath: fontPath("open-sans", "OpenSans-BoldItalic.ttf"),
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Open+Sans",
  },
  ubuntu: {
    family: "Ubuntu",
    regularPath: fontPath("ubuntu", "Ubuntu-Regular.ttf"),
    boldPath: fontPath("ubuntu", "Ubuntu-Bold.ttf"),
    italicPath: fontPath("ubuntu", "Ubuntu-Italic.ttf"),
    boldItalicPath: fontPath("ubuntu", "Ubuntu-BoldItalic.ttf"),
    license: "Ubuntu Font Licence 1.0",
    source: "https://fonts.google.com/specimen/Ubuntu",
  },
  anton: {
    family: "Anton",
    regularPath: fontPath("anton", "Anton-Regular.ttf"),
    boldPath: fontPath("anton", "Anton-Regular.ttf"),
    italicPath: fontPath("anton", "Anton-Regular.ttf"),
    boldItalicPath: fontPath("anton", "Anton-Regular.ttf"),
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Anton",
  },
  robotoCondensed: {
    family: "Roboto Condensed",
    regularPath: fontPath("roboto-condensed", "RobotoCondensed-Regular.ttf"),
    boldPath: fontPath("roboto-condensed", "RobotoCondensed-Bold.ttf"),
    italicPath: fontPath("roboto-condensed", "RobotoCondensed-Italic.ttf"),
    boldItalicPath: fontPath("roboto-condensed", "RobotoCondensed-BoldItalic.ttf"),
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Roboto+Condensed",
  },
  merriweather: {
    family: "Merriweather",
    regularPath: fontPath("merriweather", "Merriweather-Regular.ttf"),
    boldPath: fontPath("merriweather", "Merriweather-Bold.ttf"),
    italicPath: fontPath("merriweather", "Merriweather-Italic.ttf"),
    boldItalicPath: fontPath("merriweather", "Merriweather-BoldItalic.ttf"),
    license: "OFL-1.1",
    source: "https://fonts.google.com/specimen/Merriweather",
  },
  notoSans: {
    family: "Noto Sans",
    regularPath: fontPath("noto-sans", "NotoSans-Regular.ttf"),
    boldPath: fontPath("noto-sans", "NotoSans-Bold.ttf"),
    italicPath: fontPath("noto-sans", "NotoSans-Italic.ttf"),
    boldItalicPath: fontPath("noto-sans", "NotoSans-BoldItalic.ttf"),
    license: "OFL-1.1",
    source: "https://fonts.google.com/noto/specimen/Noto+Sans",
  },
} satisfies Record<string, BundledFontFace>;

export type BundledFontKey = keyof typeof bundledFonts;

export const bundledFontList = Object.values(bundledFonts);
