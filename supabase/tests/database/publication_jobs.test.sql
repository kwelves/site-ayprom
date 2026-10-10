begin;
select no_plan();

select has_table('public', 'publication_jobs', 'publication queue is durable');
select has_function('public', 'claim_publication_job', array['integer','integer'], 'builder can claim work');
select has_function('public', 'confirm_publication_job', array['uuid','bigint','text'], 'promotion can be confirmed');
select has_function('public', 'renew_publication_job', array['uuid','bigint','integer'], 'builder can renew its lease');
select has_function('public', 'fail_publication_job', array['uuid','text'], 'failure can release a lease');
select has_function('public', 'retry_publication_job', array[]::text[], 'operator can retry terminal failure');
select ok(not has_table_privilege('anon', 'public.publication_jobs', 'SELECT'), 'anonymous users cannot inspect publication state');
select ok(not has_table_privilege('authenticated', 'public.publication_jobs', 'SELECT'), 'signed-in clients cannot inspect publication state');
select ok(not has_function_privilege('anon', 'public.claim_publication_job(integer,integer)', 'EXECUTE'), 'anonymous users cannot claim builds');
select ok(not has_function_privilege('authenticated', 'public.confirm_publication_job(uuid,bigint,text)', 'EXECUTE'), 'signed-in clients cannot confirm promotions');
select ok(not has_function_privilege('anon', 'public.retry_publication_job()', 'EXECUTE'), 'anonymous users cannot override backoff');
select ok(not has_function_privilege('anon', 'public.renew_publication_job(uuid,bigint,integer)', 'EXECUTE'), 'anonymous users cannot renew leases');
select ok(has_function_privilege('service_role', 'public.claim_publication_job(integer,integer)', 'EXECUTE'), 'service role can claim builds');
-- Exact sets, as declared in supabase/schemas/zz_publication_jobs.sql: the
-- RPCs need only SELECT/INSERT/UPDATE; DELETE or TRUNCATE would let a builder
-- key wipe the deployed revision and the three-attempt limit.
select table_privs_are('public', 'publication_jobs', 'service_role', array['SELECT', 'INSERT', 'UPDATE'],
  'builder key has only the privileges the queue RPCs need');
select table_privs_are('public', 'publication_jobs', 'anon', array[]::text[], 'anonymous users have no queue table privilege');
select table_privs_are('public', 'publication_jobs', 'authenticated', array[]::text[], 'signed-in clients have no queue table privilege');
select is((select count(*)::integer from pg_proc p, unnest(array['anon', 'authenticated']) as r(role_name)
  where p.pronamespace = 'public'::regnamespace and p.proname like '%publication_job'
    and has_function_privilege(r.role_name, p.oid, 'EXECUTE')), 0, 'no client role can execute any queue RPC');

select is((select count(*)::integer from public.claim_publication_job(120, 0)), 0, 'empty catalog has nothing to publish');

insert into public.categories (slug, name, description, icon, image, "order")
values ('qa-publication', 'Publication', '', 'gear', '', 900003);
create temp table first_claim as select * from public.claim_publication_job(120, 0);
select is((select count(*)::integer from first_claim), 1, 'first content change creates one build');
select is((select revision from first_claim), public.get_content_revision(), 'claim captures current revision');
select is((select count(*)::integer from public.claim_publication_job(120, 0)), 0, 'second builder cannot claim while lease is held');
create temp table first_lease_time as select lease_until from public.publication_jobs;
select is(public.renew_publication_job((select token from first_claim), (select revision from first_claim), 120), true,
  'active builder can renew its own lease');
select ok((select lease_until from public.publication_jobs) >= (select lease_until from first_lease_time),
  'renewal never shortens a lease');
select is(public.renew_publication_job('22222222-2222-4222-8222-222222222222', (select revision from first_claim), 120), false,
  'another token cannot renew the lease');
select is((select attempt_count from public.publication_jobs), 1, 'renewal does not consume an attempt');

update public.categories set name = 'Changed' where slug = 'qa-publication';
select is(public.renew_publication_job((select token from first_claim), (select revision from first_claim), 120), false,
  'changed catalog makes the old lease unrenewable');
select is(public.confirm_publication_job((select token from first_claim), (select revision from first_claim), 'preview-a'), false,
  'stale build cannot be marked deployed');
select is((select deployed_revision from public.publication_jobs), 0::bigint, 'stale build leaves deployed revision unchanged');
create temp table second_claim as select * from public.claim_publication_job(120, 0);
select is((select revision from second_claim), public.get_content_revision(), 'newest revision can be claimed after stale build');
select is(public.confirm_publication_job((select token from second_claim), (select revision from second_claim), 'preview-b'), true,
  'current revision can be confirmed after external promotion');
select is((select deployed_revision from public.publication_jobs), public.get_content_revision(), 'confirmation stores promoted revision');
select is((select count(*)::integer from public.claim_publication_job(120, 0)), 0, 'deployed revision is not rebuilt');
select is(public.confirm_publication_job((select token from first_claim), (select revision from first_claim), 'preview-old'), false,
  'old lease cannot confirm after a newer promotion');

update public.categories set name = 'Changed again' where slug = 'qa-publication';
create temp table failed_claim as select * from public.claim_publication_job(120, 0);
select is(public.fail_publication_job((select token from failed_claim), 'build_failed'), true, 'failed build releases its lease');
select is((select count(*)::integer from public.claim_publication_job(120, 0)), 0, 'failure backs off before retry');
select is(public.retry_publication_job(), true, 'manual retry clears backoff');
create temp table retried_claim as select * from public.claim_publication_job(120, 0);
select is((select count(*)::integer from retried_claim), 1, 'pending revision can be reclaimed');
select isnt((select token from retried_claim), (select token from failed_claim), 'retry receives a fresh lease token');
select is(public.fail_publication_job((select token from failed_claim), 'build_failed'), false,
  'old lease cannot release current lease');
select is(public.fail_publication_job((select token from retried_claim), 'verification_failed'), true,
  'second failure releases its lease');
update public.publication_jobs set retry_after = clock_timestamp() - interval '1 second' where singleton = true;
create temp table third_claim as select * from public.claim_publication_job(120, 0);
select is(public.fail_publication_job((select token from third_claim), 'promotion_failed'), true,
  'second automatic failure releases its lease');
update public.publication_jobs set retry_after = clock_timestamp() - interval '1 second' where singleton = true;
create temp table fourth_claim as select * from public.claim_publication_job(120, 0);
select is((select attempt_count from public.publication_jobs), 3, 'only three automatic attempts are allowed');
select is(public.fail_publication_job((select token from fourth_claim), 'promotion_failed'), true,
  'third automatic failure records terminal state');
select is((select count(*)::integer from public.claim_publication_job(120, 0)), 0,
  'terminal failure cannot spin up more automatic builds');
select is(public.retry_publication_job(), true, 'manual retry reopens terminal state');
select is((select count(*)::integer from public.claim_publication_job(120, 0)), 1,
  'operator retry can claim again');
update public.publication_jobs set lease_until = clock_timestamp() - interval '1 second' where singleton = true;
select is(public.renew_publication_job((select lease_token from public.publication_jobs), public.get_content_revision(), 120), false,
  'an expired lease cannot be revived');
select is((select count(*)::integer from public.claim_publication_job(120, 0)), 1,
  'a new builder can claim after the old lease expires');

select * from finish();
rollback;
