-- Режим «только товары без подкатегории» у search_catalog_products.
--
-- Прямые товары смешанной категории должны пагинироваться тем же публичным
-- RPC, что и поиск: count и страница считаются в SQL. Проверяется и контракт
-- сигнатуры: единственная перегрузка с require_no_subcategory DEFAULT false,
-- иначе PostgREST не выбрал бы функцию для прежнего пятиключевого вызова.

begin;

select plan(21);

select has_function(
  'public',
  'search_catalog_products',
  array['text', 'text', 'text', 'text', 'text', 'boolean', 'uuid', 'text'],
  'поиск принимает require_no_subcategory и необязательный выпуск'
);
select hasnt_function(
  'public',
  'search_catalog_products',
  array['text', 'text', 'text', 'text', 'text'],
  'старая пятиаргументная перегрузка удалена'
);
select is(
  (select count(*) from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'search_catalog_products'),
  1::bigint,
  'у поиска ровно одна перегрузка'
);
select is(
  (select prosecdef from pg_proc
   where oid = 'public.search_catalog_products(text,text,text,text,text,boolean,uuid,text)'::regprocedure),
  false,
  'поиск остаётся SECURITY INVOKER и подчиняется RLS'
);
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.search_catalog_products(text,text,text,text,text,boolean,uuid,text)'::regprocedure),
  'поиск сохраняет пустой search_path'
);
select ok(
  has_function_privilege('anon', 'public.search_catalog_products(text,text,text,text,text,boolean,uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.search_catalog_products(text,text,text,text,text,boolean,uuid,text)', 'execute'),
  'anon и authenticated вызывают новую сигнатуру'
);

insert into public.categories (slug, name, description, icon, image, type, "order")
values
  ('qa-nosub-mixed', 'QA смешанная', 'QA', 'qa', '/qa.svg', 'subcategory', 90001),
  ('qa-nosub-other', 'QA другая', 'QA', 'qa', '/qa.svg', 'subcategory', 90002);
insert into public.subcategories (category_slug, slug, name, image)
values ('qa-nosub-mixed', 'qa-nosub-child', 'QA подкатегория', '/qa.svg');
insert into public.brands (slug, name, country, logo)
values ('qa-nosub-brand', 'QA brand', 'QA', '/qa.svg');
insert into public.vehicle_types (slug, name)
values ('qa-nosub-vehicle', 'QA vehicle');

insert into public.products (slug, name, category_slug, subcategory_id, short_description, published, "order")
values
  ('qa-nosub-direct-alpha', 'QA nosub direct alpha', 'qa-nosub-mixed', null, 'QA', true, 90001),
  ('qa-nosub-direct-beta', 'QA nosub direct beta', 'qa-nosub-mixed', null, 'QA', true, 90002),
  ('qa-nosub-direct-hidden', 'QA nosub direct hidden', 'qa-nosub-mixed', null, 'QA', false, 90003),
  (
    'qa-nosub-child-product',
    'QA nosub child product',
    'qa-nosub-mixed',
    (select id from public.subcategories where category_slug = 'qa-nosub-mixed' and slug = 'qa-nosub-child'),
    'QA',
    true,
    90004
  ),
  ('qa-nosub-other-direct', 'QA nosub other direct', 'qa-nosub-other', null, 'QA', true, 90005);
insert into public.product_brands (product_id, brand_slug)
select id, 'qa-nosub-brand' from public.products where slug = 'qa-nosub-direct-alpha';
insert into public.product_vehicle_types (product_id, vehicle_type_slug)
select id, 'qa-nosub-vehicle' from public.products where slug = 'qa-nosub-direct-beta';

-- Search now reads a real sealed release, not the editable source fixture.
do $$ begin
  perform public.capture_catalog_publication(public.get_content_revision(),'40000000-0000-4000-8000-000000000001',repeat('1',64));
  update catalog_private.catalog_releases set state='ready' where id='40000000-0000-4000-8000-000000000001';
  insert into catalog_private.catalog_publication_active(release_id) values ('40000000-0000-4000-8000-000000000001');
