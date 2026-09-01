-- Декларативное описание структуры базы: желаемое состояние, а не команды
-- изменения. Миграции генерируются из этого файла через `supabase db diff -f`.
--
-- Что сюда НЕ входит и намеренно остаётся в миграциях (диф этого не видит):
-- вставки данных, включая storage buckets; привилегии схемы; комментарии;
-- alter policy; привилегии на колонки.
-- BASELINE. Единственная стартовая миграция проекта.
--
-- Предыстория: миграции писались под уже применённое состояние прода, часть
-- схемы заводилась через админку и Studio, из-за чего локальные версии
-- 0001-0011 разошлись с timestamp-версиями в истории прода и `supabase db
-- push` стал неприменим. Прежние миграции сохранены в migrations/_archive/
-- и в истории git; здесь зафиксирован их итог.
--
-- Снято с локальной базы после того, как она была признана достоверной
-- копией прода: таблицы, колонки и Storage buckets сверены через
-- npm run schema:check, а функции, триггеры, политики и индексы — прямым
-- сравнением. Единственное расхождение, rls_auto_enable(), принадлежит
-- облачной платформе Supabase и в миграциях присутствовать не должно.
--
-- Данные вынесены в supabase/seed.sql: миграции описывают структуру,
-- сиды наполняют локальную базу для разработки.



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';

-- pg_trgm живёт в схеме extensions (см. archive/20260810094407). Дамп
-- --schema public его не захватывает, а индексы ниже ссылаются на
-- extensions.gin_trgm_ops, поэтому расширение создаётся здесь явно.
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";




