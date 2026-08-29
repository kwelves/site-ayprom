import { expect, test } from "../support/browser-observer";
import {
  cleanupSeoProductsFixture,
  createSeoProductsFixture,
  draftSentinels,
  type SeoProductsFixture,
} from "../support/seo-products";

/**
 * QA-007: публичные metadata товарных страниц.
 *
 * Раньше здесь стояла одна проба с `test.fail` — режимом ожидаемого дефекта.
 * Она фиксировала, что маршруты не читают сохранённые SEO-поля, и по замыслу
 * проходила именно тогда, когда дефект наблюдался. После исправления такой
 * тест бесполезен: он не отличает работающую реализацию от сломанной.
 *
 * Здесь обычные обязательные проверки на управляемых локальных fixture с
 * уникальными sentinel-значениями. Sentinel важен: он не встречается ни в
 * реальных данных, ни в соседнем прогоне, поэтому по нему можно и подтвердить
 * нужное, и доказать отсутствие лишнего.
 */
test.describe.configure({ mode: "serial" });
let fixture: SeoProductsFixture;

test.beforeAll(async () => {
  fixture = await createSeoProductsFixture();
});

test.afterAll(async () => {
  if (fixture) await cleanupSeoProductsFixture(fixture);
});

/** Метаданные из фактически отданного HTML, а не из состояния React. */
async function readHeadMetadata(page: import("@playwright/test").Page) {
  return page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? null,
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? null,
    ogDescription: document.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? null,
    ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute("content") ?? null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null,
  }));
}

