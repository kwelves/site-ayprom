begin;

select plan(23);

select has_table('public', 'products', 'products table exists');
select has_function(
  'public',
  'search_catalog_products',
  array['text', 'text', 'text', 'text', 'text'],
  'catalog search RPC exists'
);
select has_table('public', 'admin_audit_log', 'admin audit log exists');
select has_table('public', 'admin_auth_events', 'admin auth events table exists');
select has_function(
  'public',
  'register_admin_login_attempt',
  array['text', 'boolean', 'text'],
  'distributed login guard RPC exists with audit scope'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.admin_auth_events'::regclass),
  'admin auth events has RLS enabled'
);
select is(
  has_table_privilege('anon', 'public.admin_auth_events', 'select'),
  false,
  'anon cannot read admin auth events'
);
select is(
  has_table_privilege('authenticated', 'public.admin_auth_events', 'select'),
  false,
  'authenticated cannot read admin auth events'
);
select is(
  has_function_privilege('anon', 'public.register_admin_login_attempt(text,boolean,text)', 'execute'),
  false,
  'anon cannot call the login guard RPC'
);
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

select is(
  public.register_admin_login_attempt(repeat('a', 64), false, 'login'),
  0,
  'service role can register a first failed login attempt'
);
select is(
  (
    select count(*)
    from public.admin_auth_events
    where attempt_key_hash = repeat('a', 64)
      and scope = 'login'
      and outcome = 'failure'
  ),
  1::bigint,
  'failed login attempt is durably audited'
);

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
