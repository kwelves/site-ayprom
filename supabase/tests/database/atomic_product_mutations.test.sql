-- QA-002: создание и редактирование товара не были единой транзакцией, а
-- конкуренция не проверялась вовсе.
--
-- Главные проверки здесь две:
--   1. сбой, происходящий УЖЕ ПОСЛЕ вставки товара, не оставляет ни товара, ни
--      его связей — именно этого не гарантировал прежний компенсирующий DELETE;
--   2. правка из устаревшей вкладки отвергается, а не затирает молча более
--      новую редакцию.
--
-- Фикстуры собственные, со своими slug: тест не зависит от seed.sql.

begin;

select plan(23);

insert into public.categories (slug, name, description, icon, image, "order") values
  ('qa-atomic-category', 'QA atomic category', 'Fixture', 'icon', 'image', 910000),
  ('qa-atomic-other', 'QA atomic other', 'Fixture', 'icon', 'image', 910001);

insert into public.subcategories (category_slug, slug, name, image, "order") values
  ('qa-atomic-category', 'qa-atomic-sub', 'QA atomic sub', 'image', 0),
  ('qa-atomic-other', 'qa-atomic-foreign-sub', 'QA foreign sub', 'image', 0);

insert into public.brands (slug, name, country, logo, "order") values
  ('qa-atomic-brand', 'QA atomic brand', 'QA', 'a.svg', 910010);

insert into public.vehicle_types (slug, name, "order") values
  ('qa-atomic-vt', 'QA atomic vehicle type', 910020);

-- ---------- Создание ----------

select lives_ok(
  $$select public.create_product_with_relations(
      p_slug_base => 'qa-created', p_name => 'QA created',
      p_category_slug => 'qa-atomic-category', p_subcategory_slug => 'qa-atomic-sub',
      p_short_description => 'short', p_description => null, p_article => 'ART-1',
      p_published => true, p_availability => 'in_stock',
      p_meta_title => null, p_meta_description => null,
      p_characteristics => '[{"attribute":"Вес","value":"10"},{"attribute":"Длина","value":"20"}]'::jsonb,
      p_compatible_brands => array['qa-atomic-brand'],
      p_vehicle_types => array['qa-atomic-vt'])$$,
  'a product is created together with all of its relations'
);

select is(
  (select count(*)::integer from public.product_characteristics c
   join public.products p on p.id = c.product_id where p.slug = 'qa-created'),
  2,
  'characteristics are written in the same call'
);

select is(
  (select array_agg(c.attribute order by c."order") from public.product_characteristics c
   join public.products p on p.id = c.product_id where p.slug = 'qa-created'),
  array['Вес', 'Длина'],
  'characteristic order follows the submitted array order'
);

select is(
  (select count(*)::integer from public.product_brands b
   join public.products p on p.id = b.product_id where p.slug = 'qa-created'),
  1,
  'compatible brands are written in the same call'
);

select is(
  (select s.slug from public.products p join public.subcategories s on s.id = p.subcategory_id
   where p.slug = 'qa-created'),
  'qa-atomic-sub',
  'the subcategory is resolved inside the transaction'
);

select lives_ok(
  $$select public.create_product_with_relations(
      p_slug_base => 'qa-created', p_name => 'QA created again',
      p_category_slug => 'qa-atomic-category', p_subcategory_slug => null,
      p_short_description => 'short', p_description => null, p_article => null,
      p_published => true, p_availability => 'in_stock',
      p_meta_title => null, p_meta_description => null,
      p_characteristics => null,
      p_compatible_brands => array[]::text[], p_vehicle_types => array[]::text[])$$,
  'a colliding slug is resolved instead of failing'
);

select is(
  (select count(*)::integer from public.products where slug = 'qa-created-2'),
  1,
  'the colliding slug gets a numeric suffix'
);

-- Отказы создания

select throws_ok(
  $$select public.create_product_with_relations(
      p_slug_base => 'qa-bad', p_name => '',
      p_category_slug => 'qa-atomic-category', p_subcategory_slug => null,
      p_short_description => 's', p_description => null, p_article => null,
      p_published => true, p_availability => 'in_stock',
      p_meta_title => null, p_meta_description => null, p_characteristics => null,
      p_compatible_brands => array[]::text[], p_vehicle_types => array[]::text[])$$,
  '22023', null, 'an empty name is rejected'
);

select throws_ok(
  $$select public.create_product_with_relations(
      p_slug_base => 'qa-bad', p_name => 'QA bad',
      p_category_slug => 'no-such-category', p_subcategory_slug => null,
      p_short_description => 's', p_description => null, p_article => null,
      p_published => true, p_availability => 'in_stock',
      p_meta_title => null, p_meta_description => null, p_characteristics => null,
      p_compatible_brands => array[]::text[], p_vehicle_types => array[]::text[])$$,
  '22023', null, 'an unknown category is rejected'
);

select throws_ok(
  $$select public.create_product_with_relations(
      p_slug_base => 'qa-bad', p_name => 'QA bad',
      p_category_slug => 'qa-atomic-category', p_subcategory_slug => 'qa-atomic-foreign-sub',
      p_short_description => 's', p_description => null, p_article => null,
      p_published => true, p_availability => 'in_stock',
      p_meta_title => null, p_meta_description => null, p_characteristics => null,
      p_compatible_brands => array[]::text[], p_vehicle_types => array[]::text[])$$,
  '22023', null, 'a subcategory belonging to another category is rejected'
);