test.describe("[QA-007] публичные metadata товара", () => {
  test("сохранённые SEO-поля попадают в title, description и Open Graph", async ({ page, browserObserver }) => {
    const { filled } = fixture;
    const response = await page.goto(filled.canonicalPath);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    browserObserver.assertClean();

    const head = await readHeadMetadata(page);
    expect(head.title).toBe(`${filled.metaTitle} — AYPROM`);
    expect(head.description).toBe(filled.metaDescription);
    expect(head.ogTitle).toBe(filled.metaTitle);
    expect(head.ogDescription).toBe(filled.metaDescription);
    expect(head.canonical).toBe(`${new URL(page.url()).origin}${filled.canonicalPath}`);
    expect(head.ogUrl).toBe(`${new URL(page.url()).origin}${filled.canonicalPath}`);
    // Заполненная карточка индексируется: `noindex` здесь был бы дефектом.
    expect(head.robots).toBeNull();
  });

  test("пустые SEO-поля дают осмысленный fallback, а не пустое описание", async ({ page, browserObserver }) => {
    const { fallback } = fixture;
    const response = await page.goto(fallback.canonicalPath);
    expect(response?.status()).toBe(200);
    browserObserver.assertClean();

    const head = await readHeadMetadata(page);
    // Без meta_title заголовком становится имя товара.
    expect(head.title).toBe(`${fallback.name} — AYPROM`);
    // Без meta_description и без описаний собирается запасное описание с
    // названием и артикулом: пустой сниппет для карточки без текста хуже,
    // чем детерминированный текст.
    expect(head.description).not.toBeNull();
    expect(head.description).toContain(fallback.name);
    expect(head.description).toContain(fallback.article);
    expect(head.description!.length).toBeLessThanOrEqual(160);
    expect(head.ogTitle).toBe(fallback.name);
    expect(head.ogDescription).toBe(head.description);
    expect(head.canonical).toBe(`${new URL(page.url()).origin}${fallback.canonicalPath}`);
  });

  test("прямой маршрут категории отдаёт свои метаданные и canonical", async ({ page, browserObserver }) => {
    const { direct } = fixture;
    const response = await page.goto(direct.canonicalPath);
    expect(response?.status()).toBe(200);
    browserObserver.assertClean();

    const head = await readHeadMetadata(page);
    expect(head.title).toBe(`${direct.metaTitle} — AYPROM`);
    expect(head.description).toBe(direct.metaDescription);
    expect(head.canonical).toBe(`${new URL(page.url()).origin}${direct.canonicalPath}`);
  });

  // `/product/[slug]` не отдаёт карточку сам: он перенаправляет на её
  // единственный настоящий адрес. Перенаправление происходит НА КЛИЕНТЕ, уже
  // после ответа 200 — App Router обрабатывает `permanentRedirect` из
  // серверного компонента именно так. Поэтому дождаться его нужно явно:
  // тест, который сразу идёт дальше, обрывает навигацию на середине, и она
  // попадает в журнал браузера как `net::ERR_ABORTED`. Это и была причина
  // плавающих падений публичного набора.
  test("маршрут /product/[slug] ведёт на единственный настоящий адрес карточки", async ({ page }) => {
    for (const product of [fixture.filled, fixture.fallback, fixture.direct]) {
      const response = await page.goto(`/product/${product.slug}`);
      expect(response?.status()).toBe(200);
      await page.waitForURL(`**${product.canonicalPath}`);
      // Дожидаемся именно отрисованного заголовка страницы назначения. Ни смена
      // URL, ни `load`, ни `networkidle` не годятся: URL меняется в момент
      // фиксации навигации, а документ в этот момент ещё едет, и следующая
      // итерация цикла обрывает его — запрос попадает в журнал как
      // net::ERR_ABORTED. Видимый H1 означает, что документ действительно
      // отрисован и в полёте ничего не осталось.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(product.canonicalPath);
      const head = await readHeadMetadata(page);
      expect(head.canonical).toBe(`${new URL(page.url()).origin}${product.canonicalPath}`);
    }
    // Отдельного `assertClean` здесь нет: журнал браузера всё равно
    // проверяется автоматически при завершении теста, а повторная проверка
    // посреди трёх навигаций только приписывала бы этому тесту чужой шум.
  });

  // Одна карточка не должна попадать в индекс под несколькими адресами.
  //
  // Измерено: чужой маршрут отвечает НЕ 404, а 200. `generateMetadata`
  // выполняется раньше защиты в теле страницы и успевает начать поток, после
  // чего статус уже не изменить; в голову попадают title и description
  // настоящего товара, а телом отдаётся страница «не найдено». Дубля в поиске
  // это не создаёт — Next проставляет туда `noindex`, и здесь закрепляется
  // именно он. Сам факт 200 вместо 404 вынесен в ограничения QA-007: менять
  // стратегию canonical молча нельзя.
  test("чужие маршруты той же карточки не индексируются и не отдают карточку", async ({ page }) => {
    for (const product of [fixture.filled, fixture.fallback, fixture.direct]) {
      for (const foreignPath of product.foreignPaths) {
        const response = await page.goto(foreignPath);
        const html = await response!.text();
        expect(html, `${foreignPath} обязан быть noindex`).toContain('name="robots" content="noindex"');

        // Проверяется именно ТЕЛО, а не весь HTML: в голову чужого маршрута
        // title и description настоящего товара всё-таки попадают — это часть
        // того же дефекта с преждевременным `generateMetadata`. Ключевое, что
        // карточки на экране нет и страница закрыта от индексации.
        await expect(
          page.getByRole("heading", { level: 1, name: product.name }),
          `${foreignPath} отдал карточку товара`,
        ).toHaveCount(0);
      }
    }
  });

  test("отсутствующий товар закрыт от индексации", async ({ page }) => {
    const missingPath = `/catalog/category/${fixture.filled.categorySlug}/subcategory/${fixture.filled.subcategorySlug}/qa-e2e-product-does-not-exist`;
    const response = await page.request.get(missingPath, { maxRedirects: 0 });
    const html = await response.text();

    // Заглушечный заголовок, `noindex` и никакого canonical: страницы, на
    // которую можно было бы канонизироваться, попросту не существует.
    expect(html).toContain('name="robots" content="noindex"');
    expect(html).toContain("<title>Товар — AYPROM</title>");
    expect(html).not.toContain('rel="canonical"');
  });

  test("черновик не отдаётся ни по одному маршруту и не попадает в HTML", async ({ page }) => {
    const sentinels = draftSentinels(fixture);

    // Черновик закрыт на уровне базы: RLS отдаёт только `published = true`,
    // поэтому запрос не находит товар и страница уходит в «не найдено» с
    // `noindex`. Ни одно значение черновика в HTML попасть не может.
    for (const draftPath of fixture.draft.paths) {
      const response = await page.request.get(draftPath, { maxRedirects: 0 });
      const html = await response.text();
      expect(html, `${draftPath} обязан быть noindex`).toContain('name="robots" content="noindex"');
      for (const sentinel of sentinels) {
        expect(html, `черновик просочился в HTML ${draftPath}`).not.toContain(sentinel);
      }
    }

    // Черновика не должно быть и на страницах, которые отдаются успешно:
    // ни в каталоге категории, ни на соседней карточке.
    for (const publicPath of [`/catalog/category/${fixture.draft.categorySlug}`, fixture.filled.canonicalPath]) {
      const response = await page.goto(publicPath);
      expect(response?.status()).toBe(200);
      const html = await page.content();
      for (const sentinel of sentinels) {
        expect(html, `черновик просочился в HTML ${publicPath}`).not.toContain(sentinel);
      }
    }
  });

  test("в HTML карточки нет служебных полей и ключей", async ({ page, browserObserver }) => {
    const response = await page.goto(fixture.filled.canonicalPath);
    expect(response?.status()).toBe(200);
    browserObserver.assertClean();
    const html = await page.content();

    // Служебные имена колонок и признаки ключей. `service_role` и `secret`
    // проверяются как подстроки: любой их вид в разметке — уже утечка.
    for (const forbidden of [
      "service_role",
      "SUPABASE_SECRET_KEY",
      "ADMIN_SESSION_SECRET",
      "ADMIN_PASSWORD",
      "password_hash",
      "session_version",
      "admin_credentials",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", // заголовок любого JWT Supabase
    ]) {
      expect(html, `в HTML нашлось «${forbidden}»`).not.toContain(forbidden);
    }
  });
});
