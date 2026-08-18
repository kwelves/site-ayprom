/**
 * Загружает перекодированные hero-видео (см. scripts/generate-hero-video.mjs)
 * в бакет site-media Supabase Storage.
 *
 * Зачем отдельный скрипт: в проекте до сих пор не было ни одного способа
 * залить файл в site-media программно — предыдущие версии (hero/2026-08-16-*)
 * заливались вручную через дашборд/CLI, из-за чего у них не был явно задан
 * `cacheControl` (Supabase Storage тогда подставляет свой умолчательный
 * max-age=3600 вместо годового кэша).
 *
 * Путь на выходе версионирован датой и коротким описанием разрешения —
 * тот же принцип, что и в уже существующих hero/2026-08-16-hq и -balanced.
 * Версионирование по папке, а не перезапись файла на месте, даёт мгновенный
 * откат: старые пути остаются в бакете нетронутыми, откатить Hero.tsx можно
 * без повторной загрузки.
 *
 * Требует переменные окружения (как и scripts/check-supabase-schema.mjs):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 *
 * Использование: node scripts/upload-hero-video.mjs
 */

import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import path from "node:path";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const requiredEnvironment = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
if (missingEnvironment.length > 0) {
  console.error(`Не заданы переменные окружения: ${missingEnvironment.join(", ")}`);
  process.exit(1);
}

const SOURCE_DIR = path.resolve("public/videos/hero-web");
const REMOTE_PREFIX = "hero/2026-08-18-2k";
const BUCKET = "site-media";
// Год в секундах — файлы версионированы по пути (см. комментарий выше),
// поэтому долгий кэш безопасен: смена контента = новый путь, не перезапись.
const CACHE_CONTROL = "31536000";

const FILES = [
  { local: "hero-desktop-2k.mp4", remote: `${REMOTE_PREFIX}/hero-background-desktop.mp4` },
  { local: "hero-mobile-2k.mp4", remote: `${REMOTE_PREFIX}/hero-background-mobile.mp4` },
];

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  for (const { local, remote } of FILES) {
    const localPath = path.join(SOURCE_DIR, local);
    const body = await fs.readFile(localPath);
    const sizeMb = (body.length / 1024 / 1024).toFixed(2);

    console.log(`→ ${remote} (${sizeMb} МБ)`);
    const { error } = await supabase.storage.from(BUCKET).upload(remote, body, {
      contentType: "video/mp4",
      cacheControl: CACHE_CONTROL,
      upsert: false,
    });

    if (error) {
      // upsert: false намеренно — повторный запуск с тем же путём должен
      // явно упасть, а не молча перезаписать уже закэшированный годом файл.
      throw new Error(`Загрузка ${remote} не удалась: ${error.message}`);
    }

    const { data: publicUrl } = supabase.storage.from(BUCKET).getPublicUrl(remote);
    console.log(`  готово: ${publicUrl.publicUrl}`);
  }

  console.log("\nГотово. Обновите пути в src/components/home/Hero.tsx на новый префикс.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
