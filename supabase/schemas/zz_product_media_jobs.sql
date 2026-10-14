-- External Node/Sharp work only. No HTTP/storage operations inside transactions.
-- Service-only RPCs are called AFTER the Worker authenticates the admin and
-- derives owner_hash; they do not trust a browser-supplied session identity.
CREATE TABLE "public"."product_media_jobs" (
  id uuid CONSTRAINT "product_media_jobs_pkey" PRIMARY KEY,
  draft_id uuid NOT NULL,
  owner_hash text NOT NULL CONSTRAINT "product_media_jobs_owner_hash_check" CHECK (owner_hash ~ '^[a-f0-9]{64}$'),
  mode text NOT NULL CONSTRAINT "product_media_jobs_mode_check" CHECK (mode IN ('normal','webp','script','script-webp')),
  content_type text NOT NULL CONSTRAINT "product_media_jobs_content_type_check" CHECK (content_type IN ('image/jpeg','image/png','image/webp','image/avif')),
  byte_size bigint NOT NULL CONSTRAINT "product_media_jobs_byte_size_check" CHECK (byte_size BETWEEN 1 AND 8388608),
  source_key text NOT NULL CONSTRAINT "product_media_jobs_source_key_key" UNIQUE,
  source_sha256 text CONSTRAINT "product_media_jobs_source_sha256_check" CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  product_id uuid CONSTRAINT "product_media_jobs_product_id_fkey" REFERENCES public.products(id) ON DELETE SET NULL,
  product_slug text,
  image_order integer,
  state text NOT NULL DEFAULT 'reserved' CONSTRAINT "product_media_jobs_state_check" CHECK (state IN ('reserved','ready','processing','succeeded','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CONSTRAINT "product_media_jobs_attempts_check" CHECK (attempts BETWEEN 0 AND 3),
  lease_token uuid,
  lease_until timestamptz,
  receipt jsonb,
  public_base text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '24 hours'),
  CONSTRAINT "product_media_jobs_lease_check" CHECK ((state = 'processing') = (lease_until IS NOT NULL) AND (state <> 'processing' OR lease_token IS NOT NULL)),
  CONSTRAINT "product_media_jobs_receipt_check" CHECK ((state = 'succeeded') = (receipt IS NOT NULL)),
  CONSTRAINT "product_media_jobs_expiry_check" CHECK (expires_at > created_at)
);
CREATE INDEX "product_media_jobs_draft_idx" ON public.product_media_jobs(owner_hash,draft_id);
CREATE INDEX "product_media_jobs_product_idx" ON public.product_media_jobs(product_id);
CREATE INDEX "product_media_jobs_ready_idx" ON public.product_media_jobs(created_at,id) WHERE state = 'ready';
CREATE INDEX "product_media_jobs_lease_idx" ON public.product_media_jobs(lease_until) WHERE state = 'processing';
ALTER TABLE public.product_media_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_media_jobs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_media_jobs TO service_role;

CREATE FUNCTION "public"."reserve_product_media_job"(p_id uuid, p_draft uuid, p_owner text, p_mode text, p_type text, p_bytes bigint)
RETURNS public.product_media_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE j public.product_media_jobs; ext text;
BEGIN
  IF p_id IS NULL OR p_draft IS NULL OR p_owner IS NULL OR p_owner !~ '^[a-f0-9]{64}$'
    OR p_mode IS NULL OR p_mode NOT IN ('normal','webp','script','script-webp')
    OR p_type IS NULL OR p_type NOT IN ('image/jpeg','image/png','image/webp','image/avif')
    OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 8388608 THEN
    RAISE EXCEPTION 'invalid_media_job' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('media-draft:' || p_owner || ':' || p_draft::text, 0));
  SELECT * INTO j FROM public.product_media_jobs WHERE id = p_id;
  IF FOUND THEN
    IF j.draft_id <> p_draft OR j.owner_hash <> p_owner OR j.mode <> p_mode OR j.content_type <> p_type OR j.byte_size <> p_bytes THEN
      RAISE EXCEPTION 'media_job_conflict' USING ERRCODE = '22023';
    END IF;
    RETURN j;
  END IF;
  IF (SELECT count(*) FROM public.product_media_jobs WHERE owner_hash = p_owner AND draft_id = p_draft
      AND state NOT IN ('cancelled','failed') AND expires_at > clock_timestamp()) >= 10 THEN
    RAISE EXCEPTION 'media_job_limit' USING ERRCODE = '22023';
  END IF;
  ext := CASE p_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' ELSE 'avif' END;
  INSERT INTO public.product_media_jobs(id,draft_id,owner_hash,mode,content_type,byte_size,source_key)
    VALUES(p_id,p_draft,p_owner,p_mode,p_type,p_bytes,'product-image-staging/' || p_draft || '/' || p_id || '/source.' || ext)
    RETURNING * INTO j;
  RETURN j;
