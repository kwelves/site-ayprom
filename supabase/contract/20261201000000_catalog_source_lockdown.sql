-- CONTRACT step. NOT part of supabase/migrations: it must be applied only AFTER the Vercel site is retired.
--
-- It undoes the compatibility bridge (20261012090000_expand_contract_bridge.sql):
--   1. public reads of the editable source tables are revoked again (the public catalog is then served only from
--      sealed publications, never from editable rows);
--   2. `search_catalog_products` answers only from a sealed publication: a call that names no publication uses the
--      active one, and there is no live-table fallback any more;
--   3. the live-table search function used by the fallback is removed.
-- How to apply it (after Vercel is off and a fresh database backup exists):
--   copy this file into supabase/migrations/ and run `supabase db push --include-all`
-- The strict tests that describe this state live in supabase/contract/tests/.

SET check_function_bodies = false;

REVOKE ALL ON TABLE public.brands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.categories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.category_brands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_brands FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_characteristics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_images FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.product_vehicle_types FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.products FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.subcategories FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vehicle_hotspots FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.vehicle_types FROM PUBLIC, anon, authenticated;

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
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select * from catalog_private.search_products(search_query, category_filter,
    subcategory_filter, brand_filter, vehicle_type_filter, require_no_subcategory,
    publication_id, publication_capability);
$function$;

DROP FUNCTION catalog_private.search_live_products(text, text, text, text, text, boolean);
