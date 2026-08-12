/**
 * Запрещает прямые цвета в коде приложения.
 *
 * Единственный источник цвета — семантические токены из src/app/globals.css
 * (bg-primary, text-muted-foreground, border-input, ...). Палитровые классы
 * Tailwind (bg-blue-600, text-slate-600), утилиты -white/-black и произвольные
 * значения вида bg-[#084bb9] обходят систему токенов: пока они есть в коде,
 * смена палитры превращается в ручной обход десятков файлов.
 *
 * Запускается через `npm run check:colors` и внутри `npm run check` (а значит
 * и в CI). Таблица токенов и порядок добавления новых — docs/design-tokens.md.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_DIRECTORY = "src";
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".css"];

/**
 * Пути, где прямые цвета разрешены. Каждое исключение — с причиной: список
 * не должен расти без обсуждения.
 */
export const ALLOWLIST = [
  {
    prefix: "src/app/globals.css",
    reason: "здесь палитра и токены и определяются",
  },
  {
    prefix: "src/components/home/vehicle-showcase/",
    reason: "декоративная 3D-сцена: оттенки свечения подобраны под сцену, а не под палитру интерфейса",
  },
  {
    prefix: "src/components/home/VehicleShowcaseSection.tsx",
    reason: "оболочка той же сцены: фон подобран под её освещение",
  },
  {
    prefix: "src/components/home/_archive/",
    reason: "архив прошлой версии витрины, вне поддержки",
  },
];

/** Утилиты Tailwind, которые принимают цвет (включая направленные рамки). */
const COLOR_UTILITIES = [
  "bg",
  "text",
  "border",
  "border-t",
  "border-r",
  "border-b",
  "border-l",
  "border-x",
  "border-y",
  "border-s",
  "border-e",
  "ring",
  "ring-offset",
  "divide",
  "divide-x",
  "divide-y",
  "from",
  "via",
  "to",
  "fill",
  "stroke",
  "outline",
  "placeholder",
  "caret",
  "accent",
  "decoration",
  "selection",
  "shadow",
];

/** Палитры Tailwind целиком, включая неиспользуемые — чтобы не завезли новую. */
const PALETTE_FAMILIES = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
];

const utilities = COLOR_UTILITIES.join("|");
const families = PALETTE_FAMILIES.join("|");

const PALETTE_PATTERN = new RegExp(
  String.raw`(?<![\w-])(?:${utilities})-(?:${families})-\d{2,3}(?:\/\d{1,3})?(?![\w-])`,
  "g",
);

const WHITE_BLACK_PATTERN = new RegExp(
  String.raw`(?<![\w-])(?:${utilities})-(?:white|black)(?:\/\d{1,3})?(?![\w-])`,
  "g",
);

/**
 * Произвольные цветовые значения: bg-[#084bb9], text-[rgba(...)], и т.п.
 * Тени (shadow-[...], drop-shadow-[...]) исключены: rgba в тени — это
 * параметр эффекта, а не цвет палитры.
 */
const ARBITRARY_PATTERN =
  /(?<![\w-])([a-z][a-z-]*)-\[(#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix)\([^\]]*\))\]/g;

const SHADOW_UTILITIES = new Set(["shadow", "drop-shadow", "text-shadow", "box-shadow"]);

/** Подсказка «на что менять» для классов, которые встречались в проекте. */
const SUGGESTIONS = new Map(
  Object.entries({
    // Нейтральный текст
    "text-slate-900": "text-foreground",
    "text-slate-700": "text-muted-foreground",
    "text-slate-600": "text-muted-foreground",
    "text-slate-500": "text-muted-foreground",
    "text-slate-400": "text-faint-foreground",
    "text-slate-300": "text-inverse-foreground-muted",
    "text-slate-200": "text-inverse-foreground-muted",
    "text-slate-100": "text-inverse-foreground-muted",
    // Светлые поверхности
    "bg-white": "bg-card",
    "bg-slate-50": "bg-muted",
    "bg-slate-100": "bg-surface-subtle",
    "bg-slate-200": "bg-surface-strong",
    // Тёмные поверхности
    "bg-slate-900": "bg-inverse",
    "bg-slate-950": "bg-inverse",
    "from-slate-900": "from-inverse",
    "via-slate-900": "via-inverse",
    "to-slate-900": "to-inverse",
    "from-slate-950": "from-inverse",
    "to-slate-950": "to-inverse",
    "border-slate-800": "border-inverse-border",
    "text-white": "text-inverse-foreground",
    "bg-white/10": "bg-inverse-foreground/10",
    "border-white": "border-inverse-foreground",
    "ring-white": "ring-inverse-foreground",
    "ring-offset-slate-900": "ring-offset-inverse",
    "text-blue-400": "text-inverse-accent",
    "text-blue-300": "text-inverse-accent",
    // Синие
    "bg-blue-600": "bg-primary",
    "bg-blue-700": "bg-primary-hover",
    "bg-blue-300": "bg-primary-soft",
    "bg-blue-100": "bg-accent-strong",
    "bg-blue-50": "bg-accent",
    "text-blue-600": "text-accent-foreground",
    "text-blue-700": "text-accent-foreground",
    "ring-blue-500": "ring-ring",
    // Линии
    "border-slate-200": "border-border",
    "border-slate-300": "border-input",
    "border-blue-100": "border-border-accent",
    "divide-blue-100": "divide-border-accent",
    "border-blue-200": "border-border-interactive",
    "border-blue-300": "border-border-interactive",
    // Статусы
    "text-red-600": "text-danger",
    "text-red-700": "text-danger",
    "bg-red-50": "bg-danger-surface",
    "bg-red-100": "bg-danger-surface-hover",
    "divide-red-100": "divide-danger-surface-hover",
    "border-red-200": "border-danger-border",
    "text-green-700": "text-success",
    "text-green-800": "text-success",
    "bg-green-50": "bg-success-surface",
    "bg-green-100": "bg-success-surface",
    "bg-green-200": "bg-success-surface-hover",
    "border-green-200": "border-success-border",
    "text-amber-500": "text-warning",
    "text-amber-700": "text-warning",
    "bg-amber-100": "bg-warning-surface",
    "bg-amber-200": "bg-warning-surface-hover",
    "border-amber-200": "border-warning-border",
  }),
);

const FALLBACK_SUGGESTION = "семантический токен из src/app/globals.css (см. docs/design-tokens.md)";

/** Приводит путь к виду с прямыми слэшами — правила одинаковы на всех ОС. */
export function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

export function isAllowlisted(relativePath) {
  const normalized = normalizePath(relativePath);
  return ALLOWLIST.some((entry) => normalized.startsWith(entry.prefix));
}

/**
 * Убирает содержимое блочных комментариев, сохраняя переносы строк, чтобы
 * номера строк не съезжали. Строчные комментарии не трогаем: «//» слишком
 * часто встречается внутри строк с URL.
 */
function blankBlockComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (source[position] === "\n") line += 1;
  }
  return line;
}

