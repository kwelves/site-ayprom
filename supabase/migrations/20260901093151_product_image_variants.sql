-- Собственная система WebP-вариантов для товарных фотографий (фаза 2 из 4).
--
-- Фаза 1 (устранение блокирующего HTTP 402 на Vercel Image Optimization)
-- перевела рендер товарных фото на unoptimized: браузер грузит master
-- напрямую из Supabase Storage. Эта миграция готовит модель данных под
-- собственные компрессированные варианты, чтобы карточки и превью не
-- зависели от размера/качества оригинала.
--
-- thumbnail_url — до 640×640, WebP quality 72 (карточки, admin-превью).
-- gallery_url    — до 1600×1600, WebP quality 82 (галерея, zoom, OG, sitemap).
-- Оба nullable: строка product_images создаётся сразу при загрузке (см.
-- product-image-staging.ts), а варианты досчитываются позже генератором
-- (фаза 3) или backfill-скриптом (фаза 4) для уже существующих фото.
-- Существующий "url" остаётся оригиналом/master и не удаляется никогда —
-- он единственная гарантированно надёжная копия и цель отката/fallback.
ALTER TABLE "public"."product_images"
    ADD COLUMN "thumbnail_url" "text",
    ADD COLUMN "gallery_url" "text";

-- Оба варианта генерируются одним проходом из одного master (см. план:
-- "Оба варианта создавать непосредственно из master, а не thumbnail из
-- gallery"), поэтому промежуточного состояния "есть один, нет другого" не
-- бывает ни при создании, ни при backfill. Констрейнт делает это утверждение
-- проверяемым, а не просто комментарием.
ALTER TABLE "public"."product_images"
    ADD CONSTRAINT "product_images_variants_both_or_neither_check"
    CHECK (("thumbnail_url" IS NULL) = ("gallery_url" IS NULL));

-- search_catalog_products: сигнатура (имя, порядок и типы IN/OUT параметров)
-- не меняется — это RPC, вызываемый публичным клиентом по фиксированному
-- контракту. Меняется только тело: cover_url теперь возвращает
-- coalesce(thumbnail_url, gallery_url, url) — карточка получает наименьший
-- готовый вариант, а пока backfill/генератор не отработали по конкретному
-- фото, честно откатывается на оригинал. GRANT/REVOKE не трогаются: они
-- заданы на функцию по имени+сигнатуре и уже покрывают anon/authenticated/
-- service_role из миграции 20260810105147.
CREATE OR REPLACE FUNCTION "public"."search_catalog_products"("search_query" "text" DEFAULT NULL::"text", "category_filter" "text" DEFAULT NULL::"text", "subcategory_filter" "text" DEFAULT NULL::"text", "brand_filter" "text" DEFAULT NULL::"text", "vehicle_type_filter" "text" DEFAULT NULL::"text") RETURNS TABLE("slug" "text", "name" "text", "category_slug" "text", "subcategory_slug" "text", "short_description" "text", "article" "text", "cover_url" "text", "cover_scale" numeric, "compatible_brands" "text"[])
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with normalized_query as (
    select public.normalize_catalog_search(search_query) as value
  )
  select
    product.slug,
    product.name,
    product.category_slug,
    subcategory.slug as subcategory_slug,
    product.short_description,
    product.article,
    coalesce(cover.thumbnail_url, cover.gallery_url, cover.url) as cover_url,
    cover.scale as cover_scale,
    coalesce(brands.slugs, '{}') as compatible_brands
  from public.products as product
  cross join normalized_query
  left join public.subcategories as subcategory on subcategory.id = product.subcategory_id
  left join lateral (
    select image.url, image.thumbnail_url, image.gallery_url, image.scale
    from public.product_images as image
    where image.product_id = product.id
    order by image."order", image.id
    limit 1
  ) as cover on true
  left join lateral (
    select array_agg(product_brand.brand_slug order by product_brand.brand_slug) as slugs
    from public.product_brands as product_brand
    where product_brand.product_id = product.id
  ) as brands on true
  where product.published = true
    and (category_filter is null or product.category_slug = category_filter)
    and (
      subcategory_filter is null
      or (
        subcategory.slug = subcategory_filter
        and (category_filter is null or subcategory.category_slug = category_filter)
      )
    )
    and (
      brand_filter is null
      or exists (
        select 1
        from public.product_brands as product_brand_filter
        where product_brand_filter.product_id = product.id
          and product_brand_filter.brand_slug = brand_filter
      )
    )
    and (
      vehicle_type_filter is null
      or exists (
        select 1
        from public.product_vehicle_types as product_vehicle_type_filter
        where product_vehicle_type_filter.product_id = product.id
          and product_vehicle_type_filter.vehicle_type_slug = vehicle_type_filter
      )
    )
    and (
      normalized_query.value = ''
      or (
        -- Два условия делают разную работу, и оба нужны.
        --
        -- Первое — одиночный LIKE по первому слову — единственная форма,
        -- которую планировщик умеет свести к GIN-индексу по trgm. Проверено
        -- через EXPLAIN: ни `not exists (... not like ...)`, ни `like all`
        -- (ни с подзапросом, ни с массивом) индексом не покрываются и дают
        -- Seq Scan даже при enable_seqscan = off. Именно поэтому advisor
        -- считал products_search_text_trgm_idx неиспользуемым.
        --
        -- Второе — точная проверка «присутствуют все слова». Первое условие
        -- лишь сужает выборку до надмножества (первое слово входит в набор
        -- обязательных), поэтому семантика не меняется. Эквивалентность
        -- прежней формуле проверена на всех словах и парах слов каталога.
        product.search_text like ('%' || split_part(normalized_query.value, ' ', 1) || '%')
        and product.search_text like all (
          select '%' || word || '%'
          from unnest(string_to_array(normalized_query.value, ' ')) as word
        )
      )
    )
  order by product."order", product.name;
$$;

ALTER FUNCTION "public"."search_catalog_products"("search_query" "text", "category_filter" "text", "subcategory_filter" "text", "brand_filter" "text", "vehicle_type_filter" "text") OWNER TO "postgres";
