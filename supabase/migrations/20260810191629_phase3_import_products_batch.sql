-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE FUNCTION public.import_products_batch (
  rows jsonb
)
  RETURNS TABLE (
    row_index     integer,
    slug          text,
    action        text,
    error_message text
  )
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.import_products_batch(jsonb) FROM PUBLIC;

GRANT ALL ON FUNCTION public.import_products_batch(jsonb) TO service_role;