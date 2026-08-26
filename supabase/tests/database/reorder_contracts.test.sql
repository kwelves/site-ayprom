-- QA-003: reorder-функции не проверяли переданный набор и не ограничивали его
-- родителем. Здесь проверяется новый контракт: набор обязан быть непустым по
-- содержанию, без NULL, без дубликатов, только из существующих записей и только
-- из записей указанного родителя. Отдельно проверяется семантика слотов —
-- перестановка внутри уже занятых значений `order`, благодаря которой
-- перетаскивание работает в отфильтрованном или постраничном срезе.
--
-- Фикстуры собственные, со своими slug и высокими значениями `order`: тест не
-- зависит от seed.sql и не пересекается с ним.

begin;

select plan(18);

insert into public.categories (slug, name, description, icon, image, "order") values
  ('qa-reorder-category', 'QA reorder category', 'Fixture', 'icon', 'image', 900000),
  ('qa-reorder-other-category', 'QA reorder other category', 'Fixture', 'icon', 'image', 900001);

insert into public.subcategories (id, category_slug, slug, name, image, "order") values
  ('00000000-0000-4000-8000-000000000001', 'qa-reorder-category', 'qa-sub-a', 'QA sub A', 'image', 10),
  ('00000000-0000-4000-8000-000000000002', 'qa-reorder-category', 'qa-sub-b', 'QA sub B', 'image', 11),
  ('00000000-0000-4000-8000-000000000003', 'qa-reorder-other-category', 'qa-sub-c', 'QA sub C', 'image', 12);

insert into public.products (slug, name, category_slug, short_description, "order") values
  ('qa-reorder-p1', 'QA reorder product 1', 'qa-reorder-category', 'Fixture', 900010),
  ('qa-reorder-p2', 'QA reorder product 2', 'qa-reorder-category', 'Fixture', 900011),
  ('qa-reorder-p3', 'QA reorder product 3', 'qa-reorder-category', 'Fixture', 900012);

insert into public.product_images (id, product_id, url, "order")
select ('00000000-0000-4000-8001-00000000000' || n)::uuid,
       (select id from public.products where slug = 'qa-reorder-p1'),
       'https://example.invalid/p1-' || n || '.jpg',
       n - 1
from generate_series(1, 3) as n;

insert into public.product_images (id, product_id, url, "order")
select ('00000000-0000-4000-8002-00000000000' || n)::uuid,
       (select id from public.products where slug = 'qa-reorder-p2'),
       'https://example.invalid/p2-' || n || '.jpg',
       n - 1
from generate_series(1, 3) as n;

insert into public.brands (slug, name, country, logo, "order") values
  ('qa-reorder-brand-a', 'QA brand A', 'QA', 'a.svg', 900020),
  ('qa-reorder-brand-b', 'QA brand B', 'QA', 'b.svg', 900021);

insert into public.category_brands (category_slug, brand_slug, "order") values
  ('qa-reorder-category', 'qa-reorder-brand-a', 0),
  ('qa-reorder-category', 'qa-reorder-brand-b', 1);

insert into public.vehicle_types (slug, name, "order") values
  ('qa-reorder-vt-a', 'QA vehicle type A', 900030),
  ('qa-reorder-vt-b', 'QA vehicle type B', 900031);

-- Контракт самого списка

select throws_ok(
  $$select public.reorder_products(null::text[])$$,
  '22023', null, 'null order list is rejected'
);

select throws_ok(
  $$select public.reorder_products(array['qa-reorder-p1', null])$$,
  '22023', null, 'order list containing a null identifier is rejected'
);

select throws_ok(
  $$select public.reorder_products(array['qa-reorder-p1', 'qa-reorder-p1'])$$,
  '22023', null, 'duplicate identifiers are rejected'
);

select throws_ok(
  $$select public.reorder_products(array['qa-reorder-p1', 'definitely-not-a-slug'])$$,
  '22023', null, 'unknown identifier is rejected'
);

select lives_ok(
  $$select public.reorder_products(array[]::text[])$$,
  'empty order list is a no-op rather than an error'
);

-- Отказ не должен оставлять частичное изменение

select is(
  (select array_agg("order" order by slug) from public.products where slug like 'qa-reorder-p%'),
  array[900010, 900011, 900012],
  'a rejected reorder leaves every order untouched'
);

-- Семантика слотов: перестановка внутри уже занятых значений

select lives_ok(
  $$select public.reorder_products(array['qa-reorder-p3', 'qa-reorder-p1'])$$,
  'a filtered subset can be reordered'
);

select is(
  (select "order" from public.products where slug = 'qa-reorder-p3'),
  900010,
  'subset reorder moves the first requested row into the lowest occupied slot'
);

select is(
  (select "order" from public.products where slug = 'qa-reorder-p1'),
  900012,
  'subset reorder moves the second requested row into the highest occupied slot'
);

select is(
  (select "order" from public.products where slug = 'qa-reorder-p2'),
  900011,
  'a row outside the reordered subset keeps its slot'
);

-- Порядок фотографий ограничен товаром

select throws_ok(
  $$select public.reorder_product_images('qa-reorder-p2', array[
      '00000000-0000-4000-8001-000000000001'::uuid,
      '00000000-0000-4000-8001-000000000002'::uuid,
      '00000000-0000-4000-8001-000000000003'::uuid])$$,
  '22023', null, 'images of another product are rejected for the given product'
);

select throws_ok(
  $$select public.reorder_product_images('definitely-not-a-slug', array[
      '00000000-0000-4000-8001-000000000001'::uuid])$$,
  '22023', null, 'reordering images of an unknown product is rejected'
);

select lives_ok(
  $$select public.reorder_product_images('qa-reorder-p1', array[
      '00000000-0000-4000-8001-000000000003'::uuid,
      '00000000-0000-4000-8001-000000000002'::uuid,
      '00000000-0000-4000-8001-000000000001'::uuid])$$,
  'images can be reordered within their own product'
);

select is(
  (select "order" from public.product_images where id = '00000000-0000-4000-8001-000000000003'),
  0,
  'the image moved to the front takes the lowest occupied slot'
);

select is(
  (select array_agg("order" order by url) from public.product_images
   where product_id = (select id from public.products where slug = 'qa-reorder-p2')),
  array[0, 1, 2],
  'another product images are untouched by a scoped reorder'
);

-- Порядок подкатегорий ограничен категорией

select throws_ok(
  $$select public.reorder_subcategories('qa-reorder-category', array[
      '00000000-0000-4000-8000-000000000003'::uuid])$$,
  '22023', null, 'a subcategory of another category is rejected'
);

-- Контракт остальных функций

select throws_ok(
  $$select public.reorder_brands(array['qa-reorder-brand-a', 'definitely-not-a-brand'])$$,
  '22023', null, 'unknown brand is rejected'
);

select throws_ok(
  $$select public.reorder_category_brands('qa-reorder-other-category', array['qa-reorder-brand-a'])$$,
  '22023', null, 'a brand not attached to the category is rejected'
);

select * from finish();

rollback;
