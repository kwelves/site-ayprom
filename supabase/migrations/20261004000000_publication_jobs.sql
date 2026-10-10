-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.claim_publication_job (
  p_lease_seconds    integer,
  p_debounce_seconds integer
)
  RETURNS TABLE (
    revision bigint,
    token    uuid
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  job public.publication_jobs;
  current_row public.content_revision;
  now_at timestamptz := clock_timestamp();
  next_attempt integer;
  new_token uuid;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 1200
    OR p_debounce_seconds IS NULL OR p_debounce_seconds NOT BETWEEN 0 AND 3600 THEN
    RAISE EXCEPTION 'invalid_publication_claim' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.publication_jobs(singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;
  SELECT * INTO job FROM public.publication_jobs WHERE singleton = true FOR UPDATE;
  SELECT * INTO current_row FROM public.content_revision WHERE singleton = true;
  IF current_row.current_revision IS NULL OR current_row.current_revision <= job.deployed_revision
    OR current_row.updated_at + make_interval(secs => p_debounce_seconds) > now_at
    OR (job.lease_until IS NOT NULL AND job.lease_until > now_at)
    OR (job.attempt_revision = current_row.current_revision AND job.attempt_count >= 3)
    OR (job.attempt_revision = current_row.current_revision AND job.retry_after IS NOT NULL AND job.retry_after > now_at) THEN
    RETURN;
  END IF;
  next_attempt := CASE WHEN job.attempt_revision = current_row.current_revision THEN job.attempt_count + 1 ELSE 1 END;
  new_token := gen_random_uuid();
  UPDATE public.publication_jobs
    SET lease_revision = current_row.current_revision, lease_token = new_token,
        lease_until = now_at + make_interval(secs => p_lease_seconds),
        attempt_revision = current_row.current_revision, attempt_count = next_attempt,
        retry_after = NULL, last_error_code = NULL, updated_at = now_at
    WHERE singleton = true;
  revision := current_row.current_revision;
  token := new_token;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_publication_job(integer, integer) FROM PUBLIC;

GRANT ALL ON FUNCTION public.claim_publication_job(integer, integer) TO service_role;

CREATE FUNCTION public.confirm_publication_job (
  p_token                 uuid,
  p_revision              bigint,
  p_deployment_identifier text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  job public.publication_jobs;
  latest bigint;
  now_at timestamptz := clock_timestamp();
BEGIN
  IF p_token IS NULL OR p_revision IS NULL OR p_revision < 1 OR p_deployment_identifier IS NULL
    OR length(p_deployment_identifier) NOT BETWEEN 1 AND 128
    OR p_deployment_identifier !~ '^[a-zA-Z0-9._:-]+$' THEN
    RAISE EXCEPTION 'invalid_publication_confirmation' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO job FROM public.publication_jobs WHERE singleton = true FOR UPDATE;
  IF job.lease_token IS DISTINCT FROM p_token OR job.lease_revision IS DISTINCT FROM p_revision
    OR job.lease_until IS NULL OR job.lease_until <= now_at THEN
    RETURN false;
  END IF;
  latest := public.get_content_revision();
  IF latest <> p_revision THEN
    UPDATE public.publication_jobs
      SET lease_revision = NULL, lease_token = NULL, lease_until = NULL,
          retry_after = NULL, last_error_code = 'stale_revision', updated_at = now_at
      WHERE singleton = true;
    RETURN false;
  END IF;
  UPDATE public.publication_jobs
    SET deployed_revision = p_revision, deployment_identifier = p_deployment_identifier,
        lease_revision = NULL, lease_token = NULL, lease_until = NULL,
        attempt_count = 0, retry_after = NULL, last_error_code = NULL, updated_at = now_at
    WHERE singleton = true;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.confirm_publication_job(uuid, bigint, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.confirm_publication_job(uuid, bigint, text) TO service_role;

CREATE FUNCTION public.fail_publication_job (
  p_token      uuid,
  p_error_code text
)
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  job public.publication_jobs;
  now_at timestamptz := clock_timestamp();
BEGIN
  IF p_token IS NULL OR p_error_code IS NULL OR p_error_code NOT IN
    ('build_failed', 'verification_failed', 'promotion_failed') THEN
    RAISE EXCEPTION 'invalid_publication_failure' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO job FROM public.publication_jobs WHERE singleton = true FOR UPDATE;
  IF job.lease_token IS DISTINCT FROM p_token OR job.lease_until IS NULL OR job.lease_until <= now_at THEN
    RETURN false;
  END IF;
  UPDATE public.publication_jobs
    SET lease_revision = NULL, lease_token = NULL, lease_until = NULL,
        retry_after = CASE WHEN job.attempt_count >= 3 THEN NULL
          ELSE now_at + make_interval(secs => CASE WHEN job.attempt_count = 1 THEN 30 ELSE 120 END) END,
        last_error_code = p_error_code, updated_at = now_at
    WHERE singleton = true;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.fail_publication_job(uuid, text) FROM PUBLIC;

GRANT ALL ON FUNCTION public.fail_publication_job(uuid, text) TO service_role;

CREATE FUNCTION public.retry_publication_job()
  RETURNS boolean
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
DECLARE
  job public.publication_jobs;
  now_at timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO job FROM public.publication_jobs WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR (job.lease_until IS NOT NULL AND job.lease_until > now_at)
    OR public.get_content_revision() <= job.deployed_revision THEN
    RETURN false;
  END IF;
  UPDATE public.publication_jobs
    SET lease_revision = NULL, lease_token = NULL, lease_until = NULL,
        attempt_revision = NULL, attempt_count = 0, retry_after = NULL,
        last_error_code = NULL, updated_at = now_at
    WHERE singleton = true;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.retry_publication_job() FROM PUBLIC;

GRANT ALL ON FUNCTION public.retry_publication_job() TO service_role;

CREATE TABLE public.publication_jobs (
  singleton             boolean                  DEFAULT true NOT NULL,
  deployed_revision     bigint                   DEFAULT 0 NOT NULL,
  deployment_identifier text,
  lease_revision        bigint,
  lease_token           uuid,
  lease_until           timestamp with time zone,
  attempt_revision      bigint,
  attempt_count         integer                  DEFAULT 0 NOT NULL,
  retry_after           timestamp with time zone,
  last_error_code       text,
  updated_at            timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

ALTER TABLE public.publication_jobs
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.publication_jobs
  ADD CONSTRAINT publication_jobs_attempt_check CHECK (attempt_revision IS NOT NULL OR attempt_count = 0);

ALTER TABLE public.publication_jobs
  ADD CONSTRAINT publication_jobs_attempt_count_check CHECK (attempt_count >= 0 AND attempt_count <= 3);

ALTER TABLE public.publication_jobs
  ADD CONSTRAINT publication_jobs_deployed_check CHECK (deployed_revision >= 0);

ALTER TABLE public.publication_jobs
  ADD CONSTRAINT publication_jobs_lease_check CHECK (lease_revision IS NULL AND lease_token IS NULL AND lease_until IS NULL OR lease_revision IS NOT NULL AND lease_token IS
    NOT NULL AND lease_until IS NOT NULL);

ALTER TABLE public.publication_jobs
  ADD CONSTRAINT publication_jobs_pkey PRIMARY KEY (singleton);

ALTER TABLE public.publication_jobs
  ADD CONSTRAINT publication_jobs_singleton_check CHECK (singleton);

GRANT INSERT, SELECT, UPDATE ON public.publication_jobs TO service_role;
