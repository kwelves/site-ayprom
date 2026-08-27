/**
 * Перекодирует hero-видео главной страницы из исходного 4K-мастера в лёгкие
 * веб-версии для десктопа и телефона.
 *
 * Ступеней две.
 *
 * QUALITY (2560x1440 / 1440x2560, CRF 20) — то, что видно основную часть
 * времени. Кодируется по CRF (постоянное качество), а не фиксированным
 * битрейтом: кодировщик сам решает, сколько бит нужно каждому кадру, и не
 * переплачивает мегабайтами за уже достигнутое качество.
 *
 * STARTUP (1280x720 / 720x1280, CRF 30 с потолком 900 кбит/с) — QA-006.
 * Качественная ступень весит 22-25 МБ и требует 7-8 Мбит/с; на канале около
 * 1,5 Мбит/с браузер успевает показать один кадр и замирает — проверено
 * живым замером, воспроизведение не начинается вовсе. Стартовая ступень
 * начинает двигаться за 0,55 с при 1,5 Мбит/с и за 0,82 с при 1,0 Мбит/с и
 * доигрывает круг без провалов показа. Потолок битрейта здесь важнее CRF:
 * решает не средний вес файла, а худший двухсекундный отрезок, потому что
 * спотыкается воспроизведение именно на нём.
 *
 * Ключевые кадры стартовой ступени НЕ задаются «раз в две секунды», а
 * копируются из уже существующего файла качественной ступени: бесшовная
 * подмена возможна только в точке, которая является ключевым кадром в обоих
 * файлах. Сетка качественных версий сбита сценами после 14-й секунды и у
 * desktop с mobile различается, поэтому список читается из самого файла, а
 * не пишется руками. После кодирования совпадение проверяется.
 *
 * Источник (master) — landscape 3840x2160, ~127 Мбит/с, 610 кадров, 24 к/с,
 * хранится в Git LFS. Отдельного портретного мастера нет, поэтому мобильная
 * рамка вырезается центральным кропом по горизонтали (вся высота кадра
 * сохраняется) — тем же способом, что и текущая продакшн-версия.
 *
 * Использование:
 *   npm run video:hero -- --source=<путь к мастеру> [--tier=quality|startup]
 *                         [--crf=N] [--preset=slow] [--only=desktop|mobile]
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const DEFAULT_SOURCE = path.resolve("public/videos/hero-background-desktop.mp4");
const OUT_DIR = path.resolve("public/videos/hero-web");
const DEFAULT_PRESET = "slow";

const TIERS = {
  quality: {
    label: "качественная",
    crf: 20,
    // Без потолка: эта ступень догружается в фоне и на скорость старта не
    // влияет, поэтому ограничивать её пиковый битрейт незачем.
    rateCap: null,
    // Фиксированный GOP: ключевой кадр раз в 2 секунды при 24 к/с.
    gop: ["-g", "48", "-keyint_min", "48"],
    suffix: "2k",
    sizes: { desktop: [2560, 1440], mobile: [1440, 2560] },
  },
  startup: {
    label: "стартовая",
    crf: 30,
    // Потолок и буфер подобраны по худшему двухсекундному отрезку, а не по
    // весу файла: при 900 кбит/с пик укладывается в 1,1 Мбит/с, что оставляет
    // около трети запаса на канале 1,5 Мбит/с.
    rateCap: { maxrate: "900k", bufsize: "1800k" },
    // Ключевые кадры задаются списком из качественной версии (см. шапку),
    // поэтому автоматическая расстановка отключается целиком.
    gop: ["-sc_threshold", "0", "-g", "250"],
    suffix: "startup",
    sizes: { desktop: [1280, 720], mobile: [720, 1280] },
  },
};

const FRAMES = {
  // Полный кадр мастера, только уменьшенный — ничего не обрезается.
  desktop: (w, h) => `scale=${w}:${h}:flags=lanczos`,
  // Центральный кроп по горизонтали до 9:16, затем масштаб.
  mobile: (w, h) => `crop=ih*9/16:ih,scale=${w}:${h}:flags=lanczos`,
};

// Голое имя команды ищется в PATH, а путь из переменной окружения
// разворачивается в абсолютный. `path.resolve("ffmpeg")` без этой проверки
// превращал имя в «<каталог проекта>/ffmpeg» и падал с ENOENT.
const binary = (override, fallback) => (override ? path.resolve(override) : fallback);
const ffmpegBin = () => binary(process.env.FFMPEG_PATH, "ffmpeg");
const ffprobeBin = () => binary(process.env.FFPROBE_PATH, "ffprobe");

function outputName(target, tier) {
  return `hero-${target}-${TIERS[tier].suffix}.mp4`;
}

function parseArgs(argv) {
  const args = { tier: "quality", crf: null, preset: DEFAULT_PRESET, only: null, source: DEFAULT_SOURCE };
  for (const arg of argv) {
    if (arg.startsWith("--crf=")) args.crf = Number(arg.slice(6));
    else if (arg.startsWith("--preset=")) args.preset = arg.slice(9);
    else if (arg.startsWith("--only=")) args.only = arg.slice(7);
    else if (arg.startsWith("--tier=")) args.tier = arg.slice(7);
    else if (arg.startsWith("--source=")) args.source = path.resolve(arg.slice(9));
  }
  if (!TIERS[args.tier]) {
    throw new Error(`Некорректное значение --tier: ${args.tier} (ожидается quality|startup)`);
  }
  if (args.crf === null) args.crf = TIERS[args.tier].crf;
  if (!Number.isFinite(args.crf) || args.crf < 0 || args.crf > 51) {
    throw new Error(`Некорректное значение --crf: ${args.crf}`);
  }
  if (args.only && !FRAMES[args.only]) {
    throw new Error(`Некорректное значение --only: ${args.only} (ожидается desktop|mobile)`);
  }
  return args;
}

/** Времена ключевых кадров файла, в порядке показа. */
async function keyframeTimes(file) {
  const { stdout } = await run(ffprobeBin(), [
    "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey",
    "-show_entries", "frame=pts_time", "-of", "csv=p=0", file,
  ], { maxBuffer: 1024 * 1024 * 64 });
  return stdout.trim().split(/\s*,?\s*\n/).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

/**
 * ffmpeg ставит ключевой кадр на первый кадр с pts >= указанного времени.
 * Передавать «красивое» 17.916667 нельзя: оно чуть больше, чем 430/24, и
 * ключевой кадр уезжает на кадр вперёд — проверено, промахивались все
 * времена с периодом 1/3 секунды. Поэтому цель сдвигается на полкадра назад.
 */
function forcedKeyframeExpression(times, fps) {
  return times.map((t) => (t <= 0 ? "0" : (Math.round(t * fps) - 0.5) / fps).toString()).join(",");
}

async function videoFacts(file) {
  const { stdout } = await run(ffprobeBin(), [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,nb_frames,duration,start_time",
    "-of", "default=nw=1", file,
  ]);
  const read = (key) => (stdout.match(new RegExp(`^${key}=(.*)$`, "m")) || [])[1];
  const [num, den] = String(read("r_frame_rate")).split("/").map(Number);
  return {
    width: Number(read("width")),
    height: Number(read("height")),
    fps: num / den,
    frames: Number(read("nb_frames")),
    duration: Number(read("duration")),
    startTime: Number(read("start_time")),
  };
}

async function encode(target, { tier, crf, preset, source }) {
  const spec = TIERS[tier];
  const [width, height] = spec.sizes[target];
  const outPath = path.join(OUT_DIR, outputName(target, tier));
  console.log(`\n→ ${spec.label} ступень, ${target}: ${width}x${height} → ${outPath}`);

  const rateArgs = spec.rateCap
    ? ["-maxrate", spec.rateCap.maxrate, "-bufsize", spec.rateCap.bufsize]
    : [];

  // Стартовая ступень обязана попадать в ключевые кадры той версии, которую
  // она подменяет; если этой версии ещё нет, синхронную подмену гарантировать
  // нечем, и лучше упасть, чем выдать файл, который «почти совпадает».
  let keyframeArgs = spec.gop;
  let expectedKeyframes = null;
  if (tier === "startup") {
    const reference = path.join(OUT_DIR, outputName(target, "quality"));
    try {
      await fs.access(reference);
    } catch {
      throw new Error(
        `Нет качественной версии ${reference}: стартовая ступень копирует её ключевые кадры. ` +
        "Сначала соберите quality-ступень или положите рядом текущий продакшн-файл."
      );
    }
    expectedKeyframes = await keyframeTimes(reference);
    const { fps } = await videoFacts(reference);
    keyframeArgs = ["-force_key_frames", forcedKeyframeExpression(expectedKeyframes, fps), ...spec.gop];
    console.log(`  ключевые кадры взяты из ${path.basename(reference)}: ${expectedKeyframes.length} шт`);
  }

  const ffmpegArgs = [
    "-y",
    "-i", source,
    "-vf", FRAMES[target](width, height),
    "-an", // у мастера нет звука, но явный -an защищает от случайной дорожки в будущем источнике
    "-fps_mode", "cfr",
    "-c:v", "libx264",
    "-profile:v", "high",
    "-preset", preset,
    "-crf", String(crf),
    ...rateArgs,
    ...keyframeArgs,
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outPath,
  ];

  const started = Date.now();
  await run(ffmpegBin(), ffmpegArgs, { maxBuffer: 1024 * 1024 * 64 });
  const elapsedS = ((Date.now() - started) / 1000).toFixed(0);

  const stat = await fs.stat(outPath);
  const facts = await videoFacts(outPath);
  console.log(
    `  готово за ${elapsedS}с, вес ${(stat.size / 1024 / 1024).toFixed(2)} МБ, ` +
    `${facts.frames} кадров, ${facts.duration.toFixed(6)} с, ${facts.fps} к/с`
  );

  if (expectedKeyframes) {
    const actual = await keyframeTimes(outPath);
    const same =
      actual.length === expectedKeyframes.length &&
      actual.every((t, i) => Math.abs(t - expectedKeyframes[i]) < 1e-4);
    if (!same) {
      throw new Error(
        `Ключевые кадры не совпали с качественной версией — бесшовная подмена невозможна.\n` +
        `  ожидалось: ${expectedKeyframes.join(" ")}\n` +
        `  получилось: ${actual.join(" ")}`
      );
    }
    console.log("  ключевые кадры совпадают с качественной версией");
  }

  return stat.size;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(OUT_DIR, { recursive: true });

  try {
    await fs.access(args.source);
  } catch {
    throw new Error(
      `Нет исходного файла ${args.source}. Мастер хранится в Git LFS; ` +
      "передайте путь к рабочей копии через --source=<путь>."
    );
  }

  const master = await videoFacts(args.source);
  console.log(
    `ступень=${args.tier} CRF=${args.crf} preset=${args.preset}\n` +
    `источник=${args.source} (${master.width}x${master.height}, ${master.frames} кадров, ` +
    `${master.duration.toFixed(6)} с, ${master.fps} к/с)`
  );

  const targets = args.only ? [args.only] : Object.keys(FRAMES);
  for (const target of targets) {
    await encode(target, args);
  }

  console.log("\nГотово. Сравните стоп-кадры результата с мастером перед загрузкой на прод.");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