CREATE OR REPLACE FUNCTION "public"."normalize_catalog_search"("value" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO ''
    AS $$
  select trim(regexp_replace(lower(coalesce(value, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;


ALTER FUNCTION "public"."normalize_catalog_search"("value" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_admin_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  ignored_keys text[] := array['search_text', 'created_at', 'updated_at', 'order'];
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  field_names text[] := '{}';
  old_diff jsonb := '{}'::jsonb;
  new_diff jsonb := '{}'::jsonb;
begin
  -- Триггеры вроде products_refresh_search_text каскадно выполняют свой
  -- собственный UPDATE (например, пересчёт search_text) в ответ на исходную
  -- мутацию. pg_trigger_depth() > 1 отличает такой вложенный, вызванный
  -- другим триггером UPDATE от прямой мутации клиента/service_role — иначе
  -- одно реальное действие администратора порождает лишние записи аудита.
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(field.key order by field.key), '{}')
    into field_names
    from jsonb_each(to_jsonb(new)) as field
    where field.key <> all(ignored_keys)
      and to_jsonb(old) -> field.key is distinct from field.value;

    if array_length(field_names, 1) is null then
      return new;
    end if;

    select coalesce(jsonb_object_agg(k, to_jsonb(old) -> k), '{}'::jsonb) into old_diff
      from unnest(field_names) as k;
    select coalesce(jsonb_object_agg(k, to_jsonb(new) -> k), '{}'::jsonb) into new_diff
      from unnest(field_names) as k;
  elsif tg_op = 'INSERT' then
    field_names := array['created'];
    new_diff := to_jsonb(new) - ignored_keys;
  else
    field_names := array['deleted'];
    old_diff := to_jsonb(old) - ignored_keys;
  end if;

  insert into public.admin_audit_log (
    actor,
    action,
    entity_type,
    entity_key,
    changed_fields,
    old_values,
    new_values
  )
  values (
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claim.role', true), ''),
      current_user
    ),
    tg_op,
    tg_table_name,
    coalesce(
      row_data ->> 'slug',
      row_data ->> 'id',
      row_data ->> 'product_id',
      row_data ->> 'category_slug'
    ),
    field_names,
    nullif(old_diff, '{}'::jsonb),
    nullif(new_diff, '{}'::jsonb)
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;


ALTER FUNCTION "public"."record_admin_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."detach_vehicle_hotspots_from_unpublished_product"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  update public.vehicle_hotspots
  set product_id = null
  where product_id = new.id;

  return new;
end;
$$;


ALTER FUNCTION "public"."detach_vehicle_hotspots_from_unpublished_product"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_product_search_from_brand"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  target_product_id uuid;
begin
  for target_product_id in
    select product_id
    from public.product_brands
    where brand_slug = coalesce(new.slug, old.slug)
  loop
    perform public.refresh_product_search_text(target_product_id);
  end loop;
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."refresh_product_search_from_brand"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_product_search_from_category"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  target_product_id uuid;
begin
  for target_product_id in
    select id
    from public.products
    where category_slug = coalesce(new.slug, old.slug)
  loop
    perform public.refresh_product_search_text(target_product_id);
  end loop;
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."refresh_product_search_from_category"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_product_search_from_child"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  perform public.refresh_product_search_text(coalesce(new.product_id, old.product_id));
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."refresh_product_search_from_child"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_product_search_from_product"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  perform public.refresh_product_search_text(new.id);
  return new;
end;
$$;


ALTER FUNCTION "public"."refresh_product_search_from_product"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_product_search_from_subcategory"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  target_product_id uuid;
begin
  for target_product_id in
    select id
    from public.products
    where subcategory_id = coalesce(new.id, old.id)
  loop
    perform public.refresh_product_search_text(target_product_id);
  end loop;
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."refresh_product_search_from_subcategory"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_product_search_text"("target_product_id" "uuid") RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  -- Category and subcategory are pulled with scalar subqueries rather than an
  -- `update ... from ... left join`: Postgres forbids referencing the UPDATE
  -- target (`product`) from a join's ON clause, so the join form fails to even
  -- create the function with SQLSTATE 42P01.
  update public.products as product
  set search_text = public.normalize_catalog_search(concat_ws(
    ' ',
    product.name,
    product.article,
    product.short_description,
    product.description,
    (
      select category.name
      from public.categories as category
      where category.slug = product.category_slug
    ),
    (
      select subcategory.name
      from public.subcategories as subcategory
      where subcategory.id = product.subcategory_id
    ),
    (
      select string_agg(concat_ws(' ', brand.name, array_to_string(brand.aliases, ' ')), ' ')
      from public.product_brands as product_brand
      join public.brands as brand on brand.slug = product_brand.brand_slug
      where product_brand.product_id = product.id
    ),
    (
      select string_agg(concat_ws(' ', characteristic.attribute, characteristic.value), ' ')
      from public.product_characteristics as characteristic
      where characteristic.product_id = product.id
    )
  ))
  where product.id = target_product_id;
$$;


ALTER FUNCTION "public"."refresh_product_search_text"("target_product_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_admin_login_attempt"("attempt_key_hash" "text", "password_is_valid" boolean, "attempt_scope" "text" DEFAULT 'login'::"text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY INVOKER
    SET "search_path" TO ''
    AS $$
declare
  current_row public.admin_login_rate_limits%rowtype;
  -- Deliberately not named `current_time`: that is a reserved SQL keyword, and
  -- inside SQL expressions the parser resolves it to CURRENT_TIME (timetz)
  -- rather than to the local variable, making every comparison below fail with
  -- SQLSTATE 42883 — which the caller mistakes for "RPC not deployed yet".
  attempt_at timestamptz := clock_timestamp();
  next_failed_count integer;
  next_window_started_at timestamptz;
  next_blocked_until timestamptz;
begin
  if attempt_scope not in ('login', 'password-change') then
    raise exception 'invalid admin login attempt scope' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(attempt_key_hash, 0));

  select *
  into current_row
  from public.admin_login_rate_limits
  where key_hash = attempt_key_hash
  for update;

  if found and current_row.blocked_until is not null and current_row.blocked_until > attempt_at then
    insert into public.admin_auth_events (scope, outcome, attempt_key_hash)
    values (attempt_scope, 'blocked', attempt_key_hash);
    return greatest(1, ceil(extract(epoch from (current_row.blocked_until - attempt_at)))::integer);
  end if;

  if password_is_valid then
    delete from public.admin_login_rate_limits where key_hash = attempt_key_hash;
    insert into public.admin_auth_events (scope, outcome, attempt_key_hash)
    values (attempt_scope, 'success', attempt_key_hash);
    return 0;
  end if;

  if not found or current_row.window_started_at < attempt_at - interval '15 minutes' then
    next_failed_count := 1;
    next_window_started_at := attempt_at;
  else
    next_failed_count := current_row.failed_count + 1;
    next_window_started_at := current_row.window_started_at;
  end if;

  next_blocked_until := case
    when next_failed_count >= 5 then attempt_at + interval '15 minutes'
    else null
  end;

  insert into public.admin_login_rate_limits (
    key_hash,
    failed_count,
    window_started_at,
    last_attempt_at,
    blocked_until
  )
  values (
    attempt_key_hash,
    next_failed_count,
    next_window_started_at,
    attempt_at,
    next_blocked_until
  )
  on conflict (key_hash) do update
  set failed_count = excluded.failed_count,
      window_started_at = excluded.window_started_at,
      last_attempt_at = excluded.last_attempt_at,
      blocked_until = excluded.blocked_until;

  insert into public.admin_auth_events (scope, outcome, attempt_key_hash)
  values (
    attempt_scope,
    case when next_blocked_until is null then 'failure' else 'blocked' end,
    attempt_key_hash
  );

  if next_blocked_until is not null then
    return ceil(extract(epoch from (next_blocked_until - attempt_at)))::integer;
  end if;

  return 0;
end;
$$;


ALTER FUNCTION "public"."register_admin_login_attempt"("attempt_key_hash" "text", "password_is_valid" boolean, "attempt_scope" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_catalog_products"("search_query" "text" DEFAULT NULL::"text", "category_filter" "text" DEFAULT NULL::"text", "subcategory_filter" "text" DEFAULT NULL::"text", "brand_filter" "text" DEFAULT NULL::"text", "vehicle_type_filter" "text" DEFAULT NULL::"text") RETURNS TABLE("slug" "text", "name" "text", "category_slug" "text", "subcategory_slug" "text", "short_description" "text", "article" "text", "cover_url" "text", "cover_scale" numeric, "compatible_brands" "text"[])
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  with normalized_query as (
    select public.normalize_catalog_search(search_query) as value
  )
  select
    product.slug,
    product.name,
    product.category_slug,
    subcategory.slug as subcategory_slug,
    product.short_description,
    product.article,
    coalesce(cover.thumbnail_url, cover.gallery_url, cover.url) as cover_url,
    cover.scale as cover_scale,
    coalesce(brands.slugs, '{}') as compatible_brands
  from public.products as product
  cross join normalized_query
  left join public.subcategories as subcategory on subcategory.id = product.subcategory_id
  left join lateral (
    select image.url, image.thumbnail_url, image.gallery_url, image.scale
    from public.product_images as image
    where image.product_id = product.id
    order by image."order", image.id
    limit 1
  ) as cover on true
  left join lateral (
    select array_agg(product_brand.brand_slug order by product_brand.brand_slug) as slugs
    from public.product_brands as product_brand
    where product_brand.product_id = product.id
  ) as brands on true
  where product.published = true
    and (category_filter is null or product.category_slug = category_filter)
    and (
      subcategory_filter is null
      or (
        subcategory.slug = subcategory_filter
        and (category_filter is null or subcategory.category_slug = category_filter)
      )
    )
    and (
      brand_filter is null
      or exists (
        select 1
        from public.product_brands as product_brand_filter
        where product_brand_filter.product_id = product.id
          and product_brand_filter.brand_slug = brand_filter
      )
    )
    and (
      vehicle_type_filter is null
      or exists (
        select 1
        from public.product_vehicle_types as product_vehicle_type_filter
        where product_vehicle_type_filter.product_id = product.id
          and product_vehicle_type_filter.vehicle_type_slug = vehicle_type_filter
      )
    )
    and (
      normalized_query.value = ''
      or (
        -- Два условия делают разную работу, и оба нужны.
        --
        -- Первое — одиночный LIKE по первому слову — единственная форма,
        -- которую планировщик умеет свести к GIN-индексу по trgm. Проверено
        -- через EXPLAIN: ни `not exists (... not like ...)`, ни `like all`
        -- (ни с подзапросом, ни с массивом) индексом не покрываются и дают
        -- Seq Scan даже при enable_seqscan = off. Именно поэтому advisor
        -- считал products_search_text_trgm_idx неиспользуемым.
        --
        -- Второе — точная проверка «присутствуют все слова». Первое условие
        -- лишь сужает выборку до надмножества (первое слово входит в набор
        -- обязательных), поэтому семантика не меняется. Эквивалентность
        -- прежней формуле проверена на всех словах и парах слов каталога.
        product.search_text like ('%' || split_part(normalized_query.value, ' ', 1) || '%')
        and product.search_text like all (
          select '%' || word || '%'
          from unnest(string_to_array(normalized_query.value, ' ')) as word
        )
      )
    )
  order by product."order", product.name;
$$;


ALTER FUNCTION "public"."search_catalog_products"("search_query" "text", "category_filter" "text", "subcategory_filter" "text", "brand_filter" "text", "vehicle_type_filter" "text") OWNER TO "postgres";


-- Перестановка порядка одним запросом в транзакции.
--
-- Прежде каждая сортировка отправляла по отдельному UPDATE на запись через
-- Promise.all: при 2000 товарах это 2000 параллельных запросов к PostgREST,
-- исчерпание пула соединений и частичный сбой без отката — порядок оставался
-- в противоречивом состоянии.
--
-- Все reorder-функции используют одну модель: они не перенумеровывают записи
-- подряд, а перераспределяют уже занятые набором значения "order". Набор
-- значений сохраняется, записи вне выборки не затрагиваются. Благодаря этому
-- порядок остаётся сквозным, а перетаскивание работает в любом отфильтрованном
-- или постраничном срезе — иначе при 2000 товарах пришлось бы либо отказаться от
-- сортировки мышью, либо сделать порядок внутрикатегорийным.
--
-- Контракт набора общий (assert_reorder_identifiers) и строгий: NULL, дубликаты,
-- неизвестные и чужие идентификаторы отвергаются до какого-либо изменения.
-- Подкатегории, фотографии и бренды категории дополнительно ограничены
-- родителем, который передаётся явным аргументом.

CREATE OR REPLACE FUNCTION "public"."assert_reorder_identifiers"("identifiers" "anyarray") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if identifiers is null then
    raise exception 'Не передан список порядка.' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(identifiers) as "entry"("id") where "entry"."id" is null) then
    raise exception 'Список порядка содержит пустой идентификатор.' using errcode = '22023';
  end if;

  if (select count(*) from unnest(identifiers) as "entry"("id"))
     <> (select count(distinct "entry"."id") from unnest(identifiers) as "entry"("id")) then
    raise exception 'Список порядка содержит повторяющиеся идентификаторы.' using errcode = '22023';
  end if;
end;
$$;


ALTER FUNCTION "public"."assert_reorder_identifiers"("identifiers" "anyarray") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_products"("ordered_slugs" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "provided" integer;
  "matched" integer;
begin
  perform "public"."assert_reorder_identifiers"("ordered_slugs");
  "provided" := coalesce(array_length("ordered_slugs", 1), 0);
  if "provided" = 0 then return; end if;

  select count(*) into "matched" from "public"."products" where "slug" = any("ordered_slugs");
  if "matched" <> "provided" then
    raise exception 'Список порядка содержит неизвестные товары.' using errcode = '22023';
  end if;

  with "desired" as (
    select "slug", "ordinality" as "position"
    from unnest("ordered_slugs") with ordinality as "u"("slug", "ordinality")
  ), "slots" as (
    select
      "product"."order" as "slot",
      row_number() over (order by "product"."order", "product"."slug") as "position"
    from "public"."products" as "product"
    join "desired" on "desired"."slug" = "product"."slug"
  )
  update "public"."products" as "product"
  set "order" = "slots"."slot"
  from "desired"
  join "slots" on "slots"."position" = "desired"."position"
  where "product"."slug" = "desired"."slug"
    and "product"."order" is distinct from "slots"."slot";
end;
$$;


ALTER FUNCTION "public"."reorder_products"("ordered_slugs" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_brands"("ordered_slugs" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "provided" integer;
  "matched" integer;
begin
  perform "public"."assert_reorder_identifiers"("ordered_slugs");
  "provided" := coalesce(array_length("ordered_slugs", 1), 0);
  if "provided" = 0 then return; end if;

  select count(*) into "matched" from "public"."brands" where "slug" = any("ordered_slugs");
  if "matched" <> "provided" then
    raise exception 'Список порядка содержит неизвестные бренды.' using errcode = '22023';
  end if;

  with "desired" as (
    select "slug", "ordinality" as "position"
    from unnest("ordered_slugs") with ordinality as "u"("slug", "ordinality")
  ), "slots" as (
    select
      "brand"."order" as "slot",
      row_number() over (order by "brand"."order", "brand"."slug") as "position"
    from "public"."brands" as "brand"
    join "desired" on "desired"."slug" = "brand"."slug"
  )
  update "public"."brands" as "brand"
  set "order" = "slots"."slot"
  from "desired"
  join "slots" on "slots"."position" = "desired"."position"
  where "brand"."slug" = "desired"."slug"
    and "brand"."order" is distinct from "slots"."slot";
end;
$$;


ALTER FUNCTION "public"."reorder_brands"("ordered_slugs" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_categories"("ordered_slugs" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "provided" integer;
  "matched" integer;
begin
  perform "public"."assert_reorder_identifiers"("ordered_slugs");
  "provided" := coalesce(array_length("ordered_slugs", 1), 0);
  if "provided" = 0 then return; end if;

  select count(*) into "matched" from "public"."categories" where "slug" = any("ordered_slugs");
  if "matched" <> "provided" then
    raise exception 'Список порядка содержит неизвестные категории.' using errcode = '22023';
  end if;

  with "desired" as (
    select "slug", "ordinality" as "position"
    from unnest("ordered_slugs") with ordinality as "u"("slug", "ordinality")
  ), "slots" as (
    select
      "category"."order" as "slot",
      row_number() over (order by "category"."order", "category"."slug") as "position"
    from "public"."categories" as "category"
    join "desired" on "desired"."slug" = "category"."slug"
  )
  update "public"."categories" as "category"
  set "order" = "slots"."slot"
  from "desired"
  join "slots" on "slots"."position" = "desired"."position"
  where "category"."slug" = "desired"."slug"
    and "category"."order" is distinct from "slots"."slot";
end;
$$;


ALTER FUNCTION "public"."reorder_categories"("ordered_slugs" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_vehicle_types"("ordered_slugs" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "provided" integer;
  "matched" integer;
begin
  perform "public"."assert_reorder_identifiers"("ordered_slugs");
  "provided" := coalesce(array_length("ordered_slugs", 1), 0);
  if "provided" = 0 then return; end if;

  select count(*) into "matched" from "public"."vehicle_types" where "slug" = any("ordered_slugs");
  if "matched" <> "provided" then
    raise exception 'Список порядка содержит неизвестные типы техники.' using errcode = '22023';
  end if;

  with "desired" as (
    select "slug", "ordinality" as "position"
    from unnest("ordered_slugs") with ordinality as "u"("slug", "ordinality")
  ), "slots" as (
    select
      "vehicle_type"."order" as "slot",
      row_number() over (order by "vehicle_type"."order", "vehicle_type"."slug") as "position"
    from "public"."vehicle_types" as "vehicle_type"
    join "desired" on "desired"."slug" = "vehicle_type"."slug"
  )
  update "public"."vehicle_types" as "vehicle_type"
  set "order" = "slots"."slot"
  from "desired"
  join "slots" on "slots"."position" = "desired"."position"
  where "vehicle_type"."slug" = "desired"."slug"
    and "vehicle_type"."order" is distinct from "slots"."slot";
end;
$$;


ALTER FUNCTION "public"."reorder_vehicle_types"("ordered_slugs" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_subcategories"("target_category_slug" "text", "ordered_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "provided" integer;
  "matched" integer;
begin
  perform "public"."assert_reorder_identifiers"("ordered_ids");
  if "target_category_slug" is null then
    raise exception 'Не передана категория для порядка подкатегорий.' using errcode = '22023';
  end if;
  "provided" := coalesce(array_length("ordered_ids", 1), 0);
  if "provided" = 0 then return; end if;

  select count(*) into "matched"
  from "public"."subcategories"
  where "id" = any("ordered_ids") and "category_slug" = "target_category_slug";

  if "matched" <> "provided" then
    raise exception 'Список порядка содержит подкатегории другой категории или несуществующие.' using errcode = '22023';
  end if;

  with "desired" as (
    select "id", "ordinality" as "position"
    from unnest("ordered_ids") with ordinality as "u"("id", "ordinality")
  ), "slots" as (
    select
      "subcategory"."order" as "slot",
      row_number() over (order by "subcategory"."order", "subcategory"."id") as "position"
    from "public"."subcategories" as "subcategory"
    join "desired" on "desired"."id" = "subcategory"."id"
    where "subcategory"."category_slug" = "target_category_slug"
  )
  update "public"."subcategories" as "subcategory"
  set "order" = "slots"."slot"
  from "desired"
  join "slots" on "slots"."position" = "desired"."position"
  where "subcategory"."id" = "desired"."id"
    and "subcategory"."category_slug" = "target_category_slug"
    and "subcategory"."order" is distinct from "slots"."slot";
end;
$$;


ALTER FUNCTION "public"."reorder_subcategories"("target_category_slug" "text", "ordered_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_product_images"("target_product_slug" "text", "ordered_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "target_product_id" "uuid";
  "provided" integer;
  "matched" integer;
begin
  perform "public"."assert_reorder_identifiers"("ordered_ids");
  if "target_product_slug" is null then
    raise exception 'Не передан товар для порядка фотографий.' using errcode = '22023';
  end if;
  "provided" := coalesce(array_length("ordered_ids", 1), 0);
  if "provided" = 0 then return; end if;

  select "id" into "target_product_id" from "public"."products" where "slug" = "target_product_slug";
  if "target_product_id" is null then
    raise exception 'Товар для порядка фотографий не найден.' using errcode = '22023';
  end if;

  select count(*) into "matched"
  from "public"."product_images"
  where "id" = any("ordered_ids") and "product_id" = "target_product_id";

  if "matched" <> "provided" then
    raise exception 'Список порядка содержит фотографии другого товара или несуществующие.' using errcode = '22023';
  end if;

  with "desired" as (
    select "id", "ordinality" as "position"
    from unnest("ordered_ids") with ordinality as "u"("id", "ordinality")
  ), "slots" as (
    select
      "image"."order" as "slot",
      row_number() over (order by "image"."order", "image"."id") as "position"
    from "public"."product_images" as "image"
    join "desired" on "desired"."id" = "image"."id"
    where "image"."product_id" = "target_product_id"
  )
  update "public"."product_images" as "image"
  set "order" = "slots"."slot"
  from "desired"
  join "slots" on "slots"."position" = "desired"."position"
  where "image"."id" = "desired"."id"
    and "image"."product_id" = "target_product_id"
    and "image"."order" is distinct from "slots"."slot";
end;
$$;


ALTER FUNCTION "public"."reorder_product_images"("target_product_slug" "text", "ordered_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_category_brands"("target_category_slug" "text", "ordered_brand_slugs" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "provided" integer;
  "matched" integer;
begin
  perform "public"."assert_reorder_identifiers"("ordered_brand_slugs");
  if "target_category_slug" is null then
    raise exception 'Не передана категория для порядка брендов.' using errcode = '22023';
  end if;
  "provided" := coalesce(array_length("ordered_brand_slugs", 1), 0);
  if "provided" = 0 then return; end if;

  select count(*) into "matched"
  from "public"."category_brands"
  where "brand_slug" = any("ordered_brand_slugs") and "category_slug" = "target_category_slug";

  if "matched" <> "provided" then
    raise exception 'Список порядка содержит бренды, не привязанные к этой категории.' using errcode = '22023';
  end if;

  with "desired" as (
    select "brand_slug", "ordinality" as "position"
    from unnest("ordered_brand_slugs") with ordinality as "u"("brand_slug", "ordinality")
  ), "slots" as (
    select
      "link"."order" as "slot",
      row_number() over (order by "link"."order", "link"."brand_slug") as "position"
    from "public"."category_brands" as "link"
    join "desired" on "desired"."brand_slug" = "link"."brand_slug"
    where "link"."category_slug" = "target_category_slug"
  )
  update "public"."category_brands" as "link"
  set "order" = "slots"."slot"
  from "desired"
  join "slots" on "slots"."position" = "desired"."position"
  where "link"."brand_slug" = "desired"."brand_slug"
    and "link"."category_slug" = "target_category_slug"
    and "link"."order" is distinct from "slots"."slot";
end;
$$;


ALTER FUNCTION "public"."reorder_category_brands"("target_category_slug" "text", "ordered_brand_slugs" "text"[]) OWNER TO "postgres";



-- Создание и редактирование товара выполняются одной транзакцией: строка
-- товара, характеристики, бренды, типы техники и публикация меняются вместе,
-- поэтому частичный товар невозможен без компенсирующей логики. Обновление
-- дополнительно проверяет версию (expected_updated_at) и удерживает строку
-- FOR UPDATE, чтобы правка из устаревшей вкладки не затирала более новую.
--
-- Фотографии сюда не входят: Storage не участвует в транзакции Postgres, его
-- жизненный цикл — предмет отдельной фазы.

CREATE OR REPLACE FUNCTION "public"."resolve_product_references"(
  "p_category_slug" "text",
  "p_subcategory_slug" "text",
  "p_compatible_brands" "text"[],
  "p_vehicle_types" "text"[]
) RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_subcategory_id" "uuid";
begin
  if "p_compatible_brands" is not null
     and array_position("p_compatible_brands", null) is not null then
    raise exception 'Список брендов содержит пустое значение.' using errcode = '22023';
  end if;
  if "p_vehicle_types" is not null
     and array_position("p_vehicle_types", null) is not null then
    raise exception 'Список типов техники содержит пустое значение.' using errcode = '22023';
  end if;

  if (select count(*) from unnest(coalesce("p_compatible_brands", '{}')) as "b"("slug"))
     <> (select count(distinct "b"."slug") from unnest(coalesce("p_compatible_brands", '{}')) as "b"("slug")) then
    raise exception 'Один бренд нельзя выбрать несколько раз.' using errcode = '22023';
  end if;
  if (select count(*) from unnest(coalesce("p_vehicle_types", '{}')) as "v"("slug"))
     <> (select count(distinct "v"."slug") from unnest(coalesce("p_vehicle_types", '{}')) as "v"("slug")) then
    raise exception 'Один тип техники нельзя выбрать несколько раз.' using errcode = '22023';
  end if;

  if not exists (select 1 from "public"."categories" where "slug" = "p_category_slug") then
    raise exception 'Выбранная категория не найдена.' using errcode = '22023';
  end if;

  if (select count(*) from "public"."brands"
      where "slug" = any(coalesce("p_compatible_brands", '{}')))
     <> coalesce(array_length("p_compatible_brands", 1), 0) then
    raise exception 'Один из выбранных брендов не найден.' using errcode = '22023';
  end if;

  if (select count(*) from "public"."vehicle_types"
      where "slug" = any(coalesce("p_vehicle_types", '{}')))
     <> coalesce(array_length("p_vehicle_types", 1), 0) then
    raise exception 'Один из выбранных типов техники не найден.' using errcode = '22023';
  end if;

  if "p_subcategory_slug" is not null and "p_subcategory_slug" <> '' then
    select "id" into "v_subcategory_id"
    from "public"."subcategories"
    where "category_slug" = "p_category_slug" and "slug" = "p_subcategory_slug";

    if "v_subcategory_id" is null then
      raise exception 'Выбранная подкатегория не принадлежит выбранной категории.' using errcode = '22023';
    end if;
  end if;

  return "v_subcategory_id";
end;
$$;


ALTER FUNCTION "public"."resolve_product_references"("p_category_slug" "text", "p_subcategory_slug" "text", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."write_product_characteristics"(
  "p_product_id" "uuid",
  "p_characteristics" "jsonb"
) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if "p_characteristics" is null then
    return;
  end if;
  if jsonb_typeof("p_characteristics") <> 'array' then
    raise exception 'Характеристики должны быть массивом.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements("p_characteristics") as "entry"
    where coalesce(btrim("entry"->>'attribute'), '') = ''
       or coalesce(btrim("entry"->>'value'), '') = ''
  ) then
    raise exception 'Характеристика не может иметь пустое название или значение.' using errcode = '22023';
  end if;

  insert into "public"."product_characteristics" ("product_id", "attribute", "value", "order")
  select
    "p_product_id",
    btrim("entry"->>'attribute'),
    btrim("entry"->>'value'),
    ("ordinality" - 1)::integer
  from jsonb_array_elements("p_characteristics") with ordinality as "t"("entry", "ordinality");
end;
$$;


ALTER FUNCTION "public"."write_product_characteristics"("p_product_id" "uuid", "p_characteristics" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_product_with_relations"(
  "p_slug_base" "text",
  "p_name" "text",
  "p_category_slug" "text",
  "p_subcategory_slug" "text",
  "p_short_description" "text",
  "p_description" "text",
  "p_article" "text",
  "p_published" boolean,
  "p_availability" "public"."product_availability",
  "p_meta_title" "text",
  "p_meta_description" "text",
  "p_characteristics" "jsonb",
  "p_compatible_brands" "text"[],
  "p_vehicle_types" "text"[]
-- Выходные колонки названы out_*: имена RETURNS TABLE становятся переменными
-- PL/pgSQL, и колонка с именем "slug" конфликтовала бы с products.slug внутри
-- цикла подбора уникального значения.
) RETURNS TABLE("out_id" "uuid", "out_slug" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_subcategory_id" "uuid";
  "v_slug" "text";
  "v_base" "text";
  "v_suffix" integer := 2;
  "v_order" integer;
  "v_product_id" "uuid";
begin
  if coalesce(btrim("p_name"), '') = '' then
    raise exception 'Заполните обязательные поля: название, категория.' using errcode = '22023';
  end if;
  if coalesce(btrim("p_category_slug"), '') = '' then
    raise exception 'Заполните обязательные поля: название, категория.' using errcode = '22023';
  end if;

  "v_subcategory_id" := "public"."resolve_product_references"(
    "p_category_slug", "p_subcategory_slug", "p_compatible_brands", "p_vehicle_types"
  );

  "v_base" := coalesce(nullif(btrim("p_slug_base"), ''), 'product');
  "v_slug" := "v_base";
  while exists (select 1 from "public"."products" where "slug" = "v_slug") loop
    "v_slug" := "v_base" || '-' || "v_suffix";
    "v_suffix" := "v_suffix" + 1;
  end loop;

  select coalesce(max("order"), -1) + 1 into "v_order" from "public"."products";

  insert into "public"."products" (
    "slug", "name", "category_slug", "subcategory_id", "short_description", "description",
    "article", "published", "availability", "meta_title", "meta_description", "order"
  ) values (
    "v_slug", btrim("p_name"), "p_category_slug", "v_subcategory_id", "p_short_description",
    "p_description", "p_article", "p_published", "p_availability", "p_meta_title",
    "p_meta_description", "v_order"
  )
  returning "products"."id" into "v_product_id";

  perform "public"."write_product_characteristics"("v_product_id", "p_characteristics");

  insert into "public"."product_brands" ("product_id", "brand_slug")
  select "v_product_id", "b"."slug" from unnest(coalesce("p_compatible_brands", '{}')) as "b"("slug");

  insert into "public"."product_vehicle_types" ("product_id", "vehicle_type_slug")
  select "v_product_id", "v"."slug" from unnest(coalesce("p_vehicle_types", '{}')) as "v"("slug");

  return query select "v_product_id", "v_slug";
end;
$$;


ALTER FUNCTION "public"."create_product_with_relations"("p_slug_base" "text", "p_name" "text", "p_category_slug" "text", "p_subcategory_slug" "text", "p_short_description" "text", "p_description" "text", "p_article" "text", "p_published" boolean, "p_availability" "public"."product_availability", "p_meta_title" "text", "p_meta_description" "text", "p_characteristics" "jsonb", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_product_with_relations"(
  "p_slug" "text",
  "p_expected_updated_at" timestamp with time zone,
  "p_name" "text",
  "p_category_slug" "text",
  "p_subcategory_slug" "text",
  "p_short_description" "text",
  "p_description" "text",
  "p_article" "text",
  "p_published" boolean,
  "p_availability" "public"."product_availability",
  "p_meta_title" "text",
  "p_meta_description" "text",
  "p_characteristics" "jsonb",
  "p_compatible_brands" "text"[],
  "p_vehicle_types" "text"[]
) RETURNS TABLE("out_id" "uuid", "out_updated_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  "v_subcategory_id" "uuid";
  "v_product_id" "uuid";
  "v_current_updated_at" timestamp with time zone;
  "v_new_updated_at" timestamp with time zone;
begin
  if coalesce(btrim("p_name"), '') = '' then
    raise exception 'Заполните обязательные поля: название, категория.' using errcode = '22023';
  end if;
  if coalesce(btrim("p_category_slug"), '') = '' then
    raise exception 'Заполните обязательные поля: название, категория.' using errcode = '22023';
  end if;
  if "p_expected_updated_at" is null then
    raise exception 'Форма не передала версию товара. Обновите страницу и повторите.' using errcode = '22023';
  end if;

  "v_subcategory_id" := "public"."resolve_product_references"(
    "p_category_slug", "p_subcategory_slug", "p_compatible_brands", "p_vehicle_types"
  );

  -- FOR UPDATE удерживает строку до конца транзакции: два параллельных
  -- сохранения выстраиваются в очередь, и второе увидит уже новую версию,
  -- а не перезапишет чужую правку.
  select "products"."id", "products"."updated_at"
    into "v_product_id", "v_current_updated_at"
  from "public"."products"
  where "products"."slug" = "p_slug"
  for update;

  if "v_product_id" is null then
    raise exception 'Товар не найден.' using errcode = '22023';
  end if;

  if "v_current_updated_at" is distinct from "p_expected_updated_at" then
    raise exception 'Товар был изменён другим администратором. Обновите страницу, чтобы увидеть актуальную версию.'
      using errcode = '55000';
  end if;

  "v_new_updated_at" := now();

  -- Публикация записывается здесь же, а не отдельным запросом после связей:
  -- прежде порядок был важен, потому что триггер отвязки хотспотов мог
  -- сработать до сбоя на связях. Внутри транзакции его эффект откатывается
  -- вместе со всем остальным, поэтому разделение больше не нужно.
  update "public"."products" set
    "name" = btrim("p_name"),
    "category_slug" = "p_category_slug",
    "subcategory_id" = "v_subcategory_id",
    "short_description" = "p_short_description",
    "description" = "p_description",
    "article" = "p_article",
    "published" = "p_published",
    "availability" = "p_availability",
    "meta_title" = "p_meta_title",
    "meta_description" = "p_meta_description",
    "updated_at" = "v_new_updated_at"
  where "products"."id" = "v_product_id";

  delete from "public"."product_characteristics" where "product_id" = "v_product_id";
  perform "public"."write_product_characteristics"("v_product_id", "p_characteristics");

  delete from "public"."product_brands" where "product_id" = "v_product_id";
  insert into "public"."product_brands" ("product_id", "brand_slug")
  select "v_product_id", "b"."slug" from unnest(coalesce("p_compatible_brands", '{}')) as "b"("slug");

  delete from "public"."product_vehicle_types" where "product_id" = "v_product_id";
  insert into "public"."product_vehicle_types" ("product_id", "vehicle_type_slug")
  select "v_product_id", "v"."slug" from unnest(coalesce("p_vehicle_types", '{}')) as "v"("slug");

  return query select "v_product_id", "v_new_updated_at";
end;
$$;


ALTER FUNCTION "public"."update_product_with_relations"("p_slug" "text", "p_expected_updated_at" timestamp with time zone, "p_name" "text", "p_category_slug" "text", "p_subcategory_slug" "text", "p_short_description" "text", "p_description" "text", "p_article" "text", "p_published" boolean, "p_availability" "public"."product_availability", "p_meta_title" "text", "p_meta_description" "text", "p_characteristics" "jsonb", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_admin_auth_failure"(
  "p_key_hash" "text",
  "p_scope" "text",
  "p_attempt_at" timestamp with time zone
) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $
declare
  "v_row" "public"."admin_login_rate_limits"%rowtype;
  "v_failed_count" integer;
  "v_window_started_at" timestamp with time zone;
  "v_blocked_until" timestamp with time zone;
begin
  select * into "v_row"
  from "public"."admin_login_rate_limits"
  where "key_hash" = "p_key_hash"
  for update;

  if not found or "v_row"."window_started_at" < "p_attempt_at" - interval '15 minutes' then
    "v_failed_count" := 1;
    "v_window_started_at" := "p_attempt_at";
  else
    "v_failed_count" := "v_row"."failed_count" + 1;
    "v_window_started_at" := "v_row"."window_started_at";
  end if;

  "v_blocked_until" := case
    when "v_failed_count" >= 5 then "p_attempt_at" + interval '15 minutes'
    else null
  end;

  insert into "public"."admin_login_rate_limits" (
    "key_hash", "failed_count", "window_started_at", "last_attempt_at", "blocked_until"
  ) values (
    "p_key_hash", "v_failed_count", "v_window_started_at", "p_attempt_at", "v_blocked_until"
  )
  on conflict ("key_hash") do update
  set "failed_count" = excluded."failed_count",
      "window_started_at" = excluded."window_started_at",
      "last_attempt_at" = excluded."last_attempt_at",
      "blocked_until" = excluded."blocked_until";

  insert into "public"."admin_auth_events" ("scope", "outcome", "attempt_key_hash")
  values ("p_scope", case when "v_blocked_until" is null then 'failure' else 'blocked' end, "p_key_hash");

  if "v_blocked_until" is not null then
    return ceil(extract(epoch from ("v_blocked_until" - "p_attempt_at")))::integer;
  end if;
  return 0;
end;
$;


ALTER FUNCTION "public"."record_admin_auth_failure"("p_key_hash" "text", "p_scope" "text", "p_attempt_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."begin_admin_auth_attempt"(
  "p_key_hash" "text",
  "p_scope" "text",
  "p_ttl_seconds" integer,
  "p_max_concurrent" integer
) RETURNS TABLE("out_allowed" boolean, "out_retry_after" integer, "out_reservation_id" "uuid")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $
declare
  "v_attempt_at" timestamp with time zone := clock_timestamp();
  "v_row" "public"."admin_login_rate_limits"%rowtype;
  "v_active" integer;
  "v_id" "uuid";
  "v_abandoned" record;
begin
  if "p_scope" not in ('login', 'password-change') then
    raise exception 'invalid admin auth scope' using errcode = '22023';
  end if;
  if "p_key_hash" is null or length("p_key_hash") <> 64 then
    raise exception 'invalid admin auth key' using errcode = '22023';
  end if;
  if "p_ttl_seconds" is null or "p_ttl_seconds" <= 0 then
    raise exception 'invalid admin auth reservation ttl' using errcode = '22023';
  end if;
  if "p_max_concurrent" is null or "p_max_concurrent" <= 0 then
    raise exception 'invalid admin auth concurrency budget' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended("p_key_hash", 0));

  -- Сверка брошенных броней этого ключа. Бронь, по которой процесс не вернулся,
  -- означает израсходованный бюджет PBKDF2 с неизвестным исходом; она
  -- засчитывается как неудача. Иначе обрыв соединения на середине стал бы
  -- способом перебирать пароли, не увеличивая счётчик.
  for "v_abandoned" in
    select "id", "scope" from "public"."admin_auth_reservations"
    where "key_hash" = "p_key_hash" and "finished_at" is null and "expires_at" <= "v_attempt_at"
    for update
  loop
    update "public"."admin_auth_reservations"
    set "finished_at" = "v_attempt_at"
    where "id" = "v_abandoned"."id";
    perform "public"."record_admin_auth_failure"("p_key_hash", "v_abandoned"."scope", "v_attempt_at");
  end loop;

  select * into "v_row"
  from "public"."admin_login_rate_limits"
  where "key_hash" = "p_key_hash"
  for update;

  -- Заблокирован — возвращаемся немедленно, до какой-либо дорогой работы.
  if found and "v_row"."blocked_until" is not null and "v_row"."blocked_until" > "v_attempt_at" then
    insert into "public"."admin_auth_events" ("scope", "outcome", "attempt_key_hash")
    values ("p_scope", 'blocked', "p_key_hash");
    return query select false, greatest(1, ceil(extract(epoch from ("v_row"."blocked_until" - "v_attempt_at")))::integer), null::"uuid";
    return;
  end if;

  -- Бюджет одновременности: без него параллельный залп успел бы пройти
  -- проверку счётчика до того, как хоть одна попытка его увеличила.
  select count(*) into "v_active"
  from "public"."admin_auth_reservations"
  where "key_hash" = "p_key_hash" and "finished_at" is null and "expires_at" > "v_attempt_at";

  if "v_active" >= "p_max_concurrent" then
    insert into "public"."admin_auth_events" ("scope", "outcome", "attempt_key_hash")
    values ("p_scope", 'blocked', "p_key_hash");
    return query select false, 1, null::"uuid";
    return;
  end if;

  insert into "public"."admin_auth_reservations" ("key_hash", "scope", "expires_at")
  values ("p_key_hash", "p_scope", "v_attempt_at" + make_interval(secs => "p_ttl_seconds"))
  returning "admin_auth_reservations"."id" into "v_id";

  return query select true, 0, "v_id";
end;
$;


ALTER FUNCTION "public"."begin_admin_auth_attempt"("p_key_hash" "text", "p_scope" "text", "p_ttl_seconds" integer, "p_max_concurrent" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finish_admin_auth_attempt"(
  "p_reservation_id" "uuid",
  "p_password_is_valid" boolean
) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $
declare
  "v_attempt_at" timestamp with time zone := clock_timestamp();
  "v_reservation" "public"."admin_auth_reservations"%rowtype;
begin
  if "p_reservation_id" is null then
    raise exception 'missing admin auth reservation' using errcode = '22023';
  end if;

  select * into "v_reservation"
  from "public"."admin_auth_reservations"
  where "id" = "p_reservation_id";

  -- Неизвестная бронь: сообщаем ошибкой, а не молча успехом — вызывающий обязан
  -- закрыться fail-closed, иначе исчезновение учёта выглядело бы как успех.
  if not found then
    raise exception 'unknown admin auth reservation' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended("v_reservation"."key_hash", 0));

  -- Уже завершена (повтор или сверка успела засчитать её как брошенную) —
  -- второй раз не учитываем.
  if "v_reservation"."finished_at" is not null then
    return 0;
  end if;

  update "public"."admin_auth_reservations"
  set "finished_at" = "v_attempt_at"
  where "id" = "p_reservation_id";

  if "p_password_is_valid" then
    delete from "public"."admin_login_rate_limits" where "key_hash" = "v_reservation"."key_hash";
    insert into "public"."admin_auth_events" ("scope", "outcome", "attempt_key_hash")
    values ("v_reservation"."scope", 'success', "v_reservation"."key_hash");
    return 0;
  end if;

  return "public"."record_admin_auth_failure"("v_reservation"."key_hash", "v_reservation"."scope", "v_attempt_at");
end;
$;


ALTER FUNCTION "public"."finish_admin_auth_attempt"("p_reservation_id" "uuid", "p_password_is_valid" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_product_image_staging"(
  "p_draft_id" "uuid",
  "p_object_path" "text",
  "p_content_type" "text",
  "p_byte_size" bigint,
  "p_ttl_seconds" integer,
  "p_max_files" integer
) RETURNS TABLE("out_id" "uuid", "out_expires_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $
declare
  "v_active" integer;
  "v_expires_at" timestamp with time zone;
  "v_id" "uuid";
begin
  if "p_draft_id" is null then
    raise exception 'Не передан идентификатор сессии загрузки.' using errcode = '22023';
  end if;
  if coalesce(btrim("p_object_path"), '') = '' then
    raise exception 'Не передан путь файла.' using errcode = '22023';
  end if;
  if "p_ttl_seconds" is null or "p_ttl_seconds" <= 0 then
    raise exception 'Некорректный срок хранения.' using errcode = '22023';
  end if;
  if "p_max_files" is null or "p_max_files" <= 0 then
    raise exception 'Некорректный лимит количества файлов.' using errcode = '22023';
  end if;

  -- Считаем только незавершённые и непросроченные: просроченные всё равно
  -- будут убраны и не должны блокировать работу.
  select count(*) into "v_active"
  from "public"."product_image_staging"
  where "draft_id" = "p_draft_id"
    and "finalized_at" is null
    and "expires_at" > now();

  if "v_active" >= "p_max_files" then
    raise exception 'Можно загрузить не более % фотографий товара.', "p_max_files" using errcode = '22023';
  end if;

  "v_expires_at" := now() + make_interval(secs => "p_ttl_seconds");

  insert into "public"."product_image_staging" (
    "draft_id", "object_path", "content_type", "byte_size", "expires_at"
  ) values (
    "p_draft_id", btrim("p_object_path"), "p_content_type", "p_byte_size", "v_expires_at"
  )
  returning "product_image_staging"."id" into "v_id";

  return query select "v_id", "v_expires_at";
end;
$;


ALTER FUNCTION "public"."claim_product_image_staging"("p_draft_id" "uuid", "p_object_path" "text", "p_content_type" "text", "p_byte_size" bigint, "p_ttl_seconds" integer, "p_max_files" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_abandoned_product_image_staging"("p_limit" integer DEFAULT 100)
RETURNS TABLE("out_id" "uuid", "out_object_path" "text")
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $
  select "id", "object_path"
  from "public"."product_image_staging"
  where "finalized_at" is null and "expires_at" <= now()
  order by "expires_at"
  limit greatest(coalesce("p_limit", 100), 1);
$;


ALTER FUNCTION "public"."list_abandoned_product_image_staging"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."release_product_image_staging"("p_ids" "uuid"[])
RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $
declare
  "v_deleted" integer;
begin
  if "p_ids" is null or coalesce(array_length("p_ids", 1), 0) = 0 then
    return 0;
  end if;

  delete from "public"."product_image_staging" where "id" = any("p_ids");
  get diagnostics "v_deleted" = row_count;
  return "v_deleted";
end;
$;


ALTER FUNCTION "public"."release_product_image_staging"("p_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_product_image_staging"("p_id" "uuid")
RETURNS boolean
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $
declare
  "v_updated" integer;
begin
  update "public"."product_image_staging"
  set "finalized_at" = now()
  where "id" = "p_id" and "finalized_at" is null;

  get diagnostics "v_updated" = row_count;
  return "v_updated" > 0;
end;
$;


ALTER FUNCTION "public"."finalize_product_image_staging"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_vehicle_hotspots"("target_vehicle_type_slug" "text", "hotspot_updates" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  target_hotspot_count integer;
  submitted_count integer;
  distinct_submitted_count integer;
  matching_count integer;
  blank_label_count integer;
  invalid_product_count integer;
begin
  if nullif(btrim(target_vehicle_type_slug), '') is null then
    raise exception 'Vehicle type is required' using errcode = 'P0001';
  end if;

  if jsonb_typeof(hotspot_updates) is distinct from 'array' then
    raise exception 'Hotspot updates must be an array' using errcode = 'P0001';
  end if;

  -- Keep the same products -> hotspots lock order as quick assignments and
  -- the product-unpublish trigger. Product locks also prevent a selected
  -- product from becoming unpublished between validation and assignment.
  perform product.id
  from public.products as product
  join (
    select distinct nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  ) as desired on desired.product_id = product.id
  where desired.product_id is not null
  order by product.id
  for update of product;

  perform hotspot.id
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_vehicle_type_slug
  order by hotspot.id
  for update of hotspot;

  select count(*)
  into target_hotspot_count
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_vehicle_type_slug;

  if target_hotspot_count <> 5 then
    raise exception 'Vehicle type must have exactly five hotspots' using errcode = 'P0001';
  end if;

  with submitted as (
    select
      (entry.value ->> 'id')::uuid as id,
      entry.value ->> 'label' as label,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  )
  select
    count(*),
    count(distinct submitted.id),
    count(*) filter (where nullif(btrim(submitted.label), '') is null)
  into submitted_count, distinct_submitted_count, blank_label_count
  from submitted;

  if submitted_count <> 5 or distinct_submitted_count <> 5 then
    raise exception 'Exactly five distinct hotspot ids are required' using errcode = 'P0001';
  end if;

  if blank_label_count <> 0 then
    raise exception 'Hotspot labels cannot be blank' using errcode = 'P0001';
  end if;

  with submitted as (
    select (entry.value ->> 'id')::uuid as id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  )
  select count(*)
  into matching_count
  from public.vehicle_hotspots as hotspot
  join submitted on submitted.id = hotspot.id
  where hotspot.vehicle_type_slug = target_vehicle_type_slug;

  if matching_count <> 5 then
    raise exception 'Submitted hotspot ids must exactly match the selected vehicle type' using errcode = 'P0001';
  end if;

  with submitted as (
    select nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  )
  select count(*)
  into invalid_product_count
  from submitted
  left join public.products as product on product.id = submitted.product_id
  where submitted.product_id is not null
    and (product.id is null or product.published is false);

  if invalid_product_count <> 0 then
    raise exception 'Every selected product must be published' using errcode = 'P0001';
  end if;

  update public.vehicle_hotspots as hotspot
  set product_id = null
  where hotspot.vehicle_type_slug = target_vehicle_type_slug
    and hotspot.product_id is not null;

  with submitted as (
    select
      (entry.value ->> 'id')::uuid as id,
      btrim(entry.value ->> 'label') as label,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  )
  update public.vehicle_hotspots as hotspot
  set
    label = submitted.label,
    product_id = submitted.product_id
  from submitted
  where hotspot.id = submitted.id;
end;
$$;


ALTER FUNCTION "public"."update_vehicle_hotspots"("target_vehicle_type_slug" "text", "hotspot_updates" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_vehicle_hotspot_assignments"("assignment_updates" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SECURITY INVOKER
    SET "search_path" TO ''
    AS $$
declare
  submitted_count integer;
  distinct_hotspot_count integer;
  locked_hotspot_count integer;
  matching_state_count integer;
  invalid_product_count integer;
begin
  if jsonb_typeof(assignment_updates) is distinct from 'array' then
    raise exception 'Hotspot assignment updates must be an array' using errcode = 'P0001';
  end if;

  submitted_count := jsonb_array_length(assignment_updates);
  if submitted_count < 1 or submitted_count > 2 then
    raise exception 'One or two hotspot assignment updates are required' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(assignment_updates) as entry(value)
    where case
      when jsonb_typeof(entry.value) is distinct from 'object' then true
      else
        not (entry.value ?& array['hotspotId', 'expectedProductId', 'productId'])
        or (select count(*) from jsonb_object_keys(entry.value)) <> 3
        or jsonb_typeof(entry.value -> 'hotspotId') is distinct from 'string'
        or jsonb_typeof(entry.value -> 'expectedProductId') not in ('string', 'null')
        or jsonb_typeof(entry.value -> 'productId') not in ('string', 'null')
      end
  ) then
    raise exception 'Each hotspot assignment update must contain exactly hotspotId, expectedProductId, and productId' using errcode = 'P0001';
  end if;

  with submitted as (
    select (entry.value ->> 'hotspotId')::uuid as hotspot_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  select count(distinct submitted.hotspot_id)
  into distinct_hotspot_count
  from submitted;

  if distinct_hotspot_count <> submitted_count then
    raise exception 'Hotspot assignment ids must be distinct' using errcode = 'P0001';
  end if;

  -- Product rows are locked first to match the products -> hotspot lock order
  -- used by the unpublish trigger. Sorting every lock set prevents two quick
  -- actions that touch the same rows in reverse order from deadlocking.
  perform product.id
  from public.products as product
  join (
    select distinct product_id
    from (
      select nullif(entry.value ->> 'expectedProductId', '')::uuid as product_id
      from jsonb_array_elements(assignment_updates) as entry(value)
      union
      select nullif(entry.value ->> 'productId', '')::uuid as product_id
      from jsonb_array_elements(assignment_updates) as entry(value)
    ) as referenced_products
    where product_id is not null
  ) as referenced on referenced.product_id = product.id
  order by product.id
  for update of product;

  perform hotspot.id
  from public.vehicle_hotspots as hotspot
  join (
    select (entry.value ->> 'hotspotId')::uuid as hotspot_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  ) as submitted on submitted.hotspot_id = hotspot.id
  order by hotspot.id
  for update of hotspot;

  with submitted as (
    select (entry.value ->> 'hotspotId')::uuid as hotspot_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  select count(*)
  into locked_hotspot_count
  from public.vehicle_hotspots as hotspot
  join submitted on submitted.hotspot_id = hotspot.id;

  if locked_hotspot_count <> submitted_count then
    raise exception 'Every selected hotspot must exist' using errcode = 'P0001';
  end if;

  with submitted as (
    select
      (entry.value ->> 'hotspotId')::uuid as hotspot_id,
      nullif(entry.value ->> 'expectedProductId', '')::uuid as expected_product_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  select count(*)
  into matching_state_count
  from public.vehicle_hotspots as hotspot
  join submitted
    on submitted.hotspot_id = hotspot.id
    and submitted.expected_product_id is not distinct from hotspot.product_id;

  if matching_state_count <> submitted_count then
    raise exception 'Hotspot assignment state has changed' using errcode = 'P0001';
  end if;

  with submitted as (
    select nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  select count(*)
  into invalid_product_count
  from submitted
  left join public.products as product on product.id = submitted.product_id
  where submitted.product_id is not null
    and (product.id is null or product.published is false);

  if invalid_product_count <> 0 then
    raise exception 'Every selected product must be published' using errcode = 'P0001';
  end if;

  with submitted as (
    select (entry.value ->> 'hotspotId')::uuid as hotspot_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  update public.vehicle_hotspots as hotspot
  set product_id = null
  from submitted
  where hotspot.id = submitted.hotspot_id
    and hotspot.product_id is not null;

  with submitted as (
    select
      (entry.value ->> 'hotspotId')::uuid as hotspot_id,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(assignment_updates) as entry(value)
  )
  update public.vehicle_hotspots as hotspot
  set product_id = submitted.product_id
  from submitted
  where hotspot.id = submitted.hotspot_id
    and submitted.product_id is not null;
end;
$$;


ALTER FUNCTION "public"."update_vehicle_hotspot_assignments"("assignment_updates" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_vehicle_hotspots"("target_vehicle_type_slug" "text", "expected_hotspot_updates" "jsonb", "prior_hotspot_updates" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  expected_count integer;
  distinct_expected_count integer;
  matching_count integer;
begin
  if nullif(btrim(target_vehicle_type_slug), '') is null then
    raise exception 'Vehicle type is required' using errcode = 'P0001';
  end if;

  if jsonb_typeof(expected_hotspot_updates) is distinct from 'array' then
    raise exception 'Expected hotspot updates must be an array' using errcode = 'P0001';
  end if;

  -- Lock both the saved and restored product sets before hotspot rows. This
  -- matches update_vehicle_hotspots and keeps Undo out of the reverse-order
  -- deadlock cycle with quick assignments and product unpublishing.
  perform product.id
  from public.products as product
  join (
    select distinct product_id
    from (
      select nullif(entry.value ->> 'productId', '')::uuid as product_id
      from jsonb_array_elements(expected_hotspot_updates) as entry(value)
      union
      select nullif(entry.value ->> 'productId', '')::uuid as product_id
      from jsonb_array_elements(prior_hotspot_updates) as entry(value)
    ) as referenced_products
    where product_id is not null
  ) as referenced on referenced.product_id = product.id
  order by product.id
  for update of product;

  perform hotspot.id
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_vehicle_type_slug
  order by hotspot.id
  for update of hotspot;

  with expected as (
    select
      (entry.value ->> 'id')::uuid as id,
      entry.value ->> 'label' as label,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(expected_hotspot_updates) as entry(value)
  )
  select count(*), count(distinct expected.id)
  into expected_count, distinct_expected_count
  from expected;

  if expected_count <> 5 or distinct_expected_count <> 5 then
    raise exception 'Expected hotspot snapshot must contain exactly five distinct rows' using errcode = 'P0001';
  end if;

  with expected as (
    select
      (entry.value ->> 'id')::uuid as id,
      entry.value ->> 'label' as label,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(expected_hotspot_updates) as entry(value)
  )
  select count(*)
  into matching_count
  from public.vehicle_hotspots as hotspot
  join expected
    on expected.id = hotspot.id
    and expected.label = hotspot.label
    and expected.product_id is not distinct from hotspot.product_id
  where hotspot.vehicle_type_slug = target_vehicle_type_slug;

  if matching_count <> 5 then
    raise exception 'Hotspot state has changed since this batch was saved' using errcode = 'P0001';
  end if;

  perform public.update_vehicle_hotspots(target_vehicle_type_slug, prior_hotspot_updates);
end;
$$;


ALTER FUNCTION "public"."restore_vehicle_hotspots"("target_vehicle_type_slug" "text", "expected_hotspot_updates" "jsonb", "prior_hotspot_updates" "jsonb") OWNER TO "postgres";


-- Пакетный импорт из CSV (админка, /admin/import). Каждая строка построчно
-- изолирована собственным EXCEPTION-блоком: одна некорректная строка не
-- откатывает весь пакет и не прерывает остальные — вместо этого попадает в
-- отчёт с action = 'error'. Структурная валидация (обязательные поля,
-- существование категории/подкатегории/бренда/типа техники) сделана заранее
-- на стороне TypeScript, где уже есть в памяти полные справочники — здесь же
-- защита на случай гонки (запись удалили между предпросмотром и подтверждением)
-- или иной ошибки на уровне БД.
--
-- Сопоставление с существующим товаром — по slug (уникальный) с ON CONFLICT:
-- для строки с найденным по артикулу товаром TypeScript передаёт его текущий
-- slug, для новой строки — сгенерированный уникальный. product.article не
-- уникален на уровне БД, поэтому сама логика подбора ключа сопоставления
-- (article -> slug) сделана на стороне вызывающего кода, а не здесь.
CREATE FUNCTION "public"."import_products_batch"("rows" "jsonb") RETURNS TABLE("row_index" integer, "slug" "text", "action" "text", "error_message" "text")
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
-- RETURNS TABLE делает row_index/slug/action/error_message переменными
-- PL/pgSQL. "slug" при этом совпадает с именем колонки products.slug, и в
-- embedded SQL (список колонок INSERT, "on conflict (slug)") срабатывает
-- plpgsql_variable_conflict = error — тот же класс проблемы, что и с
-- product_id выше, только для этого имени переименование неуместно: это
-- осознанное имя выходной колонки отчёта. Прагма явно отдаёт приоритет
-- колонке внутри embedded SQL; на обычные присваивания вида "slug :=
-- current_slug" (не SQL, а чистый PL/pgSQL) она не влияет — там переменная
-- остаётся переменной, как и задумано.
declare
  row_data jsonb;
  current_row_index integer;
  current_slug text;
  -- Не "product_id": так называется колонка в product_brands/
  -- product_vehicle_types/product_characteristics, и внутри неквалифицированного
  -- запроса PL/pgSQL предпочитает колонку переменной — "where product_id =
  -- product_id" превратилось бы в тавтологию и удаляло бы всю таблицу целиком
  -- вместо строк одного товара. Тот же класс ошибки, что и current_time в
  -- register_admin_login_attempt (SET search_path не спасает: это не
  -- зарезервированное слово SQL, а обычное разрешение имён PL/pgSQL).
  target_product_id uuid;
  was_inserted boolean;
begin
  for row_data in select value from jsonb_array_elements(rows) as value loop
    current_row_index := (row_data->>'row_index')::integer;
    current_slug := row_data->>'slug';

    begin
      insert into public.products as product (
        slug, name, category_slug, subcategory_id, short_description, description, article, published
      )
      values (
        current_slug,
        row_data->>'name',
        row_data->>'category_slug',
        nullif(row_data->>'subcategory_id', '')::uuid,
        row_data->>'short_description',
        nullif(row_data->>'description', ''),
        nullif(row_data->>'article', ''),
        coalesce((row_data->>'published')::boolean, true)
      )
      on conflict (slug) do update set
        name = excluded.name,
        category_slug = excluded.category_slug,
        subcategory_id = excluded.subcategory_id,
        short_description = excluded.short_description,
        description = excluded.description,
        article = excluded.article,
        published = excluded.published,
        updated_at = now()
      returning product.id, (product.xmax = 0) into target_product_id, was_inserted;

      delete from public.product_brands as existing_brand
      where existing_brand.product_id = target_product_id;
      insert into public.product_brands (product_id, brand_slug)
      select target_product_id, brand_slug.value
      from jsonb_array_elements_text(coalesce(row_data->'brand_slugs', '[]'::jsonb)) as brand_slug(value);

      delete from public.product_vehicle_types as existing_vehicle_type
      where existing_vehicle_type.product_id = target_product_id;
      insert into public.product_vehicle_types (product_id, vehicle_type_slug)
      select target_product_id, vehicle_type_slug.value
      from jsonb_array_elements_text(coalesce(row_data->'vehicle_type_slugs', '[]'::jsonb)) as vehicle_type_slug(value);

      delete from public.product_characteristics as existing_characteristic
      where existing_characteristic.product_id = target_product_id;
      -- "with ordinality as characteristic" без списка колонок сделал бы
      -- characteristic анонимной записью из двух полей (jsonb-элемент +
      -- номер), а не самим jsonb — тогда characteristic->>'attribute' упал бы
      -- с "operator does not exist: record ->> unknown". Явные имена колонок,
      -- как в reorder_products.
      insert into public.product_characteristics (product_id, attribute, value, "order")
      select target_product_id, characteristic.element->>'attribute', characteristic.element->>'value', (characteristic.position - 1)::integer
      from jsonb_array_elements(coalesce(row_data->'characteristics', '[]'::jsonb)) with ordinality as characteristic(element, position);

      row_index := current_row_index;
      slug := current_slug;
      action := case when was_inserted then 'created' else 'updated' end;
      error_message := null;
      return next;
    exception when others then
      row_index := current_row_index;
      slug := current_slug;
      action := 'error';
      error_message := sqlerrm;
      return next;
    end;
  end loop;
end;
$$;


ALTER FUNCTION "public"."import_products_batch"("rows" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_audit_log" (
    "id" bigint NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "actor" "text" NOT NULL,
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_key" "text",
    "changed_fields" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "old_values" "jsonb",
    "new_values" "jsonb",
    CONSTRAINT "admin_audit_log_action_check" CHECK (("action" = ANY (ARRAY['INSERT'::"text", 'UPDATE'::"text", 'DELETE'::"text"])))
);


ALTER TABLE "public"."admin_audit_log" OWNER TO "postgres";


ALTER TABLE "public"."admin_audit_log" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."admin_audit_log_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


CREATE TABLE IF NOT EXISTS "public"."admin_auth_events" (
    "id" bigint NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "scope" "text" NOT NULL,
    "outcome" "text" NOT NULL,
    "attempt_key_hash" "text" NOT NULL,
    CONSTRAINT "admin_auth_events_scope_check" CHECK (("scope" = ANY (ARRAY['login'::"text", 'password-change'::"text"]))),
    CONSTRAINT "admin_auth_events_outcome_check" CHECK (("outcome" = ANY (ARRAY['success'::"text", 'failure'::"text", 'blocked'::"text"]))),
    -- QA-014: имя не выдумано, а взято из базы. В миграции этот CHECK объявлен
    -- безымянно прямо на колонке, и имя ему присваивает Postgres по правилу
    -- «таблица_колонка_check». Здесь стояло `admin_auth_events_key_hash_check`
    -- — такого констрейнта не существует.
    CONSTRAINT "admin_auth_events_attempt_key_hash_check" CHECK (("length"("attempt_key_hash") = 64))
);


ALTER TABLE "public"."admin_auth_events" OWNER TO "postgres";


ALTER TABLE "public"."admin_auth_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."admin_auth_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."admin_auth_reservations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "key_hash" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "finished_at" timestamp with time zone,
    CONSTRAINT "admin_auth_reservations_scope_check" CHECK (("scope" = ANY (ARRAY['login'::"text", 'password-change'::"text"]))),
    CONSTRAINT "admin_auth_reservations_key_hash_check" CHECK (("length"("key_hash") = 64)),
    CONSTRAINT "admin_auth_reservations_expiry_check" CHECK (("expires_at" > "created_at"))
);

ALTER TABLE "public"."admin_auth_reservations" OWNER TO "postgres";

ALTER TABLE ONLY "public"."admin_auth_reservations"
    ADD CONSTRAINT "admin_auth_reservations_pkey" PRIMARY KEY ("id");

-- Частичный индекс: и подсчёт занятых броней, и сверка просроченных смотрят
-- только на незавершённые.
CREATE INDEX "admin_auth_reservations_active_idx"
    ON "public"."admin_auth_reservations" USING "btree" ("key_hash", "expires_at")
    WHERE ("finished_at" IS NULL);

ALTER TABLE "public"."admin_auth_reservations" ENABLE ROW LEVEL SECURITY;


-- QA-014: таблица создана миграцией 20260821171707_admin_credentials, но в этот
-- файл её так и не перенесли. Файл не выполняется, поэтому на саму базу пропажа
-- не влияла — опасность в другом: он служит входом для генерации будущих
-- миграций, и `supabase db diff` на разошедшемся файле выписал бы миграцию,
-- УДАЛЯЮЩУЮ таблицу с хешем пароля администратора.
CREATE TABLE IF NOT EXISTS "public"."admin_credentials" (
    "credential_key" "text" NOT NULL,
    "password_hash" "text" NOT NULL,
    "session_version" bigint NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_credentials_session_version_check" CHECK (("session_version" >= 2)),
    CONSTRAINT "admin_credentials_singleton_check" CHECK (("credential_key" = 'primary'::"text"))
);

ALTER TABLE "public"."admin_credentials" OWNER TO "postgres";

ALTER TABLE ONLY "public"."admin_credentials"
    ADD CONSTRAINT "admin_credentials_pkey" PRIMARY KEY ("credential_key");

ALTER TABLE "public"."admin_credentials" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."admin_credentials" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."admin_credentials" TO "service_role";


CREATE TABLE IF NOT EXISTS "public"."admin_login_rate_limits" (
    "key_hash" "text" NOT NULL,
    "failed_count" integer DEFAULT 0 NOT NULL,
    "window_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "blocked_until" timestamp with time zone,
    CONSTRAINT "admin_login_rate_limits_failed_count_check" CHECK (("failed_count" >= 0))
);


ALTER TABLE "public"."admin_login_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."brands" (
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "country" "text" NOT NULL,
    "logo" "text" NOT NULL,
    "logo_scale" numeric,
    "order" integer DEFAULT 0 NOT NULL,
    "aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "brands_logo_scale_bounds_check" CHECK ((("logo_scale" IS NULL) OR (("logo_scale" >= 0.1) AND ("logo_scale" <= 5.0))))
);


ALTER TABLE "public"."brands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "icon" "text" NOT NULL,
    "image" "text" NOT NULL,
    "intro" "text",
    "type" "text",
    "order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "categories_type_check" CHECK ((("type" IS NULL) OR ("type" = ANY (ARRAY['subcategory'::"text", 'brand'::"text"]))))
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."category_brands" (
    "category_slug" "text" NOT NULL,
    "brand_slug" "text" NOT NULL,
    "logo_scale_override" numeric,
    "order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "category_brands_logo_scale_override_bounds_check" CHECK ((("logo_scale_override" IS NULL) OR (("logo_scale_override" >= 0.1) AND ("logo_scale_override" <= 5.0))))
);


ALTER TABLE "public"."category_brands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_brands" (
    "product_id" "uuid" NOT NULL,
    "brand_slug" "text" NOT NULL
);


ALTER TABLE "public"."product_brands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_characteristics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "attribute" "text" NOT NULL,
    "value" "text" NOT NULL,
    "order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."product_characteristics" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_image_staging" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    -- Одна сессия формы: позволяет ограничить количество файлов и убрать всё
    -- разом, если админ отменил создание товара.
    "draft_id" "uuid" NOT NULL,
    "object_path" "text" NOT NULL,
    "content_type" "text" NOT NULL,
    "byte_size" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    -- Проставляется, когда файл успешно перенесён в публичное хранилище и
    -- привязан к товару. Такая строка больше не подлежит уборке по сроку.
    "finalized_at" timestamp with time zone,
    CONSTRAINT "product_image_staging_byte_size_check" CHECK ((("byte_size" > 0) AND ("byte_size" <= 8388608))),
    CONSTRAINT "product_image_staging_expiry_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "product_image_staging_content_type_check" CHECK (("content_type" = ANY (ARRAY['image/jpeg'::"text", 'image/png'::"text", 'image/webp'::"text", 'image/avif'::"text"])))
);


ALTER TABLE "public"."product_image_staging" OWNER TO "postgres";

ALTER TABLE ONLY "public"."product_image_staging"
    ADD CONSTRAINT "product_image_staging_pkey" PRIMARY KEY ("id");

-- Путь в хранилище уникален: повторная выдача ссылки на тот же путь не должна
-- создавать вторую учётную запись, иначе один файл посчитается дважды.
ALTER TABLE ONLY "public"."product_image_staging"
    ADD CONSTRAINT "product_image_staging_object_path_key" UNIQUE ("object_path");

CREATE INDEX "product_image_staging_draft_idx" ON "public"."product_image_staging" USING "btree" ("draft_id");

-- Частичный индекс: уборку интересуют только незавершённые записи.
CREATE INDEX "product_image_staging_expiry_idx" ON "public"."product_image_staging" USING "btree" ("expires_at") WHERE ("finalized_at" IS NULL);

ALTER TABLE "public"."product_image_staging" ENABLE ROW LEVEL SECURITY;


CREATE TABLE IF NOT EXISTS "public"."product_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "order" integer DEFAULT 0 NOT NULL,
    "scale" numeric,
    "thumbnail_url" "text",
    "gallery_url" "text",
    CONSTRAINT "product_images_scale_bounds_check" CHECK ((("scale" IS NULL) OR (("scale" >= 0.1) AND ("scale" <= 5.0)))),
    CONSTRAINT "product_images_variants_both_or_neither_check" CHECK ((("thumbnail_url" IS NULL) = ("gallery_url" IS NULL)))
);


ALTER TABLE "public"."product_images" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_vehicle_types" (
    "product_id" "uuid" NOT NULL,
    "vehicle_type_slug" "text" NOT NULL
);


ALTER TABLE "public"."product_vehicle_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "category_slug" "text" NOT NULL,
    "subcategory_id" "uuid",
    "short_description" "text" NOT NULL,
    "description" "text",
    "article" "text",
    "published" boolean DEFAULT true NOT NULL,
    "availability" "public"."product_availability" DEFAULT 'in_stock'::"public"."product_availability" NOT NULL,
    "order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_text" "text" DEFAULT ''::"text" NOT NULL,
    "meta_title" "text",
    "meta_description" "text"
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subcategories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "category_slug" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "image" "text" NOT NULL,
    "intro" "text",
    "order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."subcategories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_hotspots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "vehicle_type_slug" "text" NOT NULL,
    "hotspot_number" smallint NOT NULL,
    "label" "text" NOT NULL,
    "x_pct" numeric(5,2) NOT NULL,
    "y_pct" numeric(5,2) NOT NULL,
    "product_id" "uuid",
    CONSTRAINT "vehicle_hotspots_hotspot_number_check" CHECK ((("hotspot_number" >= 1) AND ("hotspot_number" <= 5)))
);


ALTER TABLE "public"."vehicle_hotspots" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_types" (
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."vehicle_types" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_audit_log"
    ADD CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id");


ALTER TABLE ONLY "public"."admin_auth_events"
    ADD CONSTRAINT "admin_auth_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_login_rate_limits"
    ADD CONSTRAINT "admin_login_rate_limits_pkey" PRIMARY KEY ("key_hash");



ALTER TABLE ONLY "public"."brands"
    ADD CONSTRAINT "brands_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."category_brands"
    ADD CONSTRAINT "category_brands_pkey" PRIMARY KEY ("category_slug", "brand_slug");



ALTER TABLE ONLY "public"."product_brands"
    ADD CONSTRAINT "product_brands_pkey" PRIMARY KEY ("product_id", "brand_slug");



ALTER TABLE ONLY "public"."product_characteristics"
    ADD CONSTRAINT "product_characteristics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_images"
    ADD CONSTRAINT "product_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_vehicle_types"
    ADD CONSTRAINT "product_vehicle_types_pkey" PRIMARY KEY ("product_id", "vehicle_type_slug");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."subcategories"
    ADD CONSTRAINT "subcategories_category_slug_slug_key" UNIQUE ("category_slug", "slug");



ALTER TABLE ONLY "public"."subcategories"
    ADD CONSTRAINT "subcategories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_hotspots"
    ADD CONSTRAINT "vehicle_hotspots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vehicle_hotspots"
    ADD CONSTRAINT "vehicle_hotspots_vehicle_type_slug_hotspot_number_key" UNIQUE ("vehicle_type_slug", "hotspot_number");



ALTER TABLE ONLY "public"."vehicle_types"
    ADD CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("slug");



CREATE INDEX "admin_audit_log_entity_idx" ON "public"."admin_audit_log" USING "btree" ("entity_type", "entity_key", "occurred_at" DESC);



CREATE INDEX "admin_audit_log_occurred_at_idx" ON "public"."admin_audit_log" USING "btree" ("occurred_at" DESC);


CREATE INDEX "admin_auth_events_occurred_at_idx" ON "public"."admin_auth_events" USING "btree" ("occurred_at" DESC);


CREATE INDEX "admin_auth_events_attempt_key_idx" ON "public"."admin_auth_events" USING "btree" ("attempt_key_hash", "occurred_at" DESC);



CREATE INDEX "admin_login_rate_limits_last_attempt_idx" ON "public"."admin_login_rate_limits" USING "btree" ("last_attempt_at");



CREATE INDEX "brands_aliases_idx" ON "public"."brands" USING "gin" ("aliases");



-- Внешний ключ без покрывающего индекса: каждая проверка ссылочной целостности
-- при изменении brands сканирует category_brands целиком. Отмечено advisor'ом
-- Supabase (unindexed_foreign_keys).
CREATE INDEX "category_brands_brand_slug_idx" ON "public"."category_brands" USING "btree" ("brand_slug");



CREATE INDEX "product_brands_brand_slug_idx" ON "public"."product_brands" USING "btree" ("brand_slug");



CREATE INDEX "product_characteristics_product_id_idx" ON "public"."product_characteristics" USING "btree" ("product_id");



CREATE INDEX "product_images_product_id_idx" ON "public"."product_images" USING "btree" ("product_id");



CREATE INDEX "product_vehicle_types_slug_idx" ON "public"."product_vehicle_types" USING "btree" ("vehicle_type_slug");



CREATE INDEX "products_article_trgm_idx" ON "public"."products" USING "gin" (COALESCE("article", ''::"text") "extensions"."gin_trgm_ops");



CREATE INDEX "products_category_published_order_idx" ON "public"."products" USING "btree" ("category_slug", "published", "order");



CREATE INDEX "products_category_slug_idx" ON "public"."products" USING "btree" ("category_slug");



CREATE INDEX "products_name_trgm_idx" ON "public"."products" USING "gin" ("name" "extensions"."gin_trgm_ops");



CREATE INDEX "products_published_order_idx" ON "public"."products" USING "btree" ("published", "order", "name");



CREATE INDEX "products_search_text_trgm_idx" ON "public"."products" USING "gin" ("search_text" "extensions"."gin_trgm_ops");



CREATE INDEX "products_subcategory_id_idx" ON "public"."products" USING "btree" ("subcategory_id");



CREATE INDEX "vehicle_hotspots_vehicle_type_slug_idx" ON "public"."vehicle_hotspots" USING "btree" ("vehicle_type_slug");



-- Один товар может использоваться на нескольких точках. Обычный индекс
-- сохраняет быстрые выборки и массовую отвязку по внешнему ключу product_id.
CREATE INDEX "vehicle_hotspots_product_id_idx" ON "public"."vehicle_hotspots" USING "btree" ("product_id") WHERE ("product_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "audit_brands" AFTER INSERT OR DELETE OR UPDATE ON "public"."brands" FOR EACH ROW EXECUTE FUNCTION "public"."record_admin_mutation"();



CREATE OR REPLACE TRIGGER "audit_categories" AFTER INSERT OR DELETE OR UPDATE ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."record_admin_mutation"();



CREATE OR REPLACE TRIGGER "audit_category_brands" AFTER INSERT OR DELETE OR UPDATE ON "public"."category_brands" FOR EACH ROW EXECUTE FUNCTION "public"."record_admin_mutation"();



CREATE OR REPLACE TRIGGER "audit_product_brands" AFTER INSERT OR DELETE OR UPDATE ON "public"."product_brands" FOR EACH ROW EXECUTE FUNCTION "public"."record_admin_mutation"();



CREATE OR REPLACE TRIGGER "audit_product_characteristics" AFTER INSERT OR DELETE OR UPDATE ON "public"."product_characteristics" FOR EACH ROW EXECUTE FUNCTION "public"."record_admin_mutation"();



CREATE OR REPLACE TRIGGER "audit_product_images" AFTER INSERT OR DELETE OR UPDATE ON "public"."product_images" FOR EACH ROW EXECUTE FUNCTION "public"."record_admin_mutation"();



CREATE OR REPLACE TRIGGER "audit_product_vehicle_types" AFTER INSERT OR DELETE OR UPDATE ON "public"."product_vehicle_types" FOR EACH ROW EXECUTE FUNCTION "public"."record_admin_mutation"();



CREATE OR REPLACE TRIGGER "audit_products" AFTER INSERT OR DELETE OR UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."record_admin_mutation"();



CREATE OR REPLACE TRIGGER "audit_subcategories" AFTER INSERT OR DELETE OR UPDATE ON "public"."subcategories" FOR EACH ROW EXECUTE FUNCTION "public"."record_admin_mutation"();



CREATE OR REPLACE TRIGGER "audit_vehicle_types" AFTER INSERT OR DELETE OR UPDATE ON "public"."vehicle_types" FOR EACH ROW EXECUTE FUNCTION "public"."record_admin_mutation"();



CREATE OR REPLACE TRIGGER "audit_vehicle_hotspots" AFTER INSERT OR DELETE OR UPDATE ON "public"."vehicle_hotspots" FOR EACH ROW EXECUTE FUNCTION "public"."record_admin_mutation"();



CREATE OR REPLACE TRIGGER "brands_refresh_product_search_text" AFTER UPDATE OF "name", "aliases" ON "public"."brands" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_product_search_from_brand"();



CREATE OR REPLACE TRIGGER "categories_refresh_product_search_text" AFTER UPDATE OF "name" ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_product_search_from_category"();



CREATE OR REPLACE TRIGGER "product_brands_refresh_search_text" AFTER INSERT OR DELETE OR UPDATE ON "public"."product_brands" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_product_search_from_child"();



CREATE OR REPLACE TRIGGER "product_characteristics_refresh_search_text" AFTER INSERT OR DELETE OR UPDATE ON "public"."product_characteristics" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_product_search_from_child"();



CREATE OR REPLACE TRIGGER "products_refresh_search_text" AFTER INSERT OR UPDATE OF "name", "article", "short_description", "description", "category_slug", "subcategory_id" ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_product_search_from_product"();



CREATE OR REPLACE TRIGGER "products_detach_vehicle_hotspots_when_unpublished" AFTER UPDATE OF "published" ON "public"."products" FOR EACH ROW WHEN ((("old"."published" IS TRUE) AND ("new"."published" IS FALSE))) EXECUTE FUNCTION "public"."detach_vehicle_hotspots_from_unpublished_product"();



CREATE OR REPLACE TRIGGER "subcategories_refresh_product_search_text" AFTER UPDATE OF "name", "category_slug" ON "public"."subcategories" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_product_search_from_subcategory"();



ALTER TABLE ONLY "public"."category_brands"
    ADD CONSTRAINT "category_brands_brand_slug_fkey" FOREIGN KEY ("brand_slug") REFERENCES "public"."brands"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."category_brands"
    ADD CONSTRAINT "category_brands_category_slug_fkey" FOREIGN KEY ("category_slug") REFERENCES "public"."categories"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_brands"
    ADD CONSTRAINT "product_brands_brand_slug_fkey" FOREIGN KEY ("brand_slug") REFERENCES "public"."brands"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_brands"
    ADD CONSTRAINT "product_brands_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_characteristics"
    ADD CONSTRAINT "product_characteristics_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_images"
    ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_vehicle_types"
    ADD CONSTRAINT "product_vehicle_types_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_vehicle_types"
    ADD CONSTRAINT "product_vehicle_types_vehicle_type_slug_fkey" FOREIGN KEY ("vehicle_type_slug") REFERENCES "public"."vehicle_types"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_category_slug_fkey" FOREIGN KEY ("category_slug") REFERENCES "public"."categories"("slug");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "public"."subcategories"("id");



ALTER TABLE ONLY "public"."subcategories"
    ADD CONSTRAINT "subcategories_category_slug_fkey" FOREIGN KEY ("category_slug") REFERENCES "public"."categories"("slug") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_hotspots"
    ADD CONSTRAINT "vehicle_hotspots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."vehicle_hotspots"
    ADD CONSTRAINT "vehicle_hotspots_vehicle_type_slug_fkey" FOREIGN KEY ("vehicle_type_slug") REFERENCES "public"."vehicle_types"("slug") ON DELETE CASCADE;



CREATE POLICY "Public can read brands" ON "public"."brands" FOR SELECT USING (true);



CREATE POLICY "Public can read brands of published products" ON "public"."product_brands" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."products" "p"
  WHERE (("p"."id" = "product_brands"."product_id") AND ("p"."published" = true)))));



CREATE POLICY "Public can read categories" ON "public"."categories" FOR SELECT USING (true);



CREATE POLICY "Public can read category_brands" ON "public"."category_brands" FOR SELECT USING (true);



CREATE POLICY "Public can read characteristics of published products" ON "public"."product_characteristics" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."products" "p"
  WHERE (("p"."id" = "product_characteristics"."product_id") AND ("p"."published" = true)))));



CREATE POLICY "Public can read images of published products" ON "public"."product_images" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."products" "p"
  WHERE (("p"."id" = "product_images"."product_id") AND ("p"."published" = true)))));



CREATE POLICY "Public can read published products" ON "public"."products" FOR SELECT USING (("published" = true));



CREATE POLICY "Public can read subcategories" ON "public"."subcategories" FOR SELECT USING (true);



CREATE POLICY "Public can read vehicle types of published products" ON "public"."product_vehicle_types" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."products" "p"
  WHERE (("p"."id" = "product_vehicle_types"."product_id") AND ("p"."published" = true)))));



CREATE POLICY "Public can read vehicle_hotspots" ON "public"."vehicle_hotspots" FOR SELECT USING (true);



CREATE POLICY "Public can read vehicle_types" ON "public"."vehicle_types" FOR SELECT USING (true);



ALTER TABLE "public"."admin_audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_auth_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_login_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."brands" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."category_brands" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_brands" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_characteristics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_images" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_vehicle_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subcategories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_hotspots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vehicle_types" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



-- QA-013: публичному каталогу нужны ровно две функции поиска. Раньше
-- `normalize_catalog_search` держалась на умолчании «EXECUTE для PUBLIC»;
-- после снятия этого умолчания её доступ объявляется явно.
REVOKE ALL ON FUNCTION "public"."normalize_catalog_search"("value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."normalize_catalog_search"("value" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."normalize_catalog_search"("value" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."normalize_catalog_search"("value" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."detach_vehicle_hotspots_from_unpublished_product"() FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."detach_vehicle_hotspots_from_unpublished_product"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."record_admin_mutation"() FROM PUBLIC, "anon", "authenticated";



REVOKE ALL ON FUNCTION "public"."refresh_product_search_from_brand"() FROM PUBLIC, "anon", "authenticated";



REVOKE ALL ON FUNCTION "public"."refresh_product_search_from_category"() FROM PUBLIC, "anon", "authenticated";



REVOKE ALL ON FUNCTION "public"."refresh_product_search_from_child"() FROM PUBLIC, "anon", "authenticated";



REVOKE ALL ON FUNCTION "public"."refresh_product_search_from_product"() FROM PUBLIC, "anon", "authenticated";



REVOKE ALL ON FUNCTION "public"."refresh_product_search_from_subcategory"() FROM PUBLIC, "anon", "authenticated";



REVOKE ALL ON FUNCTION "public"."refresh_product_search_text"("target_product_id" "uuid") FROM PUBLIC, "anon", "authenticated";

-- Найдено нагрузочной проверкой Фазы 3.2, а не раньше: все прежние проверки
-- этой функции шли через MCP execute_sql или "psql -U postgres" —
-- суперпользователь, который REVOKE попросту не касается. Через PostgREST
-- admin-запись идёт от service_role (createAdminClient), и триггер
-- products_refresh_search_text вызывает эту функцию изнутри SECURITY INVOKER
-- цепочки — исполняется с правами того, кто сделал запись, то есть
-- service_role. Без явного GRANT это "permission denied", AFTER-триггер
-- прерывает всю операцию, и создание/редактирование ЛЮБОГО товара через
-- настоящую админку падает целиком. Сами триггерные функции-обёртки
-- (refresh_product_search_from_*) грантов не требуют — вызов триггера не
-- проверяет EXECUTE, это подтверждено эмпирически: без этого гранта ошибка
-- возникает именно на внутреннем вызове, а не на срабатывании триггера.
GRANT EXECUTE ON FUNCTION "public"."refresh_product_search_text"("target_product_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."register_admin_login_attempt"("attempt_key_hash" "text", "password_is_valid" boolean, "attempt_scope" "text") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."register_admin_login_attempt"("attempt_key_hash" "text", "password_is_valid" boolean, "attempt_scope" "text") TO "service_role";


-- Функции сортировки вызываются только административным слоем через
-- service_role. Postgres выдаёт EXECUTE роли PUBLIC по умолчанию, а anon и
-- authenticated наследуют от неё, поэтому право снимается именно с PUBLIC —
-- иначе любой посетитель мог бы переставлять порядок каталога.
REVOKE ALL ON FUNCTION "public"."reorder_products"("ordered_slugs" "text"[]) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_products"("ordered_slugs" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_brands"("ordered_slugs" "text"[]) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_brands"("ordered_slugs" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_categories"("ordered_slugs" "text"[]) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_categories"("ordered_slugs" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_vehicle_types"("ordered_slugs" "text"[]) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_vehicle_types"("ordered_slugs" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."assert_reorder_identifiers"("identifiers" "anyarray") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."assert_reorder_identifiers"("identifiers" "anyarray") TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_subcategories"("target_category_slug" "text", "ordered_ids" "uuid"[]) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_subcategories"("target_category_slug" "text", "ordered_ids" "uuid"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_product_images"("target_product_slug" "text", "ordered_ids" "uuid"[]) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_product_images"("target_product_slug" "text", "ordered_ids" "uuid"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_category_brands"("target_category_slug" "text", "ordered_brand_slugs" "text"[]) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_category_brands"("target_category_slug" "text", "ordered_brand_slugs" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."record_admin_auth_failure"("p_key_hash" "text", "p_scope" "text", "p_attempt_at" timestamp with time zone) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."record_admin_auth_failure"("p_key_hash" "text", "p_scope" "text", "p_attempt_at" timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."begin_admin_auth_attempt"("p_key_hash" "text", "p_scope" "text", "p_ttl_seconds" integer, "p_max_concurrent" integer) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."begin_admin_auth_attempt"("p_key_hash" "text", "p_scope" "text", "p_ttl_seconds" integer, "p_max_concurrent" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."finish_admin_auth_attempt"("p_reservation_id" "uuid", "p_password_is_valid" boolean) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."finish_admin_auth_attempt"("p_reservation_id" "uuid", "p_password_is_valid" boolean) TO "service_role";

REVOKE ALL ON TABLE "public"."admin_auth_reservations" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."admin_auth_reservations" TO "service_role";

REVOKE ALL ON FUNCTION "public"."claim_product_image_staging"("p_draft_id" "uuid", "p_object_path" "text", "p_content_type" "text", "p_byte_size" bigint, "p_ttl_seconds" integer, "p_max_files" integer) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."claim_product_image_staging"("p_draft_id" "uuid", "p_object_path" "text", "p_content_type" "text", "p_byte_size" bigint, "p_ttl_seconds" integer, "p_max_files" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."list_abandoned_product_image_staging"("p_limit" integer) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."list_abandoned_product_image_staging"("p_limit" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."release_product_image_staging"("p_ids" "uuid"[]) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."release_product_image_staging"("p_ids" "uuid"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."finalize_product_image_staging"("p_id" "uuid") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_product_image_staging"("p_id" "uuid") TO "service_role";

REVOKE ALL ON TABLE "public"."product_image_staging" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."product_image_staging" TO "service_role";

REVOKE ALL ON FUNCTION "public"."resolve_product_references"("p_category_slug" "text", "p_subcategory_slug" "text", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_product_references"("p_category_slug" "text", "p_subcategory_slug" "text", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."write_product_characteristics"("p_product_id" "uuid", "p_characteristics" "jsonb") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."write_product_characteristics"("p_product_id" "uuid", "p_characteristics" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."create_product_with_relations"("p_slug_base" "text", "p_name" "text", "p_category_slug" "text", "p_subcategory_slug" "text", "p_short_description" "text", "p_description" "text", "p_article" "text", "p_published" boolean, "p_availability" "public"."product_availability", "p_meta_title" "text", "p_meta_description" "text", "p_characteristics" "jsonb", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."create_product_with_relations"("p_slug_base" "text", "p_name" "text", "p_category_slug" "text", "p_subcategory_slug" "text", "p_short_description" "text", "p_description" "text", "p_article" "text", "p_published" boolean, "p_availability" "public"."product_availability", "p_meta_title" "text", "p_meta_description" "text", "p_characteristics" "jsonb", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."update_product_with_relations"("p_slug" "text", "p_expected_updated_at" timestamp with time zone, "p_name" "text", "p_category_slug" "text", "p_subcategory_slug" "text", "p_short_description" "text", "p_description" "text", "p_article" "text", "p_published" boolean, "p_availability" "public"."product_availability", "p_meta_title" "text", "p_meta_description" "text", "p_characteristics" "jsonb", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."update_product_with_relations"("p_slug" "text", "p_expected_updated_at" timestamp with time zone, "p_name" "text", "p_category_slug" "text", "p_subcategory_slug" "text", "p_short_description" "text", "p_description" "text", "p_article" "text", "p_published" boolean, "p_availability" "public"."product_availability", "p_meta_title" "text", "p_meta_description" "text", "p_characteristics" "jsonb", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."update_vehicle_hotspots"("target_vehicle_type_slug" "text", "hotspot_updates" "jsonb") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."update_vehicle_hotspots"("target_vehicle_type_slug" "text", "hotspot_updates" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."update_vehicle_hotspot_assignments"("assignment_updates" "jsonb") FROM PUBLIC, "anon", "authenticated";
REVOKE ALL ON FUNCTION "public"."update_vehicle_hotspot_assignments"("assignment_updates" "jsonb") FROM "anon";
REVOKE ALL ON FUNCTION "public"."update_vehicle_hotspot_assignments"("assignment_updates" "jsonb") FROM "authenticated";
GRANT ALL ON FUNCTION "public"."update_vehicle_hotspot_assignments"("assignment_updates" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."restore_vehicle_hotspots"("target_vehicle_type_slug" "text", "expected_hotspot_updates" "jsonb", "prior_hotspot_updates" "jsonb") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."restore_vehicle_hotspots"("target_vehicle_type_slug" "text", "expected_hotspot_updates" "jsonb", "prior_hotspot_updates" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."import_products_batch"("rows" "jsonb") FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON FUNCTION "public"."import_products_batch"("rows" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_catalog_products"("search_query" "text", "category_filter" "text", "subcategory_filter" "text", "brand_filter" "text", "vehicle_type_filter" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_catalog_products"("search_query" "text", "category_filter" "text", "subcategory_filter" "text", "brand_filter" "text", "vehicle_type_filter" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."search_catalog_products"("search_query" "text", "category_filter" "text", "subcategory_filter" "text", "brand_filter" "text", "vehicle_type_filter" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_catalog_products"("search_query" "text", "category_filter" "text", "subcategory_filter" "text", "brand_filter" "text", "vehicle_type_filter" "text") TO "service_role";



REVOKE ALL ON TABLE "public"."admin_audit_log" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."admin_audit_log" TO "service_role";


GRANT ALL ON TABLE "public"."admin_auth_events" TO "service_role";

REVOKE ALL ON TABLE "public"."admin_auth_events" FROM "anon";
REVOKE ALL ON TABLE "public"."admin_auth_events" FROM "authenticated";
REVOKE ALL ON TABLE "public"."admin_auth_events" FROM PUBLIC;



REVOKE ALL ON SEQUENCE "public"."admin_audit_log_id_seq" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON SEQUENCE "public"."admin_audit_log_id_seq" TO "service_role";


GRANT ALL ON SEQUENCE "public"."admin_auth_events_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."admin_auth_events_id_seq" FROM "anon";
REVOKE ALL ON SEQUENCE "public"."admin_auth_events_id_seq" FROM "authenticated";
REVOKE ALL ON SEQUENCE "public"."admin_auth_events_id_seq" FROM PUBLIC;



REVOKE ALL ON TABLE "public"."admin_login_rate_limits" FROM PUBLIC, "anon", "authenticated";
GRANT ALL ON TABLE "public"."admin_login_rate_limits" TO "service_role";



GRANT SELECT ON TABLE "public"."brands" TO "anon";
GRANT SELECT ON TABLE "public"."brands" TO "authenticated";
GRANT ALL ON TABLE "public"."brands" TO "service_role";



GRANT SELECT ON TABLE "public"."categories" TO "anon";
GRANT SELECT ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT SELECT ON TABLE "public"."category_brands" TO "anon";
GRANT SELECT ON TABLE "public"."category_brands" TO "authenticated";
GRANT ALL ON TABLE "public"."category_brands" TO "service_role";



GRANT SELECT ON TABLE "public"."product_brands" TO "anon";
GRANT SELECT ON TABLE "public"."product_brands" TO "authenticated";
GRANT ALL ON TABLE "public"."product_brands" TO "service_role";



GRANT SELECT ON TABLE "public"."product_characteristics" TO "anon";
GRANT SELECT ON TABLE "public"."product_characteristics" TO "authenticated";
GRANT ALL ON TABLE "public"."product_characteristics" TO "service_role";



GRANT SELECT ON TABLE "public"."product_images" TO "anon";
GRANT SELECT ON TABLE "public"."product_images" TO "authenticated";
GRANT ALL ON TABLE "public"."product_images" TO "service_role";



GRANT SELECT ON TABLE "public"."product_vehicle_types" TO "anon";
GRANT SELECT ON TABLE "public"."product_vehicle_types" TO "authenticated";
GRANT ALL ON TABLE "public"."product_vehicle_types" TO "service_role";



GRANT SELECT ON TABLE "public"."products" TO "anon";
GRANT SELECT ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT SELECT ON TABLE "public"."subcategories" TO "anon";
GRANT SELECT ON TABLE "public"."subcategories" TO "authenticated";
GRANT ALL ON TABLE "public"."subcategories" TO "service_role";



GRANT SELECT ON TABLE "public"."vehicle_hotspots" TO "anon";
GRANT SELECT ON TABLE "public"."vehicle_hotspots" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_hotspots" TO "service_role";



GRANT SELECT ON TABLE "public"."vehicle_types" TO "anon";
GRANT SELECT ON TABLE "public"."vehicle_types" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_types" TO "service_role";



-- QA-013: default privileges — вторая половина проблемы. Без этих REVOKE-- каждая новая таблица, созданная миграцией от роли `postgres`, снова-- получала бы TRUNCATE для `anon`, а каждая новая функция — EXECUTE.-- Разовый REVOKE по существующим объектам такую регрессию не удержит.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM PUBLIC, "anon", "authenticated";
-- Отдельная строка без `IN SCHEMA` — не дубль предыдущей: итоговые права
-- нового объекта считаются как объединение глобальной и схемной записи, и при
-- отсутствии глобальной её место занимает встроенное умолчание Postgres, где у
-- функций есть EXECUTE для PUBLIC. Без этой строки PUBLIC возвращается.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
