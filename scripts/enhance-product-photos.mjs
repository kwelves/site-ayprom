/**
 * Приводит фото товаров после фотосессии к единому виду для каталога.
 *
 * Ожидает на входе PNG/WebP с уже удалённым (прозрачным) фоном — сам скрипт
 * фон не трогает. На каждое фото:
 *   1. Автояркость/контраст (normalize) + локальный контраст (clahe, тянет
 *      детали из засветов и теней) + компрессия светов (soft-knee: значения
 *      выше порога поджимаются к потолку) — normalize/clahe сами по себе
 *      выбитые в чистый белый пересветы не лечат (иногда даже усиливают
 *      клиппинг), нужен отдельный шаг именно для этого — актуально для
 *      кадров, снятых почти "в контровом свете".
 *   2. Адаптивная резкость: со съёмки на телефон обычно резкий только
 *      передний план, а дальняя часть детали смазана (маленькая глубина
 *      резкости камеры). Скрипт строит карту локальной чёткости (по
 *      плотности мелкой текстуры на градациях серого) и накладывает
 *      unsharp-mask с силой, обратной этой карте — размытые зоны получают
 *      заметно больше резкости, уже чёткие почти не трогаются, так что вся
 *      деталь выглядит равномерно резкой.
 *   3. Обрезка по границам непрозрачных пикселей и вписывание в квадратный
 *      холст так, чтобы деталь занимала одну и ту же долю кадра на всех
 *      фото — это и решает разброс "деталь на 30% / 90% кадра".
 *   4. Диагональный повторяющийся полупрозрачный водяной знак на белом
 *      фоне, наложенный под деталью (сначала водяной знак, затем деталь
 *      поверх — сквозь полупрозрачные края детали слегка проступает).
 *      Итоговый файл непрозрачный (белый фон запечён), а не PNG с альфа-
 *      каналом — так надёжнее показывается в любых просмотрщиках.
 *
 * Сама обработка (шаги 1-4) живёт в src/lib/admin/enhance-product-photo.core.mjs
 * — тот же код использует и админка (режим добавления товара "через скрипт"),
 * чтобы CLI и серверное действие никогда не разошлись в деталях обработки.
 * Этот файл — только интерфейс командной строки: разбор флагов, обход папки,
 * чтение/запись файлов.
 *
 * Использование:
 *   node scripts/enhance-product-photos.mjs <папка-с-фото> [папка-результата]
 *     [--canvas=1600] [--fill=0.82] [--sharpen-min=0.4] [--sharpen-max=2.8]
 *     [--highlight-knee=175] [--highlight-ceiling=232]
 *     [--watermark-text=ayprom-hydraulic] [--watermark-opacity=0.16] [--watermark-color=#1d4ed8]
 *
 * Папка-результата по умолчанию — <папка-с-фото>/enhanced.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  enhancePhotoBuffer,
  DEFAULT_CANVAS_SIZE,
  DEFAULT_FILL_RATIO,
  DEFAULT_ALPHA_THRESHOLD,
  DEFAULT_PADDING_RATIO,
  DEFAULT_WATERMARK_TEXT,
  DEFAULT_WATERMARK_OPACITY,
  DEFAULT_WATERMARK_COLOR,
  DEFAULT_WATERMARK_FONT_RATIO,
  DEFAULT_SHARPEN_MIN,
  DEFAULT_SHARPEN_MAX,
  DEFAULT_HIGHLIGHT_KNEE,
  DEFAULT_HIGHLIGHT_CEILING,
} from "../src/lib/admin/enhance-product-photo.core.mjs";

const SUPPORTED_EXTENSIONS = new Set([".png", ".webp", ".jpg", ".jpeg", ".avif", ".tiff"]);

function parseFlags(args) {
  const flags = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    flags[key] = value ?? true;
  }
  return flags;
}

async function processImage(inputPath, outputPath, options) {
  const inputBuffer = await fs.readFile(inputPath);
  const outputBuffer = await enhancePhotoBuffer(inputBuffer, options);
  await fs.writeFile(outputPath, outputBuffer);
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const flags = parseFlags(args);
  const inputDir = positional[0];

  if (!inputDir) {
    console.error(
      "Использование: node scripts/enhance-product-photos.mjs <папка-с-фото> [папка-результата] " +
        "[--canvas=1600] [--fill=0.82] [--sharpen-min=0.4] [--sharpen-max=2.8] " +
        "[--highlight-knee=175] [--highlight-ceiling=232] " +
        "[--watermark-text=ayprom-hydraulic] [--watermark-opacity=0.16] [--watermark-color=#1d4ed8]"
    );
    process.exit(1);
  }

  const outputDir = positional[1] || path.join(inputDir, "enhanced");
  await fs.mkdir(outputDir, { recursive: true });

  const options = {
    canvasSize: Number(flags.canvas) || DEFAULT_CANVAS_SIZE,
    fillRatio: Number(flags.fill) || DEFAULT_FILL_RATIO,
    alphaThreshold: Number(flags["alpha-threshold"]) || DEFAULT_ALPHA_THRESHOLD,
    paddingRatio: Number(flags.padding) || DEFAULT_PADDING_RATIO,
    sharpen: {
      minAmount: Number(flags["sharpen-min"]) || DEFAULT_SHARPEN_MIN,
      maxAmount: Number(flags["sharpen-max"]) || DEFAULT_SHARPEN_MAX,
    },
    highlights: {
      knee: Number(flags["highlight-knee"]) || DEFAULT_HIGHLIGHT_KNEE,
      ceiling: Number(flags["highlight-ceiling"]) || DEFAULT_HIGHLIGHT_CEILING,
    },
    watermark: {
      text: flags["watermark-text"] || DEFAULT_WATERMARK_TEXT,
      opacity: Number(flags["watermark-opacity"]) || DEFAULT_WATERMARK_OPACITY,
      color: flags["watermark-color"] || DEFAULT_WATERMARK_COLOR,
      fontSizeRatio: Number(flags["watermark-font-ratio"]) || DEFAULT_WATERMARK_FONT_RATIO,
    },
  };

  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name);

  if (files.length === 0) {
    console.log(`В папке ${inputDir} не найдено поддерживаемых изображений.`);
    return;
  }

  console.log(`Обработка ${files.length} фото из ${inputDir} → ${outputDir}`);

  let done = 0;
  let failed = 0;

  for (const file of files) {
    const inputPath = path.join(inputDir, file);
    const outputPath = path.join(outputDir, `${path.parse(file).name}.png`);
    try {
      await processImage(inputPath, outputPath, options);
      done++;
      console.log(`  ✓ ${file}`);
    } catch (error) {
      failed++;
      console.error(`  ✗ ${file}: ${error.message}`);
    }
  }

  console.log(`Готово: ${done} успешно, ${failed} с ошибками.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
