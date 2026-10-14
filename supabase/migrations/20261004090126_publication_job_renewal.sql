-- Incremental counterpart of the declarative publication queue function.
-- Renewal is service-only and keeps the lease valid while a long build runs.
CREATE FUNCTION "public"."renew_publication_job"(p_token uuid, p_revision bigint, p_lease_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  job public.publication_jobs;
  now_at timestamptz := clock_timestamp();
BEGIN
  IF p_token IS NULL OR p_revision IS NULL OR p_revision < 1
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 1200 THEN
    RAISE EXCEPTION 'invalid_publication_renewal' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO job FROM public.publication_jobs WHERE singleton = true FOR UPDATE;
  IF NOT FOUND OR job.lease_token IS DISTINCT FROM p_token
    OR job.lease_revision IS DISTINCT FROM p_revision
    OR job.lease_until IS NULL OR job.lease_until <= now_at THEN
    RETURN false;
  END IF;
  IF public.get_content_revision() <> p_revision THEN
    UPDATE public.publication_jobs
      SET lease_revision = NULL, lease_token = NULL, lease_until = NULL,
          retry_after = NULL, last_error_code = 'stale_revision', updated_at = now_at
      WHERE singleton = true;
    RETURN false;
  END IF;
  UPDATE public.publication_jobs
    SET lease_until = greatest(job.lease_until, now_at + make_interval(secs => p_lease_seconds)),
        updated_at = now_at
    WHERE singleton = true;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.renew_publication_job(uuid,bigint,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_publication_job(uuid,bigint,integer) TO service_role;