select throws_ok(
  $$select public.create_product_with_relations(
      p_slug_base => 'qa-bad', p_name => 'QA bad',
      p_category_slug => 'qa-atomic-category', p_subcategory_slug => null,
      p_short_description => 's', p_description => null, p_article => null,
      p_published => true, p_availability => 'in_stock',
      p_meta_title => null, p_meta_description => null, p_characteristics => null,
      p_compatible_brands => array['qa-atomic-brand','qa-atomic-brand'],
      p_vehicle_types => array[]::text[])$$,
  '22023', null, 'the same brand selected twice is rejected'
);

-- Атомарность: сбой происходит уже ПОСЛЕ вставки строки товара, потому что
-- пустая характеристика проверяется при записи характеристик. Прежний код
-- полагался здесь на компенсирующий DELETE, который сам мог не сработать.
select throws_ok(
  $$select public.create_product_with_relations(
      p_slug_base => 'qa-partial', p_name => 'QA partial',
      p_category_slug => 'qa-atomic-category', p_subcategory_slug => null,
      p_short_description => 's', p_description => null, p_article => null,
      p_published => true, p_availability => 'in_stock',
      p_meta_title => null, p_meta_description => null,
      p_characteristics => '[{"attribute":"ok","value":"1"},{"attribute":"","value":""}]'::jsonb,
      p_compatible_brands => array[]::text[], p_vehicle_types => array[]::text[])$$,
  '22023', null, 'a failure after the product row is inserted still raises'
);

select is(
  (select count(*)::integer from public.products where slug like 'qa-partial%'),
  0,
  'a failure after the product row is inserted leaves no product behind'
);

-- ---------- Обновление ----------

select lives_ok(
  $$select public.update_product_with_relations(
      p_slug => 'qa-created',
      p_expected_updated_at => (select updated_at from public.products where slug = 'qa-created'),
      p_name => 'QA renamed', p_category_slug => 'qa-atomic-category',
      p_subcategory_slug => null, p_short_description => 'changed',
      p_description => null, p_article => null, p_published => false,
      p_availability => 'in_stock', p_meta_title => null, p_meta_description => null,
      p_characteristics => '[{"attribute":"Новая","value":"1"}]'::jsonb,
      p_compatible_brands => array[]::text[], p_vehicle_types => array[]::text[])$$,
  'an update with the expected version succeeds'
);

select is(
  (select name from public.products where slug = 'qa-created'),
  'QA renamed',
  'the product row is updated'
);

select is(
  (select count(*)::integer from public.product_brands b
   join public.products p on p.id = b.product_id where p.slug = 'qa-created'),
  0,
  'relations dropped by the submitted form are removed in the same transaction'
);

select is(
  (select published from public.products where slug = 'qa-created'),
  false,
  'publication is written inside the same transaction'
);

-- Конкуренция

select throws_ok(
  $$select public.update_product_with_relations(
      p_slug => 'qa-created', p_expected_updated_at => '2020-01-01T00:00:00+00'::timestamptz,
      p_name => 'QA stale', p_category_slug => 'qa-atomic-category',
      p_subcategory_slug => null, p_short_description => 's',
      p_description => null, p_article => null, p_published => true,
      p_availability => 'in_stock', p_meta_title => null, p_meta_description => null,
      p_characteristics => null, p_compatible_brands => array[]::text[],
      p_vehicle_types => array[]::text[])$$,
  '55000', null, 'a stale edit is rejected instead of silently overwriting'
);

select is(
  (select name from public.products where slug = 'qa-created'),
  'QA renamed',
  'a rejected stale edit leaves the newer revision intact'
);

select throws_ok(
  $$select public.update_product_with_relations(
      p_slug => 'qa-created', p_expected_updated_at => null,
      p_name => 'QA nover', p_category_slug => 'qa-atomic-category',
      p_subcategory_slug => null, p_short_description => 's',
      p_description => null, p_article => null, p_published => true,
      p_availability => 'in_stock', p_meta_title => null, p_meta_description => null,
      p_characteristics => null, p_compatible_brands => array[]::text[],
      p_vehicle_types => array[]::text[])$$,
  '22023', null, 'a missing version is rejected fail-closed rather than skipping the check'
);

select throws_ok(
  $$select public.update_product_with_relations(
      p_slug => 'no-such-product', p_expected_updated_at => now(),
      p_name => 'QA ghost', p_category_slug => 'qa-atomic-category',
      p_subcategory_slug => null, p_short_description => 's',
      p_description => null, p_article => null, p_published => true,
      p_availability => 'in_stock', p_meta_title => null, p_meta_description => null,
      p_characteristics => null, p_compatible_brands => array[]::text[],
      p_vehicle_types => array[]::text[])$$,
  '22023', null, 'updating an unknown product is rejected'
);

-- Атомарность обновления: сбой на характеристиках не должен оставить товар с
-- уже стёртыми связями — прежний код именно это и делал.
select throws_ok(
  $$select public.update_product_with_relations(
      p_slug => 'qa-created',
      p_expected_updated_at => (select updated_at from public.products where slug = 'qa-created'),
      p_name => 'QA broken', p_category_slug => 'qa-atomic-category',
      p_subcategory_slug => null, p_short_description => 's',
      p_description => null, p_article => null, p_published => true,
      p_availability => 'in_stock', p_meta_title => null, p_meta_description => null,
      p_characteristics => '[{"attribute":"","value":""}]'::jsonb,
      p_compatible_brands => array[]::text[], p_vehicle_types => array[]::text[])$$,
  '22023', null, 'an update failing on characteristics raises'
);

select is(
  (select array_agg(c.attribute) from public.product_characteristics c
   join public.products p on p.id = c.product_id where p.slug = 'qa-created'),
  array['Новая'],
  'an update that failed midway leaves the previous relations untouched'
);

select * from finish();

rollback;
