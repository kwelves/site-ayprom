-- QA-012: визуальный масштаб не имел границы ни в UI, ни на сервере, ни в БД.
-- Здесь проверяется последний рубеж — CHECK-констрейнты: даже если валидация
-- приложения будет обойдена или изменена, база обязана отвергнуть значение вне
-- измеренного диапазона 0.1–5.0 и сохранить NULL как «без масштабирования».
--
-- Фикстуры создаются собственные, с уникальными slug: тест не должен зависеть
-- от содержимого seed.sql и не должен ломаться от его изменения.

begin;

select plan(12);

insert into public.categories (slug, name, description, icon, image, "order")
values ('qa-scale-category', 'QA scale category', 'Fixture', 'icon', 'image', 900000);

insert into public.products (slug, name, category_slug, short_description, "order")
values ('qa-scale-product', 'QA scale product', 'qa-scale-category', 'Fixture', 900000);

insert into public.product_images (product_id, url, "order")
select id, 'https://example.invalid/qa-scale.jpg', 0 from public.products where slug = 'qa-scale-product';

insert into public.brands (slug, name, country, logo, "order")
values ('qa-scale-brand', 'QA scale brand', 'QA', 'logo.svg', 900000);

insert into public.category_brands (category_slug, brand_slug, "order")
values ('qa-scale-category', 'qa-scale-brand', 0);

-- product_images.scale

select throws_ok(
  $$update public.product_images set scale = 5.01 where url = 'https://example.invalid/qa-scale.jpg'$$,
  '23514',
  null,
  'product image scale above the measured maximum is rejected'
);

select throws_ok(
  $$update public.product_images set scale = 0.09 where url = 'https://example.invalid/qa-scale.jpg'$$,
  '23514',
  null,
  'product image scale below the measured minimum is rejected'
);

select throws_ok(
  $$update public.product_images set scale = 0 where url = 'https://example.invalid/qa-scale.jpg'$$,
  '23514',
  null,
  'zero product image scale is rejected'
);

select throws_ok(
  $$update public.product_images set scale = -1.5 where url = 'https://example.invalid/qa-scale.jpg'$$,
  '23514',
  null,
  'negative product image scale is rejected'
);

select lives_ok(
  $$update public.product_images set scale = null where url = 'https://example.invalid/qa-scale.jpg'$$,
  'null product image scale stays allowed and means no scaling'
);

select lives_ok(
  $$update public.product_images set scale = 0.1 where url = 'https://example.invalid/qa-scale.jpg'$$,
  'product image scale accepts the inclusive lower bound'
);

select lives_ok(
  $$update public.product_images set scale = 5.0 where url = 'https://example.invalid/qa-scale.jpg'$$,
  'product image scale accepts the inclusive upper bound'
);

-- brands.logo_scale

select throws_ok(
  $$update public.brands set logo_scale = 100 where slug = 'qa-scale-brand'$$,
  '23514',
  null,
  'brand logo scale typed as 100 instead of 1.00 is rejected'
);

select lives_ok(
  $$update public.brands set logo_scale = 1.6 where slug = 'qa-scale-brand'$$,
  'brand logo scale accepts the largest value observed in the catalog'
);

-- category_brands.logo_scale_override

select throws_ok(
  $$update public.category_brands set logo_scale_override = -0.5
    where category_slug = 'qa-scale-category' and brand_slug = 'qa-scale-brand'$$,
  '23514',
  null,
  'negative category brand logo override is rejected'
);

select lives_ok(
  $$update public.category_brands set logo_scale_override = 1.15
    where category_slug = 'qa-scale-category' and brand_slug = 'qa-scale-brand'$$,
  'category brand logo override accepts the largest value observed in the catalog'
);

-- Инвариант: ни одна существующая строка каталога не нарушает новые границы,
-- иначе миграция не смогла бы примениться к реальным данным.
select is(
  (
    select count(*)
    from (
      select scale as value from public.product_images where scale is not null
      union all
      select logo_scale from public.brands where logo_scale is not null
      union all
      select logo_scale_override from public.category_brands where logo_scale_override is not null
    ) as every_scale
    where value < 0.1 or value > 5.0
  ),
  0::bigint,
  'no existing catalog row violates the visual scale bounds'
);

select * from finish();

rollback;
