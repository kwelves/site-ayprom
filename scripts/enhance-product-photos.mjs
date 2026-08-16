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
import sharp from "sharp";

const DEFAULT_CANVAS_SIZE = 1600;
const DEFAULT_FILL_RATIO = 0.82;
const DEFAULT_ALPHA_THRESHOLD = 16;
const DEFAULT_PADDING_RATIO = 0.03;
const DEFAULT_WATERMARK_TEXT = "ayprom-hydraulic";
const DEFAULT_WATERMARK_OPACITY = 0.16;
const DEFAULT_WATERMARK_COLOR = "#1d4ed8";
const DEFAULT_WATERMARK_FONT_RATIO = 0.045;
const DEFAULT_SHARPEN_MIN = 0.4;
const DEFAULT_SHARPEN_MAX = 2.8;
const DEFAULT_HIGHLIGHT_KNEE = 175;
const DEFAULT_HIGHLIGHT_CEILING = 232;

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

function escapeXml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Значения ниже knee не трогает; значения от knee до 255 поджимает в
// диапазон [knee, ceiling] — так пересвеченные/клиппированные участки
// перестают быть плоским чистым белым пятном, не искажая нормальные тона.
function buildHighlightLut(knee, ceiling) {
  const lut = new Uint8Array(256);
  for (let value = 0; value < 256; value++) {
    if (value <= knee) {
      lut[value] = value;
    } else {
      const t = (value - knee) / (255 - knee);
      lut[value] = Math.round(knee + t * (ceiling - knee));
    }
  }
  return lut;
}

// normalize()/clahe() растягивают контраст, но не лечат пересветы: если
// исходник уже клиппирован в чистый белый, растягивать там нечего, а иногда
// это даже усиливает клиппинг. Отдельно поджимаем верх диапазона по LUT —
// актуально для кадров, снятых почти "в контровом свете".
async function recoverHighlights(buffer, options) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const lut = buildHighlightLut(options.knee, options.ceiling);

  for (let i = 0; i < width * height; i++) {
    const base = i * channels;
    data[base] = lut[data[base]];
    data[base + 1] = lut[data[base + 1]];
    data[base + 2] = lut[data[base + 2]];
  }

  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

// Значение под которым лежат p% пикселей однобайтового (0-255) буфера —
// устойчивее к отдельным выбросам (шум/JPEG-артефакты), чем голый min/max.
function percentile(buffer, p) {
  const histogram = new Array(256).fill(0);
  for (let i = 0; i < buffer.length; i++) histogram[buffer[i]]++;
  const target = buffer.length * p;
  let cumulative = 0;
  for (let value = 0; value < 256; value++) {
    cumulative += histogram[value];
    if (cumulative >= target) return value;
  }
  return 255;
}

