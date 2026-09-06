-- Публичная сетка каталога раньше получала из RPC только выбранный WebP.
-- Если объект варианта отсутствовал или был повреждён, приложение уже не
-- знало URL постоянного master и показывало ложную заглушку «фото нет».
-- Добавляем отдельный OUT-столбец с master, не меняя входную сигнатуру RPC.
-- PostgreSQL не позволяет изменить RETURNS TABLE через CREATE OR REPLACE,
-- поэтому функция пересоздаётся и её минимальные права восстанавливаются
-- явно в этой же миграции.
DROP FUNCTION "public"."search_catalog_products"("text", "text", "text", "text", "text");

CREATE FUNCTION "public"."search_catalog_products"(
  "search_query" "text" DEFAULT NULL::"text",
  "category_filter" "text" DEFAULT NULL::"text",
  "subcategory_filter" "text" DEFAULT NULL::"text",
  "brand_filter" "text" DEFAULT NULL::"text",
  "vehicle_type_filter" "text" DEFAULT NULL::"text"
) RETURNS TABLE(
  "slug" "text",
  "name" "text",
  "category_slug" "text",
  "subcategory_slug" "text",
  "short_description" "text",
  "article" "text",
  "cover_url" "text",
  "cover_fallback_url" "text",
  "cover_scale" numeric,
  "compatible_brands" "text"[]
)
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
    case
      when cover.thumbnail_url is not null or cover.gallery_url is not null then cover.url
      else null
    end as cover_fallback_url,
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
        product.search_text like ('%' || split_part(normalized_query.value, ' ', 1) || '%')
        and product.search_text like all (
          select '%' || word || '%'
          from unnest(string_to_array(normalized_query.value, ' ')) as word
        )
      )
    )
  order by product."order", product.name;
$$;

ALTER FUNCTION "public"."search_catalog_products"("text", "text", "text", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."search_catalog_products"("text", "text", "text", "text", "text") FROM PUBLIC, "anon", "authenticated";
GRANT EXECUTE ON FUNCTION "public"."search_catalog_products"("text", "text", "text", "text", "text") TO "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."search_catalog_products"("text", "text", "text", "text", "text") TO "service_role";
