begin;
select no_plan();

select has_function('public','read_publication_control',array[]::text[],'private active-pointer read exists');
select has_function('public','mark_catalog_publication_ready',array['bigint','uuid','text','uuid'],'private leased mark-ready exists');
select has_function('public','compare_and_set_catalog_publication',array['uuid','uuid'],'private active-pointer CAS exists');

insert into catalog_private.catalog_releases(id,revision,sha256,capability_hash,state) values
 ('40000000-0000-4000-8000-000000000001',41,repeat('a',64),repeat('b',64),'sealed'),
 ('40000000-0000-4000-8000-000000000002',40,repeat('c',64),repeat('d',64),'ready'),
 ('40000000-0000-4000-8000-000000000003',41,repeat('e',64),repeat('f',64),'revoked'),
 ('40000000-0000-4000-8000-000000000004',41,null,repeat('f',64),'capturing');
insert into public.content_revision(singleton,current_revision,updated_at)
 values(true,41,clock_timestamp()) on conflict(singleton) do update set current_revision=41,updated_at=clock_timestamp();
insert into public.publication_jobs(singleton,lease_revision,lease_token,lease_until)
 values(true,41,'50000000-0000-4000-8000-000000000001',clock_timestamp()+interval '10 minutes')
 on conflict(singleton) do update set lease_revision=41,lease_token=excluded.lease_token,lease_until=excluded.lease_until;

select ok(not has_function_privilege('anon','public.read_publication_control()','EXECUTE'),'anon cannot read control');
select ok(not has_function_privilege('authenticated','public.read_publication_control()','EXECUTE'),'authenticated cannot read control');
select ok(not has_function_privilege('anon','public.mark_catalog_publication_ready(bigint,uuid,text,uuid)','EXECUTE'),'anon cannot mark-ready');
select ok(not has_function_privilege('authenticated','public.mark_catalog_publication_ready(bigint,uuid,text,uuid)','EXECUTE'),'authenticated cannot mark-ready');
select ok(not has_function_privilege('anon','public.compare_and_set_catalog_publication(uuid,uuid)','EXECUTE'),'anon cannot CAS');
select ok(not has_function_privilege('authenticated','public.compare_and_set_catalog_publication(uuid,uuid)','EXECUTE'),'authenticated cannot CAS');
select ok(not has_table_privilege('service_role','catalog_private.catalog_publication_active','UPDATE'),'private service gets no direct pointer write');
select ok(not has_table_privilege('service_role','catalog_private.catalog_releases','UPDATE'),'private service gets no direct release write');

select is(public.read_publication_control(),null::jsonb,'empty active pointer is explicit');
select is(public.mark_catalog_publication_ready(41,'40000000-0000-4000-8000-000000000001',repeat('a',64),
 '50000000-0000-4000-8000-000000000099'),false,'foreign job token refused');
select is(public.mark_catalog_publication_ready(41,'40000000-0000-4000-8000-000000000001',repeat('c',64),
 '50000000-0000-4000-8000-000000000001'),false,'wrong release hash refused');
select is(public.mark_catalog_publication_ready(41,'40000000-0000-4000-8000-000000000003',repeat('e',64),
 '50000000-0000-4000-8000-000000000001'),false,'revoked release cannot become ready');
select is(public.mark_catalog_publication_ready(41,'40000000-0000-4000-8000-000000000004',repeat('a',64),
 '50000000-0000-4000-8000-000000000001'),false,'capturing release cannot become ready');
update public.publication_jobs set lease_until=clock_timestamp()-interval '1 second';
select is(public.mark_catalog_publication_ready(41,'40000000-0000-4000-8000-000000000001',repeat('a',64),
 '50000000-0000-4000-8000-000000000001'),false,'expired lease refused');
update public.publication_jobs set lease_until=clock_timestamp()+interval '10 minutes';
update public.content_revision set current_revision=42;
select is(public.mark_catalog_publication_ready(41,'40000000-0000-4000-8000-000000000001',repeat('a',64),
 '50000000-0000-4000-8000-000000000001'),false,'stale source revision refused');
select is((select state from catalog_private.catalog_releases where id='40000000-0000-4000-8000-000000000001'),
 'sealed','failed readiness does not mutate release');
update public.content_revision set current_revision=41;
set local role service_role;
select is(public.mark_catalog_publication_ready(41,'40000000-0000-4000-8000-000000000001',repeat('a',64),
 '50000000-0000-4000-8000-000000000001'),true,'service can ready the exact leased sealed release');
select is(public.mark_catalog_publication_ready(41,'40000000-0000-4000-8000-000000000001',repeat('a',64),
 '50000000-0000-4000-8000-000000000001'),true,'ready retry is idempotent under same valid lease');
select is(public.read_publication_control(),null::jsonb,'ready does not activate legacy');
select is(public.compare_and_set_catalog_publication(null,'40000000-0000-4000-8000-000000000001'),true,'initial CAS requires absent pointer');
select is(public.read_publication_control(),jsonb_build_object('releaseId','40000000-0000-4000-8000-000000000001',
 'revision',41,'releaseSha256',repeat('a',64)),'control returns only safe identity');
select is(public.compare_and_set_catalog_publication(null,'40000000-0000-4000-8000-000000000002'),false,'another initial publisher cannot overwrite');
select is(public.compare_and_set_catalog_publication('40000000-0000-4000-8000-000000000002',
 '40000000-0000-4000-8000-000000000002'),false,'wrong expected pointer refused');
select is(public.compare_and_set_catalog_publication('40000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000003'),false,'revoked target refused');
select is(public.compare_and_set_catalog_publication('40000000-0000-4000-8000-000000000001',
 '40000000-0000-4000-8000-000000000002'),true,'compensation can restore older ready release');
select is(public.read_publication_control()->>'releaseId','40000000-0000-4000-8000-000000000002','restored pointer readable');
reset role;
select is((select count(*) from catalog_private.catalog_releases),4::bigint,'CAS retains immutable releases');
set local role anon;
select throws_ok($$select public.read_publication_control()$$,'42501','permission denied for function read_publication_control','anon actual execution denied');
select throws_ok($$select public.compare_and_set_catalog_publication(null,'40000000-0000-4000-8000-000000000001')$$,
 '42501','permission denied for function compare_and_set_catalog_publication','anon actual CAS denied');
reset role;
select * from finish();
rollback;
