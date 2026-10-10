-- QA-013: права клиентских ролей `anon` и `authenticated` в схеме public.
--
-- RLS проверяет только строковые операции. TRUNCATE, REFERENCES, TRIGGER и
-- MAINTAIN работают на уровне таблицы целиком и политиками не ограничиваются:
-- пока у `anon` был TRUNCATE, включённый RLS не мешал очистить каталог.
--
-- Поэтому проверяется не «RLS не пускает», а сам набор GRANT: клиентские роли
-- не должны иметь SELECT на одиннадцати редактируемых таблицах каталога;
-- публичное чтение проходит через функции опубликованного выпуска.
-- Отдельно проверяются default privileges —
-- без них следующая же миграция вернула бы лишние права на новых объектах.

begin;

select plan(34);

create temporary table qa013_catalog(relname text primary key);
insert into qa013_catalog values
  ('brands'), ('categories'), ('category_brands'), ('product_brands'),
  ('product_characteristics'), ('product_images'), ('product_vehicle_types'),
  ('products'), ('subcategories'), ('vehicle_hotspots'), ('vehicle_types');

-- Публичные функции каталога: всё остальное в схеме внутреннее.
create temporary table qa013_public_functions(proname text primary key);
insert into qa013_public_functions values ('search_catalog_products'), ('normalize_catalog_search'),
 ('get_content_revision'), ('read_catalog_publication_document'), ('list_catalog_publication_documents');

-- Проверки-списки называют нарушителя, а не просто падают: при регрессии сразу
-- видно, какая таблица или функция открылась.

select is(
  (select coalesce(string_agg(t.relname, ', ' order by t.relname), '')
   from qa013_catalog t
   where has_table_privilege('anon', ('public.' || t.relname)::regclass, 'SELECT')),
  '',
  'anon не читает редактируемые таблицы каталога'
);

select is(
  (select coalesce(string_agg(t.relname, ', ' order by t.relname), '')
   from qa013_catalog t
   where has_table_privilege('authenticated', ('public.' || t.relname)::regclass, 'SELECT')),
  '',
  'authenticated не читает редактируемые таблицы каталога'
);

-- Перебираются ВСЕ таблицы схемы, а не только каталожные: новая таблица с
-- лишними правами должна ронять проверку, даже если её забыли внести в список.

