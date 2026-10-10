-- Publication control is callable only by the private Node coordinator.
-- The release content remains immutable and no direct table rights are added.
CREATE OR REPLACE FUNCTION catalog_private.read_publication_control()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s'
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM catalog_private.catalog_publication_active a WHERE a.singleton) THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object('releaseId',r.id,'revision',r.revision,'releaseSha256',r.sha256)
    INTO result FROM catalog_private.catalog_publication_active a
    JOIN catalog_private.catalog_releases r ON r.id=a.release_id
    WHERE a.singleton AND r.state='ready' AND r.sha256 ~ '^[0-9a-f]{64}$';
  IF result IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='Catalog publication control unavailable';
  END IF;
  RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION catalog_private.mark_publication_ready(
  p_expected_revision bigint, p_release_id uuid, p_release_sha256 text, p_lease_token uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s'
AS $$
DECLARE job public.publication_jobs; current_revision bigint; selected catalog_private.catalog_releases;
BEGIN
  IF p_expected_revision IS NULL OR p_expected_revision < 1 OR p_expected_revision > 9007199254740991
    OR p_release_id IS NULL OR p_release_sha256 IS NULL OR p_release_sha256 !~ '^[0-9a-f]{64}$'
    OR p_lease_token IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid publication control request';
  END IF;
  -- Consistent lock order with claim/renew/confirm: job first, revision second.
  -- A lease cannot be replaced while this transaction confirms readiness.
  SELECT j.* INTO job FROM public.publication_jobs j WHERE j.singleton FOR UPDATE NOWAIT;
  IF NOT FOUND OR job.lease_token IS DISTINCT FROM p_lease_token
    OR job.lease_revision IS DISTINCT FROM p_expected_revision
    OR job.lease_until IS NULL OR job.lease_until <= clock_timestamp() THEN RETURN false; END IF;
  SELECT c.current_revision INTO current_revision FROM public.content_revision c WHERE c.singleton FOR SHARE NOWAIT;
  IF current_revision IS DISTINCT FROM p_expected_revision THEN RETURN false; END IF;
  SELECT r.* INTO selected FROM catalog_private.catalog_releases r WHERE r.id=p_release_id FOR UPDATE NOWAIT;
  IF NOT FOUND OR selected.revision IS DISTINCT FROM p_expected_revision
    OR selected.sha256 IS DISTINCT FROM p_release_sha256
    OR selected.state NOT IN ('sealed','ready') THEN RETURN false; END IF;
  UPDATE catalog_private.catalog_releases SET state='ready' WHERE id=p_release_id;
  RETURN true;
EXCEPTION WHEN lock_not_available THEN RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION catalog_private.compare_and_set_publication(
  p_expected_release_id uuid, p_next_release_id uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' SET lock_timeout = '5s'
AS $$
DECLARE current_id uuid; selected_state text; selected_hash text;
BEGIN
  IF p_next_release_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid publication control request';
  END IF;
  -- Serialize the absent-row case too; never steal or wait indefinitely on another CAS.
  IF NOT pg_try_advisory_xact_lock(hashtextextended('ayprom-publication-pointer',482914)) THEN RETURN false; END IF;
  SELECT a.release_id INTO current_id FROM catalog_private.catalog_publication_active a WHERE a.singleton FOR UPDATE NOWAIT;
  IF current_id IS DISTINCT FROM p_expected_release_id THEN RETURN false; END IF;
  SELECT r.state,r.sha256 INTO selected_state,selected_hash FROM catalog_private.catalog_releases r
    WHERE r.id=p_next_release_id FOR SHARE NOWAIT;
  IF NOT FOUND OR selected_state <> 'ready' OR selected_hash IS NULL OR selected_hash !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  -- Revision is deliberately not required here: compensation may restore an older
  -- ready release. The caller must reconcile hosting state before requesting it.
  INSERT INTO catalog_private.catalog_publication_active(singleton,release_id) VALUES(true,p_next_release_id)
    ON CONFLICT(singleton) DO UPDATE SET release_id=excluded.release_id;
  RETURN true;
EXCEPTION WHEN lock_not_available THEN RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION public.read_publication_control()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s'
AS $$ SELECT catalog_private.read_publication_control() $$;
CREATE OR REPLACE FUNCTION public.mark_catalog_publication_ready(
  expected_revision bigint, release_id uuid, release_sha256 text, lease_token uuid
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s'
AS $$ SELECT catalog_private.mark_publication_ready(expected_revision,release_id,release_sha256,lease_token) $$;
CREATE OR REPLACE FUNCTION public.compare_and_set_catalog_publication(
  expected_release_id uuid, next_release_id uuid
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = '' SET lock_timeout = '5s'
AS $$ SELECT catalog_private.compare_and_set_publication(expected_release_id,next_release_id) $$;

REVOKE ALL ON FUNCTION catalog_private.read_publication_control() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catalog_private.mark_publication_ready(bigint,uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION catalog_private.compare_and_set_publication(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION catalog_private.read_publication_control() TO service_role;
GRANT EXECUTE ON FUNCTION catalog_private.mark_publication_ready(bigint,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION catalog_private.compare_and_set_publication(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.read_publication_control() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.mark_catalog_publication_ready(bigint,uuid,text,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.compare_and_set_catalog_publication(uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_publication_control() TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_catalog_publication_ready(bigint,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.compare_and_set_catalog_publication(uuid,uuid) TO service_role;
