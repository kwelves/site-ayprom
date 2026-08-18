/**
 * Готовит статичные WebP-версии фотографий спецтехники на главной секции
 * "Гидравлика на вашей технике".
 *
 * Зачем: эти пять фото — фиксированный, редко меняющийся набор, который
 * next/image иначе пересжимает "на лету" при каждом новом сочетании
 * (машина × требуемая ширина). Первый запрос такого сочетания ощутимо
 * медленнее последующих (сервер реально ресайзит и кодирует картинку), из-за
 * чего переключение техники может выглядеть "зависшим". Заранее подготовленный
 * статичный файл убирает этот первый медленный запрос для всех посетителей.
 *
 * PNG-мастера в public/images/vehicle-showcase остаются источником истины —
 * WebP всегда перегенерируется из них заново, а не пересжимается сам из себя,
 * чтобы повторные запуски не теряли качество на повторном lossy-сжатии.
 *
 * Полноразмерный .webp сохраняет разрешение исходника (без ресайза) — эти
 * фото и так уже компактные (около 1000–1100px по ширине), апскейл смысла
 * не имеет. Дополнительно генерируется уменьшенный `-mobile.webp` того же
 * кадра: на телефоне сцена показывает фото заметно мельче, чем на десктопе
 * (подтверждено Lighthouse: ~60-99 КБ "лишних" на мобильном при полноразмерном
 * файле), а `naturalWidth`/`naturalHeight` в VEHICLE_VISUALS (см.
 * VehicleShowcaseSection.tsx) остаются равны исходнику независимо от того,
 * какой файл реально отдаётся — это чисто система координат для хотспотов,
 * выбор файла на неё не влияет.
 *
 * Использование: node scripts/generate-vehicle-webp.mjs [--quality=85] [--mobile-width=560]
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SOURCE_DIR = path.resolve("public/images/vehicle-showcase");
const DEFAULT_QUALITY = 85;
const DEFAULT_MOBILE_WIDTH = 560;

function parseNumberFlag(args, name, fallback) {
  const flag = args.find((arg) => arg.startsWith(`--${name}=`));
  if (!flag) return fallback;
  const value = Number(flag.split("=")[1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Некорректное значение --${name}: ${flag}`);
  }
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const quality = parseNumberFlag(args, "quality", DEFAULT_QUALITY);
  if (quality > 100) throw new Error(`Некорректное значение --quality: ${quality}`);
  const mobileWidth = parseNumberFlag(args, "mobile-width", DEFAULT_MOBILE_WIDTH);

  const entries = await fs.readdir(SOURCE_DIR);
  const pngFiles = entries.filter((name) => name.toLowerCase().endsWith(".png"));

  if (pngFiles.length === 0) {
    console.log(`В ${SOURCE_DIR} не найдено PNG-файлов.`);
    return;
  }

  for (const fileName of pngFiles) {
    const sourcePath = path.join(SOURCE_DIR, fileName);
    const fullTargetPath = path.join(SOURCE_DIR, fileName.replace(/\.png$/i, ".webp"));
    const mobileTargetPath = path.join(SOURCE_DIR, fileName.replace(/\.png$/i, "-mobile.webp"));

    const sourceStat = await fs.stat(sourcePath);

    await sharp(sourcePath).webp({ quality, alphaQuality: 100 }).toFile(fullTargetPath);
    const fullStat = await fs.stat(fullTargetPath);

    // Ресайз всегда из PNG-мастера (не из только что созданного полноразмерного
    // webp) — та же причина, что и выше: не терять качество на повторном
    // lossy-сжатии уже сжатого файла.
    await sharp(sourcePath)
      .resize({ width: mobileWidth, withoutEnlargement: true })
      .webp({ quality, alphaQuality: 100 })
      .toFile(mobileTargetPath);
    const mobileStat = await fs.stat(mobileTargetPath);

    const beforeKb = (sourceStat.size / 1024).toFixed(0);
    const fullKb = (fullStat.size / 1024).toFixed(0);
    const mobileKb = (mobileStat.size / 1024).toFixed(0);
    console.log(
      `${fileName} -> ${path.basename(fullTargetPath)}: ${beforeKb} КБ -> ${fullKb} КБ` +
        `  |  ${path.basename(mobileTargetPath)}: ${mobileKb} КБ`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
