-- Журнал изменений хранил только имена изменённых полей. Добавляем сами
-- значения до/после, чтобы показать реальный диф в UI. Записи, созданные до
-- этой миграции, останутся с old_values/new_values = NULL — UI обязан
-- деградировать до текущего вида (список имён полей), а не падать.
ALTER TABLE "public"."admin_audit_log"
  ADD COLUMN "old_values" "jsonb",
  ADD COLUMN "new_values" "jsonb";

-- Служебные/генерируемые поля исключены из дифа: search_text — производный
-- полнотекстовый индекс, created_at/updated_at — временные метки, order —
-- меняется при каждом drag-n-drop и не несёт содержательной информации
-- (решение подтверждено владельцем — иначе журнал тонет в перестановках).
SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.record_admin_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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

    -- An UPDATE that only touched ignored_keys (the common case: a drag-n-drop
    -- reorder writing only `order`) has nothing worth journaling — skip the
    -- insert entirely instead of recording an empty, unexplained entry.
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
$function$;
