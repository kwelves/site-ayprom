begin;
select no_plan();
grant usage on schema extensions to anon, authenticated;

-- The release store must not be in PostgREST's exposed public schema.
select has_schema('catalog_private', 'catalog release data has a private schema');
select has_table('catalog_private', 'catalog_releases', 'release identity is durable');
select has_table('catalog_private', 'catalog_release_documents', 'immutable page data is durable');
select has_table('catalog_private', 'catalog_release_search', 'immutable search data is durable');
select has_table('catalog_private', 'catalog_publication_active', 'legacy active release pointer is durable');

select has_function('public', 'read_catalog_publication_document',
  array['text', 'text', 'uuid', 'text'], 'one public document read contract exists');
select has_function('public', 'list_catalog_publication_documents',
  array['text', 'uuid', 'text'], 'one public document list contract exists');
select has_function('public', 'search_catalog_products',
  array['text', 'text', 'text', 'text', 'text', 'boolean', 'uuid', 'text'],
  'catalog search accepts an optional pinned release');
select hasnt_function('public', 'search_catalog_products',
  array['text', 'text', 'text', 'text', 'text', 'boolean'],
  'obsolete overload cannot compete with pinned search');

-- Disposable, transaction-scoped releases. These tokens are test data only.
insert into catalog_private.catalog_releases(id, revision, capability_hash, state) values
 ('10000000-0000-4000-8000-000000000001', 1, encode(extensions.digest('fixture-release-one', 'sha256'), 'hex'), 'capturing'),
 ('10000000-0000-4000-8000-000000000002', 2, encode(extensions.digest('fixture-release-two', 'sha256'), 'hex'), 'capturing'),
 ('10000000-0000-4000-8000-000000000003', 3, encode(extensions.digest('fixture-release-three', 'sha256'), 'hex'), 'revoked');
insert into catalog_private.catalog_release_documents(release_id,kind,key,payload) values
 ('10000000-0000-4000-8000-000000000001','product','pump','{"name":"Old pump"}'),
 ('10000000-0000-4000-8000-000000000002','product','pump','{"name":"New pump"}');
insert into catalog_private.catalog_release_search
 (release_id,slug,name,category_slug,subcategory_slug,compatible_brands,vehicle_types,search_text,sort_order) values
 ('10000000-0000-4000-8000-000000000001','old-a','Pump A','hydraulics','gear',array['kamaz'],array['truck'],'pump a gear kamaz',2),
 ('10000000-0000-4000-8000-000000000001','old-b','Pump B','hydraulics',null,array['shacman'],array['truck'],'pump b shacman',1),
 ('10000000-0000-4000-8000-000000000001','old-c','Valve C','valves',null,array['kamaz'],array['crane'],'valve c kamaz',3),
 ('10000000-0000-4000-8000-000000000002','new-a','New pump','hydraulics','gear',array['kamaz'],array['truck'],'new pump gear kamaz',1);
update catalog_private.catalog_releases set state='sealed' where revision in (1,2);
update catalog_private.catalog_releases set state='ready' where revision=1;

select throws_ok($$select public.read_catalog_publication_document('product','pump')$$,
 '55000', 'Catalog publication unavailable', 'missing active release fails closed');
select throws_ok($$select * from public.search_catalog_products()$$,
 '55000', 'Catalog publication unavailable', 'search with no active release cannot fall back to source');

insert into catalog_private.catalog_publication_active(release_id)
 values ('10000000-0000-4000-8000-000000000001');

select is(public.read_catalog_publication_document('product','pump'),
 '{"name":"Old pump"}'::jsonb, 'ordinary reader sees the active release');
select is(public.read_catalog_publication_document('product','pump',
 '10000000-0000-4000-8000-000000000002','fixture-release-two'),
 '{"name":"New pump"}'::jsonb, 'capability reads its sealed release');
select throws_ok($$select public.read_catalog_publication_document('product','pump',
 '10000000-0000-4000-8000-000000000002')$$,
 '55000', 'Catalog publication unavailable', 'release id alone does not disclose candidate');
select throws_ok($$select public.read_catalog_publication_document('product','pump',
 '10000000-0000-4000-8000-000000000002','fixture-release-one')$$,
 '55000', 'Catalog publication unavailable', 'another release capability is rejected');
select throws_ok($$select public.read_catalog_publication_document('product','pump',
 '10000000-0000-4000-8000-000000000003','fixture-release-three')$$,
 '55000', 'Catalog publication unavailable', 'revoked release is denied even with its capability');
select throws_ok($$select public.read_catalog_publication_document('product','pump',
 '10000000-0000-4000-8000-000000000099','fixture-release-three')$$,
 '55000', 'Catalog publication unavailable', 'unknown release has same safe error');
select throws_ok($$select public.read_catalog_publication_document('product','pump',
 null,'fixture-release-one')$$,
 '55000', 'Catalog publication unavailable', 'capability without release is not silently ignored');
select is(public.read_catalog_publication_document('product','missing'), null::jsonb,
 'missing document in valid release returns null');
select is((select count(*) from public.list_catalog_publication_documents('product')), 1::bigint,
 'list contains only active documents');
