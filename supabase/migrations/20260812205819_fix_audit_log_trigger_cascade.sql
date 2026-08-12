-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.record_admin_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
$function$;