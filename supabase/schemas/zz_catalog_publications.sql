-- A release is separate from the editable catalog. This schema is not in
-- api.schemas; only the explicitly granted public wrappers are REST-visible.
CREATE SCHEMA IF NOT EXISTS catalog_private;
REVOKE ALL ON SCHEMA catalog_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS catalog_private.catalog_releases (
  id uuid PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision >= 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  capability_hash text NOT NULL CHECK (capability_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'capturing' CHECK (state IN ('capturing', 'sealed', 'ready', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sealed_at timestamptz
);

CREATE TABLE IF NOT EXISTS catalog_private.catalog_release_documents (
  release_id uuid NOT NULL REFERENCES catalog_private.catalog_releases(id),
  kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 64),
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 256),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 1048576),
  PRIMARY KEY (release_id, kind, key)
);

CREATE TABLE IF NOT EXISTS catalog_private.catalog_release_search (
  release_id uuid NOT NULL REFERENCES catalog_private.catalog_releases(id),
  slug text NOT NULL,
  name text NOT NULL,
  category_slug text NOT NULL,
  subcategory_slug text,
  short_description text NOT NULL DEFAULT '',
  article text,
  cover_url text,
  cover_fallback_url text,
  cover_scale numeric,
  compatible_brands text[] NOT NULL DEFAULT '{}',
  vehicle_types text[] NOT NULL DEFAULT '{}',
  search_text text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (release_id, slug)
);

CREATE TABLE IF NOT EXISTS catalog_private.catalog_publication_active (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  release_id uuid NOT NULL REFERENCES catalog_private.catalog_releases(id)
);

ALTER TABLE catalog_private.catalog_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_private.catalog_release_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_private.catalog_release_search ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_private.catalog_publication_active ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA catalog_private FROM PUBLIC, anon, authenticated, service_role;

-- USAGE permits the invoker wrappers to resolve the private read functions;
-- it grants no table access and does not expose this schema through PostgREST.
GRANT USAGE ON SCHEMA catalog_private TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION catalog_private.resolve_publication(
  publication_id uuid, publication_capability text
) RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE selected_id uuid;
BEGIN
  IF publication_id IS NULL AND publication_capability IS NULL THEN
    SELECT r.id INTO selected_id
    FROM catalog_private.catalog_publication_active AS a
    JOIN catalog_private.catalog_releases AS r ON r.id = a.release_id
    WHERE a.singleton AND r.state = 'ready';
  ELSIF publication_id IS NOT NULL AND publication_capability IS NOT NULL
    AND length(publication_capability) BETWEEN 1 AND 256 THEN
    SELECT r.id INTO selected_id FROM catalog_private.catalog_releases AS r
    WHERE r.id = publication_id AND r.state IN ('sealed', 'ready')
      AND r.capability_hash = encode(extensions.digest(publication_capability, 'sha256'), 'hex');
  END IF;
  IF selected_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog publication unavailable';
  END IF;
  RETURN selected_id;
END
$$;