end $$;
set local role anon;

select is(
  (select string_agg(slug, ',' order by ordinality)
   from public.search_catalog_products(null, 'qa-nosub-mixed', null, null, null, true)
     with ordinality),
  'qa-nosub-direct-alpha,qa-nosub-direct-beta',
  'режим возвращает только опубликованные товары без подкатегории в прежнем порядке'
);
select is(
  (select count(*) from public.search_catalog_products(null, 'qa-nosub-mixed', null, null, null, true)
   where slug = 'qa-nosub-direct-hidden'),
  0::bigint,
  'неопубликованный прямой товар скрыт'
);
select is(
  (select count(*) from public.search_catalog_products(null, 'qa-nosub-mixed', null, null, null)),
  3::bigint,
  'прежний позиционный вызов с пятью аргументами возвращает всю категорию'
);
select is(
  (select count(*) from public.search_catalog_products(category_filter => 'qa-nosub-mixed')),
  3::bigint,
  'именованный вызов без нового аргумента не сужает выборку'
);
select is(
  (select count(*) from public.search_catalog_products(null, 'qa-nosub-mixed', null, null, null, false)),
  3::bigint,
  'require_no_subcategory = false не сужает выборку'
);
select is(
  (select count(*) from public.search_catalog_products(null, 'qa-nosub-mixed', null, null, null, null)),
  3::bigint,
  'NULL трактуется как отключённый фильтр, как у прочих аргументов'
);
select is(
  (select count(*) from public.search_catalog_products(null, 'qa-nosub-mixed', 'qa-nosub-child', null, null, true)),
  0::bigint,
  'конфликт подкатегории и режима даёт пустую выборку, а не расширенную'
);
select is(
  (select count(*) from public.search_catalog_products(null, 'qa-nosub-mixed', 'qa-nosub-child', null, null)),
  1::bigint,
  'фильтр подкатегории без режима работает как прежде'
);
select is(
  (select string_agg(slug, ',')
   from public.search_catalog_products(null, 'qa-nosub-mixed', null, 'qa-nosub-brand', null, true)),
  'qa-nosub-direct-alpha',
  'фильтр бренда сочетается с режимом'
);
select is(
  (select string_agg(slug, ',')
   from public.search_catalog_products(null, 'qa-nosub-mixed', null, null, 'qa-nosub-vehicle', true)),
  'qa-nosub-direct-beta',
  'фильтр типа техники сочетается с режимом'
);
select is(
  (select string_agg(slug, ',')
   from public.search_catalog_products('nosub direct beta', 'qa-nosub-mixed', null, null, null, true)),
  'qa-nosub-direct-beta',
  'текстовый поиск сочетается с режимом'
);
select is(
  (select count(*) from public.search_catalog_products('qa nosub', null, null, null, null, true)
   where slug in ('qa-nosub-direct-alpha', 'qa-nosub-direct-beta', 'qa-nosub-other-direct')),
  3::bigint,
  'без категории режим охватывает прямые товары всех категорий'
);
select is(
  (select string_agg(slug, ',')
   from (
     select slug from public.search_catalog_products(null, 'qa-nosub-mixed', null, null, null, true)
     offset 1 limit 1
   ) as page),
  'qa-nosub-direct-beta',
  'вторая страница по одному товару берёт следующий прямой товар'
);
select is(
  (select count(*)
   from (
     select slug from public.search_catalog_products(null, 'qa-nosub-mixed', null, null, null, true)
     offset 24 limit 24
   ) as page),
  0::bigint,
  'страница за пределами результата пуста'
);

reset role;
set local role authenticated;

select is(
  (select count(*) from public.search_catalog_products(null, 'qa-nosub-mixed', null, null, null, true)),
  2::bigint,
  'authenticated получает тот же результат, что и anon'
);

reset role;
select * from finish();
rollback;
