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
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  field_names text[] := '{}';
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
    where to_jsonb(old) -> field.key is distinct from field.value;
  elsif tg_op = 'INSERT' then
    field_names := array['created'];
  else
    field_names := array['deleted'];
  end if;

  insert into public.admin_audit_log (
    actor,
    action,
    entity_type,
    entity_key,
    changed_fields
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
    field_names
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


CREATE OR REPLACE FUNCTION "public"."register_admin_login_attempt"("attempt_key_hash" "text", "password_is_valid" boolean) RETURNS integer
    LANGUAGE "plpgsql"
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
  perform pg_advisory_xact_lock(hashtextextended(attempt_key_hash, 0));

  select *
  into current_row
  from public.admin_login_rate_limits
  where key_hash = attempt_key_hash
  for update;

  if found and current_row.blocked_until is not null and current_row.blocked_until > attempt_at then
    return greatest(1, ceil(extract(epoch from (current_row.blocked_until - attempt_at)))::integer);
  end if;

  if password_is_valid then
    delete from public.admin_login_rate_limits where key_hash = attempt_key_hash;
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

  if next_blocked_until is not null then
    return ceil(extract(epoch from (next_blocked_until - attempt_at)))::integer;
  end if;

  return 0;
end;
$$;


ALTER FUNCTION "public"."register_admin_login_attempt"("attempt_key_hash" "text", "password_is_valid" boolean) OWNER TO "postgres";


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
    cover.url as cover_url,
    cover.scale as cover_scale,
    coalesce(brands.slugs, '{}') as compatible_brands
  from public.products as product
  cross join normalized_query
  left join public.subcategories as subcategory on subcategory.id = product.subcategory_id
  left join lateral (
    select image.url, image.scale
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
-- reorder_products устроен иначе остальных: он не перенумеровывает записи
-- подряд, а перераспределяет уже занятые ими значения "order". Набор значений
-- сохраняется, товары вне выборки не затрагиваются. Благодаря этому порядок
-- остаётся сквозным по всему каталогу, а перетаскивание работает в любом
-- отфильтрованном или постраничном срезе — иначе при 2000 товарах пришлось бы
-- либо отказаться от сортировки мышью, либо сделать порядок внутрикатегорийным.
CREATE OR REPLACE FUNCTION "public"."reorder_products"("ordered_slugs" "text"[]) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  with "desired" as (
    select "slug", "ordinality" as "position"
    from unnest("ordered_slugs") with ordinality as "u"("slug", "ordinality")
  ), "slots" as (
    select
      "product"."order" as "slot",
      row_number() over (order by "product"."order", "product"."name") as "position"
    from "public"."products" as "product"
    join "desired" on "desired"."slug" = "product"."slug"
  )
  update "public"."products" as "product"
  set "order" = "slots"."slot"
  from "desired"
  join "slots" on "slots"."position" = "desired"."position"
  where "product"."slug" = "desired"."slug"
    and "product"."order" is distinct from "slots"."slot";
$$;


ALTER FUNCTION "public"."reorder_products"("ordered_slugs" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_brands"("ordered_slugs" "text"[]) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  update "public"."brands" as "brand"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_slugs") with ordinality as "desired"("slug", "ordinality")
  where "brand"."slug" = "desired"."slug"
    and "brand"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$$;


ALTER FUNCTION "public"."reorder_brands"("ordered_slugs" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_categories"("ordered_slugs" "text"[]) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  update "public"."categories" as "category"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_slugs") with ordinality as "desired"("slug", "ordinality")
  where "category"."slug" = "desired"."slug"
    and "category"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$$;


ALTER FUNCTION "public"."reorder_categories"("ordered_slugs" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_vehicle_types"("ordered_slugs" "text"[]) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  update "public"."vehicle_types" as "vehicle_type"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_slugs") with ordinality as "desired"("slug", "ordinality")
  where "vehicle_type"."slug" = "desired"."slug"
    and "vehicle_type"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$$;


ALTER FUNCTION "public"."reorder_vehicle_types"("ordered_slugs" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_subcategories"("ordered_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  update "public"."subcategories" as "subcategory"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_ids") with ordinality as "desired"("id", "ordinality")
  where "subcategory"."id" = "desired"."id"
    and "subcategory"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$$;


ALTER FUNCTION "public"."reorder_subcategories"("ordered_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_product_images"("ordered_ids" "uuid"[]) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  update "public"."product_images" as "image"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_ids") with ordinality as "desired"("id", "ordinality")
  where "image"."id" = "desired"."id"
    and "image"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$$;


ALTER FUNCTION "public"."reorder_product_images"("ordered_ids" "uuid"[]) OWNER TO "postgres";


-- Порядок брендов задаётся внутри категории, поэтому ключ составной.
CREATE OR REPLACE FUNCTION "public"."reorder_category_brands"("target_category_slug" "text", "ordered_brand_slugs" "text"[]) RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  update "public"."category_brands" as "link"
  set "order" = ("desired"."ordinality" - 1)::integer
  from unnest("ordered_brand_slugs") with ordinality as "desired"("brand_slug", "ordinality")
  where "link"."category_slug" = "target_category_slug"
    and "link"."brand_slug" = "desired"."brand_slug"
    and "link"."order" is distinct from ("desired"."ordinality" - 1)::integer;
$$;


ALTER FUNCTION "public"."reorder_category_brands"("target_category_slug" "text", "ordered_brand_slugs" "text"[]) OWNER TO "postgres";


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
  duplicate_product_count integer;
  invalid_product_count integer;
  outside_assignment_count integer;
begin
  if nullif(btrim(target_vehicle_type_slug), '') is null then
    raise exception 'Vehicle type is required' using errcode = 'P0001';
  end if;

  if jsonb_typeof(hotspot_updates) is distinct from 'array' then
    raise exception 'Hotspot updates must be an array' using errcode = 'P0001';
  end if;

  perform 1
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_vehicle_type_slug
  for update;

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
  into duplicate_product_count
  from (
    select submitted.product_id
    from submitted
    where submitted.product_id is not null
    group by submitted.product_id
    having count(*) > 1
  ) as duplicate_product;

  if duplicate_product_count <> 0 then
    raise exception 'A product may be assigned to only one hotspot' using errcode = 'P0001';
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

  with submitted as (
    select
      (entry.value ->> 'id')::uuid as id,
      nullif(entry.value ->> 'productId', '')::uuid as product_id
    from jsonb_array_elements(hotspot_updates) as entry(value)
  )
  select count(*)
  into outside_assignment_count
  from public.vehicle_hotspots as assigned_hotspot
  join submitted on submitted.product_id = assigned_hotspot.product_id
  where assigned_hotspot.product_id is not null
    and not exists (
      select 1
      from submitted as submitted_hotspot
      where submitted_hotspot.id = assigned_hotspot.id
    );

  if outside_assignment_count <> 0 then
    raise exception 'A selected product is already assigned to another hotspot' using errcode = 'P0001';
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

  perform 1
  from public.vehicle_hotspots as hotspot
  where hotspot.vehicle_type_slug = target_vehicle_type_slug
  for update;

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
    "aliases" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."brands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."categories" (
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "icon" "text" NOT NULL,
    "image" "text" NOT NULL,
    "intro" "text",
    "type" "text" NOT NULL,
    "order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "categories_type_check" CHECK (("type" = ANY (ARRAY['subcategory'::"text", 'brand'::"text"])))
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."category_brands" (
    "category_slug" "text" NOT NULL,
    "brand_slug" "text" NOT NULL,
    "logo_scale_override" numeric,
    "order" integer DEFAULT 0 NOT NULL
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


CREATE TABLE IF NOT EXISTS "public"."product_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "product_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "order" integer DEFAULT 0 NOT NULL,
    "scale" numeric
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
    "order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_text" "text" DEFAULT ''::"text" NOT NULL
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



-- Один товар закрепляется максимум за одной точкой. Исторические дубли
-- очищаются детерминированно в миграции 20260815102954 до создания индекса;
-- частичный индекс не индексирует заглушки (NULL), но покрывает все реальные
-- product_id.
CREATE UNIQUE INDEX "vehicle_hotspots_product_id_unique" ON "public"."vehicle_hotspots" USING "btree" ("product_id") WHERE ("product_id" IS NOT NULL);



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



REVOKE ALL ON FUNCTION "public"."record_admin_mutation"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."refresh_product_search_from_brand"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."refresh_product_search_from_category"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."refresh_product_search_from_child"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."refresh_product_search_from_product"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."refresh_product_search_from_subcategory"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."refresh_product_search_text"("target_product_id" "uuid") FROM PUBLIC;

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



REVOKE ALL ON FUNCTION "public"."register_admin_login_attempt"("attempt_key_hash" "text", "password_is_valid" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."register_admin_login_attempt"("attempt_key_hash" "text", "password_is_valid" boolean) TO "service_role";


-- Функции сортировки вызываются только административным слоем через
-- service_role. Postgres выдаёт EXECUTE роли PUBLIC по умолчанию, а anon и
-- authenticated наследуют от неё, поэтому право снимается именно с PUBLIC —
-- иначе любой посетитель мог бы переставлять порядок каталога.
REVOKE ALL ON FUNCTION "public"."reorder_products"("ordered_slugs" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_products"("ordered_slugs" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_brands"("ordered_slugs" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_brands"("ordered_slugs" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_categories"("ordered_slugs" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_categories"("ordered_slugs" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_vehicle_types"("ordered_slugs" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_vehicle_types"("ordered_slugs" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_subcategories"("ordered_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_subcategories"("ordered_ids" "uuid"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_product_images"("ordered_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_product_images"("ordered_ids" "uuid"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."reorder_category_brands"("target_category_slug" "text", "ordered_brand_slugs" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_category_brands"("target_category_slug" "text", "ordered_brand_slugs" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."update_vehicle_hotspots"("target_vehicle_type_slug" "text", "hotspot_updates" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_vehicle_hotspots"("target_vehicle_type_slug" "text", "hotspot_updates" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."restore_vehicle_hotspots"("target_vehicle_type_slug" "text", "expected_hotspot_updates" "jsonb", "prior_hotspot_updates" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restore_vehicle_hotspots"("target_vehicle_type_slug" "text", "expected_hotspot_updates" "jsonb", "prior_hotspot_updates" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."import_products_batch"("rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."import_products_batch"("rows" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_catalog_products"("search_query" "text", "category_filter" "text", "subcategory_filter" "text", "brand_filter" "text", "vehicle_type_filter" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."search_catalog_products"("search_query" "text", "category_filter" "text", "subcategory_filter" "text", "brand_filter" "text", "vehicle_type_filter" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_catalog_products"("search_query" "text", "category_filter" "text", "subcategory_filter" "text", "brand_filter" "text", "vehicle_type_filter" "text") TO "service_role";



GRANT ALL ON TABLE "public"."admin_audit_log" TO "service_role";



GRANT UPDATE ON SEQUENCE "public"."admin_audit_log_id_seq" TO "anon";
GRANT UPDATE ON SEQUENCE "public"."admin_audit_log_id_seq" TO "authenticated";
GRANT UPDATE ON SEQUENCE "public"."admin_audit_log_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admin_login_rate_limits" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."brands" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."brands" TO "authenticated";
GRANT ALL ON TABLE "public"."brands" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."categories" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."categories" TO "authenticated";
GRANT ALL ON TABLE "public"."categories" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_brands" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."category_brands" TO "authenticated";
GRANT ALL ON TABLE "public"."category_brands" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_brands" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_brands" TO "authenticated";
GRANT ALL ON TABLE "public"."product_brands" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_characteristics" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_characteristics" TO "authenticated";
GRANT ALL ON TABLE "public"."product_characteristics" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_images" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_images" TO "authenticated";
GRANT ALL ON TABLE "public"."product_images" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_vehicle_types" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."product_vehicle_types" TO "authenticated";
GRANT ALL ON TABLE "public"."product_vehicle_types" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."products" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."subcategories" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."subcategories" TO "authenticated";
GRANT ALL ON TABLE "public"."subcategories" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vehicle_hotspots" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vehicle_hotspots" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_hotspots" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vehicle_types" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."vehicle_types" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_types" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
