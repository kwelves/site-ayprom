/**
 * Загружает перекодированные hero-видео (см. scripts/generate-hero-video.mjs)
 * напрямую в Cloudflare R2 — туда же, откуда их сейчас раздаёт сайт
 * (NEXT_PUBLIC_HERO_MEDIA_SOURCE=r2, см. docs/R2_MIGRATION.md).
 *
 * До 2026-09-15 этот скрипт писал в Supabase Storage bucket `site-media`.
 * После переноса каталога на R2 это стало несовместимо с CSP (media-src
 * больше не пускает Supabase) — новое видео, залитое старой версией
 * скрипта, оказывалось на URL, который браузер тут же блокирует.
 *
 * Ключ объекта в R2 строится так же, как для уже перенесённых hero-видео
 * (см. `heroPaths` в scripts/migrate-media-to-r2.mjs): `site-media/<prefix>/<remote>`,
 * то есть тот же путь, что раньше был внутри Supabase-бакета `site-media`.
 *
 * Путь версионирован датой и коротким описанием разрешения — тот же принцип,
 * что и до переноса. Версионирование по папке, а не перезапись файла на
 * месте, даёт мгновенный откат: старые пути остаются в R2 нетронутыми,
 * откатить Hero.tsx можно без повторной загрузки. Повторный запуск с тем же
 * путём намеренно падает (`IfNoneMatch: "*"`), а не перезаписывает молча.
 *
 * Требует переменные окружения Cloudflare R2 (как и media-storage.ts):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME,
 *   NEXT_PUBLIC_MEDIA_BASE_URL
 *
 * Использование: node scripts/upload-hero-video.mjs [--tier=quality|startup]
 */

import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Не задана переменная окружения: ${name}`);
    process.exit(1);
  }
  return value;
}

const r2Settings = {
  accountId: required("R2_ACCOUNT_ID"),
  accessKeyId: required("R2_ACCESS_KEY_ID"),
  secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
  bucket: required("R2_BUCKET_NAME"),
  publicBaseUrl: required("NEXT_PUBLIC_MEDIA_BASE_URL").replace(/\/$/, ""),
};

const r2Client = new S3Client({
  region: "auto",
  endpoint: `https://${r2Settings.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: r2Settings.accessKeyId,
    secretAccessKey: r2Settings.secretAccessKey,
  },
});

const SOURCE_DIR = path.resolve("public/videos/hero-web");
const BUCKET = "site-media";
// Год в секундах — файлы версионированы по пути (см. комментарий выше),
// поэтому долгий кэш безопасен: смена контента = новый путь, не перезапись.
const CACHE_CONTROL = "public, max-age=31536000, immutable";

// Ступени заливаются раздельно и в разные версионированные папки. Стартовая
// ступень (QA-006) добавляется рядом с качественной, а не вместо неё: пока
// Hero не выкачен, новые файлы просто лежат в R2 и ни на что не влияют,
// а откат сводится к откату кода без повторной загрузки.
const TIERS = {
  quality: {
    prefix: "hero/2026-08-18-2k",
    files: [
      { local: "hero-desktop-2k.mp4", remote: "hero-background-desktop.mp4" },
      { local: "hero-mobile-2k.mp4", remote: "hero-background-mobile.mp4" },
    ],
  },
  startup: {
    prefix: "hero/2026-08-27-startup",
    files: [
      { local: "hero-desktop-startup.mp4", remote: "hero-startup-desktop.mp4" },
      { local: "hero-mobile-startup.mp4", remote: "hero-startup-mobile.mp4" },
    ],
  },
};

function parseTier(argv) {
  const arg = argv.find((value) => value.startsWith("--tier="));
  const tier = arg ? arg.slice(7) : "quality";
  if (!TIERS[tier]) {
    throw new Error(`Некорректное значение --tier: ${tier} (ожидается ${Object.keys(TIERS).join("|")})`);
  }
  return tier;
}

function targetUrl(key) {
  return `${r2Settings.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function objectExists(key) {
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: r2Settings.bucket, Key: key }));
    return true;
  } catch (error) {
    if (error?.name === "NotFound" || error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

async function main() {
  const tier = parseTier(process.argv.slice(2));
  const { prefix, files } = TIERS[tier];

  console.log(`ступень=${tier} → R2 ${r2Settings.bucket}/${BUCKET}/${prefix}`);

  for (const entry of files) {
    const key = `${BUCKET}/${prefix}/${entry.remote}`;
    const localPath = path.join(SOURCE_DIR, entry.local);
    const body = await fs.readFile(localPath);
    const sizeMb = (body.length / 1024 / 1024).toFixed(2);
    const digest = createHash("sha256").update(body).digest("hex");

    console.log(`→ ${key} (${sizeMb} МБ)`);

    // upsert выключен намеренно — повторный запуск с тем же путём должен
    // явно упасть, а не молча перезаписать уже закэшированный годом файл.
    if (await objectExists(key)) {
      throw new Error(`Загрузка ${key} не удалась: объект уже существует в R2.`);
    }

    await r2Client.send(
      new PutObjectCommand({
        Bucket: r2Settings.bucket,
        Key: key,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: "video/mp4",
        CacheControl: CACHE_CONTROL,
        Metadata: { sha256: digest },
        IfNoneMatch: "*",
      }),
    );

    // HEAD публичного адреса подтверждает, что объект реально раздаётся, а не
    // только записан в бакет. Accept-Encoding: identity обязателен — иначе
    // Cloudflare может сжать ответ и убрать Content-Length, и проверка ложно
    // решит, что копия не подтверждена (см. copyObject() в migrate-media-to-r2.mjs).
    const publicHead = await fetch(targetUrl(key), {
      method: "HEAD",
      headers: { "Accept-Encoding": "identity" },
      signal: AbortSignal.timeout(30000),
    });
    if (!publicHead.ok || Number(publicHead.headers.get("content-length")) !== body.byteLength) {
      throw new Error(`Публичная копия не подтверждена: ${key}, HTTP ${publicHead.status}`);
    }

    console.log(`  готово: ${targetUrl(key)}`);
  }

  console.log(`\nГотово. Ступень ${tier} лежит в R2 ${BUCKET}/${prefix}; сверьте путь в src/components/home/Hero.tsx.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
