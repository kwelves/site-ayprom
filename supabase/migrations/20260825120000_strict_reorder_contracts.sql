-- QA-003: reorder-функции жили в двух несовместимых моделях и ни одна не
-- проверяла переданный набор.
--
-- `reorder_products` переставлял записи внутри уже занятых ими значений `order`
-- (модель слотов) — это корректно работает с фильтрами и страницами админки.
-- Остальные присваивали абсолютные позиции `ordinality - 1`, поэтому неполный
-- набор молча перенумеровывал подмножество в 0..n-1 и сталкивал его со строками
-- вне набора.
--
-- Кроме того, порядок подкатегорий и фотографий не был ограничен родителем:
-- действие принимало `categorySlug`/`productSlug`, но в RPC его не передавало,
-- поэтому идентификаторы чужой категории или чужого товара перенумеровывались
-- без возражений.
--
-- Здесь все семь функций приводятся к модели слотов и получают единый контракт:
-- набор не может быть NULL, содержать NULL, дубликаты, неизвестные или чужие
-- идентификаторы. Модель слотов при этом остаётся перестановкой уже занятых
-- значений, то есть сама по себе не способна создать дубликат `order`.

-- Нормализация порядка фотографий выполняется до создания функций. В каталоге
-- есть товар с двумя фотографиями на одной позиции (order = 3): при равных
-- значениях порядок вывода зависел от плана запроса. Пересчёт делает его
-- плотным и детерминированным (0..n-1 внутри товара), попутно закрывая разрывы,
-- оставшиеся после удалений.
WITH "renumbered" AS (
  SELECT
    "id",
    (row_number() OVER (PARTITION BY "product_id" ORDER BY "order", "id") - 1)::integer AS "new_order"
  FROM "public"."product_images"
)
UPDATE "public"."product_images" AS "image"
SET "order" = "renumbered"."new_order"
FROM "renumbered"
WHERE "image"."id" = "renumbered"."id"
  AND "image"."order" IS DISTINCT FROM "renumbered"."new_order";


-- Общая проверка самого списка. Существование и принадлежность родителю
-- проверяются отдельно в каждой функции, потому что зависят от таблицы.
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
REVOKE ALL ON FUNCTION "public"."assert_reorder_identifiers"("identifiers" "anyarray") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."assert_reorder_identifiers"("identifiers" "anyarray") TO "service_role";


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


-- Подкатегории и фотографии получают обязательного родителя: без него любой
-- чужой идентификатор считался допустимым. Сигнатура меняется, поэтому старая
-- функция удаляется явно.
DROP FUNCTION IF EXISTS "public"."reorder_subcategories"("ordered_ids" "uuid"[]);

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
REVOKE ALL ON FUNCTION "public"."reorder_subcategories"("target_category_slug" "text", "ordered_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_subcategories"("target_category_slug" "text", "ordered_ids" "uuid"[]) TO "service_role";


DROP FUNCTION IF EXISTS "public"."reorder_product_images"("ordered_ids" "uuid"[]);

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
REVOKE ALL ON FUNCTION "public"."reorder_product_images"("target_product_slug" "text", "ordered_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_product_images"("target_product_slug" "text", "ordered_ids" "uuid"[]) TO "service_role";


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
