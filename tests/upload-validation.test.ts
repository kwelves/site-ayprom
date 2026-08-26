import { describe, expect, it } from "vitest";
import {
  sanitizeSvg,
  validateBrandLogoUpload,
  validateCategoryImageUpload,
} from "@/lib/admin/upload-validation";

// QA-012 (вторая половина): логотипы брендов и картинки категорий загружались
// без единой серверной проверки, а расширение бралось из имени файла, которое
// целиком контролирует клиент.
//
// Логотипы по умолчанию считались SVG. SVG — текстовый документ, внутри
// которого может лежать исполняемый код, и такой файл становился публично
// доступным по ссылке. Проверки ниже описывают конкретные способы это
// сделать — каждый должен быть отвергнут.

const CLEAN_LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/></svg>';

function svgFile(source: string, name = "logo.svg"): File {
  return new File([source], name, { type: "image/svg+xml" });
}

/** Минимальный корректный PNG 1x1 — для проверки растрового пути. */
function pngFile(name = "photo.png"): File {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [
    0x00, 0x00, 0x00, 0x0d, // длина блока IHDR
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x00, 0x01, // ширина 1
    0x00, 0x00, 0x00, 0x01, // высота 1
    0x08, 0x06, 0x00, 0x00, 0x00, // глубина, тип цвета, сжатие, фильтр, чересстрочность
    0x1f, 0x15, 0xc4, 0x89, // контрольная сумма
  ];
  return new File([new Uint8Array([...signature, ...ihdr])], name, { type: "image/png" });
}

describe("sanitizeSvg", () => {
  it("пропускает чистый логотип без изменений по смыслу", () => {
    const clean = sanitizeSvg(CLEAN_LOGO, "logo.svg");

    expect(clean).toContain("<svg");
    expect(clean).toContain("<path");
  });

  it("отвергает встроенный скрипт", () => {
    const attack =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("https://evil.invalid")</script></svg>';

    expect(() => sanitizeSvg(attack, "logo.svg")).toThrow(/небезопасное содержимое/);
  });

  it("отвергает обработчик события в атрибуте", () => {
    const attack = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0"/></svg>';

    expect(() => sanitizeSvg(attack, "logo.svg")).toThrow(/небезопасное содержимое/);
  });

  it("отвергает foreignObject, через который вставляют произвольный HTML", () => {
    const attack =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject></svg>';

    expect(() => sanitizeSvg(attack, "logo.svg")).toThrow(/небезопасное содержимое/);
  });

  it("отвергает ссылку на внешний ресурс", () => {
    const attack =
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>';

    expect(() => sanitizeSvg(attack, "logo.svg")).toThrow(/небезопасное содержимое/);
  });

  it("отвергает файл, который вообще не является SVG", () => {
    expect(() => sanitizeSvg("просто текст", "logo.svg")).toThrow(/не является корректным SVG/);
  });
});

describe("validateBrandLogoUpload", () => {
  it("принимает чистый SVG и возвращает проверенный тип и расширение", async () => {
    const result = await validateBrandLogoUpload(svgFile(CLEAN_LOGO));

    expect(result.contentType).toBe("image/svg+xml");
    expect(result.extension).toBe("svg");
    expect(new TextDecoder().decode(result.bytes)).toContain("<svg");
  });

  it("отвергает SVG с несоответствующим расширением", async () => {
    await expect(validateBrandLogoUpload(svgFile(CLEAN_LOGO, "logo.png"))).rejects.toThrow(
      /объявлен как SVG/,
    );
  });

  it("отвергает опасный SVG до записи в хранилище", async () => {
    const attack = '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>';

    await expect(validateBrandLogoUpload(svgFile(attack))).rejects.toThrow(/небезопасное содержимое/);
  });

  it("принимает обычную картинку как логотип", async () => {
    const result = await validateBrandLogoUpload(pngFile("logo.png"));

    expect(result.contentType).toBe("image/png");
    expect(result.extension).toBe("png");
  });

  // Главный сценарий подмены: имя файла лжёт о содержимом.
  it("отвергает файл, чьё содержимое не соответствует заявленному типу", async () => {
    const spoofed = new File([new TextEncoder().encode("<svg>не png</svg>")], "photo.png", {
      type: "image/png",
    });

    await expect(validateBrandLogoUpload(spoofed)).rejects.toThrow(/не соответствует заявленному/);
  });
});

describe("validateCategoryImageUpload", () => {
  it("принимает обычную картинку", async () => {
    const result = await validateCategoryImageUpload(pngFile());

    expect(result.contentType).toBe("image/png");
    expect(result.extension).toBe("png");
  });

  it("отвергает SVG: для категорий вектор не нужен и только расширяет поверхность риска", async () => {
    await expect(validateCategoryImageUpload(svgFile(CLEAN_LOGO))).rejects.toThrow(
      /только JPEG, PNG, WebP или AVIF/,
    );
  });

  it("отвергает подменённое содержимое", async () => {
    const spoofed = new File([new TextEncoder().encode("GIF89a")], "image.jpg", {
      type: "image/jpeg",
    });

    await expect(validateCategoryImageUpload(spoofed)).rejects.toThrow(/не соответствует заявленному/);
  });
});