END;
$$;

CREATE FUNCTION "public"."queue_product_media_job"(p_id uuid, p_owner text, p_product uuid, p_sha text)
RETURNS public.product_media_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE j public.product_media_jobs; slug text; position integer;
BEGIN
  IF p_sha IS NULL OR p_sha !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_media_job' USING ERRCODE = '22023'; END IF;
  -- Global lock ordering: product row, then job row. Serializes the ten-photo
  -- limit across different drafts; reservation itself serializes each draft.
  SELECT products.slug INTO slug FROM public.products WHERE id = p_product FOR UPDATE;
  IF NOT FOUND OR slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN RAISE EXCEPTION 'media_job_conflict' USING ERRCODE = '22023'; END IF;
  SELECT * INTO j FROM public.product_media_jobs WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR j.owner_hash IS DISTINCT FROM p_owner THEN RAISE EXCEPTION 'media_job_conflict' USING ERRCODE = '22023'; END IF;
  IF j.state IN ('ready','processing','succeeded') AND j.product_id = p_product AND j.source_sha256 = p_sha THEN RETURN j; END IF;
  IF j.state <> 'reserved' OR j.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'media_job_conflict' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.product_images WHERE product_id = p_product)
    + (SELECT count(*) FROM public.product_media_jobs WHERE product_id = p_product AND state IN ('ready','processing')) >= 10 THEN
    RAISE EXCEPTION 'media_job_limit' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(max(n),-1)+1 INTO position FROM (
    SELECT "order" AS n FROM public.product_images WHERE product_id = p_product
    UNION ALL SELECT image_order FROM public.product_media_jobs WHERE product_id = p_product AND state IN ('ready','processing')
  ) AS positions;
  UPDATE public.product_media_jobs SET state = 'ready', source_sha256 = p_sha, product_id = p_product,
    product_slug = slug, image_order = position WHERE id = p_id RETURNING * INTO j;
  RETURN j;
END;
$$;

CREATE FUNCTION "public"."claim_product_media_job"(p_seconds integer DEFAULT 120)
RETURNS SETOF public.product_media_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE job_id uuid;
BEGIN
  IF p_seconds IS NULL OR p_seconds NOT BETWEEN 5 AND 600 THEN RAISE EXCEPTION 'invalid_media_lease' USING ERRCODE = '22023'; END IF;
  -- Recover only a bounded batch; skip other transactions, never steal a live lease.
  WITH expired AS (
    SELECT id FROM public.product_media_jobs WHERE state = 'processing' AND lease_until <= clock_timestamp()
    ORDER BY lease_until,id LIMIT 100 FOR UPDATE SKIP LOCKED
  ) UPDATE public.product_media_jobs j SET state = CASE WHEN j.attempts < 3 AND j.expires_at > clock_timestamp() AND j.product_id IS NOT NULL THEN 'ready' ELSE 'failed' END,
      lease_until = NULL, lease_token = NULL FROM expired WHERE j.id = expired.id;
  SELECT id INTO job_id FROM public.product_media_jobs WHERE state = 'ready' AND attempts < 3
    AND expires_at > clock_timestamp() AND product_id IS NOT NULL ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF job_id IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.product_media_jobs SET state = 'processing', attempts = attempts+1,
    lease_token = pg_catalog.gen_random_uuid(), lease_until = clock_timestamp() + pg_catalog.make_interval(secs => p_seconds)
    WHERE id = job_id RETURNING *;
END;
$$;

CREATE FUNCTION "public"."fail_product_media_job"(p_id uuid, p_token uuid, p_retry boolean)
RETURNS public.product_media_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE j public.product_media_jobs;
BEGIN
  SELECT * INTO j FROM public.product_media_jobs WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR j.state <> 'processing' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until <= clock_timestamp() THEN
    RAISE EXCEPTION 'media_job_conflict' USING ERRCODE = '22023';
  END IF;
  UPDATE public.product_media_jobs SET state = CASE WHEN p_retry IS TRUE AND attempts < 3 AND expires_at > clock_timestamp() AND product_id IS NOT NULL THEN 'ready' ELSE 'failed' END,
    lease_until = NULL, lease_token = NULL WHERE id = p_id RETURNING * INTO j;
  RETURN j;
END;
$$;

