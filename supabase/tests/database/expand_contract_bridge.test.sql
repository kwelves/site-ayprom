begin;
select no_plan();

-- EXPAND state: the current Vercel site must keep working next to the new static site.
-- (The strict "contract" state, applied after Vercel is retired, is tested in supabase/contract/tests/.)

-- 1. Public reads of the source tables are open again, exactly the 11 tables least_privilege_client_roles granted.
select ok(has_table_privilege('anon','public.brands','SELECT'), 'anon reads brands');
select ok(has_table_privilege('anon','public.categories','SELECT'), 'anon reads categories');
select ok(has_table_privilege('anon','public.category_brands','SELECT'), 'anon reads category brands');
select ok(has_table_privilege('anon','public.product_brands','SELECT'), 'anon reads product brands');
select ok(has_table_privilege('anon','public.product_characteristics','SELECT'), 'anon reads characteristics');
select ok(has_table_privilege('anon','public.product_images','SELECT'), 'anon reads images');
select ok(has_table_privilege('anon','public.product_vehicle_types','SELECT'), 'anon reads product vehicles');
select ok(has_table_privilege('anon','public.products','SELECT'), 'anon reads products');
select ok(has_table_privilege('anon','public.subcategories','SELECT'), 'anon reads subcategories');
select ok(has_table_privilege('anon','public.vehicle_hotspots','SELECT'), 'anon reads hotspots');
select ok(has_table_privilege('anon','public.vehicle_types','SELECT'), 'anon reads vehicles');
select ok(has_table_privilege('authenticated','public.products','SELECT'), 'authenticated reads products');
-- ...and nothing more than SELECT: clients still cannot write or truncate.
select ok(not has_table_privilege('anon','public.products','INSERT'), 'anon cannot insert products');
select ok(not has_table_privilege('anon','public.products','UPDATE'), 'anon cannot update products');
select ok(not has_table_privilege('anon','public.products','DELETE'), 'anon cannot delete products');
select ok(not has_table_privilege('anon','public.products','TRUNCATE'), 'anon cannot truncate products');
select ok(not has_table_privilege('anon','public.admin_credentials','SELECT'), 'anon cannot read admin credentials');
select ok(not has_table_privilege('anon','catalog_private.catalog_releases','SELECT'), 'anon cannot read sealed releases directly');

-- 2. Fixture: one live product and one sealed release that says something different.
insert into public.categories(slug,name,description,icon,image)
 values ('bridge-fixture','Fixture','','pump','/brand/ayprom-logo.svg');
insert into public.products(slug,name,category_slug,short_description,published)
 values ('bridge-live-product','Live name','bridge-fixture','Live',true),
        ('bridge-draft-product','Draft name','bridge-fixture','Draft',false);
insert into catalog_private.catalog_releases(id,revision,capability_hash)
 values ('40000000-0000-4000-8000-000000000001',60,encode(extensions.digest('bridge-capability-value-0123456789abcdef','sha256'),'hex'));
insert into catalog_private.catalog_release_search(release_id,slug,name,category_slug,search_text)
 values ('40000000-0000-4000-8000-000000000001','bridge-live-product','Sealed name','bridge-fixture','sealed name');
update catalog_private.catalog_releases set state='sealed' where id='40000000-0000-4000-8000-000000000001';

set local role anon;
create temp table bridge_old_call as
 select slug, name from public.search_catalog_products(null,null,null,null,null);
create temp table bridge_new_call as
 select slug, name from public.search_catalog_products(null,null,null,null,null,false,
   '40000000-0000-4000-8000-000000000001','bridge-capability-value-0123456789abcdef');
reset role;

-- 3. A call that names no publication (the Vercel site) is answered from the live tables, published rows only.
select is((select name from bridge_old_call where slug='bridge-live-product'),'Live name',
 'five-argument search without a publication reads the live row');
select is((select count(*)::int from bridge_old_call where slug='bridge-draft-product'),0,
 'five-argument search never shows an unpublished product');

-- 4. A call that names a publication (the static site) is answered from the sealed copy, not the live row.
select is((select name from bridge_new_call where slug='bridge-live-product'),'Sealed name',
 'search with a publication reads the sealed copy');
select is((select count(*)::int from bridge_new_call where slug='bridge-draft-product'),0,
 'search with a publication does not see live-only rows');

-- 5. A wrong capability is still refused (the bridge must not weaken the sealed path).
set local role anon;
select throws_ok($$ select * from public.search_catalog_products(null,null,null,null,null,false,
   '40000000-0000-4000-8000-000000000001','wrong-capability-value-0123456789abcdefghij') $$,
 '55000', 'Catalog publication unavailable', 'a wrong capability is refused');
reset role;

-- 6. The six-argument and filtered forms used by the old site still resolve to one function.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='search_catalog_products'),1,
 'search_catalog_products stays a single function, so named-argument calls are unambiguous');
set local role anon;
select is((select count(*)::int from public.search_catalog_products(null,'bridge-fixture',null,null,null,true) where slug='bridge-live-product'),1,
 'category filter and no-subcategory flag work on the live path');
reset role;

select * from finish();
rollback;