select is(
  (select coalesce(string_agg(c.relname || '(' || r.rolname || ')', ', ' order by c.relname, r.rolname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, 'INSERT')),
  '',
  'клиентские роли нигде не могут INSERT'
);

select is(
  (select coalesce(string_agg(c.relname || '(' || r.rolname || ')', ', ' order by c.relname, r.rolname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, 'UPDATE')),
  '',
  'клиентские роли нигде не могут UPDATE'
);

select is(
  (select coalesce(string_agg(c.relname || '(' || r.rolname || ')', ', ' order by c.relname, r.rolname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, 'DELETE')),
  '',
  'клиентские роли нигде не могут DELETE'
);

-- Главная находка QA-013: TRUNCATE проходит мимо RLS целиком.
select is(
  (select coalesce(string_agg(c.relname || '(' || r.rolname || ')', ', ' order by c.relname, r.rolname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, 'TRUNCATE')),
  '',
  'клиентские роли нигде не могут TRUNCATE'
);

select is(
  (select coalesce(string_agg(c.relname || '(' || r.rolname || ')', ', ' order by c.relname, r.rolname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, 'TRIGGER')),
  '',
  'клиентские роли нигде не могут создавать триггеры'
);

select is(
  (select coalesce(string_agg(c.relname || '(' || r.rolname || ')', ', ' order by c.relname, r.rolname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, 'REFERENCES')),
  '',
  'клиентские роли нигде не могут ссылаться внешним ключом'
);

select is(
  (select coalesce(string_agg(c.relname || '(' || r.rolname || ')', ', ' order by c.relname, r.rolname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, 'MAINTAIN')),
  '',
  'клиентские роли нигде не имеют MAINTAIN'
);

-- Служебные таблицы не должны читаться вовсе.
select is(
  (select coalesce(string_agg(c.relname || '(' || r.rolname || ')', ', ' order by c.relname, r.rolname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where c.relkind = 'r'
     and c.relname not in (select relname from qa013_catalog)
     -- The non-secret revision is explicitly public (publication_revision.test).
     and c.relname <> 'content_revision'
     and has_table_privilege(r.rolname, c.oid, 'SELECT')),
  '',
  'клиентские роли не читают служебные таблицы'
);

select is(
  (select coalesce(string_agg(c.relname || '(' || r.rolname || ')', ', ' order by c.relname, r.rolname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where c.relkind = 'S'
     and (has_sequence_privilege(r.rolname, c.oid, 'USAGE')
       or has_sequence_privilege(r.rolname, c.oid, 'SELECT')
       or has_sequence_privilege(r.rolname, c.oid, 'UPDATE'))),
  '',
  'клиентские роли не имеют доступа к последовательностям'
);

-- Функции: список разрешённого закрыт с обеих сторон.

select is(
  (select coalesce(string_agg(p.proname || '(' || r.rolname || ')', ', ' order by p.proname, r.rolname), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where p.proname not in (select proname from qa013_public_functions)
     and has_function_privilege(r.rolname, p.oid, 'EXECUTE')),
  '',
  'клиентские роли не выполняют ни одну внутреннюю функцию'
);

select is(
  (select coalesce(string_agg(f.proname || '(' || r.rolname || ')', ', ' order by f.proname, r.rolname), '')
   from qa013_public_functions f
   join pg_proc p on p.proname = f.proname
   join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   cross join (values ('anon'), ('authenticated')) as r(rolname)
   where not has_function_privilege(r.rolname, p.oid, 'EXECUTE')),
  '',
  'клиентские роли выполняют обе функции поиска каталога'
);

-- EXECUTE для PUBLIC — тот же доступ, только выданный не по имени роли.
select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  '',
  'ни одна функция public не выдана PUBLIC'
);

-- service_role обслуживает админку и cron, поэтому теряться его права не должны.

select is(
  (select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relkind = 'r'
     and not (has_table_privilege('service_role', c.oid, 'SELECT')
          and has_table_privilege('service_role', c.oid, 'INSERT')
          and has_table_privilege('service_role', c.oid, 'UPDATE')
          and (c.relname = 'publication_jobs' or has_table_privilege('service_role', c.oid, 'DELETE')))),
  '',
  'service_role сохраняет требуемые права, очередь публикации не требует DELETE'
);
select ok(not has_table_privilege('service_role','public.publication_jobs','DELETE'),
 'service role cannot erase the publication cursor');

select is(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where not has_function_privilege('service_role', p.oid, 'EXECUTE')),
  '',
  'service_role выполняет все функции public'
);

-- Default privileges. Проверка отдельная и «живая»: объект действительно
-- создаётся, потому что запись в pg_default_acl сама по себе ещё ничего не
-- доказывает — итоговые права считаются объединением глобальной и схемной
-- записи, и схемный REVOKE PUBLIC без глобального не работает.

create table public.qa013_probe_table (id integer);
create sequence public.qa013_probe_sequence;
create function public.qa013_probe_function() returns integer language sql as $$select 1$$;

select is(
  (select coalesce(string_agg(r.rolname, ', ' order by r.rolname), '')
   from (values ('anon'), ('authenticated')) as r(rolname)
   where has_table_privilege(r.rolname, 'public.qa013_probe_table', 'SELECT')
      or has_table_privilege(r.rolname, 'public.qa013_probe_table', 'INSERT')
      or has_table_privilege(r.rolname, 'public.qa013_probe_table', 'UPDATE')
      or has_table_privilege(r.rolname, 'public.qa013_probe_table', 'DELETE')
      or has_table_privilege(r.rolname, 'public.qa013_probe_table', 'TRUNCATE')
      or has_table_privilege(r.rolname, 'public.qa013_probe_table', 'TRIGGER')
      or has_table_privilege(r.rolname, 'public.qa013_probe_table', 'REFERENCES')
      or has_table_privilege(r.rolname, 'public.qa013_probe_table', 'MAINTAIN')),
  '',
  'новая таблица не достаётся клиентским ролям'
);

select ok(
  has_table_privilege('service_role', 'public.qa013_probe_table', 'SELECT')
    and has_table_privilege('service_role', 'public.qa013_probe_table', 'INSERT')
    and has_table_privilege('service_role', 'public.qa013_probe_table', 'UPDATE')
    and has_table_privilege('service_role', 'public.qa013_probe_table', 'DELETE'),
  'новая таблица остаётся доступной service_role'
);

select is(
  (select coalesce(string_agg(r.rolname, ', ' order by r.rolname), '')
   from (values ('anon'), ('authenticated')) as r(rolname)
   where has_sequence_privilege(r.rolname, 'public.qa013_probe_sequence', 'USAGE')
      or has_sequence_privilege(r.rolname, 'public.qa013_probe_sequence', 'SELECT')
      or has_sequence_privilege(r.rolname, 'public.qa013_probe_sequence', 'UPDATE')),
  '',
  'новая последовательность не достаётся клиентским ролям'
);

select ok(
  has_sequence_privilege('service_role', 'public.qa013_probe_sequence', 'USAGE'),
  'новая последовательность остаётся доступной service_role'
);

select is(
  (select coalesce(string_agg(r.rolname, ', ' order by r.rolname), '')
   from (values ('anon'), ('authenticated')) as r(rolname)
   where has_function_privilege(r.rolname, 'public.qa013_probe_function()', 'EXECUTE')),
  '',
  'новая функция не достаётся клиентским ролям'
);

select is(
  (select count(*)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.proname = 'qa013_probe_function' and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  0::bigint,
  'новая функция не выдаётся PUBLIC'
);

select ok(
  has_function_privilege('service_role', 'public.qa013_probe_function()', 'EXECUTE'),
  'новая функция остаётся доступной service_role'
);

-- Живые проверки под самой ролью: отказ должен приходить от GRANT (42501), а
-- не от RLS — иначе «ноль изменённых строк» снова выдавали бы за защиту.

do $$ begin
  perform public.capture_catalog_publication(public.get_content_revision(),'40000000-0000-4000-8000-000000000001',repeat('1',64));
  update catalog_private.catalog_releases set state='ready' where id='40000000-0000-4000-8000-000000000001';
  insert into catalog_private.catalog_publication_active(release_id) values ('40000000-0000-4000-8000-000000000001');
end $$;
set local role anon;

select throws_ok(
  $$select count(*) from public.products where published = true$$,
  '42501', 'permission denied for table products',
  'anon не обходит опубликованный выпуск прямым чтением source'
);

select isnt(
  (select count(*) from public.search_catalog_products(null, null, null, null, null)),
  0::bigint,
  'anon пользуется поиском каталога'
);

-- Текст ошибки проверяется намеренно: у отказа по GRANT и у нарушения RLS
-- один и тот же SQLSTATE 42501. Без сверки сообщения тест продолжал бы
-- проходить после возврата лишнего GRANT — отказ просто приходил бы от
-- политики. Проверено: выдача INSERT роли anon такой тест не роняет.
select throws_ok(
  $$truncate table public.products cascade$$,
  '42501', 'permission denied for table products',
  'anon не может очистить таблицу товаров'
);

-- Отдельно — таблица, на которую никто не ссылается: у неё TRUNCATE не уходит
-- каскадом на соседей, поэтому отказ приходит именно за неё, а не за смежную.
select throws_ok(
  $$truncate table public.product_characteristics$$,
  '42501', 'permission denied for table product_characteristics',
  'anon не может очистить таблицу характеристик'
);

select throws_ok(
  $$delete from public.products$$,
  '42501', 'permission denied for table products',
  'anon не может удалять товары'
);

select throws_ok(
  $$insert into public.products (slug, name, category_slug, short_description) values ('qa013', 'qa013', 'hydraulic-pumps', 'qa013')$$,
  '42501', 'permission denied for table products',
  'anon не может добавлять товары'
);

select throws_ok(
  $$update public.products set name = 'qa013'$$,
  '42501', 'permission denied for table products',
  'anon не может изменять товары'
);

select throws_ok(
  $$select public.reorder_products(array['qa013'])$$,
  '42501', 'permission denied for function reorder_products',
  'anon не может вызывать RPC переупорядочивания'
);

select throws_ok(
  $$select public.import_products_batch('[]'::jsonb)$$,
  '42501', 'permission denied for function import_products_batch',
  'anon не может вызывать RPC массового импорта'
);

select throws_ok(
  $$select public.update_vehicle_hotspots('qa013', '[]'::jsonb)$$,
  '42501', 'permission denied for function update_vehicle_hotspots',
  'anon не может вызывать RPC hotspot-ов'
);

reset role;

select * from finish();

rollback;
