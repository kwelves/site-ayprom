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
 * Разрешение сохраняется как у исходника (без ресайза): апскейл выше
 * исходных пикселей всё равно не добавляет детализации, а даунскейл вручную
 * не нужен — эти фото и так уже компактные (около 1000–1100px по ширине).
 *
 * Использование: node scripts/generate-vehicle-webp.mjs [--quality=85]
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SOURCE_DIR = path.resolve("public/images/vehicle-showcase");
const DEFAULT_QUALITY = 85;

function parseQuality(args) {
  const flag = args.find((arg) => arg.startsWith("--quality="));
  if (!flag) return DEFAULT_QUALITY;
  const value = Number(flag.split("=")[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 100) {
    throw new Error(`Некорректное значение --quality: ${flag}`);
  }
  return value;
}

async function main() {
  const quality = parseQuality(process.argv.slice(2));
  const entries = await fs.readdir(SOURCE_DIR);
  const pngFiles = entries.filter((name) => name.toLowerCase().endsWith(".png"));

  if (pngFiles.length === 0) {
    console.log(`В ${SOURCE_DIR} не найдено PNG-файлов.`);
    return;
  }

  for (const fileName of pngFiles) {
    const sourcePath = path.join(SOURCE_DIR, fileName);
    const targetPath = path.join(SOURCE_DIR, fileName.replace(/\.png$/i, ".webp"));

    const sourceStat = await fs.stat(sourcePath);
    await sharp(sourcePath).webp({ quality, alphaQuality: 100 }).toFile(targetPath);
    const targetStat = await fs.stat(targetPath);

    const beforeKb = (sourceStat.size / 1024).toFixed(0);
    const afterKb = (targetStat.size / 1024).toFixed(0);
    console.log(`${fileName} -> ${path.basename(targetPath)}: ${beforeKb} КБ -> ${afterKb} КБ`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
