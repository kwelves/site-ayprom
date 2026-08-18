/**
 * Перекодирует hero-видео главной страницы из исходных 4K-мастеров в лёгкие
 * веб-версии для десктопа и телефона.
 *
 * Зачем: текущие файлы на проде (hero/2026-08-16-*) закодированы с
 * ФИКСИРОВАННЫМ битрейтом (5-10 Мбит/с) — такой режим тратит одинаковое
 * число бит что на статичный кадр, что на резкое движение, то есть
 * переплачивает мегабайтами за уже достигнутое качество. Этот скрипт
 * кодирует по CRF (постоянное качество) — кодировщик сам решает, сколько бит
 * нужно каждому кадру, лишнего не тратит.
 *
 * Десктопная версия при этом становится НАСТОЯЩИМ 2K (2560x1440) вместо
 * сегодняшних 1920x1080 — и получается ЛЕГЧЕ, а не тяжелее, потому что
 * убирается переплата фиксированного битрейта. Мобильная версия — тот же
 * подход, но в портретной рамке.
 *
 * Источники (mastera) — оба landscape 3840x2160, полностью бескомпромиссное
 * качество (~127 Мбит/с), лежат в public/videos/*.mp4 (Git LFS). Файлы
 * hero-background-desktop.mp4 и hero-background-mobile.mp4 на диске сейчас
 * идентичны байт-в-байт — отдельного портретного мастера нет, поэтому
 * мобильная рамка вырезается из того же landscape-мастера центральным
 * кропом по горизонтали (вся высота кадра сохраняется, обрезаются только
 * левый и правый края) — этим же способом уже обрезана текущая продакшн
 * версия, композиция кадра не меняется.
 *
 * Качество подбирается вручную через --crf, а не по целевому размеру файла:
 * PROJECT_BRIEF.md прямо запрещает резать качество ради веса. Стартовое
 * значение 20 — типичная "визуально без потерь" отметка для x264 на
 * контрастной сцене с движением (карьер, техника, пыль). Кодируйте
 * несколько вариантов, сравнивайте стоп-кадры с мастером и с результатом
 * `npm run video:hero -- --crf=18` (выше качество) при сомнении.
 *
 * Использование:
 *   npm run video:hero -- [--crf=20] [--preset=slow] [--only=desktop|mobile]
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const SOURCE_DESKTOP = path.resolve("public/videos/hero-background-desktop.mp4");
const OUT_DIR = path.resolve("public/videos/hero-web");
const DEFAULT_CRF = 20;
const DEFAULT_PRESET = "slow";

const TARGETS = {
  desktop: {
    label: "десктоп (2K, 16:9)",
    out: "hero-desktop-2k.mp4",
    // Полный кадр мастера, просто уменьшенный с 4K до 2K — ничего не
    // обрезается.
    filter: "scale=2560:1440:flags=lanczos",
  },
  mobile: {
    label: "телефон (портрет, 9:16)",
    out: "hero-mobile-2k.mp4",
    // Центральный кроп по горизонтали до соотношения 9:16 (высота кадра
    // сохраняется полностью), затем масштаб до 1440x2560 — то же
    // соотношение и тот же принцип кропа, что и у текущей продакшн-версии,
    // просто на более высоком разрешении (сегодня 1080x1920).
    filter: "crop=ih*9/16:ih,scale=1440:2560:flags=lanczos",
  },
};

function parseArgs(argv) {
  const args = { crf: DEFAULT_CRF, preset: DEFAULT_PRESET, only: null };
  for (const arg of argv) {
    if (arg.startsWith("--crf=")) args.crf = Number(arg.slice(6));
    else if (arg.startsWith("--preset=")) args.preset = arg.slice(9);
    else if (arg.startsWith("--only=")) args.only = arg.slice(7);
  }
  if (!Number.isFinite(args.crf) || args.crf < 0 || args.crf > 51) {
    throw new Error(`Некорректное значение --crf: ${args.crf}`);
  }
  if (args.only && !TARGETS[args.only]) {
    throw new Error(`Некорректное значение --only: ${args.only} (ожидается desktop|mobile)`);
  }
  return args;
}

async function encode(key, target, { crf, preset }) {
  const outPath = path.join(OUT_DIR, target.out);
  console.log(`\n→ ${target.label}: ${outPath}`);

  const ffmpegArgs = [
    "-y",
    "-i", SOURCE_DESKTOP,
    "-vf", target.filter,
    "-an", // у мастера нет звука, но явный -an защищает от случайной дорожки в будущем источнике
    "-c:v", "libx264",
    "-profile:v", "high",
    "-preset", preset,
    "-crf", String(crf),
    // Фиксированный GOP держит быстрый seek внутри цикла предсказуемым;
    // 48 кадров при 24 fps = ключевой кадр раз в 2 секунды.
    "-g", "48",
    "-keyint_min", "48",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outPath,
  ];

  const started = Date.now();
  await run(path.resolve(process.env.FFMPEG_PATH ?? "ffmpeg"), ffmpegArgs, { maxBuffer: 1024 * 1024 * 64 });
  const elapsedS = ((Date.now() - started) / 1000).toFixed(0);

  const stat = await fs.stat(outPath);
  console.log(`  готово за ${elapsedS}с, вес: ${(stat.size / 1024 / 1024).toFixed(2)} МБ`);
  return stat.size;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log(`CRF=${args.crf}  preset=${args.preset}  источник=${SOURCE_DESKTOP}`);

  const keys = args.only ? [args.only] : Object.keys(TARGETS);
  for (const key of keys) {
    await encode(key, TARGETS[key], args);
  }

  console.log("\nГотово. Сравните стоп-кадры результата с мастером перед загрузкой на прод.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
