begin;

select plan(2);

insert into public.products (
  slug,
  name,
  category_slug,
  short_description,
  article,
  published,
  "order"
)
select
  'scale-test-product-' || number,
  'Scale test token product ' || number,
  'hydraulic-pumps',
  'Synthetic catalog scale fixture',
  'SCALE-' || lpad(number::text, 5, '0'),
  true,
  100000 + number
from generate_series(1, 5000) as number;

do $$ begin
  perform public.capture_catalog_publication(public.get_content_revision(),'40000000-0000-4000-8000-000000000001',repeat('1',64));
  update catalog_private.catalog_releases set state='ready' where id='40000000-0000-4000-8000-000000000001';
  insert into catalog_private.catalog_publication_active(release_id) values ('40000000-0000-4000-8000-000000000001');
end $$;
set local role anon;

select is(
  (
    select count(*)
    from public.search_catalog_products('scale test token', null, null, null, null)
  ),
  5000::bigint,
  'backend search returns all matching rows from a 5000-product fixture'
);

select is(
  (
    select count(*)
    from (
      select slug
      from public.search_catalog_products('scale test token', null, null, null, null)
      limit 24 offset 4992
    ) as final_page
  ),
  8::bigint,
  'server-side pagination returns only the final bounded window'
);

reset role;
select * from finish();
rollback;
