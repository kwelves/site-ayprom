-- QA-002: создание и редактирование товара не были единой транзакцией.
--
-- `createProduct` вставлял товар, затем тремя отдельными запросами писал
-- связанные таблицы, а при сбое выполнял компенсирующий DELETE. Если падал сам
-- компенсирующий DELETE, в базе оставался частичный товар — код признавал это
-- текстом «Очистка: не удалось удалить неполную запись».
--
-- `updateProduct` был хуже: delete+insert по трём дочерним таблицам вообще без
-- компенсации. Сбой на середине оставлял товар обновлённым, но, например, с
-- полностью стёртыми совместимыми брендами.
--
-- Ни один из путей не проверял конкуренцию: два администратора, открывшие одну
-- карточку, молча перезаписывали правки друг друга.
--
-- Здесь обе операции переносятся в Postgres целиком. Функция — одна транзакция,
-- поэтому любая ошибка (включая срабатывание триггеров и нарушение внешнего
-- ключа) откатывает всё, а компенсирующая логика становится не нужна.
--
-- Загрузка фотографий сознательно остаётся снаружи: это Storage, он не
-- участвует в транзакции Postgres. Его жизненный цикл — предмет фазы 3 (QA-004).


-- Проверка ссылок и разрешение подкатегории. Вынесена отдельно, потому что
-- нужна обеим операциям и должна выполняться до записи: иначе некорректная
-- связь могла бы изменить публикацию товара (и запустить триггер отвязки
-- хотспотов) раньше, чем обнаружится ошибка.
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
REVOKE ALL ON FUNCTION "public"."resolve_product_references"("p_category_slug" "text", "p_subcategory_slug" "text", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_product_references"("p_category_slug" "text", "p_subcategory_slug" "text", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) TO "service_role";


-- Запись характеристик общая для создания и обновления.
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
REVOKE ALL ON FUNCTION "public"."write_product_characteristics"("p_product_id" "uuid", "p_characteristics" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."write_product_characteristics"("p_product_id" "uuid", "p_characteristics" "jsonb") TO "service_role";


-- Создание товара со связями одной транзакцией.
--
-- Slug и порядок разрешаются внутри функции, а не в приложении: прежде это были
-- два отдельных «прочитать максимум, потом записать», то есть гонка между двумя
-- одновременными созданиями. Транслитерация остаётся в приложении — сюда
-- приходит уже готовая основа slug, а функция лишь обеспечивает уникальность.
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
REVOKE ALL ON FUNCTION "public"."create_product_with_relations"("p_slug_base" "text", "p_name" "text", "p_category_slug" "text", "p_subcategory_slug" "text", "p_short_description" "text", "p_description" "text", "p_article" "text", "p_published" boolean, "p_availability" "public"."product_availability", "p_meta_title" "text", "p_meta_description" "text", "p_characteristics" "jsonb", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_product_with_relations"("p_slug_base" "text", "p_name" "text", "p_category_slug" "text", "p_subcategory_slug" "text", "p_short_description" "text", "p_description" "text", "p_article" "text", "p_published" boolean, "p_availability" "public"."product_availability", "p_meta_title" "text", "p_meta_description" "text", "p_characteristics" "jsonb", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) TO "service_role";


-- Обновление товара со связями одной транзакцией и с проверкой версии.
--
-- `p_expected_updated_at` — оптимистическая блокировка: форма присылает ту
-- версию, которую видел администратор. NULL отвергается намеренно (fail-closed):
-- иначе устаревшая вкладка, не приславшая поле, обошла бы проверку молча — ровно
-- тот сценарий, который QA-002 требует закрыть.
--
-- Значение сравнивается с микросекундной точностью, поэтому приложение обязано
-- передавать строку из базы без разбора в Date: JS обрезает до миллисекунд и
-- сравнение стало бы ложно конфликтным.
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
REVOKE ALL ON FUNCTION "public"."update_product_with_relations"("p_slug" "text", "p_expected_updated_at" timestamp with time zone, "p_name" "text", "p_category_slug" "text", "p_subcategory_slug" "text", "p_short_description" "text", "p_description" "text", "p_article" "text", "p_published" boolean, "p_availability" "public"."product_availability", "p_meta_title" "text", "p_meta_description" "text", "p_characteristics" "jsonb", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_product_with_relations"("p_slug" "text", "p_expected_updated_at" timestamp with time zone, "p_name" "text", "p_category_slug" "text", "p_subcategory_slug" "text", "p_short_description" "text", "p_description" "text", "p_article" "text", "p_published" boolean, "p_availability" "public"."product_availability", "p_meta_title" "text", "p_meta_description" "text", "p_characteristics" "jsonb", "p_compatible_brands" "text"[], "p_vehicle_types" "text"[]) TO "service_role";
