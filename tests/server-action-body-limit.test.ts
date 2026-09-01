import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES } from "@/lib/admin/image-validation";

/**
 * Транспорт Server Action не должен быть жёстче собственной валидации файла.
 *
 * Пока `bodySizeLimit` оставался дефолтным (1 МБ), загрузка фотографии в
 * режиме редактирования товара обрывалась на уровне транспорта раньше, чем
 * до файла добиралась валидация: администратор получал HTTP 413 и служебное
 * «An error occurred in the Server Components render» вместо внятного
 * «файл больше 8 МБ». Измерено на реальном сценарии: снимок 4000×3000 с
 * плотной фактурой после клиентского сжатия (1920 px, JPEG q0.82) весит
 * 1.24 МБ — то есть в отказ попадало обычное детализированное фото детали,
 * а не какой-то экзотический вход.
 *
 * Тест читает next.config.ts как текст намеренно: импортировать его нельзя —
 * на верхнем уровне конфиг требует NEXT_PUBLIC_SUPABASE_URL и оборачивается
 * Sentry-плагином, то есть тянет за собой рантайм сборки.
 */
describe("serverActions.bodySizeLimit", () => {
  const config = readFileSync("next.config.ts", "utf8");

  function parseByteSize(value: string): number {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
    if (!match) throw new Error(`Не удалось разобрать размер: ${value}`);
    const units: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
    return Number(match[1]) * (match[2] ? units[match[2].toLowerCase()] : 1);
  }

  it("задан явно, а не оставлен дефолтным", () => {
    expect(config).toMatch(/serverActions:\s*\{/);
    expect(config).toMatch(/bodySizeLimit:\s*["']/);
  });

  it("не меньше лимита валидации изображения", () => {
    const declared = config.match(/bodySizeLimit:\s*["']([^"']+)["']/)?.[1];
    expect(declared).toBeDefined();

    const limitBytes = parseByteSize(declared!);
    // Строго больше: multipart добавляет к телу границы, заголовки частей и
    // служебные поля формы, поэтому ровно MAX_IMAGE_BYTES не хватило бы для
    // файла ровно на границе допустимого.
    expect(limitBytes).toBeGreaterThan(MAX_IMAGE_BYTES);
  });
});
