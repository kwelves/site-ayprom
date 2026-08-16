/**
 * Убирает фон с фото товаров через API rembg.com — первый шаг перед
 * scripts/enhance-product-photos.mjs (который ожидает на входе уже
 * прозрачный PNG/WebP).
 *
 * Нужен ключ REMBG_API_KEY в окружении — держи его в .env.local (в
 * .gitignore, в репозиторий не попадёт) и запускай через `node --env-file`,
 * как показано в примере ниже. Ключ виден только процессу, в код не
 * зашивается.
 *
 * Использование:
 *   node --env-file=.env.local scripts/remove-background-rembg.mjs <папка-с-фото> [папка-результата]
 *     [--format=png] [--concurrency=3]
 *
 * Папка-результата по умолчанию — <папка-с-фото>/no-bg.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

const API_URL = "https://api.rembg.com/rmbg";
const DEFAULT_FORMAT = "png";
const DEFAULT_CONCURRENCY = 3;
const MAX_RETRIES = 3;

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

function parseFlags(args) {
  const flags = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const [key, value] = arg.slice(2).split("=");
    flags[key] = value ?? true;
  }
  return flags;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeBackground(inputPath, apiKey, format) {
  const bytes = await fs.readFile(inputPath);
  const form = new FormData();
  form.append("image", new Blob([bytes]), path.basename(inputPath));
  form.append("format", format);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey },
      body: form,
    });

    if (response.ok) {
      return Buffer.from(await response.arrayBuffer());
    }

    if (response.status === 429 && attempt < MAX_RETRIES) {
      await sleep(2000 * attempt);
      continue;
    }

    const detail = await response.text().catch(() => "");
    throw new Error(`rembg.com вернул ${response.status}: ${detail.slice(0, 200)}`);
  }

  throw new Error("Не удалось получить ответ от rembg.com после повторов");
}

// Простой пул с ограничением параллельности — без внешних зависимостей.
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function runner() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const flags = parseFlags(args);
  const inputDir = positional[0];

  if (!inputDir) {
    console.error(
      "Использование: node --env-file=.env.local scripts/remove-background-rembg.mjs <папка-с-фото> [папка-результата] " +
        "[--format=png] [--concurrency=3]"
    );
    process.exit(1);
  }

  const apiKey = process.env.REMBG_API_KEY;
  if (!apiKey) {
    console.error(
      "Не найден REMBG_API_KEY. Положи ключ в .env.local и запускай так:\n" +
        "  node --env-file=.env.local scripts/remove-background-rembg.mjs ..."
    );
    process.exit(1);
  }

  const format = flags.format || DEFAULT_FORMAT;
  const concurrency = Number(flags.concurrency) || DEFAULT_CONCURRENCY;
  const outputDir = positional[1] || path.join(inputDir, "no-bg");
  await fs.mkdir(outputDir, { recursive: true });

  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => entry.name);

  if (files.length === 0) {
    console.log(`В папке ${inputDir} не найдено поддерживаемых изображений.`);
    return;
  }

  console.log(`Удаление фона через rembg.com: ${files.length} фото → ${outputDir}`);

  let done = 0;
  let failed = 0;

  await runWithConcurrency(files, concurrency, async (file) => {
    const inputPath = path.join(inputDir, file);
    const outputPath = path.join(outputDir, `${path.parse(file).name}.${format}`);
    try {
      const resultBytes = await removeBackground(inputPath, apiKey, format);
      await fs.writeFile(outputPath, resultBytes);
      done++;
      console.log(`  ✓ ${file}`);
    } catch (error) {
      failed++;
      console.error(`  ✗ ${file}: ${error.message}`);
    }
  });

  console.log(`Готово: ${done} успешно, ${failed} с ошибками.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
