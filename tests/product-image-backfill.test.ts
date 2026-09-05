import { describe, expect, it } from "vitest";
import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONCURRENCY,
  isAlreadyExistsError,
  parseBackfillArgs,
  projectRefFromUrl,
  storagePathFromPublicUrl,
  isCurrentProfileUrl,
  variantProfileMarker,
} from "@/lib/admin/product-image-backfill.core.mjs";
import { THUMBNAIL_VARIANT } from "@/lib/admin/product-image-variants.core.mjs";

const SUPABASE_URL = "https://acyoyvetcyqmwppfenau.supabase.co";
const publicUrl = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/product-images/${path}`;

const argv = (...args: string[]) => ["node", "script.mjs", ...args];

describe("parseBackfillArgs", () => {
  it("по умолчанию работает в dry-run без записи", () => {
    const options = parseBackfillArgs(argv());
    expect(options.apply).toBe(false);
    expect(options.confirmProjectRef).toBeNull();
    expect(options.limit).toBeNull();
    expect(options.batchSize).toBe(DEFAULT_BATCH_SIZE);
    expect(options.concurrency).toBe(DEFAULT_CONCURRENCY);
    expect(options.regenerate).toBe(false);
  });

  it("включает перегенерацию только по явному --regenerate", () => {
    expect(parseBackfillArgs(argv("--regenerate")).regenerate).toBe(true);
    expect(parseBackfillArgs(argv("--regenerate=yes")).regenerate).toBe(false);
    // Режимы независимы: перегенерация сама по себе записи не включает.
    expect(parseBackfillArgs(argv("--regenerate")).apply).toBe(false);
  });

  it("включает запись только по явному --apply", () => {
    expect(parseBackfillArgs(argv("--apply")).apply).toBe(true);
    // Никаких «правдоподобных» значений: запись включает ровно один флаг.
    expect(parseBackfillArgs(argv("--apply=yes")).apply).toBe(false);
    expect(parseBackfillArgs(argv("--apply=1")).apply).toBe(false);
  });

  it("читает подтверждение проекта и числовые ограничения", () => {
    const options = parseBackfillArgs(
      argv("--apply", "--confirm-project-ref=abc123", "--limit=10", "--batch=50", "--concurrency=4"),
    );
    expect(options.confirmProjectRef).toBe("abc123");
    expect(options.limit).toBe(10);
    expect(options.batchSize).toBe(50);
    expect(options.concurrency).toBe(4);
  });

  it("отклоняет некорректные числовые значения, а не подставляет умолчание", () => {
    expect(() => parseBackfillArgs(argv("--limit=0"))).toThrow();
    expect(() => parseBackfillArgs(argv("--limit=-5"))).toThrow();
    expect(() => parseBackfillArgs(argv("--batch=abc"))).toThrow();
    expect(() => parseBackfillArgs(argv("--concurrency=1.5"))).toThrow();
  });
});

describe("projectRefFromUrl", () => {
  it("извлекает ref из адреса supabase.co", () => {
    expect(projectRefFromUrl(SUPABASE_URL)).toBe("acyoyvetcyqmwppfenau");
  });

  it("для локального адреса возвращает host, а не выдумывает ref", () => {
    expect(projectRefFromUrl("http://127.0.0.1:54321")).toBe("127.0.0.1");
  });

  it("на мусорной строке возвращает null", () => {
    expect(projectRefFromUrl("не-url")).toBeNull();
  });
});

describe("storagePathFromPublicUrl", () => {
  it("извлекает путь объекта внутри бакета", () => {
    expect(storagePathFromPublicUrl(publicUrl("gear-pump/img-1/master.jpg"), SUPABASE_URL)).toBe(
      "gear-pump/img-1/master.jpg",
    );
  });

  it("декодирует percent-encoding в пути", () => {
    expect(storagePathFromPublicUrl(publicUrl("gear%20pump/master.jpg"), SUPABASE_URL)).toBe(
      "gear pump/master.jpg",
    );
  });

  it("отклоняет чужой origin — backfill скачивает содержимое по этой ссылке", () => {
    const foreign = "https://evil.example.com/storage/v1/object/public/product-images/x/master.jpg";
    expect(storagePathFromPublicUrl(foreign, SUPABASE_URL)).toBeNull();
  });

  it("отклоняет другой бакет того же проекта", () => {
    const otherBucket = `${SUPABASE_URL}/storage/v1/object/public/brand-logos/daf/logo.svg`;
    expect(storagePathFromPublicUrl(otherBucket, SUPABASE_URL)).toBeNull();
  });

  it("не принимает маркер Storage в середине постороннего пути", () => {
    const prefixed = `${SUPABASE_URL}/foreign/storage/v1/object/public/product-images/x/master.jpg`;
    expect(storagePathFromPublicUrl(prefixed, SUPABASE_URL)).toBeNull();
  });

  it("отклоняет обход вверх по дереву", () => {
    expect(storagePathFromPublicUrl(publicUrl("gear-pump/../../secret.jpg"), SUPABASE_URL)).toBeNull();
    expect(storagePathFromPublicUrl(publicUrl("%2E%2E/secret.jpg"), SUPABASE_URL)).toBeNull();
  });

  it("отклоняет пустой путь и мусор", () => {
    expect(storagePathFromPublicUrl(publicUrl(""), SUPABASE_URL)).toBeNull();
    expect(storagePathFromPublicUrl("не-url", SUPABASE_URL)).toBeNull();
    expect(storagePathFromPublicUrl(`${SUPABASE_URL}/rest/v1/product_images`, SUPABASE_URL)).toBeNull();
  });
});

describe("isAlreadyExistsError", () => {
  it("распознаёт конфликт имени как «уже загружено»", () => {
    expect(isAlreadyExistsError({ statusCode: "409" })).toBe(true);
    expect(isAlreadyExistsError({ statusCode: 409 })).toBe(true);
    expect(isAlreadyExistsError({ message: "The resource already exists" })).toBe(true);
    expect(isAlreadyExistsError({ message: "Duplicate object" })).toBe(true);
  });

  it("не глушит остальные ошибки загрузки", () => {
    expect(isAlreadyExistsError({ statusCode: "403", message: "Forbidden" })).toBe(false);
    expect(isAlreadyExistsError({ message: "Payload too large" })).toBe(false);
    expect(isAlreadyExistsError(null)).toBe(false);
  });
});

describe("версия профиля обработки", () => {
  const marker = variantProfileMarker(THUMBNAIL_VARIANT);
  const url = (version: string) =>
    `${SUPABASE_URL}/storage/v1/object/public/product-images/pump/id/variants/${version}/thumbnail-0123456789abcdef.webp`;

  it("узнаёт вариант текущей версии профиля", () => {
    expect(marker).toBe(`/variants/${THUMBNAIL_VARIANT.profileVersion}/thumbnail-`);
    expect(isCurrentProfileUrl(url(THUMBNAIL_VARIANT.profileVersion), THUMBNAIL_VARIANT)).toBe(true);
  });

  it("считает устаревшими прежние версии и пустое значение", () => {
    // Именно эти строки и выбирает --regenerate.
    expect(isCurrentProfileUrl(url("v1"), THUMBNAIL_VARIANT)).toBe(false);
    expect(isCurrentProfileUrl(null, THUMBNAIL_VARIANT)).toBe(false);
    expect(isCurrentProfileUrl(undefined, THUMBNAIL_VARIANT)).toBe(false);
  });
});
