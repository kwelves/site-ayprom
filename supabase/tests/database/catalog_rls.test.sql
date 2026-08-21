begin;

select plan(15);

select has_table('public', 'products', 'products table exists');
select has_function(
  'public',
  'search_catalog_products',
  array['text', 'text', 'text', 'text', 'text'],
  'catalog search RPC exists'
);
select has_table('public', 'admin_audit_log', 'admin audit log exists');
select has_table('public', 'admin_credentials', 'admin credentials table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.admin_credentials'::regclass),
  'admin credentials has RLS enabled'
);
select is(
  has_table_privilege('anon', 'public.admin_credentials', 'select'),
  false,
  'anon cannot read admin credentials'
);
select is(
  has_table_privilege('authenticated', 'public.admin_credentials', 'select'),
  false,
  'authenticated cannot read admin credentials'
);
select is(
  has_table_privilege('service_role', 'public.admin_credentials', 'update'),
  true,
  'service role can update admin credentials'
);

insert into public.products (
  slug,
  name,
  category_slug,
  subcategory_id,
  short_description,
  article,
  published,
  "order"
)
values (
  'integration-hidden-product',
  'Integration hidden pump',
  'hydraulic-pumps',
  (
    select id
    from public.subcategories
    where category_slug = 'hydraulic-pumps' and slug = 'gear-pumps'
  ),
  'Integration RLS check',
  'INTEGRATION-001',
  false,
  99999
);

set local role anon;

select is(
  (select count(*) from public.products where slug = 'integration-hidden-product'),
  0::bigint,
  'anon cannot read an unpublished product'
);
select is(
  (
    select count(*)
    from public.search_catalog_products('integration', null, null, null, null)
    where slug = 'integration-hidden-product'
  ),
  0::bigint,
  'search RPC respects unpublished-product visibility'
);
select throws_ok(
  $$delete from public.products where slug = 'integration-hidden-product'$$,
  '42501',
  'permission denied for table products',
  'anon cannot delete products'
);

reset role;
set local role service_role;

select lives_ok(
  $$update public.products set published = true where slug = 'integration-hidden-product'$$,
  'service role can update a product'
);
select is(
  (
    select count(*)
    from public.admin_audit_log
    where entity_type = 'products'
      and entity_key = 'integration-hidden-product'
      and action = 'UPDATE'
  ),
  1::bigint,
  'important service-role mutations are audited'
);

reset role;
set local role anon;

select is(
  (
    select count(*)
    from public.search_catalog_products('integration', null, null, null, null)
    where slug = 'integration-hidden-product'
  ),
  1::bigint,
  'published product is returned by backend search'
);
select is(
  (
    select count(*)
    from public.search_catalog_products('integration hidden', null, null, null, null)
    where slug = 'integration-hidden-product'
  ),
  1::bigint,
  'backend search applies AND matching across normalized words'
);

reset role;
select * from finish();
rollback;