CREATE OR REPLACE FUNCTION catalog_private.read_document(
  document_kind text, document_key text, publication_id uuid, publication_capability text
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE selected_id uuid; result jsonb;
BEGIN
  selected_id := catalog_private.resolve_publication(publication_id, publication_capability);
  IF document_kind IS NULL OR length(document_kind) NOT BETWEEN 1 AND 64
    OR document_key IS NULL OR length(document_key) NOT BETWEEN 1 AND 256 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid catalog document request';
  END IF;
  SELECT d.payload INTO result FROM catalog_private.catalog_release_documents AS d
    WHERE d.release_id = selected_id AND d.kind = document_kind AND d.key = document_key;
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION catalog_private.list_documents(
  document_kind text, publication_id uuid, publication_capability text
) RETURNS SETOF jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE selected_id uuid;
BEGIN
  selected_id := catalog_private.resolve_publication(publication_id, publication_capability);
  IF document_kind IS NULL OR length(document_kind) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid catalog document request';
  END IF;
  RETURN QUERY SELECT d.payload FROM catalog_private.catalog_release_documents AS d
    WHERE d.release_id = selected_id AND d.kind = document_kind ORDER BY d.key;
END
$$;

CREATE OR REPLACE FUNCTION catalog_private.guard_release_data()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE current_state text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog publication immutable';
  END IF;
  -- Lock the parent so a concurrent seal cannot pass an in-flight insert.
  SELECT r.state INTO current_state FROM catalog_private.catalog_releases AS r
    WHERE r.id = NEW.release_id FOR SHARE;
  IF current_state IS DISTINCT FROM 'capturing' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog publication immutable';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION catalog_private.guard_release_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog publication immutable';
  END IF;
  IF ROW(NEW.id, NEW.revision, NEW.capability_hash, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.revision, OLD.capability_hash, OLD.created_at) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog publication immutable';
  END IF;
  IF OLD.state = 'capturing' THEN
    IF NEW.state NOT IN ('capturing', 'sealed', 'revoked') THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog publication immutable';
    END IF;
  ELSE
    IF (to_jsonb(NEW) - 'state') IS DISTINCT FROM (to_jsonb(OLD) - 'state')
      OR NOT (NEW.state = OLD.state
        OR (OLD.state = 'sealed' AND NEW.state IN ('ready', 'revoked'))
        OR (OLD.state = 'ready' AND NEW.state = 'revoked')) THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog publication immutable';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER immutable_publication_identity
BEFORE UPDATE OR DELETE ON catalog_private.catalog_releases
FOR EACH ROW EXECUTE FUNCTION catalog_private.guard_release_identity();

CREATE OR REPLACE FUNCTION catalog_private.search_products(
  search_query text, category_filter text, subcategory_filter text,
  brand_filter text, vehicle_type_filter text, require_no_subcategory boolean,
  publication_id uuid, publication_capability text
) RETURNS TABLE(slug text, name text, category_slug text, subcategory_slug text,
  short_description text, article text, cover_url text, cover_fallback_url text,
  cover_scale numeric, compatible_brands text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE selected_id uuid; normalized_query text;
BEGIN
  selected_id := catalog_private.resolve_publication(publication_id, publication_capability);
  normalized_query := public.normalize_catalog_search(search_query);
  RETURN QUERY SELECT p.slug, p.name, p.category_slug, p.subcategory_slug,
    p.short_description, p.article, p.cover_url, p.cover_fallback_url,
    p.cover_scale, p.compatible_brands
  FROM catalog_private.catalog_release_search AS p
  WHERE p.release_id = selected_id
    AND (category_filter IS NULL OR p.category_slug = category_filter)
    AND (subcategory_filter IS NULL OR p.subcategory_slug = subcategory_filter)
    AND (require_no_subcategory IS NOT TRUE OR p.subcategory_slug IS NULL)
    AND (brand_filter IS NULL OR brand_filter = ANY(p.compatible_brands))
    AND (vehicle_type_filter IS NULL OR vehicle_type_filter = ANY(p.vehicle_types))
    AND (normalized_query = '' OR (
      p.search_text LIKE ('%' || split_part(normalized_query, ' ', 1) || '%')
      AND p.search_text LIKE ALL (
        SELECT '%' || word || '%' FROM unnest(string_to_array(normalized_query, ' ')) AS word
      )
    ))
  ORDER BY p.sort_order, p.name;
END
$$;

CREATE TRIGGER immutable_publication_documents
BEFORE INSERT OR UPDATE OR DELETE ON catalog_private.catalog_release_documents
FOR EACH ROW EXECUTE FUNCTION catalog_private.guard_release_data();
CREATE TRIGGER immutable_publication_search
BEFORE INSERT OR UPDATE OR DELETE ON catalog_private.catalog_release_search
FOR EACH ROW EXECUTE FUNCTION catalog_private.guard_release_data();

CREATE OR REPLACE FUNCTION public.read_catalog_publication_document(
  kind text, key text, publication_id uuid DEFAULT NULL, publication_capability text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT catalog_private.read_document(kind, key, publication_id, publication_capability) $$;

CREATE OR REPLACE FUNCTION public.list_catalog_publication_documents(
  kind text, publication_id uuid DEFAULT NULL, publication_capability text DEFAULT NULL
) RETURNS SETOF jsonb LANGUAGE sql STABLE SET search_path = ''
AS $$ SELECT * FROM catalog_private.list_documents(kind, publication_id, publication_capability) $$;

REVOKE ALL ON FUNCTION catalog_private.resolve_publication(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catalog_private.guard_release_data() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catalog_private.guard_release_identity() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catalog_private.read_document(text,text,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catalog_private.list_documents(text,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catalog_private.read_document(text,text,uuid,text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catalog_private.list_documents(text,uuid,text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catalog_private.search_products(text,text,text,text,text,boolean,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catalog_private.search_products(text,text,text,text,text,boolean,uuid,text) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.read_catalog_publication_document(text,text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_catalog_publication_document(text,text,uuid,text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_catalog_publication_documents(text,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_catalog_publication_documents(text,uuid,text) TO anon, authenticated, service_role;

-- The builder calls one transaction, never paginates over mutable source rows.
-- NOWAIT bounds lock acquisition: a busy catalog is retried as a new job, not
-- read partially. SHARE permits ordinary reads but prevents source writes until
-- this transaction commits. No test sleeps or caller-provided SQL are accepted.
CREATE OR REPLACE FUNCTION catalog_private.capture_publication(
  expected_revision bigint, release_id uuid, capability_hash text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = '' SET timezone = 'UTC'
AS $$
DECLARE
  existing catalog_private.catalog_releases;
  document_count bigint;
  total_bytes bigint;
  content_hash text;
BEGIN
  IF expected_revision IS NULL OR expected_revision < 0 OR expected_revision > 9007199254740991
    OR release_id IS NULL OR capability_hash IS NULL OR capability_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid catalog capture request';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(release_id::text, 482914)) THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog capture unavailable';
  END IF;
  SELECT r.* INTO existing FROM catalog_private.catalog_releases r WHERE r.id = release_id;
  IF FOUND THEN
    IF existing.revision <> expected_revision OR existing.capability_hash <> capability_hash
      OR existing.state NOT IN ('sealed','ready') OR existing.sha256 IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog capture unavailable';
    END IF;
    RETURN jsonb_build_object('releaseId',existing.id,'revision',existing.revision,
      'sha256',existing.sha256,'documentCount',(SELECT count(*) FROM catalog_private.catalog_release_documents d WHERE d.release_id=existing.id));
  END IF;

  LOCK TABLE public.brands, public.categories, public.category_brands,
    public.product_brands, public.product_characteristics, public.product_images,
    public.product_vehicle_types, public.products, public.subcategories,
    public.vehicle_hotspots, public.vehicle_types, public.content_revision IN SHARE MODE NOWAIT;
  IF public.get_content_revision() <> expected_revision THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog capture unavailable';
  END IF;
  INSERT INTO catalog_private.catalog_releases(id,revision,capability_hash)
    VALUES (release_id,expected_revision,capability_hash);

  -- Explicit public projections: never to_jsonb(source_row), which could expose
  -- a newly added admin-only column without a review. Nulls and variant URLs are
  -- retained for the existing query mappers; no draft product is captured.
  INSERT INTO catalog_private.catalog_release_documents(release_id,kind,key,payload)
  SELECT release_id,'category',c.slug,jsonb_build_object('slug',c.slug,'name',c.name,
    'description',c.description,'icon',c.icon,'image',c.image,'intro',c.intro,'type',c.type,'order',c."order") FROM public.categories c
  UNION ALL
  SELECT release_id,'subcategory',jsonb_build_array(s.category_slug,s.slug)::text,
    jsonb_build_object('category_slug',s.category_slug,'slug',s.slug,'name',s.name,'image',s.image,'intro',s.intro,'order',s."order") FROM public.subcategories s
  UNION ALL
  SELECT release_id,'brand',b.slug,jsonb_build_object('slug',b.slug,'name',b.name,'country',b.country,'logo',b.logo,'logo_scale',b.logo_scale,'order',b."order") FROM public.brands b
  UNION ALL
  SELECT release_id,'category_brand',jsonb_build_array(cb.category_slug,cb.brand_slug)::text,
    jsonb_build_object('category_slug',cb.category_slug,'brand_slug',cb.brand_slug,'logo_scale_override',cb.logo_scale_override,'order',cb."order") FROM public.category_brands cb
  UNION ALL
  SELECT release_id,'vehicle_type',v.slug,jsonb_build_object('slug',v.slug,'name',v.name,'order',v."order") FROM public.vehicle_types v;

  INSERT INTO catalog_private.catalog_release_documents(release_id,kind,key,payload)
  SELECT release_id,'product',p.slug,jsonb_build_object(
    'slug',p.slug,'name',p.name,'category_slug',p.category_slug,'short_description',p.short_description,
    'description',p.description,'article',p.article,'meta_title',p.meta_title,'meta_description',p.meta_description,
    'order',p."order",'updated_at',p.updated_at,
    'subcategories',(SELECT jsonb_build_object('slug',s.slug) FROM public.subcategories s WHERE s.id=p.subcategory_id),
    'product_images',coalesce((SELECT jsonb_agg(jsonb_build_object('url',i.url,'order',i."order",'scale',i.scale,
      'thumbnail_url',i.thumbnail_url,'gallery_url',i.gallery_url) ORDER BY i."order",i.url COLLATE "C",i.id)
      FROM public.product_images i WHERE i.product_id=p.id),'[]'::jsonb),
    'product_characteristics',coalesce((SELECT jsonb_agg(jsonb_build_object('attribute',c.attribute,'value',c.value,'order',c."order")
      ORDER BY c."order",c.attribute COLLATE "C",c.value COLLATE "C",c.id) FROM public.product_characteristics c WHERE c.product_id=p.id),'[]'::jsonb),
    'product_brands',coalesce((SELECT jsonb_agg(jsonb_build_object('brands',jsonb_build_object('slug',b.slug,'name',b.name,'country',b.country,'logo',b.logo,'logo_scale',b.logo_scale))
      ORDER BY b.slug COLLATE "C") FROM public.product_brands pb JOIN public.brands b ON b.slug=pb.brand_slug WHERE pb.product_id=p.id),'[]'::jsonb),
    'product_vehicle_types',coalesce((SELECT jsonb_agg(jsonb_build_object('vehicle_type_slug',pv.vehicle_type_slug) ORDER BY pv.vehicle_type_slug COLLATE "C")
      FROM public.product_vehicle_types pv WHERE pv.product_id=p.id),'[]'::jsonb))
  FROM public.products p WHERE p.published;

  INSERT INTO catalog_private.catalog_release_documents(release_id,kind,key,payload)
  SELECT capture_publication.release_id,'vehicle_hotspot',h.id::text,jsonb_build_object('id',h.id,'vehicle_type_slug',h.vehicle_type_slug,
    'hotspot_number',h.hotspot_number,'label',h.label,'x_pct',h.x_pct,'y_pct',h.y_pct,
    'products',CASE WHEN d.payload IS NULL THEN NULL ELSE jsonb_build_object('slug',d.payload->'slug',
      'name',d.payload->'name','short_description',d.payload->'short_description','product_images',d.payload->'product_images') END)
  FROM public.vehicle_hotspots h LEFT JOIN public.products p ON p.id=h.product_id AND p.published
    LEFT JOIN catalog_private.catalog_release_documents d ON d.release_id=capture_publication.release_id AND d.kind='product' AND d.key=p.slug;

  INSERT INTO catalog_private.catalog_release_search(release_id,slug,name,category_slug,subcategory_slug,
    short_description,article,cover_url,cover_fallback_url,cover_scale,compatible_brands,vehicle_types,search_text,sort_order)
  SELECT release_id,p.slug,p.name,p.category_slug,s.slug,p.short_description,p.article,
    coalesce(i.thumbnail_url,i.gallery_url,i.url),
    CASE WHEN coalesce(i.thumbnail_url,i.gallery_url,i.url) IS DISTINCT FROM i.url THEN i.url END,
    i.scale,ARRAY(SELECT pb.brand_slug FROM public.product_brands pb WHERE pb.product_id=p.id ORDER BY pb.brand_slug COLLATE "C"),
    ARRAY(SELECT pv.vehicle_type_slug FROM public.product_vehicle_types pv WHERE pv.product_id=p.id ORDER BY pv.vehicle_type_slug COLLATE "C"),p.search_text,p."order"
  FROM public.products p LEFT JOIN public.subcategories s ON s.id=p.subcategory_id
    LEFT JOIN LATERAL (SELECT pi.url,pi.thumbnail_url,pi.gallery_url,pi.scale FROM public.product_images pi
      WHERE pi.product_id=p.id ORDER BY pi."order",pi.url COLLATE "C",pi.id LIMIT 1) i ON true
  WHERE p.published;

  SELECT count(*),coalesce(sum(octet_length(d.payload::text)),0) INTO document_count,total_bytes
    FROM catalog_private.catalog_release_documents d WHERE d.release_id=capture_publication.release_id;
  IF document_count > 20000 OR total_bytes > 536870912 THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog capture unavailable';
  END IF;
  -- Canonical format v1: PostgreSQL jsonb text, C-ordered document keys and
  -- search slugs, UTF-8 digest. Identity, capability and timestamps of capture
  -- are not content. Source updated_at IS content (sitemap lastmod).
  SELECT encode(extensions.digest(jsonb_build_object('format',1,
    'documents',coalesce((SELECT jsonb_agg(jsonb_build_array(d.kind,d.key,d.payload) ORDER BY d.kind COLLATE "C",d.key COLLATE "C")
      FROM catalog_private.catalog_release_documents d WHERE d.release_id=capture_publication.release_id),'[]'::jsonb),
    'search',coalesce((SELECT jsonb_agg(to_jsonb(s)-'release_id' ORDER BY s.slug COLLATE "C")
      FROM catalog_private.catalog_release_search s WHERE s.release_id=capture_publication.release_id),'[]'::jsonb))::text,'sha256'),'hex') INTO content_hash;
  UPDATE catalog_private.catalog_releases r SET sha256=content_hash,state='sealed',sealed_at=clock_timestamp()
    WHERE r.id=release_id;
  RETURN jsonb_build_object('releaseId',release_id,'revision',expected_revision,'sha256',content_hash,'documentCount',document_count);
EXCEPTION
  WHEN invalid_parameter_value THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid catalog capture request';
  WHEN OTHERS THEN
    -- This exception block rolls back every insert before returning a safe
    -- error. Never expose source text or the capability hash through DETAIL.
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Catalog capture unavailable';
END
$$;

CREATE OR REPLACE FUNCTION public.capture_catalog_publication(expected_revision bigint, release_id uuid, capability_hash text)
RETURNS jsonb LANGUAGE sql VOLATILE SET search_path = ''
AS $$ SELECT catalog_private.capture_publication(expected_revision,release_id,capability_hash) $$;
REVOKE ALL ON FUNCTION catalog_private.capture_publication(bigint,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catalog_private.capture_publication(bigint,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.capture_catalog_publication(bigint,uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_catalog_publication(bigint,uuid,text) TO service_role;
