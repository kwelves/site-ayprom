-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.bump_content_revision()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  INSERT INTO public.content_revision (singleton, current_revision, updated_at)
  VALUES (true, 1, clock_timestamp())
  ON CONFLICT (singleton) DO UPDATE
  SET current_revision = public.content_revision.current_revision + 1,
      updated_at = clock_timestamp();
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.bump_content_revision() FROM PUBLIC;

GRANT ALL ON FUNCTION public.bump_content_revision() TO service_role;

CREATE FUNCTION public.get_content_revision()
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$ SELECT coalesce((SELECT current_revision FROM public.content_revision WHERE singleton = true), 0)::bigint $function$;

REVOKE ALL ON FUNCTION public.get_content_revision() FROM PUBLIC;

GRANT ALL ON FUNCTION public.get_content_revision() TO anon;

GRANT ALL ON FUNCTION public.get_content_revision() TO authenticated;

GRANT ALL ON FUNCTION public.get_content_revision() TO service_role;

CREATE TRIGGER publication_revision_brands
  AFTER INSERT OR DELETE OR UPDATE ON public.brands
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_content_revision();

CREATE TRIGGER publication_revision_categories
  AFTER INSERT OR DELETE OR UPDATE ON public.categories
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_content_revision();

CREATE TRIGGER publication_revision_category_brands
  AFTER INSERT OR DELETE OR UPDATE ON public.category_brands
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_content_revision();

CREATE TABLE public.content_revision (
  singleton        boolean                  DEFAULT true NOT NULL,
  current_revision bigint                   NOT NULL,
  updated_at       timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.content_revision
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.content_revision
  ADD CONSTRAINT content_revision_pkey PRIMARY KEY (singleton);

ALTER TABLE public.content_revision
  ADD CONSTRAINT content_revision_positive_check CHECK (current_revision >= 1);

ALTER TABLE public.content_revision
  ADD CONSTRAINT content_revision_singleton_check CHECK (singleton);

-- Explicitly narrow client grants even if a deployment has old default
-- privileges. RLS does not protect TRUNCATE or other table-level powers.
REVOKE ALL ON public.content_revision FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.content_revision TO anon;

GRANT SELECT ON public.content_revision TO authenticated;

GRANT ALL ON public.content_revision TO service_role;

CREATE POLICY "Public can read content revision" ON public.content_revision
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE TRIGGER publication_revision_product_brands
  AFTER INSERT OR DELETE OR UPDATE ON public.product_brands
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_content_revision();

CREATE TRIGGER publication_revision_product_characteristics
  AFTER INSERT OR DELETE OR UPDATE ON public.product_characteristics
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_content_revision();

CREATE TRIGGER publication_revision_product_images
  AFTER INSERT OR DELETE OR UPDATE ON public.product_images
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_content_revision();

CREATE TRIGGER publication_revision_product_vehicle_types
  AFTER INSERT OR DELETE OR UPDATE ON public.product_vehicle_types
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_content_revision();

CREATE TRIGGER publication_revision_products
  AFTER INSERT OR DELETE OR UPDATE ON public.products
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_content_revision();

CREATE TRIGGER publication_revision_subcategories
  AFTER INSERT OR DELETE OR UPDATE ON public.subcategories
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_content_revision();

CREATE TRIGGER publication_revision_vehicle_hotspots
  AFTER INSERT OR DELETE OR UPDATE ON public.vehicle_hotspots
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_content_revision();

CREATE TRIGGER publication_revision_vehicle_types
  AFTER INSERT OR DELETE OR UPDATE ON public.vehicle_types
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.bump_content_revision();
