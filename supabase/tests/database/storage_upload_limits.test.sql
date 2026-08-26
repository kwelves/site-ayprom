-- QA-012 (вторая половина): ограничения на загрузку существовали только в коде
-- приложения, а три хранилища из четырёх принимали файл любого типа и размера.
--
-- Здесь проверяется последний рубеж — конфигурация самих хранилищ. Даже если
-- проверка в приложении будет обойдена или изменена, Storage обязан отказать
-- сам. Тот же принцип, что и у CHECK-констрейнтов масштаба в фазе 2.

begin;

select plan(9);

select is(
  (select file_size_limit from storage.buckets where id = 'product-images'),
  8388608::bigint,
  'product-images ограничен 8 МБ'
);

select is(
  (select file_size_limit from storage.buckets where id = 'category-images'),
  8388608::bigint,
  'category-images ограничен 8 МБ'
);

select is(
  (select file_size_limit from storage.buckets where id = 'brand-logos'),
  8388608::bigint,
  'brand-logos ограничен 8 МБ'
);

-- Ни одно хранилище каталога не должно принимать произвольный тип.
select is(
  (select count(*)::integer from storage.buckets
   where id in ('product-images', 'category-images', 'brand-logos')
     and allowed_mime_types is null),
  0,
  'ни одно хранилище каталога не принимает произвольный тип файла'
);

-- Вектор допустим только там, где он осмыслен: у логотипов брендов.
select ok(
  'image/svg+xml' = any(select unnest(allowed_mime_types) from storage.buckets where id = 'brand-logos'),
  'brand-logos принимает вектор — PROJECT_BRIEF требует сохранять SVG векторным'
);

select ok(
  'image/svg+xml' <> all(select unnest(allowed_mime_types) from storage.buckets where id = 'product-images'),
  'product-images не принимает SVG'
);

select ok(
  'image/svg+xml' <> all(select unnest(allowed_mime_types) from storage.buckets where id = 'category-images'),
  'category-images не принимает SVG'
);

-- Опасные типы не должны быть разрешены нигде в каталоге.
select is(
  (select count(*)::integer from storage.buckets
   where id in ('product-images', 'category-images', 'brand-logos')
     and allowed_mime_types && array['text/html', 'application/javascript', 'text/javascript', 'application/xhtml+xml']),
  0,
  'исполняемые и HTML-типы не разрешены ни в одном хранилище каталога'
);

-- Видео-хранилище уже было настроено правильно и служит образцом: проверка
-- фиксирует, что фаза 3 его не сломала.
select is(
  (select array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'site-media'),
  'video/mp4',
  'site-media остался нетронутым'
);

select * from finish();

rollback;
