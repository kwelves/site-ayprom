-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.reorder_brands (
  ordered_slugs text[]
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  update "public"."brands" as "brand"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_slugs") with ordinality as "desired"("slug", "ordinality")
  where "brand"."slug" = "desired"."slug"
    and "brand"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$function$;

REVOKE ALL ON FUNCTION public.reorder_brands(text[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reorder_brands(text[]) TO service_role;

CREATE FUNCTION public.reorder_categories (
  ordered_slugs text[]
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  update "public"."categories" as "category"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_slugs") with ordinality as "desired"("slug", "ordinality")
  where "category"."slug" = "desired"."slug"
    and "category"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$function$;

REVOKE ALL ON FUNCTION public.reorder_categories(text[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reorder_categories(text[]) TO service_role;

CREATE FUNCTION public.reorder_category_brands (
  target_category_slug text,
  ordered_brand_slugs  text[]
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  update "public"."category_brands" as "link"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_brand_slugs") with ordinality as "desired"("brand_slug", "ordinality")
  where "link"."category_slug" = "target_category_slug"
    and "link"."brand_slug" = "desired"."brand_slug"
    and "link"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$function$;

REVOKE ALL ON FUNCTION public.reorder_category_brands(text, text[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reorder_category_brands(text, text[]) TO service_role;

CREATE FUNCTION public.reorder_product_images (
  ordered_ids uuid[]
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  update "public"."product_images" as "image"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_ids") with ordinality as "desired"("id", "ordinality")
  where "image"."id" = "desired"."id"
    and "image"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$function$;

REVOKE ALL ON FUNCTION public.reorder_product_images(uuid[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reorder_product_images(uuid[]) TO service_role;

CREATE FUNCTION public.reorder_products (
  ordered_slugs text[]
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  with "desired" as (
    select "slug", "ordinality" as "position"
    from unnest("ordered_slugs") with ordinality as "u"("slug", "ordinality")
  ), "slots" as (
    select
      "product"."order" as "slot",
      row_number() over (order by "product"."order", "product"."name") as "position"
    from "public"."products" as "product"
    join "desired" on "desired"."slug" = "product"."slug"
  )
  update "public"."products" as "product"
  set "order" = "slots"."slot"
  from "desired"
  join "slots" on "slots"."position" = "desired"."position"
  where "product"."slug" = "desired"."slug"
    and "product"."order" is distinct from "slots"."slot";
$function$;

REVOKE ALL ON FUNCTION public.reorder_products(text[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reorder_products(text[]) TO service_role;

CREATE FUNCTION public.reorder_subcategories (
  ordered_ids uuid[]
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  update "public"."subcategories" as "subcategory"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_ids") with ordinality as "desired"("id", "ordinality")
  where "subcategory"."id" = "desired"."id"
    and "subcategory"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$function$;

REVOKE ALL ON FUNCTION public.reorder_subcategories(uuid[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reorder_subcategories(uuid[]) TO service_role;

CREATE FUNCTION public.reorder_vehicle_types (
  ordered_slugs text[]
)
  RETURNS void
  LANGUAGE sql
  SET search_path TO ''
  AS $function$
  update "public"."vehicle_types" as "vehicle_type"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_slugs") with ordinality as "desired"("slug", "ordinality")
  where "vehicle_type"."slug" = "desired"."slug"
    and "vehicle_type"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$function$;

REVOKE ALL ON FUNCTION public.reorder_vehicle_types(text[]) FROM PUBLIC;

GRANT ALL ON FUNCTION public.reorder_vehicle_types(text[]) TO service_role;

CREATE OR REPLACE FUNCTION public.search_catalog_products (
  search_query        text DEFAULT NULL::text,
  category_filter     text DEFAULT NULL::text,
  subcategory_filter  text DEFAULT NULL::text,
  brand_filter        text DEFAULT NULL::text,
  vehicle_type_filter text DEFAULT NULL::text
)
  RETURNS TABLE (
    slug              text,
    name              text,
    category_slug     text,
    subcategory_slug  text,
    short_description text,
    article           text,
    cover_url         text,
    cover_scale       numeric,
    compatible_brands text[]
  )
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
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
    cover.url as cover_url,
    cover.scale as cover_scale,
    coalesce(brands.slugs, '{}') as compatible_brands
  from public.products as product
  cross join normalized_query
  left join public.subcategories as subcategory on subcategory.id = product.subcategory_id
  left join lateral (
    select image.url, image.scale
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
$function$;

CREATE INDEX category_brands_brand_slug_idx ON public.category_brands (brand_slug);

CREATE INDEX vehicle_hotspots_product_id_idx ON public.vehicle_hotspots (product_id);