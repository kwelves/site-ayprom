-- Expand / contract bridge.
--
-- While the Vercel site is still the rollback target, it keeps reading the catalog the old way: straight from the
-- source tables with the public key, and through `search_catalog_products` WITHOUT naming a publication. The
-- migrations before this one close both paths (private_catalog_source revokes table reads; catalog_publications makes the
-- search answer only from a sealed publication). This migration keeps the old behaviour alive next to the new one:
--   1. public reads of the source tables are granted again, exactly as `least_privilege_client_roles` set them;
--   2. a call that names no publication (id and capability both NULL) is answered from the live tables, as before;
--      a call that names a publication (the static site's Worker always does) is answered from the sealed copy.
-- The matching "contract" step, applied only after Vercel is retired, is kept in supabase/contract/ and is NOT run here.

SET check_function_bodies = false;

GRANT SELECT ON TABLE "public"."brands" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."categories" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."category_brands" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."product_brands" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."product_characteristics" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."product_images" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."product_vehicle_types" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."products" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."subcategories" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."vehicle_hotspots" TO "anon", "authenticated";
GRANT SELECT ON TABLE "public"."vehicle_types" TO "anon", "authenticated";

CREATE FUNCTION catalog_private.search_live_products (
  search_query           text,
  category_filter        text,
  subcategory_filter     text,
  brand_filter           text,
  vehicle_type_filter    text,
  require_no_subcategory boolean
)
  RETURNS TABLE (
    slug               text,
    name               text,
    category_slug      text,
    subcategory_slug   text,
    short_description  text,
    article            text,
    cover_url          text,
    cover_fallback_url text,
    cover_scale        numeric,
    compatible_brands  text[]
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
    and (require_no_subcategory is not true or product.subcategory_id is null)
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
$function$;

REVOKE ALL ON FUNCTION catalog_private.search_live_products(text, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catalog_private.search_live_products(text, text, text, text, text, boolean) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.search_catalog_products (
  search_query           text    DEFAULT NULL::text,
  category_filter        text    DEFAULT NULL::text,
  subcategory_filter     text    DEFAULT NULL::text,
  brand_filter           text    DEFAULT NULL::text,
  vehicle_type_filter    text    DEFAULT NULL::text,
  require_no_subcategory boolean DEFAULT false,
  publication_id         uuid    DEFAULT NULL::uuid,
  publication_capability text    DEFAULT NULL::text
)
  RETURNS TABLE (
    slug               text,
    name               text,
    category_slug      text,
    subcategory_slug   text,
    short_description  text,
    article            text,
    cover_url          text,
    cover_fallback_url text,
    cover_scale        numeric,
    compatible_brands  text[]
  )
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
BEGIN
  IF publication_id IS NULL AND publication_capability IS NULL THEN
    RETURN QUERY SELECT * FROM catalog_private.search_live_products(
      search_query, category_filter, subcategory_filter, brand_filter, vehicle_type_filter, require_no_subcategory);
  ELSE
    RETURN QUERY SELECT * FROM catalog_private.search_products(
      search_query, category_filter, subcategory_filter, brand_filter, vehicle_type_filter, require_no_subcategory,
      publication_id, publication_capability);
  END IF;
END
$function$;
