begin;
select no_plan();

-- Editable source rows must not be a second public catalog after a release is sealed.
select ok(not has_table_privilege('anon','public.brands','SELECT'), 'anon cannot read editable brands');
select ok(not has_table_privilege('authenticated','public.brands','SELECT'), 'authenticated cannot read editable brands');
select ok(not has_table_privilege('anon','public.categories','SELECT'), 'anon cannot read editable categories');
select ok(not has_table_privilege('authenticated','public.categories','SELECT'), 'authenticated cannot read editable categories');
select ok(not has_table_privilege('anon','public.category_brands','SELECT'), 'anon cannot read editable category brands');
select ok(not has_table_privilege('authenticated','public.category_brands','SELECT'), 'authenticated cannot read editable category brands');
select ok(not has_table_privilege('anon','public.product_brands','SELECT'), 'anon cannot read editable product brands');
select ok(not has_table_privilege('authenticated','public.product_brands','SELECT'), 'authenticated cannot read editable product brands');
select ok(not has_table_privilege('anon','public.product_characteristics','SELECT'), 'anon cannot read editable characteristics');
select ok(not has_table_privilege('authenticated','public.product_characteristics','SELECT'), 'authenticated cannot read editable characteristics');
select ok(not has_table_privilege('anon','public.product_images','SELECT'), 'anon cannot read editable images');
select ok(not has_table_privilege('authenticated','public.product_images','SELECT'), 'authenticated cannot read editable images');
select ok(not has_table_privilege('anon','public.product_vehicle_types','SELECT'), 'anon cannot read editable product vehicles');
select ok(not has_table_privilege('authenticated','public.product_vehicle_types','SELECT'), 'authenticated cannot read editable product vehicles');
select ok(not has_table_privilege('anon','public.products','SELECT'), 'anon cannot read editable products');
select ok(not has_table_privilege('authenticated','public.products','SELECT'), 'authenticated cannot read editable products');
select ok(not has_table_privilege('anon','public.subcategories','SELECT'), 'anon cannot read editable subcategories');
select ok(not has_table_privilege('authenticated','public.subcategories','SELECT'), 'authenticated cannot read editable subcategories');
select ok(not has_table_privilege('anon','public.vehicle_hotspots','SELECT'), 'anon cannot read editable hotspots');
select ok(not has_table_privilege('authenticated','public.vehicle_hotspots','SELECT'), 'authenticated cannot read editable hotspots');
select ok(not has_table_privilege('anon','public.vehicle_types','SELECT'), 'anon cannot read editable vehicles');
select ok(not has_table_privilege('authenticated','public.vehicle_types','SELECT'), 'authenticated cannot read editable vehicles');

-- The old five-argument RPC and active-release document wrapper stay usable.
insert into catalog_private.catalog_releases(id,revision,capability_hash)
 values ('30000000-0000-4000-8000-000000000001',50,repeat('a',64));
insert into catalog_private.catalog_release_documents(release_id,kind,key,payload)
 values ('30000000-0000-4000-8000-000000000001','product','source-test-product',
  '{"slug":"source-test-product","name":"Published"}');
insert into catalog_private.catalog_release_search(release_id,slug,name,category_slug,search_text)
 values ('30000000-0000-4000-8000-000000000001','source-test-product','Published','source-access-fixture','published');
update catalog_private.catalog_releases set state='sealed' where id='30000000-0000-4000-8000-000000000001';
update catalog_private.catalog_releases set state='ready' where id='30000000-0000-4000-8000-000000000001';
insert into catalog_private.catalog_publication_active(release_id)
 values ('30000000-0000-4000-8000-000000000001')
 on conflict (singleton) do update set release_id=excluded.release_id;
insert into public.categories(slug,name,description,icon,image)
 values ('source-access-fixture','Fixture','','pump','/brand/ayprom-logo.svg');
insert into public.products(slug,name,category_slug,short_description,published)
 values ('source-test-product','Pending edit','source-access-fixture','Pending',true);

set local role anon;
create temp table anon_release_result as
 select public.read_catalog_publication_document('product','source-test-product') as document,
  (select name from public.search_catalog_products(null,null,null,null,null) where slug='source-test-product') as search_name;
reset role;
select is((select document->>'name' from anon_release_result),'Published',
 'legacy anonymous document read sees the release, not the pending source edit');
select is((select search_name from anon_release_result),'Published',
 'legacy anonymous five-argument search sees the release, not the pending source edit');
select ok(has_table_privilege('service_role','public.products','SELECT'),
 'private admin and capture ports retain source read access');

select * from finish();
rollback;
