import { describe, expect, it } from "vitest";
import {
  CANONICAL_UPLOAD_EXTENSION,
  STAGING_RETENTION_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
  buildStagingObjectPath,
  draftIdFromStagingPath,
  isUuid,
} from "@/lib/admin/product-image-staging";

const DRAFT = "11111111-2222-4333-8444-555555555555";
const FILE = "66666666-7777-4888-8999-aaaaaaaaaaaa";

describe("buildStagingObjectPath", () => {
  // QA-004: путь в хранилище не должен зависеть от имени файла, которое
  // присылает браузер, — иначе клиент управляет тем, куда пишется объект.
  it("строит путь только из серверных значений", () => {
    expect(buildStagingObjectPath(DRAFT, FILE, "jpg")).toBe(`${DRAFT}/${FILE}.jpg`);
  });

  it("отвергает попытку выйти за пределы своей папки", () => {
    expect(() => buildStagingObjectPath("../other", FILE, "jpg")).toThrow(/идентификатор сессии/);
    expect(() => buildStagingObjectPath(DRAFT, "../../escape", "jpg")).toThrow(/идентификатор файла/);
  });

  it("отвергает поддельное расширение", () => {
    expect(() => buildStagingObjectPath(DRAFT, FILE, "php")).not.toThrow(); // короткое и буквенное
    expect(() => buildStagingObjectPath(DRAFT, FILE, "jpg/../x")).toThrow(/расширение/);
    expect(() => buildStagingObjectPath(DRAFT, FILE, "")).toThrow(/расширение/);
    expect(() => buildStagingObjectPath(DRAFT, FILE, "verylongext")).toThrow(/расширение/);
  });
});

describe("draftIdFromStagingPath", () => {
  it("возвращает сессию для корректного пути", () => {
    expect(draftIdFromStagingPath(`${DRAFT}/${FILE}.jpg`)).toBe(DRAFT);
  });

  it("возвращает null, если путь не принадлежит сессии", () => {
    expect(draftIdFromStagingPath("не-сессия/файл.jpg")).toBeNull();
    expect(draftIdFromStagingPath(DRAFT)).toBeNull();
  });
});

describe("isUuid", () => {
  it("отличает настоящий идентификатор от подделки", () => {
    expect(isUuid(DRAFT)).toBe(true);
    expect(isUuid("../../etc/passwd")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

describe("сроки", () => {
  // Это два РАЗНЫХ срока, и их путаница опасна в обе стороны: короткое
  // хранение теряет работу администратора, длинная ссылка остаётся полезной
  // после утечки.
  it("ссылка на загрузку живёт заметно меньше, чем само хранение", () => {
    expect(UPLOAD_URL_TTL_SECONDS).toBeLessThan(STAGING_RETENTION_SECONDS);
  });

  it("хранение рассчитано на возвращение администратора на следующий день", () => {
    expect(STAGING_RETENTION_SECONDS).toBe(24 * 60 * 60);
  });

  it("ссылка достаточно длинная для 8 МБ по медленному каналу, но не дольше", () => {
    expect(UPLOAD_URL_TTL_SECONDS).toBe(5 * 60);
  });
});

describe("CANONICAL_UPLOAD_EXTENSION", () => {
  it("покрывает ровно те типы, которые принимает промежуточное хранилище", () => {
    expect(Object.keys(CANONICAL_UPLOAD_EXTENSION).sort()).toEqual([
      "image/avif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  it("не знает SVG: вектор в фотографиях товара не принимается", () => {
    expect(CANONICAL_UPLOAD_EXTENSION["image/svg+xml"]).toBeUndefined();
  });
});
