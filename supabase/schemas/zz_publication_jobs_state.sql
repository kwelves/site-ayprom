-- Read only the safe receipt/lease comparison needed after a lost confirmation reply.
-- The caller token is compared privately, never included in the returned object.
CREATE OR REPLACE FUNCTION public.read_publication_job(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s'
AS $$
DECLARE job public.publication_jobs;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid publication state request';
  END IF;
  SELECT j.* INTO job FROM public.publication_jobs j WHERE j.singleton;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'deployedRevision',job.deployed_revision,
    'deploymentIdentifier',job.deployment_identifier,
    'leaseRevision',job.lease_revision,
    'leaseOwned',coalesce(job.lease_token=p_token,false),
    'leaseValid',coalesce(job.lease_until>clock_timestamp(),false)
  );
END
$$;
REVOKE ALL ON FUNCTION public.read_publication_job(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_publication_job(uuid) TO service_role;
