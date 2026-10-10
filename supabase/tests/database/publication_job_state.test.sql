begin;
select plan(16);
select has_function('public','read_publication_job',array['uuid'],'private queue state is readable');
select ok(not has_function_privilege('anon','public.read_publication_job(uuid)','EXECUTE'),'anon cannot read queue state');
select ok(not has_function_privilege('authenticated','public.read_publication_job(uuid)','EXECUTE'),'authenticated cannot read queue state');
select ok(has_function_privilege('service_role','public.read_publication_job(uuid)','EXECUTE'),'coordinator can reconcile confirmation');
delete from public.publication_jobs;
select is(public.read_publication_job('11111111-1111-4111-8111-111111111111'),null::jsonb,'absent row is distinct from confirmation');
insert into public.publication_jobs(singleton) values(true);
select is(public.read_publication_job('11111111-1111-4111-8111-111111111111'),
  '{"deployedRevision":0,"deploymentIdentifier":null,"leaseRevision":null,"leaseOwned":false,"leaseValid":false}'::jsonb,
  'initial state is safe and unleased');
select throws_ok('select public.read_publication_job(null)','22023','Invalid publication state request','null token rejected');
update public.publication_jobs set lease_revision=8,lease_token='11111111-1111-4111-8111-111111111111',
  lease_until=clock_timestamp()+interval '5 minutes';
select is((public.read_publication_job('11111111-1111-4111-8111-111111111111')->>'leaseOwned')::boolean,true,'own lease recognized');
select is((public.read_publication_job('22222222-2222-4222-8222-222222222222')->>'leaseOwned')::boolean,false,'foreign lease not owned');
select is((public.read_publication_job('11111111-1111-4111-8111-111111111111')->>'leaseValid')::boolean,true,'valid lease recognized');
update public.publication_jobs set lease_until=clock_timestamp()-interval '1 second';
select is((public.read_publication_job('11111111-1111-4111-8111-111111111111')->>'leaseValid')::boolean,false,'expired lease is not valid');
select is((public.read_publication_job('11111111-1111-4111-8111-111111111111')->>'leaseOwned')::boolean,true,'expiry does not hide owner comparison');
update public.publication_jobs set deployed_revision=7,deployment_identifier='cf:deployment-7',lease_revision=null,lease_token=null,lease_until=null;
select is(public.read_publication_job('11111111-1111-4111-8111-111111111111'),
  '{"deployedRevision":7,"deploymentIdentifier":"cf:deployment-7","leaseRevision":null,"leaseOwned":false,"leaseValid":false}'::jsonb,
  'confirmed deployment can be reconciled without repeating confirm');
select is((select count(*)::integer from jsonb_object_keys(public.read_publication_job('11111111-1111-4111-8111-111111111111'))),5,'only five safe fields returned');
select ok(position('11111111' in public.read_publication_job('11111111-1111-4111-8111-111111111111')::text)=0,'lease token absent from response');
set local role service_role;
select is((public.read_publication_job('11111111-1111-4111-8111-111111111111')->>'deployedRevision')::bigint,7::bigint,'real coordinator role can read state');
reset role;
select * from finish();
rollback;
