-- QA-004: учёт промежуточной загрузки. Проверяется то, на что опирается вся
-- схема: лимит количества нельзя обойти повторным запросом, завершённое не
-- попадает под уборку, а повтор завершения и уборки безопасен — без этого
-- восстановление после частичного сбоя превращается в потерю или дублирование.

begin;

select plan(13);

-- Промежуточное хранилище обязано быть приватным: файл в нём ещё не прошёл
-- повторную проверку и не является частью каталога.
select is(
  (select public from storage.buckets where id = 'product-image-staging'),
  false,
  'промежуточное хранилище приватное'
);

select is(
  (select file_size_limit from storage.buckets where id = 'product-image-staging'),
  8388608::bigint,
  'промежуточное хранилище ограничено 8 МБ'
);

select ok(
  'image/svg+xml' <> all(select unnest(allowed_mime_types) from storage.buckets where id = 'product-image-staging'),
  'промежуточное хранилище не принимает SVG'
);

-- Регистрация

select lives_ok(
  $$select public.claim_product_image_staging(
      '00000000-0000-4000-9000-000000000001'::uuid, 'draft/a.jpg', 'image/jpeg', 1024, 300, 3)$$,
  'первая регистрация проходит'
);

select is(
  (select count(*)::integer from public.product_image_staging
   where draft_id = '00000000-0000-4000-9000-000000000001'),
  1,
  'учётная запись создана'
);

select throws_ok(
  $$select public.claim_product_image_staging(
      null, 'draft/x.jpg', 'image/jpeg', 1024, 300, 3)$$,
  '22023', null, 'регистрация без сессии отвергается'
);

select throws_ok(
  $$select public.claim_product_image_staging(
      '00000000-0000-4000-9000-000000000001'::uuid, 'draft/a.jpg', 'image/jpeg', 1024, 300, 3)$$,
  '23505', null, 'повторная регистрация того же пути отвергается — иначе файл посчитался бы дважды'
);

-- Лимит количества: третий файл при лимите 2 не проходит.
select lives_ok(
  $$select public.claim_product_image_staging(
      '00000000-0000-4000-9000-000000000001'::uuid, 'draft/b.jpg', 'image/jpeg', 1024, 300, 2)$$,
  'второй файл при лимите 2 проходит'
);

select throws_ok(
  $$select public.claim_product_image_staging(
      '00000000-0000-4000-9000-000000000001'::uuid, 'draft/c.jpg', 'image/jpeg', 1024, 300, 2)$$,
  '22023', null, 'лимит количества нельзя обойти повторным запросом'
);

-- Уборка

insert into public.product_image_staging (draft_id, object_path, content_type, byte_size, created_at, expires_at)
values ('00000000-0000-4000-9000-000000000002', 'draft/expired.jpg', 'image/jpeg', 1024,
        now() - interval '2 days', now() - interval '1 day');

select is(
  (select count(*)::integer from public.list_abandoned_product_image_staging(100)
   where out_object_path = 'draft/expired.jpg'),
  1,
  'просроченная запись попадает в список уборки'
);

-- Завершённое под уборку не попадает, даже если срок вышел.
insert into public.product_image_staging (draft_id, object_path, content_type, byte_size, created_at, expires_at, finalized_at)
values ('00000000-0000-4000-9000-000000000003', 'draft/done.jpg', 'image/jpeg', 1024,
        now() - interval '2 days', now() - interval '1 day', now());

select is(
  (select count(*)::integer from public.list_abandoned_product_image_staging(100)
   where out_object_path = 'draft/done.jpg'),
  0,
  'завершённая запись не попадает под уборку даже с истёкшим сроком'
);

-- Идемпотентность: повтор не должен ни падать, ни менять результат.
select is(
  (select public.finalize_product_image_staging(
     (select id from public.product_image_staging where object_path = 'draft/a.jpg'))),
  true,
  'первое завершение отмечает запись'
);

select is(
  (select public.finalize_product_image_staging(
     (select id from public.product_image_staging where object_path = 'draft/a.jpg'))),
  false,
  'повторное завершение безопасно и сообщает, что менять было нечего'
);

select * from finish();

rollback;