CREATE FUNCTION "public"."cancel_product_media_job"(p_id uuid, p_owner text)
RETURNS public.product_media_jobs LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE j public.product_media_jobs;
BEGIN
  SELECT * INTO j FROM public.product_media_jobs WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR j.owner_hash IS DISTINCT FROM p_owner OR j.state = 'succeeded' THEN RAISE EXCEPTION 'media_job_conflict' USING ERRCODE = '22023'; END IF;
  UPDATE public.product_media_jobs SET state = 'cancelled', lease_until = NULL, lease_token = NULL WHERE id = p_id RETURNING * INTO j;
  RETURN j;
END;
$$;

CREATE FUNCTION "public"."finish_product_media_job"(p_id uuid, p_token uuid, p_receipt jsonb, p_base text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE j public.product_media_jobs; target uuid; kind text; item jsonb; prefix text; expected text; master_type text; ext text;
BEGIN
  SELECT product_id INTO target FROM public.product_media_jobs WHERE id = p_id;
  PERFORM 1 FROM public.products WHERE id = target FOR UPDATE;
  SELECT * INTO j FROM public.product_media_jobs WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'media_job_conflict' USING ERRCODE = '22023'; END IF;
  IF j.state = 'succeeded' AND j.lease_token = p_token AND j.receipt = p_receipt AND j.public_base = p_base THEN RETURN j.id; END IF;
  IF j.state <> 'processing' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until <= clock_timestamp()
    OR j.expires_at <= clock_timestamp() OR j.product_id IS NULL OR j.product_id IS DISTINCT FROM target THEN
    RAISE EXCEPTION 'media_job_conflict' USING ERRCODE = '22023';
  END IF;
  IF p_base IS NULL OR p_base !~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?(/[a-zA-Z0-9_-]+)*$'
    OR p_receipt IS NULL OR jsonb_typeof(p_receipt) <> 'object' OR pg_column_size(p_receipt) > 8192
    OR (p_receipt->>'inputSha256') IS DISTINCT FROM j.source_sha256 THEN
    RAISE EXCEPTION 'invalid_media_receipt' USING ERRCODE = '22023';
  END IF;
  master_type := CASE j.mode WHEN 'script' THEN 'image/png' WHEN 'script-webp' THEN 'image/webp' ELSE j.content_type END;
  ext := CASE master_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' ELSE 'avif' END;
  prefix := j.product_slug || '/' || j.id || '/';
  FOREACH kind IN ARRAY ARRAY['master','thumbnail','gallery'] LOOP
    item := p_receipt->kind;
    IF item IS NULL OR jsonb_typeof(item) <> 'object'
      OR coalesce(item->>'sha256','') !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(item->'bytes') IS DISTINCT FROM 'number'
      OR NOT (CASE WHEN item->>'bytes' ~ '^[0-9]{1,8}$' THEN (item->>'bytes')::bigint BETWEEN 1 AND 8388608 ELSE false END)
      OR (item->>'contentType') IS DISTINCT FROM (CASE WHEN kind = 'master' THEN master_type ELSE 'image/webp' END) THEN
      RAISE EXCEPTION 'invalid_media_receipt' USING ERRCODE = '22023';
    END IF;
    expected := CASE WHEN kind = 'master' THEN prefix || 'master.' || ext
      ELSE prefix || 'variants/' || CASE WHEN kind = 'thumbnail' THEN 'v2' ELSE 'v1' END || '/' || kind || '-' || left(item->>'sha256',16) || '.webp' END;
    IF (item->>'path') IS DISTINCT FROM expected THEN RAISE EXCEPTION 'invalid_media_receipt' USING ERRCODE = '22023'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.product_images WHERE product_id = target) >= 10 THEN RAISE EXCEPTION 'media_job_limit' USING ERRCODE = '22023'; END IF;
  -- Caller must confirm all immutable objects exist with these hashes BEFORE
  -- this RPC. SQL cannot verify R2. Job completion, image row and the existing
  -- publication revision trigger commit atomically here, never beforehand.
  INSERT INTO public.product_images(id,product_id,url,thumbnail_url,gallery_url,"order") VALUES (
    j.id,target,p_base || '/product-images/' || (p_receipt->'master'->>'path'),
    p_base || '/product-images/' || (p_receipt->'thumbnail'->>'path'),
    p_base || '/product-images/' || (p_receipt->'gallery'->>'path'),j.image_order);
  UPDATE public.product_media_jobs SET state = 'succeeded', lease_until = NULL, receipt = p_receipt, public_base = p_base WHERE id = p_id;
  RETURN j.id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_product_media_job(uuid,uuid,text,text,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.queue_product_media_job(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_product_media_job(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fail_product_media_job(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_product_media_job(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_product_media_job(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_product_media_job(uuid,uuid,text,text,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.queue_product_media_job(uuid,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_product_media_job(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_product_media_job(uuid,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_product_media_job(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_product_media_job(uuid,uuid,jsonb,text) TO service_role;
