create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  entity_type text not null,
  entity_key text,
  changed_fields text[] not null default '{}'
);

alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from anon, authenticated;
grant select on table public.admin_audit_log to service_role;

create index admin_audit_log_occurred_at_idx
  on public.admin_audit_log (occurred_at desc);
create index admin_audit_log_entity_idx
  on public.admin_audit_log (entity_type, entity_key, occurred_at desc);

create or replace function public.record_admin_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  field_names text[] := '{}';
begin
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

revoke execute on function public.record_admin_mutation()
  from public, anon, authenticated;

create trigger audit_products
after insert or update or delete on public.products
for each row execute function public.record_admin_mutation();

create trigger audit_product_images
after insert or update or delete on public.product_images
for each row execute function public.record_admin_mutation();

create trigger audit_product_characteristics
after insert or update or delete on public.product_characteristics
for each row execute function public.record_admin_mutation();

create trigger audit_product_brands
after insert or update or delete on public.product_brands
for each row execute function public.record_admin_mutation();

create trigger audit_product_vehicle_types
after insert or update or delete on public.product_vehicle_types
for each row execute function public.record_admin_mutation();

create trigger audit_categories
after insert or update or delete on public.categories
for each row execute function public.record_admin_mutation();

create trigger audit_subcategories
after insert or update or delete on public.subcategories
for each row execute function public.record_admin_mutation();

create trigger audit_brands
after insert or update or delete on public.brands
for each row execute function public.record_admin_mutation();

create trigger audit_category_brands
after insert or update or delete on public.category_brands
for each row execute function public.record_admin_mutation();

create trigger audit_vehicle_types
after insert or update or delete on public.vehicle_types
for each row execute function public.record_admin_mutation();