select results_eq($$select slug from public.search_catalog_products()$$,
 $$values ('old-b'::text),('old-a'::text),('old-c'::text)$$,
 'search uses the active release and preserves order');
select is((select count(*) from public.search_catalog_products(null,null,null,null,null)),3::bigint,
 'legacy five-argument search remains unambiguous');
select results_eq($$select slug from public.search_catalog_products(null,'hydraulics',null,null,null,true)$$,
 $$values ('old-b'::text)$$, 'legacy six-argument no-subcategory search remains valid');
select results_eq($$select slug from public.search_catalog_products('PUMP KAMAZ','hydraulics','gear','kamaz','truck')$$,
 $$values ('old-a'::text)$$, 'all filters and normalized search words are preserved');
select is((select count(*) from public.search_catalog_products(null,'hydraulics','gear',null,null,true)),0::bigint,
 'subcategory and no-subcategory cannot broaden search');
select results_eq($$select slug from public.search_catalog_products(publication_id =>
 '10000000-0000-4000-8000-000000000002',publication_capability => 'fixture-release-two')$$,
 $$values ('new-a'::text)$$, 'pinned search uses candidate instead of active release');
select throws_ok($$select * from public.search_catalog_products(publication_id =>
 '10000000-0000-4000-8000-000000000002')$$,
 '55000','Catalog publication unavailable','search refuses id without capability');
select throws_ok($$insert into catalog_private.catalog_release_documents values
 ('10000000-0000-4000-8000-000000000001','product','late','{}')$$,
 '55000','Catalog publication immutable','sealed release cannot acquire another document');
select throws_ok($$update catalog_private.catalog_release_documents set payload='{}'
 where release_id='10000000-0000-4000-8000-000000000001'$$,
 '55000','Catalog publication immutable','sealed document cannot be edited');
select throws_ok($$delete from catalog_private.catalog_release_documents
 where release_id='10000000-0000-4000-8000-000000000001'$$,
 '55000','Catalog publication immutable','sealed document cannot be removed');

select ok(not has_table_privilege('anon','catalog_private.catalog_release_documents','SELECT'),
 'anonymous visitor cannot read private table');
select ok(not has_table_privilege('authenticated','catalog_private.catalog_release_search','SELECT'),
 'signed-in visitor cannot read private search table');
select ok(not has_table_privilege('service_role','catalog_private.catalog_release_documents','UPDATE'),
 'service role has no direct document mutation grant');

set local role anon;
create temp table anon_publication_read as select public.read_catalog_publication_document('product','pump') as document;
reset role;
select is((select document from anon_publication_read), '{"name":"Old pump"}'::jsonb,
 'anonymous wrapper works without direct table access');
set local role authenticated;
create temp table authenticated_publication_read as select public.read_catalog_publication_document('product','pump') as document;
reset role;
select is((select document from authenticated_publication_read), '{"name":"Old pump"}'::jsonb,
 'authenticated wrapper works without direct table access');

select throws_ok($$update catalog_private.catalog_releases set revision=99
 where id='10000000-0000-4000-8000-000000000001'$$,
 '55000','Catalog publication immutable','sealed release revision cannot change');
select throws_ok($$update catalog_private.catalog_releases set capability_hash=repeat('a',64)
 where id='10000000-0000-4000-8000-000000000001'$$,
 '55000','Catalog publication immutable','sealed release capability cannot change');
select throws_ok($$update catalog_private.catalog_releases set state='capturing'
 where id='10000000-0000-4000-8000-000000000002'$$,
 '55000','Catalog publication immutable','sealed release cannot reopen for writes');
select throws_ok($$update catalog_private.catalog_releases set state='ready'
 where id='10000000-0000-4000-8000-000000000003'$$,
 '55000','Catalog publication immutable','revocation cannot be undone');
select throws_ok($$delete from catalog_private.catalog_releases
 where id='10000000-0000-4000-8000-000000000003'$$,
 '55000','Catalog publication immutable','release identity cannot be deleted');
select ok(not has_function_privilege('anon','catalog_private.resolve_publication(uuid,text)','EXECUTE'),
 'internal resolver cannot be called directly by anonymous role');
select ok(not has_function_privilege('authenticated','catalog_private.guard_release_data()','EXECUTE'),
 'internal trigger cannot be called directly by authenticated role');

insert into catalog_private.catalog_releases(id,revision,capability_hash)
 values ('10000000-0000-4000-8000-000000000004',4,repeat('a',64));
select throws_ok($$insert into catalog_private.catalog_release_documents values
 ('10000000-0000-4000-8000-000000000004','product','oversized',to_jsonb(repeat('x',1048577)))$$,
 '23514',null,'oversized document is rejected before sealing');
select throws_ok($$select public.read_catalog_publication_document(repeat('x',65),'pump')$$,
 '22023','Invalid catalog document request','document kind has a fixed size bound');
select throws_ok($$select public.read_catalog_publication_document('product',repeat('x',257))$$,
 '22023','Invalid catalog document request','document key has a fixed size bound');
select throws_ok($$select public.read_catalog_publication_document('product','pump',
 '10000000-0000-4000-8000-000000000004',repeat('x',257))$$,
 '55000','Catalog publication unavailable','oversized capability is rejected safely');

select * from finish();
rollback;
