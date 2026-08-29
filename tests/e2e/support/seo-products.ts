import { getLocalAdminClient } from "./local-supabase";
import { E2E_PRODUCT_PREFIX } from "./local-products";

/**
 * QA-007: карточка товара доступна по трём разным маршрутам, и у каждого своя
 * защита. Проверять их на общем каталожном fixture нельзя: он создаёт товары
 * без подкатегории и без брендов, то есть ровно один маршрут из трёх.
 *
 * Здесь строится управляемый набор, где каждый случай отделён от остальных:
 * заполненные SEO-поля, пустые SEO-поля и черновик. Все значения — уникальные
 * sentinel-строки с идентификатором прогона: их нельзя спутать ни с реальными
 * данными, ни с соседним прогоном, и по ним же проверяется, что в HTML не
 * попало ничего лишнего.
 */
export type SeoProductsFixture = {
  runId: string;
  /** Товар с заполненными meta_title/meta_description, маршрут подкатегории. */
  filled: {
    slug: string;
    categorySlug: string;
    subcategorySlug: string;
    name: string;
    metaTitle: string;
    metaDescription: string;
    /** Маршрут, под которым товар действительно отдаётся. */
    canonicalPath: string;
    /** Маршруты той же карточки, которые обязаны отвечать 404. */
    foreignPaths: string[];
  };
  /** Товар без SEO-полей и без описаний, брендовый маршрут: проверка fallback. */
  fallback: {
    slug: string;
    categorySlug: string;
    brandSlug: string;
    name: string;
    article: string;
    canonicalPath: string;
    foreignPaths: string[];
  };
  /** Товар без подкатегории в обычной категории: прямой маршрут. */
  direct: {
    slug: string;
    categorySlug: string;
    name: string;
    metaTitle: string;
    metaDescription: string;
    canonicalPath: string;
    foreignPaths: string[];
  };
  /** Неопубликованный товар: не должен отдаваться ни по одному маршруту. */
  draft: {
    slug: string;
    categorySlug: string;
    name: string;
    metaTitle: string;
    metaDescription: string;
    secretMarker: string;
    paths: string[];
  };
};

/** Все sentinel-значения, которых НЕ должно быть в HTML публичных страниц. */
export function draftSentinels(fixture: SeoProductsFixture): string[] {
  return [fixture.draft.name, fixture.draft.metaTitle, fixture.draft.metaDescription, fixture.draft.secretMarker];
}

