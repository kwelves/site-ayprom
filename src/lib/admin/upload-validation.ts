import DOMPurify from "isomorphic-dompurify";
import { MAX_IMAGE_BYTES, validateRasterImage } from "@/lib/admin/image-validation";

// QA-012 (вторая половина): логотипы брендов и картинки категорий загружались
// вообще без серверной проверки. Расширение бралось прямо из имени файла,
// присланного браузером, и файл попадал в публичное хранилище как есть.
//
// Для логотипов это особенно опасно: они по умолчанию считались SVG, а SVG —
// не картинка, а текстовый документ, внутри которого может лежать исполняемый
// код. Такой файл становился публично доступным по ссылке.
//
// Здесь тип и расширение всегда выводятся из проверенного содержимого, а не из
// имени файла: имя целиком под контролем клиента и не должно влиять на путь в
// хранилище.

export interface ValidatedUpload {
  /** Содержимое для записи. Для SVG — уже обезвреженное. */
  bytes: Uint8Array;
  /** Проверенный тип; передаётся в хранилище явно, а не угадывается им. */
  contentType: string;
  /** Каноническое расширение для этого типа. */
  extension: string;
}

export const SVG_MIME_TYPE = "image/svg+xml";

/**
 * Теги, которые не имеют смысла в логотипе и являются известными путями к
 * исполнению кода или загрузке стороннего содержимого. DOMPurify отсекает их и
 * сам по себе в профиле svg, но список задан явно: он документирует намерение и
 * не зависит от изменения умолчаний библиотеки.
 */
const FORBIDDEN_SVG_TAGS = [
  "script",
  "foreignObject",
  "iframe",
  "embed",
  "object",
  "audio",
  "video",
  "handler",
  "listener",
];

const FORBIDDEN_SVG_ATTRIBUTES = ["href", "xlink:href", "formaction", "action"];

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

/**
 * Проверяет и обезвреживает SVG.
 *
 * Опасное содержимое **отвергается, а не вычищается молча**: логотип со
 * скриптом внутри — не логотип, и администратор должен узнать об этом, а не
 * получить «сохранено» с незаметно изменённым файлом. Тот же принцип, что и у
 * границ масштаба в фазе 2.
 */
export function sanitizeSvg(source: string, fileName: string): string {
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: FORBIDDEN_SVG_TAGS,
    FORBID_ATTR: FORBIDDEN_SVG_ATTRIBUTES,
  });

  // DOMPurify разбирает вход как HTML и оборачивает его в документ, поэтому в
  // списке удалённого всегда оказывается служебный BODY — даже для полностью
  // чистого файла. Это артефакт разбора, а не найденная угроза, и учитывать его
  // как повод для отказа нельзя.
  const PARSER_ARTIFACTS = new Set(["HTML", "HEAD", "BODY"]);
  const removed = DOMPurify.removed.filter((entry) => {
    const node = entry as { attribute?: { name?: string }; element?: { nodeName?: string } };
    if (node.attribute) return true;
    const name = node.element?.nodeName?.toUpperCase();
    return !name || !PARSER_ARTIFACTS.has(name);
  });

  if (removed.length > 0) {
    const what = removed
      .map((entry) => {
        const node = entry as { attribute?: { name?: string }; element?: { nodeName?: string } };
        return node.attribute?.name ?? node.element?.nodeName ?? "неизвестный элемент";
      })
      .filter((name, index, all) => all.indexOf(name) === index)
      .slice(0, 5)
      .join(", ");
    throw new Error(
      `Файл «${fileName}» содержит небезопасное содержимое (${what}) и не может быть загружен. ` +
        `Пересохраните логотип как чистый SVG без скриптов и внешних ссылок.`,
    );
  }

  if (!/<svg[\s>]/i.test(clean)) {
    throw new Error(`Файл «${fileName}» не является корректным SVG.`);
  }

  // Независимая проверка результата. Выше решение об отказе опирается на список
  // удалённого, который ведёт сама библиотека; здесь тот же вывод проверяется
  // ещё раз по содержимому — чтобы ошибка в фильтре служебных элементов не
  // открыла путь наружу. Это не замена санитайзеру и не regex-санитизация:
  // отказ, а не вычистка.
  const residualDanger = [
    /<\s*script/i,
    /\son[a-z]+\s*=/i,
    /javascript\s*:/i,
    /<\s*foreignObject/i,
  ].find((pattern) => pattern.test(clean));

  if (residualDanger) {
    throw new Error(
      `Файл «${fileName}» не прошёл повторную проверку безопасности и не может быть загружен.`,
    );
  }

  return clean;
}

/**
 * Логотип бренда: вектор (SVG) или обычная картинка.
 *
 * Вектор сохраняется вектором — `PROJECT_BRIEF` прямо запрещает растрировать
 * или апскейлить SVG, поэтому обезвреживание работает с исходным текстом и не
 * конвертирует его.
 */
export async function validateBrandLogoUpload(file: File): Promise<ValidatedUpload> {
  if (file.type === SVG_MIME_TYPE) {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error(`Файл «${file.name}» больше 8 МБ.`);
    }
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (extension !== "svg") {
      throw new Error(`Файл «${file.name}» объявлен как SVG, но имеет расширение «${extension}».`);
    }

    const source = decodeUtf8(new Uint8Array(await file.arrayBuffer()));
    const clean = sanitizeSvg(source, file.name);
    return {
      bytes: new TextEncoder().encode(clean),
      contentType: SVG_MIME_TYPE,
      extension: "svg",
    };
  }

  return validateRasterImage(file);
}

/**
 * Картинка категории или подкатегории: только растр.
 *
 * SVG здесь не принимается намеренно — в каталоге нет ни одной такой картинки,
 * а векторная иллюстрация категории не нужна: это фотографии.
 */
export async function validateCategoryImageUpload(file: File): Promise<ValidatedUpload> {
  if (file.type === SVG_MIME_TYPE) {
    throw new Error(
      `Файл «${file.name}»: для категорий принимаются только JPEG, PNG, WebP или AVIF.`,
    );
  }
  return validateRasterImage(file);
}