/** Дотягивает совпадение влево до начала класса, чтобы показать варианты (hover:, sm:). */
function withVariants(source, matchIndex, matched) {
  let start = matchIndex;
  while (start > 0 && /[\w:.@/[\]-]/.test(source[start - 1])) {
    start -= 1;
  }
  return source.slice(start, matchIndex) + matched;
}

function suggestFor(className) {
  const lastColon = className.lastIndexOf(":");
  const variants = lastColon === -1 ? "" : className.slice(0, lastColon + 1);
  const base = lastColon === -1 ? className : className.slice(lastColon + 1);

  const direct = SUGGESTIONS.get(base);
  if (direct) return variants + direct;

  const withoutOpacity = base.replace(/\/\d{1,3}$/, "");
  const opacity = base.slice(withoutOpacity.length);
  const byBase = SUGGESTIONS.get(withoutOpacity);
  if (byBase) return variants + byBase + opacity;

  return FALLBACK_SUGGESTION;
}

/**
 * Находит прямые цвета в одном файле.
 *
 * @param {string} source содержимое файла
 * @param {string} relativePath путь от корня репозитория
 * @returns {{line: number, className: string, suggestion: string}[]}
 */
export function findViolations(source, relativePath) {
  if (isAllowlisted(relativePath)) return [];

  const scannable = blankBlockComments(source);
  const violations = [];

  for (const pattern of [PALETTE_PATTERN, WHITE_BLACK_PATTERN]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(scannable)) !== null) {
      const className = withVariants(scannable, match.index, match[0]);
      violations.push({
        line: lineNumberAt(scannable, match.index),
        className,
        suggestion: suggestFor(className),
      });
    }
  }

  ARBITRARY_PATTERN.lastIndex = 0;
  let arbitrary;
  while ((arbitrary = ARBITRARY_PATTERN.exec(scannable)) !== null) {
    if (SHADOW_UTILITIES.has(arbitrary[1])) continue;
    violations.push({
      line: lineNumberAt(scannable, arbitrary.index),
      className: arbitrary[0],
      suggestion: FALLBACK_SUGGESTION,
    });
  }

  return violations.sort((first, second) => first.line - second.line);
}

function collectSourceFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (SCANNED_EXTENSIONS.includes(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function main() {
  const root = process.cwd();
  const files = collectSourceFiles(path.join(root, SOURCE_DIRECTORY));

  let total = 0;
  let filesWithViolations = 0;

  for (const file of files) {
    const relativePath = normalizePath(path.relative(root, file));
    const violations = findViolations(readFileSync(file, "utf8"), relativePath);
    if (violations.length === 0) continue;

    filesWithViolations += 1;
    total += violations.length;

    for (const violation of violations) {
      console.error(
        `${relativePath}:${violation.line}  ${violation.className}  → используйте ${violation.suggestion}`,
      );
    }
  }

  if (total === 0) {
    console.log(`Прямых цветов не найдено (проверено файлов: ${files.length}).`);
    return;
  }

  console.error(
    `\nПрямых цветов: ${total} в ${filesWithViolations} файлах. Цвет задаётся только семантическими токенами из src/app/globals.css.`,
  );
  process.exit(1);
}

if (process.argv[1] && normalizePath(process.argv[1]).endsWith("scripts/check-color-tokens.mjs")) {
  main();
}
