-- The generated 20261004000000_publication_jobs migration dropped the REVOKE
-- that supabase/schemas/zz_publication_jobs.sql declares, so the schema default
-- privileges left service_role with DELETE, TRUNCATE, REFERENCES and TRIGGER on
-- the queue. The queue RPCs (SECURITY INVOKER) need only SELECT, INSERT and
-- UPDATE; deleting the singleton would silently reset deployed_revision and the
-- three-attempt limit. Bring the table back to the declared privileges.
REVOKE ALL ON public.publication_jobs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.publication_jobs TO service_role;
