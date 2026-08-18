/**
 * Buffer-in/buffer-out core of the product-photo enhancement pipeline —
 * shared by scripts/enhance-product-photos.mjs (CLI, reads/writes files) and
 * src/lib/admin/enhance-product-photo.ts (admin "upload via script" mode,
 * processes an uploaded file in memory). Both call the same `enhancePhotoBuffer`
 * so the two paths can never quietly drift apart.
 *
 * Deliberately plain JS (not TypeScript): the CLI script runs via a bare
 * `node scripts/...mjs` with no TypeScript loader configured in this project,
 * so a `.ts` file here would not be importable from it. Next's bundler has no
 * trouble importing this same file from the TypeScript wrapper.
 *
 * Expects input with an already-removed (transparent) background — this
 * module does not touch the background itself. See the CLI script's header
 * comment for the full rationale behind each processing step.
 */

import sharp from "sharp";

export const DEFAULT_CANVAS_SIZE = 1600;
export const DEFAULT_FILL_RATIO = 0.82;
export const DEFAULT_ALPHA_THRESHOLD = 16;
export const DEFAULT_PADDING_RATIO = 0.03;
export const DEFAULT_WATERMARK_TEXT = "ayprom-hydraulic";
export const DEFAULT_WATERMARK_OPACITY = 0.16;
export const DEFAULT_WATERMARK_COLOR = "#1d4ed8";
export const DEFAULT_WATERMARK_FONT_RATIO = 0.045;
export const DEFAULT_SHARPEN_MIN = 0.4;
export const DEFAULT_SHARPEN_MAX = 2.8;
export const DEFAULT_HIGHLIGHT_KNEE = 175;
export const DEFAULT_HIGHLIGHT_CEILING = 232;

export const DEFAULT_ENHANCE_OPTIONS = {
  canvasSize: DEFAULT_CANVAS_SIZE,
  fillRatio: DEFAULT_FILL_RATIO,
  alphaThreshold: DEFAULT_ALPHA_THRESHOLD,
  paddingRatio: DEFAULT_PADDING_RATIO,
  sharpen: { minAmount: DEFAULT_SHARPEN_MIN, maxAmount: DEFAULT_SHARPEN_MAX },
  highlights: { knee: DEFAULT_HIGHLIGHT_KNEE, ceiling: DEFAULT_HIGHLIGHT_CEILING },
  watermark: {
    text: DEFAULT_WATERMARK_TEXT,
    opacity: DEFAULT_WATERMARK_OPACITY,
    color: DEFAULT_WATERMARK_COLOR,
    fontSizeRatio: DEFAULT_WATERMARK_FONT_RATIO,
  },
};

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

/**
 * Runs the full catalog-photo pipeline (tone correction, highlight recovery,
 * adaptive sharpen, alpha-bbox crop, square-canvas fit, diagonal watermark,
 * flatten to opaque white) and returns the finished PNG as a Buffer.
 */
export async function enhancePhotoBuffer(inputBuffer, options = DEFAULT_ENHANCE_OPTIONS) {
  const meta = await sharp(inputBuffer).metadata();
  const minSide = Math.max(1, Math.min(meta.width ?? 0, meta.height ?? 0));
  const tileSize = Math.max(8, Math.round(minSide / 8));

  const toneCorrected = await sharp(inputBuffer)
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
  return sharp({
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
    .toBuffer();
}
