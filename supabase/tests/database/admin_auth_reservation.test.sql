-- QA-005: проверка пароля выполнялась раньше проверки лимита, поэтому
-- заблокированный перебирающий всё равно заставлял сервер считать PBKDF2.
--
-- Здесь проверяется контракт брони: заблокированный ключ не получает броню
-- вовсе (значит приложению нечего допускать до хеша), параллельный залп
-- ограничен бюджетом, учёт неудачи происходит ровно один раз, а брошенная
-- бронь не теряется.

begin;

select plan(17);

-- Ключи — 64 символа, как требует констрейнт (это sha256-хеш).
create temporary table qa_keys(name text primary key, hash text);
insert into qa_keys values
  ('a', repeat('a', 64)),
  ('b', repeat('b', 64)),
  ('c', repeat('c', 64));

-- Проверка входных данных

select throws_ok(
  $$select public.begin_admin_auth_attempt(repeat('a',64), 'wrong-scope', 30, 3)$$,
  '22023', null, 'неизвестная область попытки отвергается'
);

select throws_ok(
  $$select public.begin_admin_auth_attempt('короткий', 'login', 30, 3)$$,
  '22023', null, 'ключ неверной длины отвергается'
);

select throws_ok(
  $$select public.begin_admin_auth_attempt(repeat('a',64), 'login', 0, 3)$$,
  '22023', null, 'нулевой срок брони отвергается'
);

select throws_ok(
  $$select public.begin_admin_auth_attempt(repeat('a',64), 'login', 30, 0)$$,
  '22023', null, 'нулевой бюджет одновременности отвергается'
);

-- Обычный путь

select is(
  (select out_allowed from public.begin_admin_auth_attempt((select hash from qa_keys where name='a'), 'login', 30, 3)),
  true,
  'первая попытка получает бронь'
);

select isnt(
  (select out_reservation_id from public.begin_admin_auth_attempt((select hash from qa_keys where name='a'), 'login', 30, 3)),
  null,
  'бронь имеет идентификатор'
);

-- Бюджет одновременности: при лимите 2 третья одновременная бронь не выдаётся.
select is(
  (select out_allowed from public.begin_admin_auth_attempt((select hash from qa_keys where name='a'), 'login', 30, 2)),
  false,
  'параллельный залп ограничен бюджетом одновременности'
);

-- Учёт неудачи

select lives_ok(
  $$select public.finish_admin_auth_attempt(
      (select id from public.admin_auth_reservations
       where key_hash = repeat('a',64) and finished_at is null order by created_at limit 1), false)$$,
  'завершение неудачей проходит'
);

select is(
  (select failed_count from public.admin_login_rate_limits where key_hash = (select hash from qa_keys where name='a')),
  1,
  'неудача учтена ровно один раз'
);

-- Идемпотентность: повторное завершение той же брони не считается снова.
select is(
  (select public.finish_admin_auth_attempt(
     (select id from public.admin_auth_reservations
      where key_hash = repeat('a',64) and finished_at is not null order by finished_at limit 1), false)),
  0,
  'повторное завершение той же брони безопасно'
);

select is(
  (select failed_count from public.admin_login_rate_limits where key_hash = (select hash from qa_keys where name='a')),
  1,
  'повтор не увеличил счётчик второй раз'
);

-- Блокировка после пяти неудач и отказ в броне

do $$
declare i integer; r uuid;
begin
  for i in 1..5 loop
    select out_reservation_id into r from public.begin_admin_auth_attempt(repeat('b',64), 'login', 30, 5);
    perform public.finish_admin_auth_attempt(r, false);
  end loop;
end $$;

select isnt(
  (select blocked_until from public.admin_login_rate_limits where key_hash = (select hash from qa_keys where name='b')),
  null,
  'после пяти неудач ключ заблокирован'
);

-- Главное: заблокированный ключ не получает броню, поэтому приложению нечего
-- допускать до проверки пароля.
select is(
  (select out_allowed from public.begin_admin_auth_attempt(repeat('b',64), 'login', 30, 5)),
  false,
  'заблокированный ключ не получает броню — до PBKDF2 дело не доходит'
);

select ok(
  (select out_retry_after from public.begin_admin_auth_attempt(repeat('b',64), 'login', 30, 5)) > 0,
  'отказ сообщает, через сколько можно повторить'
);

select is(
  (select out_reservation_id from public.begin_admin_auth_attempt(repeat('b',64), 'login', 30, 5)),
  null,
  'при отказе бронь не создаётся'
);

-- Брошенная бронь: процесс не вернулся, срок вышел. Она не должна пропасть,
-- иначе обрыв соединения стал бы способом перебирать пароли без учёта.
insert into public.admin_auth_reservations (key_hash, scope, created_at, expires_at)
values ((select hash from qa_keys where name='c'), 'login', now() - interval '5 minutes', now() - interval '4 minutes');

select is(
  (select out_allowed from public.begin_admin_auth_attempt(repeat('c',64), 'login', 30, 3)),
  true,
  'следующая попытка после брошенной брони проходит'
);

select is(
  (select failed_count from public.admin_login_rate_limits where key_hash = (select hash from qa_keys where name='c')),
  1,
  'брошенная бронь засчитана как неудача при сверке'
);

select * from finish();

rollback;