export async function createSeoProductsFixture(): Promise<SeoProductsFixture> {
  const supabase = getLocalAdminClient();
  const runId = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

  const subcategoryCategory = `${E2E_PRODUCT_PREFIX}category-sub-${runId}`;
  const brandCategory = `${E2E_PRODUCT_PREFIX}category-brand-${runId}`;
  const directCategory = `${E2E_PRODUCT_PREFIX}category-direct-${runId}`;
  const subcategorySlug = `${E2E_PRODUCT_PREFIX}subcategory-${runId}`;
  const brandSlug = `${E2E_PRODUCT_PREFIX}brand-${runId}`;

  const { error: categoriesError } = await supabase.from("categories").insert([
    {
      slug: subcategoryCategory,
      name: `QA E2E SEO subcategory category ${runId}`,
      description: "Owned local Playwright fixture",
      icon: "hydraulic-pump",
      image: "/brand/ayprom-icon.svg",
      type: "subcategory",
      order: 1_000_000,
    },
    {
      slug: brandCategory,
      name: `QA E2E SEO brand category ${runId}`,
      description: "Owned local Playwright fixture",
      icon: "hydraulic-pump",
      image: "/brand/ayprom-icon.svg",
      type: "brand",
      order: 1_000_001,
    },
    {
      slug: directCategory,
      name: `QA E2E SEO direct category ${runId}`,
      description: "Owned local Playwright fixture",
      icon: "hydraulic-pump",
      image: "/brand/ayprom-icon.svg",
      type: "subcategory",
      order: 1_000_002,
    },
  ]);
  if (categoriesError) throw categoriesError;

  const { error: subcategoryError } = await supabase.from("subcategories").insert({
    category_slug: subcategoryCategory,
    slug: subcategorySlug,
    name: `QA E2E SEO subcategory ${runId}`,
    image: "/brand/ayprom-icon.svg",
    order: 1_000_000,
  });
  if (subcategoryError) throw subcategoryError;

  const { data: subcategoryRow, error: subcategoryLookupError } = await supabase
    .from("subcategories")
    .select("id")
    .eq("category_slug", subcategoryCategory)
    .eq("slug", subcategorySlug)
    .single();
  if (subcategoryLookupError) throw subcategoryLookupError;

  const { error: brandError } = await supabase.from("brands").insert({
    slug: brandSlug,
    name: `QA E2E SEO brand ${runId}`,
    country: "Кыргызстан",
    logo: "/brand/ayprom-icon.svg",
    order: 1_000_000,
  });
  if (brandError) throw brandError;

  const { error: categoryBrandError } = await supabase.from("category_brands").insert({
    category_slug: brandCategory,
    brand_slug: brandSlug,
    order: 1_000_000,
  });
  if (categoryBrandError) throw categoryBrandError;

  const filled = {
    slug: `${E2E_PRODUCT_PREFIX}product-seo-filled-${runId}`,
    categorySlug: subcategoryCategory,
    subcategorySlug,
    name: `QA E2E SEO filled name ${runId}`,
    metaTitle: `QAE2ESEOTITLE${runId}`,
    metaDescription: `QAE2ESEODESCRIPTION${runId} уникальное описание для проверки метаданных.`,
    canonicalPath: "",
    foreignPaths: [] as string[],
  };
  const fallback = {
    slug: `${E2E_PRODUCT_PREFIX}product-seo-fallback-${runId}`,
    categorySlug: brandCategory,
    brandSlug,
    name: `QA E2E SEO fallback name ${runId}`,
    article: `QAE2EARTICLE${runId}`,
    canonicalPath: "",
    foreignPaths: [] as string[],
  };
  const direct = {
    slug: `${E2E_PRODUCT_PREFIX}product-seo-direct-${runId}`,
    categorySlug: directCategory,
    name: `QA E2E SEO direct name ${runId}`,
    metaTitle: `QAE2EDIRECTTITLE${runId}`,
    metaDescription: `QAE2EDIRECTDESCRIPTION${runId} уникальное описание прямого маршрута.`,
    canonicalPath: "",
    foreignPaths: [] as string[],
  };
  const draft = {
    slug: `${E2E_PRODUCT_PREFIX}product-seo-draft-${runId}`,
    categorySlug: subcategoryCategory,
    name: `QAE2EDRAFTNAME${runId}`,
    metaTitle: `QAE2EDRAFTTITLE${runId}`,
    metaDescription: `QAE2EDRAFTDESCRIPTION${runId}`,
    // Отдельный маркер в поле, которое публичная карточка выводит на экран:
    // если черновик всё же просочится, он найдётся в HTML по этой строке.
    secretMarker: `QAE2EDRAFTSECRET${runId}`,
    paths: [] as string[],
  };

  const { error: productsError } = await supabase.from("products").insert([
    {
      slug: filled.slug,
      name: filled.name,
      category_slug: filled.categorySlug,
      subcategory_id: subcategoryRow.id,
      short_description: `QA E2E filled short ${runId}`,
      published: true,
      availability: "in_stock",
      meta_title: filled.metaTitle,
      meta_description: filled.metaDescription,
      order: 1_000_000,
    },
    {
      // Ни meta_*, ни description, ни short_description сверх обязательного —
      // именно этот товар доказывает работу запасного описания.
      slug: fallback.slug,
      name: fallback.name,
      category_slug: fallback.categorySlug,
      short_description: "",
      article: fallback.article,
      published: true,
      availability: "in_stock",
      order: 1_000_001,
    },
    {
      slug: direct.slug,
      name: direct.name,
      category_slug: direct.categorySlug,
      short_description: `QA E2E direct short ${runId}`,
      published: true,
      availability: "in_stock",
      meta_title: direct.metaTitle,
      meta_description: direct.metaDescription,
      order: 1_000_002,
    },
    {
      slug: draft.slug,
      name: draft.name,
      category_slug: draft.categorySlug,
      subcategory_id: subcategoryRow.id,
      short_description: draft.secretMarker,
      published: false,
      availability: "in_stock",
      meta_title: draft.metaTitle,
      meta_description: draft.metaDescription,
      order: 1_000_003,
    },
  ]);
  if (productsError) throw productsError;

  const { data: fallbackRow, error: fallbackLookupError } = await supabase
    .from("products")
    .select("id")
    .eq("slug", fallback.slug)
    .single();
  if (fallbackLookupError) throw fallbackLookupError;

  const { error: productBrandError } = await supabase.from("product_brands").insert({
    product_id: fallbackRow.id,
    brand_slug: fallback.brandSlug,
  });
  if (productBrandError) throw productBrandError;

  filled.canonicalPath = `/catalog/category/${filled.categorySlug}/subcategory/${filled.subcategorySlug}/${filled.slug}`;
  filled.foreignPaths = [
    `/catalog/category/${filled.categorySlug}/${filled.slug}`,
    `/catalog/category/${filled.categorySlug}/brand/${fallback.brandSlug}/${filled.slug}`,
  ];

  fallback.canonicalPath = `/catalog/category/${fallback.categorySlug}/brand/${fallback.brandSlug}/${fallback.slug}`;
  fallback.foreignPaths = [
    `/catalog/category/${fallback.categorySlug}/${fallback.slug}`,
    `/catalog/category/${fallback.categorySlug}/subcategory/${subcategorySlug}/${fallback.slug}`,
  ];

  direct.canonicalPath = `/catalog/category/${direct.categorySlug}/${direct.slug}`;
  direct.foreignPaths = [
    `/catalog/category/${direct.categorySlug}/subcategory/${subcategorySlug}/${direct.slug}`,
    `/catalog/category/${direct.categorySlug}/brand/${fallback.brandSlug}/${direct.slug}`,
  ];

  draft.paths = [
    `/product/${draft.slug}`,
    `/catalog/category/${draft.categorySlug}/subcategory/${subcategorySlug}/${draft.slug}`,
    `/catalog/category/${draft.categorySlug}/${draft.slug}`,
  ];

  return { runId, filled, fallback, direct, draft };
}

