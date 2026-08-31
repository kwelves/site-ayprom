import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const globalsCssPath = path.join(projectRoot, "src/app/globals.css");
const fontDirectory = path.join(projectRoot, "src/app/fonts/geist");
const provenancePath = path.join(fontDirectory, "README.md");

const fontAssets = [
  {
    file: "geist-cyrillic-ext-variable.woff2",
    sha256: "B7A545BBB08256BD809F11CFE66D88DA3E22D169EA4407737B1EF0EC1ED3D791",
    source: "https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwRGFWNOITddY4.woff2",
  },
  {
    file: "geist-cyrillic-variable.woff2",
    sha256: "6129FC8571C3E0CB0A4C41F5160C974A843B055009DC4AD8858BD808E18A2D86",
    source: "https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwYGFWNOITddY4.woff2",
  },
  {
    file: "geist-vietnamese-variable.woff2",
    sha256: "F689F638F29FFF460A2D5749EDB5D5C38D7BEF0389F32032D871F23FC6EBB008",
    source: "https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwTGFWNOITddY4.woff2",
  },
  {
    file: "geist-latin-ext-variable.woff2",
    sha256: "58A6B173D5CA1DEC92166EA3C6CB1A84A4144556D10928AC14E8E6B40E4787BD",
    source: "https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwSGFWNOITddY4.woff2",
  },
  {
    file: "geist-latin-variable.woff2",
    sha256: "9B6F5FF45B278C744B5F379A2C4ECBAF858A842B8EAF82AC8D21B699CA16C608",
    source: "https://fonts.gstatic.com/s/geist/v5/gyByhwUxId8gMEwcGFWNOITd.woff2",
  },
] as const;

const runtimeExtensions = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

function collectRuntimeFiles(entryPath: string): string[] {
  if (!existsSync(entryPath)) return [];

  const entries = readdirSync(entryPath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const resolvedPath = path.join(entryPath, entry.name);
    if (entry.isDirectory()) return collectRuntimeFiles(resolvedPath);
    return runtimeExtensions.has(path.extname(entry.name)) ? [resolvedPath] : [];
  });
}

const runtimeFiles = [
  ...collectRuntimeFiles(path.join(projectRoot, "src")),
  ...collectRuntimeFiles(path.join(projectRoot, "scripts")),
  ...readdirSync(projectRoot, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile() || !runtimeExtensions.has(path.extname(entry.name))) return [];
    return [path.join(projectRoot, entry.name)];
  }),
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Возвращает текст объекта-аргумента каждого вызова `localFont(` в файле.
// Скан учитывает строковые литералы, поэтому фигурная скобка внутри строки
// не сбивает подсчёт вложенности.
function collectLocalFontOptions(source: string): string[] {
  const options: string[] = [];
  const callPattern = /localFont\s*\(\s*\{/g;
  let call: RegExpExecArray | null;

  while ((call = callPattern.exec(source)) !== null) {
    const openIndex = source.indexOf("{", call.index);
    let depth = 0;
    let quote: string | null = null;

    for (let index = openIndex; index < source.length; index += 1) {
      const char = source[index];

      if (quote) {
        if (char === "\\") index += 1;
        else if (char === quote) quote = null;
        continue;
      }

      if (char === '"' || char === "'" || char === "`") {
        quote = char;
        continue;
      }

      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          options.push(source.slice(openIndex, index + 1));
          callPattern.lastIndex = index + 1;
          break;
        }
      }
    }
  }

  return options;
}

function stripComments(value: string): string {
  return value.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("локальный Geist не зависит от Google Fonts во время build/runtime", () => {
  it("не содержит literal next/font/google ни в одном runtime/build source", () => {
    for (const runtimeFile of runtimeFiles) {
      const source = readFileSync(runtimeFile, "utf8");
      expect(source, runtimeFile).not.toContain("next/font/google");
    }
  });

  it("объявляет пять локальных subset URL и сохраняет проверенные файлы", () => {
    const css = readFileSync(globalsCssPath, "utf8");
    const provenance = readFileSync(provenancePath, "utf8");
    const cssWithoutBlockComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const fontFaceBlocks = cssWithoutBlockComments.match(/@font-face\s*\{[^}]*\}/gi) ?? [];

    for (const asset of fontAssets) {
      const assetPath = path.join(fontDirectory, asset.file);
      const localSrc = new RegExp(
        `src\\s*:\\s*url\\(["']?\\./fonts/geist/${escapeRegExp(asset.file)}["']?\\)\\s*format\\(["']woff2["']\\)`,
        "i",
      );
      expect(fontFaceBlocks.some((block) => localSrc.test(block)), asset.file).toBe(true);
      expect(existsSync(assetPath), asset.file).toBe(true);

      const actualHash = createHash("sha256").update(readFileSync(assetPath)).digest("hex").toUpperCase();
      expect(actualHash, asset.file).toBe(asset.sha256);
      expect(provenance, asset.file).toContain(asset.sha256);
      expect(provenance, asset.file).toContain(asset.source);
    }
  });

  it("не содержит Google Fonts URL в runtime/build source", () => {
    for (const runtimeFile of runtimeFiles) {
      const source = readFileSync(runtimeFile, "utf8");
      expect(source, runtimeFile).not.toMatch(/https?:\/\/fonts\.(?:googleapis|gstatic)\.com/i);
    }
  });
});

describe("next/font/local не прелоадит шрифты глобально", () => {
  // Next собирает preload-теги всех `next/font/local` в общий head, поэтому
  // объявление с preload по умолчанию заставляет каждую страницу тянуть копию
  // шрифта, который на ней не применяется. Так `global-not-found.tsx` однажды
  // добавил на главную три неиспользуемых `.p.`-файла. Акцентные шрифты идут с
  // `display: swap` и fallback, поэтому preload им не нужен.
  it("каждое объявление localFont задаёт preload: false", () => {
    const declarations = runtimeFiles.flatMap((runtimeFile) =>
      collectLocalFontOptions(readFileSync(runtimeFile, "utf8")).map((options) => ({
        runtimeFile,
        options: stripComments(options),
      })),
    );

    expect(declarations.length).toBeGreaterThan(0);

    for (const declaration of declarations) {
      expect(declaration.options, declaration.runtimeFile).toMatch(/preload\s*:\s*false/);
    }
  });
});