// Строит карту "насколько резко" по плотности мелкой текстуры (яркость минус
// сильно смазанная версия яркости, fineSigma) — усредняет её по региону
// (regionSigma), так отдельные резкие точки на смазанном фоне не путают со
// сфокусированной зоной, — и на её основе накладывает unsharp mask с силой
// от minAmount (уже резкие места) до maxAmount (самые смазанные по кадру).
//
// Важно: любой одноканальный raw-буфер, собранный вручную (не из файла),
// нужно после sharp-операций явно возвращать в .toColourspace("b-w") перед
// .raw() — иначе sharp молча отдаёт 3 канала (sRGB) вместо 1, и последующее
// чтение буфера как одноканального съезжает по смещениям на мусорные данные.
async function adaptiveSharpen(buffer, width, height, options) {
  const { data: origData } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lowpassData = await sharp(buffer).ensureAlpha().blur(options.lowpassSigma).raw().toBuffer();

  const grey = await sharp(buffer).greyscale().raw().toBuffer();
  const greyLow = await sharp(buffer).greyscale().blur(options.fineSigma).raw().toBuffer();

  const energy = Buffer.alloc(width * height);
  for (let i = 0; i < energy.length; i++) {
    energy[i] = Math.min(255, Math.abs(grey[i] - greyLow[i]) * options.energyScale);
  }

  const localSharpness = await sharp(energy, { raw: { width, height, channels: 1 } })
    .blur(options.regionSigma)
    .toColourspace("b-w")
    .raw()
    .toBuffer();

  const low = percentile(localSharpness, 0.05);
  const high = percentile(localSharpness, 0.95);
  const range = Math.max(1, high - low);

  const output = Buffer.alloc(origData.length);
  const pixelCount = width * height;
  for (let i = 0; i < pixelCount; i++) {
    const norm = clamp((localSharpness[i] - low) / range, 0, 1);
    const amount = options.minAmount + (1 - norm) * (options.maxAmount - options.minAmount);

    const base = i * 4;
    for (let channel = 0; channel < 3; channel++) {
      const original = origData[base + channel];
      const detail = original - lowpassData[base + channel];
      output[base + channel] = Math.round(clamp(original + amount * detail, 0, 255));
    }
    output[base + 3] = origData[base + 3];
  }

  return sharp(output, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

// Сканирует альфа-канал, чтобы найти прямоугольник, в который вписана
// непрозрачная деталь — по нему и нормализуем заполнение кадра.
async function computeAlphaBoundingBox(buffer, threshold) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * channels;
    for (let x = 0; x < width; x++) {
      const alpha = data[rowOffset + x * channels + 3];
      if (alpha <= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return {
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    imageWidth: width,
    imageHeight: height,
  };
}

// Текст рисуется строками вдоль оси X, вся группа развёрнута на -45°
// (против часовой стрелки), из-за чего строки идут по диагонали
// снизу-слева вверх-направо, как просил заказчик. Заливаем диагональю
// с запасом (√2 × сторона холста), чтобы после поворота не было пустых углов.
function buildWatermarkTile(canvasSize, { text, opacity, color, fontSizeRatio }) {
  const fontSize = Math.round(canvasSize * fontSizeRatio);
  const diag = Math.ceil(canvasSize * Math.SQRT2);
  const lineHeight = Math.round(fontSize * 1.8);
  const lineCount = Math.ceil(diag / lineHeight) + 2;

  const repeatUnit = `${text}    `;
  const approxCharWidth = fontSize * 0.58;
  const repeatsPerLine = Math.ceil(diag / (approxCharWidth * repeatUnit.length)) + 2;
  const lineText = escapeXml(repeatUnit.repeat(repeatsPerLine));

  const lines = [];
  for (let i = 0; i < lineCount; i++) {
    const y = i * lineHeight;
    lines.push(
      `<text x="0" y="${y}" font-family="'Segoe UI', Arial, sans-serif" font-size="${fontSize}" font-weight="600" fill="${color}" fill-opacity="${opacity}" letter-spacing="2">${lineText}</text>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}">
  <g transform="translate(${canvasSize / 2} ${canvasSize / 2}) rotate(-45) translate(${-diag / 2} ${-diag / 2})">
    ${lines.join("\n    ")}
  </g>
</svg>`;
}

async function processImage(inputPath, outputPath, options) {
  const meta = await sharp(inputPath).metadata();
  const minSide = Math.max(1, Math.min(meta.width ?? 0, meta.height ?? 0));
  const tileSize = Math.max(8, Math.round(minSide / 8));

  const toneCorrected = await sharp(inputPath)
    .ensureAlpha()
    .normalize()
    .clahe({ width: tileSize, height: tileSize, maxSlope: 3 })
    .png()
    .toBuffer();

  const highlightCorrected = await recoverHighlights(toneCorrected, options.highlights);

  const sharpenGeometry = {
    fineSigma: clamp(minSide / 300, 3, 8),
    energyScale: 18,
    regionSigma: clamp(minSide / 40, 25, 90),
    lowpassSigma: clamp(minSide / 220, 4, 10),
    minAmount: options.sharpen.minAmount,
    maxAmount: options.sharpen.maxAmount,
  };
  const correctedBuffer = await adaptiveSharpen(highlightCorrected, meta.width, meta.height, sharpenGeometry);

  const bbox = await computeAlphaBoundingBox(correctedBuffer, options.alphaThreshold);

  let objectBuffer = correctedBuffer;
  if (bbox && !(bbox.width === bbox.imageWidth && bbox.height === bbox.imageHeight)) {
    const padX = Math.round(bbox.width * options.paddingRatio);
    const padY = Math.round(bbox.height * options.paddingRatio);
    const left = Math.max(0, bbox.left - padX);
    const top = Math.max(0, bbox.top - padY);
    const width = Math.min(bbox.imageWidth - left, bbox.width + padX * 2);
    const height = Math.min(bbox.imageHeight - top, bbox.height + padY * 2);
    objectBuffer = await sharp(correctedBuffer).extract({ left, top, width, height }).png().toBuffer();
  }

  const objectMeta = await sharp(objectBuffer).metadata();
  const targetInner = Math.round(options.canvasSize * options.fillRatio);
  const scale = targetInner / Math.max(objectMeta.width, objectMeta.height);
  const resizedWidth = Math.max(1, Math.round(objectMeta.width * scale));
  const resizedHeight = Math.max(1, Math.round(objectMeta.height * scale));

  const resizedObject = await sharp(objectBuffer)
    .resize(resizedWidth, resizedHeight, { fit: "fill" })
    .png()
    .toBuffer();

  const watermarkBuffer = Buffer.from(buildWatermarkTile(options.canvasSize, options.watermark));

  const left = Math.round((options.canvasSize - resizedWidth) / 2);
  const top = Math.round((options.canvasSize - resizedHeight) / 2);

  // Холст непрозрачно-белый, а не прозрачный: sharp смешивает слои в
  // premultiplied-alpha пространстве, поэтому у полностью прозрачного
  // пикселя (alpha=0) RGB всегда обнуляется в чёрный ещё до наложения —
  // "белый фон под прозрачностью" в принципе не работает на уровне
  // compositing. Непрозрачный белый холст даёт тот же вид на сайте
  // (карточки каталога и так на белом) и застрахован от вьюеров, которые
  // не умеют показывать альфа-канал.
  await sharp({
    create: {
      width: options.canvasSize,
      height: options.canvasSize,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 255 },
    },
  })
    .composite([
      { input: watermarkBuffer, top: 0, left: 0 },
      { input: resizedObject, top, left },
    ])
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
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