export async function cleanupSeoProductsFixture(fixture: SeoProductsFixture): Promise<void> {
  const supabase = getLocalAdminClient();
  const slugs = [fixture.filled.slug, fixture.fallback.slug, fixture.direct.slug, fixture.draft.slug];
  for (const slug of slugs) {
    if (!slug.startsWith(E2E_PRODUCT_PREFIX)) throw new Error(`Отказ очистки чужого fixture slug: ${slug}`);
  }

  const { error: productsError } = await supabase.from("products").delete().in("slug", slugs);
  if (productsError) throw productsError;

  const { error: categoryBrandError } = await supabase
    .from("category_brands")
    .delete()
    .eq("category_slug", fixture.fallback.categorySlug);
  if (categoryBrandError) throw categoryBrandError;

  const { error: brandDeleteError } = await supabase.from("brands").delete().eq("slug", fixture.fallback.brandSlug);
  if (brandDeleteError) throw brandDeleteError;

  const { error: subcategoryError } = await supabase
    .from("subcategories")
    .delete()
    .eq("slug", fixture.filled.subcategorySlug);
  if (subcategoryError) throw subcategoryError;

  const { error: categoriesError } = await supabase
    .from("categories")
    .delete()
    .in("slug", [fixture.filled.categorySlug, fixture.fallback.categorySlug, fixture.direct.categorySlug]);
  if (categoriesError) throw categoriesError;
}
