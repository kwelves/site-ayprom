-- Собственная система WebP-вариантов (фаза 2): новые колонки
-- product_images.thumbnail_url/gallery_url, их целостность, доступность
-- клиентским ролям без отдельного GRANT и fallback внутри
-- search_catalog_products. Генератор и backfill — отдельные фазы, здесь
-- проверяется только модель данных и совместимость публичного RPC.
--
-- Три раздельные фикстуры под три несвязанных сценария — умышленно, чтобы
-- ни одна проверка не зависела от порядка/id строк product_images другой:
--   both    — обложка с обоими вариантами сразу.
--   none    — обложка без вариантов (обычное состояние сразу после upload).
--   scratch — только механика записи (insert/update), в резолвинг cover_url
--             не участвует вовсе.

begin;

select plan(8);

insert into public.products (
  slug, name, category_slug, short_description, article, published, "order"
)
values
  ('image-variants-test-both', 'Image variants test both', 'hydraulic-pumps', 'Fixture', 'IV-BOTH', true, 93001),
  ('image-variants-test-none', 'Image variants test none', 'hydraulic-pumps', 'Fixture', 'IV-NONE', true, 93002),
  ('image-variants-test-scratch', 'Image variants test scratch', 'hydraulic-pumps', 'Fixture', 'IV-SCRATCH', true, 93003);

-- Оба варианта заполнены вместе — так их пишет генератор (фаза 3) и
-- backfill (фаза 4): одним условным обновлением после успешной загрузки
-- обоих файлов.
insert into public.product_images (product_id, url, thumbnail_url, gallery_url)
select id, 'https://storage.example/master-both.jpg',
       'https://storage.example/variants/v1/thumbnail-both.webp',
       'https://storage.example/variants/v1/gallery-both.webp'
from public.products where slug = 'image-variants-test-both';

-- Фото без вариантов — обычное состояние строки сразу после upload, до
-- прохода генератора/backfill.
insert into public.product_images (product_id, url)
select id, 'https://storage.example/master-none.jpg'
from public.products where slug = 'image-variants-test-none';

select throws_ok(
  $$ insert into public.product_images (product_id, url, thumbnail_url)
     select id, 'https://storage.example/thumb-only.jpg', 'https://storage.example/thumb-only-thumb.webp'
     from public.products where slug = 'image-variants-test-scratch' $$,
  '23514',
  null,
  'thumbnail_url без gallery_url отклоняется constraint''ом'
);

select throws_ok(
  $$ insert into public.product_images (product_id, url, gallery_url)
     select id, 'https://storage.example/gallery-only.jpg', 'https://storage.example/gallery-only-gallery.webp'
     from public.products where slug = 'image-variants-test-scratch' $$,
  '23514',
  null,
  'gallery_url без thumbnail_url отклоняется constraint''ом'
);

select lives_ok(
  $$ insert into public.product_images (product_id, url)
     select id, 'https://storage.example/scratch-master.jpg'
     from public.products where slug = 'image-variants-test-scratch' $$,
  'оба варианта NULL — допустимое состояние (фото ещё не обработано)'
);

select lives_ok(
  $$ update public.product_images
     set thumbnail_url = 'https://storage.example/variants/v1/thumbnail-scratch.webp',
         gallery_url = 'https://storage.example/variants/v1/gallery-scratch.webp'
     where url = 'https://storage.example/scratch-master.jpg' $$,
  'заполнение обоих вариантов одним UPDATE проходит (путь backfill/генератора)'
);

set local role anon;

select is(
  (select cover_url from public.search_catalog_products('image variants test both', null, null, null, null)),
  'https://storage.example/variants/v1/thumbnail-both.webp',
  'search_catalog_products.cover_url = thumbnail_url, когда оба варианта заполнены'
);

-- Здесь же неявно проверяется regression-контракт: до этой миграции
-- cover_url был просто "url"; после — coalesce(thumbnail_url, gallery_url,
-- url). Для товара без вариантов результат обязан остаться прежним.
select is(
  (select cover_url from public.search_catalog_products('image variants test none', null, null, null, null)),
  'https://storage.example/master-none.jpg',
  'search_catalog_products.cover_url = url, когда варианты ещё не посчитаны (fallback на оригинал)'
);

-- thumbnail_url/gallery_url — обычные колонки той же таблицы, права на
-- которую выданы на уровне TABLE (GRANT SELECT ON TABLE product_images),
-- а не на уровне колонок. Убеждаемся, что anon реально видит их напрямую
-- через тот же RLS-контур ("Public can read images of published
-- products"), без отдельного GRANT для новых колонок.
select is(
  (
    select thumbnail_url
    from public.product_images
    join public.products on products.id = product_images.product_id
    where products.slug = 'image-variants-test-both'
  ),
  'https://storage.example/variants/v1/thumbnail-both.webp',
  'anon видит thumbnail_url напрямую без дополнительного GRANT на колонку'
);

reset role;

select is(
  (
    select thumbnail_url is null and gallery_url is null
    from public.product_images
    where url = 'https://storage.example/scratch-master.jpg'
  ),
  false,
  'UPDATE из предыдущего шага реально закрепился (оба варианта не NULL)'
);

select * from finish();

rollback;
